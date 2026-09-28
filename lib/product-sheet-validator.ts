import "server-only";

import {
  getProductSheetRow,
  getProductSheetRows,
  getUpdatedListRow,
  type ProductSheetSource,
  type SheetProductRow
} from "@/lib/product-sheet";
import {
  rowAccessories,
  rowColourOptions,
  hasProductManagerSheetField,
  sheetAccessoriesExpected,
  sheetColourBoardExpected,
  sheetCustomNotesExpected,
  sheetSpecificationsExpected
} from "@/lib/product-sheet-create";
import type { WooCategory, WooProduct } from "@/lib/types";
import { getCategories, getProduct, getProducts, productHasCustomNotes } from "@/lib/woocommerce";

export type SheetFieldComparison = {
  available: boolean;
  sheetExpected: boolean;
  wooPresent: boolean;
  sheetValues: string[];
  wooValues: string[];
  missingInWoo: string[];
  extraInWoo: string[];
  matches: boolean;
};

export type ProductSheetValidationResult = {
  row: SheetProductRow;
  status: "matched" | "not_found" | "missing_lookup" | "ambiguous" | "error";
  matchMethod: "sku" | "name" | "none";
  product?: WooProduct;
  candidates: WooProduct[];
  error?: string;
  categoryComparison: {
    sheet: string[];
    woo: string[];
    sheetHierarchy: string[];
    wooHierarchy: string[];
    missingInWoo: string[];
    extraInWoo: string[];
    matches: boolean;
  };
  customNotesComparison: {
    available: boolean;
    sheet: boolean;
    woo: boolean;
    matches: boolean;
  };
  colourBoardComparison: SheetFieldComparison;
  accessoriesComparison: SheetFieldComparison;
  specificationsComparison: {
    sheet: boolean;
    woo: boolean;
    matches: boolean;
  };
};

let categoriesCache: {
  expiresAt: number;
  categories: WooCategory[];
} | null = null;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeIdentityName(value: string) {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeIdentitySku(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function findLikelyDraftProduct(row: SheetProductRow, candidates: WooProduct[]) {
  const sourceTokens = new Set(normalizeIdentityName(row.name).split(" ").filter(Boolean));
  const likelyDrafts = [...new Map(candidates.map((product) => [product.id, product])).values()]
    .filter((product) => {
      if (product.status !== "draft") {
        return false;
      }

      const candidateTokens = normalizeIdentityName(product.name).split(" ").filter(Boolean);

      return candidateTokens.length >= 3 && candidateTokens.every((token) => sourceTokens.has(token));
    });

  return likelyDrafts.length === 1 ? likelyDrafts[0] : undefined;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function metaValue(product: WooProduct | undefined, key: string) {
  return product?.meta_data?.find((item) => item.key === key)?.value;
}

function safeArray(value: unknown) {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown>>;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function safeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.map(String).map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function compareValues(
  available: boolean,
  sheetExpected: boolean,
  sheetValues: string[],
  wooValues: string[],
  wooPresentOverride?: boolean
) {
  const normalizedSheet = new Map(unique(sheetValues).map((value) => [normalizeText(value), value]));
  const normalizedWoo = new Map(unique(wooValues).map((value) => [normalizeText(value), value]));
  const missingInWoo = [...normalizedSheet.entries()]
    .filter(([key]) => !normalizedWoo.has(key))
    .map(([, value]) => value);
  const extraInWoo = [...normalizedWoo.entries()]
    .filter(([key]) => !normalizedSheet.has(key))
    .map(([, value]) => value);
  const wooPresent = wooPresentOverride ?? wooValues.length > 0;
  const matches = !available
    ? true
    : sheetValues.length > 0
      ? missingInWoo.length === 0 && extraInWoo.length === 0
      : sheetExpected === wooPresent;

  return {
    available,
    sheetExpected,
    wooPresent,
    sheetValues: unique(sheetValues),
    wooValues: unique(wooValues),
    missingInWoo,
    extraInWoo,
    matches
  };
}

function wooColourNames(product: WooProduct | undefined) {
  const count = Number(metaValue(product, "personalization_0_image_items") ?? 0);
  const names = Array.from(
    { length: Number.isFinite(count) && count > 0 ? count : 0 },
    (_, index) => String(metaValue(product, `personalization_0_image_items_${index}_name`) ?? "").trim()
  ).filter((name) => name && !/^(?:none|no colou?r option)$/i.test(name));

  return unique(names);
}

function wooAccessoryNames(product: WooProduct | undefined) {
  const rawNames = safeArray(metaValue(product, "product_accessories"))
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean);
  const trackedNames = safeStringArray(metaValue(product, "_fcw_accessory_cross_sell_names"));

  return unique([...rawNames, ...trackedNames]).filter(
    (name) => normalizeText(name) !== normalizeText(product?.name ?? "")
  );
}

function wooSpecificationsPresent(product: WooProduct | undefined) {
  const groups = safeArray(metaValue(product, "technical_specifications"));
  const hasJsonSpecifications = groups.some((group) =>
    safeArray(group.specifications).some((specification) =>
      Boolean(String(specification.name ?? specification.value ?? "").trim())
    )
  );

  if (hasJsonSpecifications) {
    return true;
  }

  const featureCount = Number(metaValue(product, "_fcw_features_specification_count") ?? 0);
  if (Number.isFinite(featureCount) && featureCount > 0) {
    return true;
  }

  return Boolean(product?.meta_data?.some((item) =>
    /^groups_\d+_specifications_\d+_(?:name|value)$/.test(item.key) &&
    String(item.value ?? "").trim()
  ));
}

function compareSheetFields(row: SheetProductRow, product: WooProduct | undefined) {
  const sheetCustomNotes = sheetCustomNotesExpected(row);
  const sheetColours = rowColourOptions(row).map((option) => String(option.color_name ?? "").trim()).filter(Boolean);
  const sheetAccessories = rowAccessories(row).map((item) => String(item.name ?? "").trim()).filter(Boolean);
  const wooColours = wooColourNames(product);
  const wooAccessories = wooAccessoryNames(product);
  const sheetSpecifications = sheetSpecificationsExpected(row);
  const wooSpecifications = wooSpecificationsPresent(product);
  const customNoteFieldAvailable = hasProductManagerSheetField(row, "customNotes");
  const colourBoardFieldAvailable = hasProductManagerSheetField(row, "colourBoard");
  const accessoriesFieldAvailable = hasProductManagerSheetField(row, "accessories");
  const accessoriesComparison = compareValues(
    accessoriesFieldAvailable,
    sheetAccessoriesExpected(row),
    sheetAccessories,
    wooAccessories,
    (product?.cross_sell_ids?.length ?? 0) > 0
  );
  const expectedAccessoryCount = new Set(sheetAccessories.map(normalizeText)).size;
  const linkedAccessoryCount = new Set(product?.cross_sell_ids ?? []).size;

  return {
    customNotesComparison: {
      available: customNoteFieldAvailable,
      sheet: sheetCustomNotes,
      woo: productHasCustomNotes(product ?? {}),
      matches:
        !customNoteFieldAvailable ||
        (Boolean(product) && sheetCustomNotes === productHasCustomNotes(product ?? {}))
    },
    colourBoardComparison: compareValues(
      colourBoardFieldAvailable,
      sheetColourBoardExpected(row),
      sheetColours,
      wooColours,
      wooColours.length > 0
    ),
    accessoriesComparison: {
      ...accessoriesComparison,
      matches:
        accessoriesComparison.matches &&
        (expectedAccessoryCount === 0 || linkedAccessoryCount >= expectedAccessoryCount)
    },
    specificationsComparison: {
      sheet: sheetSpecifications,
      woo: wooSpecifications,
      matches: !sheetSpecifications || wooSpecifications
    }
  };
}

async function getCachedCategories() {
  const now = Date.now();

  if (categoriesCache && categoriesCache.expiresAt > now) {
    return categoriesCache.categories;
  }

  const categories = await getCategories();
  categoriesCache = {
    expiresAt: now + 5 * 60 * 1000,
    categories
  };

  return categories;
}

function categoryPath(category: WooCategory, categoryById: Map<number, WooCategory>) {
  const path: string[] = [];
  const seen = new Set<number>();
  let current: WooCategory | undefined = category;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parent ? categoryById.get(current.parent) : undefined;
  }

  return path;
}

function wooCategoryHierarchy(product: WooProduct | undefined, categories: WooCategory[]) {
  if (!product) {
    return [];
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return unique(
    product.categories.map((productCategory) => {
      const fullCategory = categoryById.get(productCategory.id);
      const path = fullCategory ? categoryPath(fullCategory, categoryById) : [productCategory.name ?? ""].filter(Boolean);

      return path.join(" > ");
    })
  );
}

function compareCategories(row: SheetProductRow, product: WooProduct | undefined, categories: WooCategory[]) {
  const sheetHierarchy = unique(row.categoryHierarchy.map((category) => category.label));
  const wooHierarchy = wooCategoryHierarchy(product, categories);
  const sheet = sheetHierarchy.length ? sheetHierarchy : unique(row.categories);
  const woo = wooHierarchy.length
    ? wooHierarchy
    : unique(product?.categories.map((category) => category.name ?? "").filter(Boolean) ?? []);
  const normalizedWoo = new Map(woo.map((category) => [normalizeText(category), category]));
  const normalizedSheet = new Map(sheet.map((category) => [normalizeText(category), category]));
  const missingInWoo = sheet.filter((category) => !normalizedWoo.has(normalizeText(category)));
  const extraInWoo = woo.filter((category) => !normalizedSheet.has(normalizeText(category)));

  return {
    sheet,
    woo,
    sheetHierarchy,
    wooHierarchy,
    missingInWoo,
    extraInWoo,
    matches: missingInWoo.length === 0 && extraInWoo.length === 0
  };
}

function bestSkuMatch(products: WooProduct[], sku: string) {
  const normalizedSku = normalizeText(sku);

  return products.find((product) => normalizeText(product.sku) === normalizedSku) ?? products[0];
}

async function matchWooProduct(row: SheetProductRow) {
  const lookupErrors: string[] = [];
  const candidates: WooProduct[] = [];

  if (!row.sku && !row.name) {
    return {
      status: "missing_lookup" as const,
      matchMethod: "none" as const,
      candidates: []
    };
  }

  if (row.sku) {
    try {
      const skuResult = await getProducts({
        sku: row.sku,
        perPage: 10,
        status: "any"
      });
      candidates.push(...skuResult.data);

      if (skuResult.data.length === 1) {
        return {
          status: "matched" as const,
          matchMethod: "sku" as const,
          product: skuResult.data[0],
          candidates: skuResult.data
        };
      }

      if (skuResult.data.length > 1) {
        const exactSkuMatches = skuResult.data.filter(
          (product) => normalizeIdentitySku(product.sku || "") === normalizeIdentitySku(row.sku)
        );

        if (exactSkuMatches.length === 1) {
          return {
            status: "matched" as const,
            matchMethod: "sku" as const,
            product: exactSkuMatches[0],
            candidates: skuResult.data
          };
        }

        return {
          status: "ambiguous" as const,
          matchMethod: "sku" as const,
          product: bestSkuMatch(skuResult.data, row.sku),
          candidates: skuResult.data
        };
      }
    } catch (error) {
      lookupErrors.push(`SKU lookup failed: ${error instanceof Error ? error.message : "WooCommerce request failed."}`);
    }
  }

  if (row.name) {
    try {
      const nameResult = await getProducts({
        search: row.name,
        perPage: 10,
        status: "any"
      });
      candidates.push(...nameResult.data);
      const exactNameMatches = nameResult.data.filter(
        (product) => normalizeIdentityName(product.name) === normalizeIdentityName(row.name)
      );

      if (exactNameMatches.length === 1) {
        return {
          status: "matched" as const,
          matchMethod: "name" as const,
          product: exactNameMatches[0],
          candidates: nameResult.data,
          error: lookupErrors.join(" ")
        };
      }

      if (exactNameMatches.length > 1) {
        return {
          status: "ambiguous" as const,
          matchMethod: "name" as const,
          product: exactNameMatches[0],
          candidates: exactNameMatches,
          error: lookupErrors.join(" ")
        };
      }
    } catch (error) {
      lookupErrors.push(`Name lookup failed: ${error instanceof Error ? error.message : "WooCommerce request failed."}`);
    }
  }

  if (lookupErrors.length > 0) {
    return {
      status: "error" as const,
      matchMethod: "none" as const,
      candidates: [],
      error: lookupErrors.join(" ")
    };
  }

  return {
    status: "not_found" as const,
    matchMethod: "none" as const,
    candidates: [...new Map(candidates.map((product) => [product.id, product])).values()]
  };
}

export async function validateProductSheetFixTarget(
  rowNumber: number,
  productId: number,
  source: ProductSheetSource = "product-manager"
) {
  const [row, product] = await Promise.all([
    source === "updated-list" ? getUpdatedListRow(rowNumber) : getProductSheetRow(rowNumber),
    getProduct(productId)
  ]);

  if (!row) {
    return undefined;
  }

  const skuMatches = Boolean(
    row.sku &&
    product.sku &&
    normalizeIdentitySku(row.sku) === normalizeIdentitySku(product.sku)
  );
  const nameMatches = Boolean(
    row.name &&
    product.name &&
    normalizeIdentityName(row.name) === normalizeIdentityName(product.name)
  );

  if (!skuMatches && !nameMatches) {
    throw new Error("The selected WooCommerce product no longer matches this Product Manager row.");
  }

  return {
    row,
    product,
    ...compareSheetFields(row, product)
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

type ValidateProductSheetRowsOptions = {
  offset?: number;
  limit?: number;
};

async function validateRows(rows: SheetProductRow[], categories: WooCategory[]) {
  return mapWithConcurrency(rows, 1, async (row): Promise<ProductSheetValidationResult> => {
    try {
      const match = await matchWooProduct(row);

      return {
        row,
        ...match,
        categoryComparison: compareCategories(row, match.product, categories),
        ...compareSheetFields(row, match.product)
      };
    } catch (error) {
      return {
        row,
        status: "error",
        matchMethod: "none",
        candidates: [],
        error: error instanceof Error ? error.message : "WooCommerce lookup failed.",
        categoryComparison: compareCategories(row, undefined, categories),
        ...compareSheetFields(row, undefined)
      };
    }
  });
}

export async function validateProductSheetSourceRow(
  rowNumber: number,
  source: ProductSheetSource = "product-manager"
) {
  const [row, categories] = await Promise.all([
    source === "updated-list" ? getUpdatedListRow(rowNumber) : getProductSheetRow(rowNumber),
    getCachedCategories()
  ]);

  if (!row) {
    return undefined;
  }

  return (await validateRows([row], categories))[0];
}

export async function validateProductSheetRows(options: ValidateProductSheetRowsOptions = {}) {
  const [rows, categories] = await Promise.all([getProductSheetRows(), getCachedCategories()]);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? rows.length);
  const batchRows = rows.slice(offset, offset + limit);
  const results = await validateRows(batchRows, categories);

  return results;
}

export async function validateProductSheetBatch(options: ValidateProductSheetRowsOptions = {}) {
  const [rows, categories] = await Promise.all([getProductSheetRows(), getCachedCategories()]);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? rows.length);
  const batchRows = rows.slice(offset, offset + limit);
  const results = await validateRows(batchRows, categories);

  return {
    offset,
    limit,
    total: rows.length,
    nextOffset: offset + results.length < rows.length ? offset + results.length : null,
    results
  };
}

export async function refreshProductSheetValidatorBatch(
  cachedResults: ProductSheetValidationResult[],
  options: ValidateProductSheetRowsOptions = {}
) {
  const categories = await getCachedCategories();
  const rows = cachedResults.map((result) => result.row);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, options.limit ?? rows.length);
  const batchRows = rows.slice(offset, offset + limit);
  const results = await validateRows(batchRows, categories);

  return {
    offset,
    limit,
    total: rows.length,
    nextOffset: offset + results.length < rows.length ? offset + results.length : null,
    results
  };
}
