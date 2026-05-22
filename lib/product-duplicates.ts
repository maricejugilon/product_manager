import type { ProductChanges, ProductMergeChanges, ProductVariationChanges, WooProduct } from "@/lib/types";

export type DuplicateProductGroup = {
  key: string;
  title: string;
  products: WooProduct[];
  matchReasons: string[];
};

export type ProductDetailSummary = {
  score: number;
  facts: string[];
};

type ProductMergeBuildOptions = {
  mode?: ProductMergeChanges["mode"];
  variationAttributeName?: string;
  targetVariationOption?: string;
  sourceVariationOption?: string;
};

function compactText(value: string | undefined | null) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProductName(name: string) {
  return compactText(name)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeSku(sku: string | undefined | null) {
  return compactText(sku).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function skuTokens(sku: string | undefined | null) {
  const value = compactText(sku).toLowerCase();
  const alphaNumericTokens = value
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && /\d/.test(token));
  const numericTokens = value.match(/\d{3,}/g) ?? [];

  return [...new Set([...alphaNumericTokens, ...numericTokens])];
}

function hasSkuContainment(first: string, second: string) {
  if (!first || !second || first === second) {
    return false;
  }

  const shorter = first.length < second.length ? first : second;
  const longer = first.length < second.length ? second : first;

  return shorter.length >= 3 && longer.includes(shorter);
}

function sharedSkuToken(firstSku: string, secondSku: string) {
  const firstTokens = new Set(skuTokens(firstSku));

  return skuTokens(secondSku).find((token) => firstTokens.has(token));
}

export function getProductDuplicateSignals(first: WooProduct, second: WooProduct) {
  const reasons: string[] = [];
  const firstName = normalizeProductName(first.name);
  const secondName = normalizeProductName(second.name);
  const firstSku = normalizeSku(first.sku);
  const secondSku = normalizeSku(second.sku);

  if (firstName && firstName === secondName) {
    reasons.push("Same normalized product name");
  }

  if (firstSku && secondSku && firstSku === secondSku) {
    reasons.push("Same SKU");
  } else if (hasSkuContainment(firstSku, secondSku)) {
    reasons.push("One SKU is contained in the other");
  }

  const sharedToken = sharedSkuToken(first.sku, second.sku);
  if (sharedToken && !reasons.includes("Same SKU")) {
    reasons.push(`Shared SKU part: ${sharedToken}`);
  }

  return reasons;
}

export function getProductDetailMatches(first: WooProduct, second: WooProduct) {
  const matches: string[] = [];
  const firstCategoryIds = new Set(first.categories.map((category) => category.id));
  const sharedCategories = second.categories.filter((category) => firstCategoryIds.has(category.id));

  if (first.regular_price && first.regular_price === second.regular_price) {
    matches.push("Same regular price");
  }

  if (first.sale_price && first.sale_price === second.sale_price) {
    matches.push("Same sale price");
  }

  if (first.stock_status === second.stock_status) {
    matches.push("Same stock status");
  }

  if (sharedCategories.length > 0) {
    matches.push(`Shared category: ${sharedCategories.map((category) => category.name ?? category.id).join(", ")}`);
  }

  if (compactText(first.short_description) && compactText(first.short_description) === compactText(second.short_description)) {
    matches.push("Same short description");
  }

  return matches;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function uniqueText(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function dedupeProductsById(products: WooProduct[]) {
  return [...new Map(products.map((product) => [product.id, product])).values()];
}

function productPairKey(firstId: number, secondId: number) {
  return [firstId, secondId].sort((a, b) => a - b).join("-");
}

function addCandidatePairs(pairs: Set<string>, ids: number[]) {
  const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);

  for (let firstIndex = 0; firstIndex < uniqueIds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < uniqueIds.length; secondIndex += 1) {
      pairs.add(productPairKey(uniqueIds[firstIndex], uniqueIds[secondIndex]));
    }
  }
}

function getCandidateDuplicatePairs(products: WooProduct[]) {
  const buckets = new Map<string, number[]>();

  function addBucket(key: string, productId: number) {
    if (!key) {
      return;
    }

    buckets.set(key, [...(buckets.get(key) ?? []), productId]);
  }

  for (const product of products) {
    addBucket(`name:${normalizeProductName(product.name)}`, product.id);
    addBucket(`sku:${normalizeSku(product.sku)}`, product.id);

    for (const token of skuTokens(product.sku)) {
      addBucket(`sku-token:${token}`, product.id);
    }
  }

  const pairs = new Set<string>();

  for (const ids of buckets.values()) {
    if (ids.length > 1) {
      addCandidatePairs(pairs, ids);
    }
  }

  return pairs;
}

class ProductUnion {
  private parents = new Map<number, number>();

  constructor(ids: number[]) {
    for (const id of ids) {
      this.parents.set(id, id);
    }
  }

  find(id: number): number {
    const parent = this.parents.get(id) ?? id;

    if (parent === id) {
      return id;
    }

    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(first: number, second: number) {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);

    if (firstRoot !== secondRoot) {
      this.parents.set(secondRoot, firstRoot);
    }
  }
}

export function buildDuplicateProductGroups(products: WooProduct[]) {
  const uniqueProducts = dedupeProductsById(products);
  const productsById = new Map(uniqueProducts.map((product) => [product.id, product]));
  const union = new ProductUnion(uniqueProducts.map((product) => product.id));
  const reasonsByPair = new Map<string, string[]>();
  const candidatePairs = getCandidateDuplicatePairs(uniqueProducts);

  for (const candidatePair of candidatePairs) {
    const [firstId, secondId] = candidatePair.split("-").map(Number);
    const first = productsById.get(firstId);
    const second = productsById.get(secondId);

    if (!first || !second) {
      continue;
    }

    const reasons = getProductDuplicateSignals(first, second);

    if (reasons.length === 0) {
      continue;
    }

    union.union(first.id, second.id);
    reasonsByPair.set(candidatePair, reasons);
  }

  const grouped = new Map<number, WooProduct[]>();

  for (const product of uniqueProducts) {
    const root = union.find(product.id);
    grouped.set(root, [...(grouped.get(root) ?? []), product]);
  }

  return [...grouped.entries()]
    .filter(([, groupProducts]) => groupProducts.length > 1)
    .map(([root, groupProducts]): DuplicateProductGroup => {
      const matchReasons = new Set<string>();

      for (let firstIndex = 0; firstIndex < groupProducts.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < groupProducts.length; secondIndex += 1) {
          const pairKey = [groupProducts[firstIndex].id, groupProducts[secondIndex].id]
            .sort((a, b) => a - b)
            .join("-");

          for (const reason of reasonsByPair.get(pairKey) ?? []) {
            matchReasons.add(reason);
          }
        }
      }

      const sortedProducts = [...groupProducts].sort(
        (a, b) => getProductCompletenessScore(b) - getProductCompletenessScore(a) || a.id - b.id
      );

      return {
        key: `product-duplicates-${root}`,
        title: sortedProducts[0].name,
        products: sortedProducts,
        matchReasons: [...matchReasons].sort()
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getProductCompletenessScore(product: WooProduct) {
  let score = 0;

  if (product.status === "publish") {
    score += 12;
  }

  if (product.sku) {
    score += 8;
  }

  if (product.regular_price || product.price) {
    score += 5;
  }

  if (product.manage_stock && product.stock_quantity !== null) {
    score += 5;
  }

  score += product.categories.length * 3;
  score += Math.min(product.images?.length ?? 0, 5) * 2;

  if (compactText(product.short_description)) {
    score += 4;
  }

  if (compactText(product.description)) {
    score += 6;
  }

  if (product.attributes?.length) {
    score += Math.min(product.attributes.length, 4) * 2;
  }

  return score;
}

export function getProductDetailSummary(product: WooProduct): ProductDetailSummary {
  const facts = [
    product.status ? `Status: ${product.status}` : "",
    product.sku ? `SKU: ${product.sku}` : "No SKU",
    product.regular_price ? `Regular: GBP ${product.regular_price}` : "",
    product.sale_price ? `Sale: GBP ${product.sale_price}` : "",
    product.manage_stock ? `Stock: ${product.stock_quantity ?? 0}` : `Stock: ${product.stock_status}`,
    product.categories.length ? `${product.categories.length} categories` : "No categories",
    product.images?.length ? `${product.images.length} images` : "No images",
    compactText(product.short_description) ? "Short description" : "",
    compactText(product.description) ? "Full description" : "",
    product.attributes?.length ? `${product.attributes.length} attributes` : ""
  ].filter(Boolean);

  return {
    score: getProductCompletenessScore(product),
    facts
  };
}

export function defaultProductMergeTarget(products: WooProduct[]) {
  return [...products].sort(
    (a, b) =>
      getProductCompletenessScore(b) - getProductCompletenessScore(a) ||
      (b.stock_quantity ?? 0) - (a.stock_quantity ?? 0) ||
      a.id - b.id
  )[0];
}

function sameNumberSet(first: number[], second: number[]) {
  return first.length === second.length && first.every((id) => second.includes(id));
}

function mergeImages(target: WooProduct, source: WooProduct) {
  const seen = new Set<string>();
  const merged = [];

  for (const image of [...(target.images ?? []), ...(source.images ?? [])]) {
    const key = image.id ? `id:${image.id}` : image.src ? `src:${image.src}` : "";

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      id: image.id,
      src: image.src,
      alt: image.alt
    });
  }

  return merged;
}

function mergeAttributes(target: WooProduct, source: WooProduct) {
  if (target.attributes?.length || !source.attributes?.length) {
    return undefined;
  }

  return source.attributes;
}

function defaultVariationOption(product: WooProduct) {
  return product.sku || product.name || `Product ${product.id}`;
}

function normalizeAttributeName(value: string | undefined) {
  return compactText(value) || "Variant";
}

function mergeVariationAttribute(
  attributes: WooProduct["attributes"],
  attributeName: string,
  options: string[]
) {
  const normalizedName = attributeName.toLowerCase();
  const currentAttributes = attributes ?? [];
  const existingIndex = currentAttributes.findIndex((attribute) => attribute.name?.toLowerCase() === normalizedName);
  const nextAttributes = [...currentAttributes];

  if (existingIndex >= 0) {
    const existing = nextAttributes[existingIndex];
    nextAttributes[existingIndex] = {
      ...existing,
      visible: true,
      variation: true,
      options: uniqueText([...(existing.options ?? []), ...options])
    };

    return nextAttributes;
  }

  return [
    ...nextAttributes,
    {
      name: attributeName,
      visible: true,
      variation: true,
      options: uniqueText(options)
    }
  ];
}

function firstImage(product: WooProduct) {
  return product.images?.find((image) => image.id || image.src);
}

function productVariationFromProduct(
  product: WooProduct,
  attributeName: string,
  option: string
): ProductVariationChanges {
  const image = firstImage(product);

  return {
    sku: product.sku || undefined,
    regular_price: product.regular_price || product.price || undefined,
    sale_price: product.sale_price || undefined,
    stock_status: product.stock_status,
    manage_stock: product.manage_stock,
    stock_quantity: product.manage_stock ? product.stock_quantity : undefined,
    description: product.short_description || product.description || undefined,
    image: image
      ? {
          id: image.id,
          src: image.src,
          alt: image.alt
        }
      : undefined,
    attributes: [
      {
        name: attributeName,
        option
      }
    ],
    dimensions: product.dimensions,
    weight: product.weight || undefined,
    shipping_class: product.shipping_class || undefined,
    menu_order: product.menu_order
  };
}

function missingText(targetValue: string | undefined, sourceValue: string | undefined) {
  return !compactText(targetValue) && compactText(sourceValue);
}

export function buildProductMergeChanges(
  source: WooProduct,
  target: WooProduct,
  matchReasons = getProductDuplicateSignals(source, target),
  options: ProductMergeBuildOptions = {}
): ProductMergeChanges {
  const mode = options.mode ?? "duplicate";
  const targetChanges: ProductChanges = {};
  const sourceChanges: ProductChanges = {};
  const targetCategoryIds = target.categories.map((category) => category.id);
  const mergedCategoryIds = unique([...targetCategoryIds, ...source.categories.map((category) => category.id)]).sort(
    (a, b) => a - b
  );

  if (!sameNumberSet(targetCategoryIds, mergedCategoryIds)) {
    targetChanges.categories = mergedCategoryIds.map((id) => ({ id }));
  }

  const mergedImages = mergeImages(target, source);
  if (mergedImages.length > (target.images?.length ?? 0)) {
    targetChanges.images = mergedImages;
  }

  const targetTagIds = target.tags?.map((tag) => tag.id) ?? [];
  const mergedTagIds = unique([...targetTagIds, ...(source.tags?.map((tag) => tag.id) ?? [])]).sort((a, b) => a - b);
  if (!sameNumberSet(targetTagIds, mergedTagIds)) {
    targetChanges.tags = mergedTagIds.map((id) => ({ id }));
  }

  const attributeFallback = mergeAttributes(target, source);
  if (attributeFallback) {
    targetChanges.attributes = attributeFallback;
  }

  for (const field of ["short_description", "description", "regular_price", "sale_price", "weight", "shipping_class"] as const) {
    if (missingText(target[field], source[field])) {
      targetChanges[field] = source[field] ?? "";
    }
  }

  if (missingText(target.purchase_note, source.purchase_note)) {
    targetChanges.purchase_note = source.purchase_note ?? "";
  }

  if (!target.featured && source.featured) {
    targetChanges.featured = true;
  }

  if (source.manage_stock && source.stock_quantity !== null) {
    if (target.manage_stock && target.stock_quantity !== null) {
      targetChanges.stock_quantity = target.stock_quantity + source.stock_quantity;
    } else if (!target.manage_stock) {
      targetChanges.manage_stock = true;
      targetChanges.stock_quantity = source.stock_quantity;
    }
  }

  if (target.stock_status !== "instock" && source.stock_status === "instock") {
    targetChanges.stock_status = "instock";
  }

  if (source.status !== "draft") {
    sourceChanges.status = "draft";
  }

  if (source.catalog_visibility !== "hidden") {
    sourceChanges.catalog_visibility = "hidden";
  }

  if (source.stock_status !== "outofstock") {
    sourceChanges.stock_status = "outofstock";
  }

  if (source.featured) {
    sourceChanges.featured = false;
  }

  if (mode === "variation") {
    const variationAttributeName = normalizeAttributeName(options.variationAttributeName);
    const targetVariationOption = compactText(options.targetVariationOption) || defaultVariationOption(target);
    const sourceVariationOption = compactText(options.sourceVariationOption) || defaultVariationOption(source);
    const parentChanges: ProductChanges = {
      ...targetChanges,
      type: "variable",
      attributes: mergeVariationAttribute(target.attributes, variationAttributeName, [
        targetVariationOption,
        sourceVariationOption
      ])
    };
    const targetVariation =
      target.type === "variable"
        ? undefined
        : productVariationFromProduct(target, variationAttributeName, targetVariationOption);
    const sourceVariation = productVariationFromProduct(source, variationAttributeName, sourceVariationOption);

    if (targetVariation?.sku) {
      parentChanges.sku = "";
    }

    if (sourceVariation.sku) {
      sourceChanges.sku = "";
    }

    return {
      mode,
      sourceId: source.id,
      targetId: target.id,
      sourceName: source.name,
      targetName: target.name,
      matchReasons,
      targetChanges: parentChanges,
      sourceChanges,
      variationAttributeName,
      targetVariationOption,
      sourceVariationOption,
      parentChanges,
      targetVariation,
      sourceVariation
    };
  }

  return {
    mode,
    sourceId: source.id,
    targetId: target.id,
    sourceName: source.name,
    targetName: target.name,
    matchReasons,
    targetChanges,
    sourceChanges
  };
}
