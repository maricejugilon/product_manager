"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Plus,
  Ruler,
  Search,
  Save,
  X
} from "lucide-react";

import { getCategoryPath, getHierarchicalCategoryOptions } from "@/lib/category-utils";
import { COLOUR_BOARD_CHOICES, type ColourBoardChoice } from "@/lib/colour-board-choices";
import type { ProductChanges, WooCategory, WooProduct } from "@/lib/types";

function sortedIds(ids: number[]) {
  return [...ids].sort((a, b) => a - b).join(",");
}

function dimensionValue(form: FormData, field: "length" | "width" | "height") {
  return String(form.get(`dimension_${field}`) ?? "").trim();
}

function isValidDimension(value: string) {
  if (!value) {
    return true;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0;
}

function backordersValue(value: FormDataEntryValue | null) {
  return value === "yes" || value === "notify" || value === "no" ? value : "no";
}

function dimensionsText(product: WooProduct) {
  const dimensions = product.dimensions ?? {};
  const values = [dimensions.length, dimensions.width, dimensions.height].map((value) => value?.trim() ?? "");

  if (values.every((value) => !value)) {
    return "Not set";
  }

  return values.map((value) => value || "-").join(" x ");
}

function imageText(product: WooProduct) {
  return product.images?.map((image) => image.src).filter(Boolean).join("\n") ?? "";
}

function advancedText(product: WooProduct) {
  return JSON.stringify(
    {
      attributes: product.attributes ?? [],
      meta_data: product.meta_data ?? [],
      weight: product.weight ?? "",
      shipping_class: product.shipping_class ?? "",
      tags: product.tags?.map((tag) => ({ id: tag.id })) ?? [],
      purchase_note: product.purchase_note ?? "",
      menu_order: product.menu_order ?? 0
    },
    null,
    2
  );
}

type CategoryTreeNode = {
  category: WooCategory;
  path: string;
  depth: number;
  children: CategoryTreeNode[];
};

type RelatedProductSummary = {
  id: number;
  name: string;
  sku: string;
  permalink: string;
  image: string;
  status: string;
  stockStatus: string;
  regularPrice: string;
};

type ProductsResponse = {
  data?: WooProduct[];
  error?: string;
};

type ColourBoardOption = {
  option_group?: string;
  color_name?: string;
  color_hex?: string;
  swatch_image_url?: string;
  option_image_url?: string;
  price_adjustment?: string;
  default_option?: boolean;
  notes?: string;
};

type SpecificationGroup = {
  group_name: string;
  specifications: Array<{ name: string; value: string }>;
};

const relationshipFields = [
  "id",
  "name",
  "sku",
  "permalink",
  "images",
  "status",
  "stock_status",
  "regular_price"
].join(",");

function toRelatedProduct(product: WooProduct): RelatedProductSummary {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    permalink: product.permalink,
    image: product.images?.[0]?.src ?? "",
    status: product.status,
    stockStatus: product.stock_status,
    regularPrice: product.regular_price
  };
}

function relatedProductFallback(id: number): RelatedProductSummary {
  return {
    id,
    name: `Product #${id}`,
    sku: "",
    permalink: "",
    image: "",
    status: "",
    stockStatus: "",
    regularPrice: ""
  };
}

function safeJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function htmlDecode(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return htmlDecode(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedColourOptions(options: ColourBoardOption[]) {
  return options
    .map((option) => ({
      option_group: String(option.option_group ?? "Case Colour").trim(),
      color_name: String(option.color_name ?? "").trim(),
      color_hex: String(option.color_hex ?? "").trim(),
      swatch_image_url: String(option.swatch_image_url ?? "").trim(),
      option_image_url: String(option.option_image_url ?? "").trim(),
      price_adjustment: String(option.price_adjustment ?? "0").trim(),
      default_option: Boolean(option.default_option),
      notes: String(option.notes ?? "").trim()
    }))
    .filter((option) => option.color_name || option.color_hex || option.swatch_image_url || option.option_image_url);
}

function colourOptionSignature(options: ColourBoardOption[]) {
  return JSON.stringify(normalizedColourOptions(options));
}

function initialColourBoardOptions(product: WooProduct) {
  const meta = product.meta_data ?? [];
  const legacy = meta.find((item) => item.key === "legacy_colour_board_options")?.value;
  const fallback = meta.find((item) => item.key === "color_options")?.value;

  return normalizedColourOptions(safeJsonArray<ColourBoardOption>(legacy).length > 0
    ? safeJsonArray<ColourBoardOption>(legacy)
    : safeJsonArray<ColourBoardOption>(fallback));
}

function buildColourBoardAcfPayload(options: ColourBoardOption[]) {
  const items = normalizedColourOptions(options)
    .map((option) => {
      const name = option.color_name;
      const imageUrl = option.option_image_url || option.swatch_image_url;

      if (!name && !imageUrl) {
        return undefined;
      }

      return {
        name,
        additional_price: option.price_adjustment,
        image: imageUrl,
        _legacy_value: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        _legacy_swatch_image_url: option.swatch_image_url,
        default: option.default_option ? 1 : 0
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const option = {
    type: "Image",
    image: {
      label: "Colour Board",
      frontend_label: "Personalise this item with coloured board",
      items
    }
  };

  return {
    products: {
      options: [option]
    },
    options: [option]
  };
}

function productMetaEntry(product: WooProduct, key: string, value: unknown) {
  const existing = product.meta_data?.find((item) => item.key === key);

  return {
    ...(existing?.id ? { id: existing.id } : {}),
    key,
    value
  };
}

function productMetaValue(product: WooProduct, key: string) {
  return product.meta_data?.find((item) => item.key === key)?.value;
}

function isTruthyMeta(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  return normalized === "1" || normalized === "yes" || normalized === "true" || normalized === "on";
}

function customNotesMetaData(product: WooProduct, enabled: boolean) {
  const meta = [productMetaEntry(product, "custom_notes", enabled ? "1" : "0")];
  const fieldKey = productMetaValue(product, "_custom_notes");

  if (fieldKey) {
    meta.push(productMetaEntry(product, "_custom_notes", fieldKey));
  }

  return meta;
}

const personalizationFieldKeys = {
  personalization: "field_68b4362b5c347",
  type: "field_68b436665c348",
  image: "field_68b436af5c349",
  imageLabel: "field_68b436c95c34a",
  imageFrontendLabel: "field_68b436dc5c34b",
  imageItems: "field_68b436e85c34c",
  itemName: "field_68b436f05c34d",
  itemAdditionalPrice: "field_68b436fa5c34e",
  itemImage: "field_68b4370b5c34f"
};

function colourBoardPersonalizationMetaData(product: WooProduct, options: ColourBoardOption[]) {
  const normalized = normalizedColourOptions(options);
  const meta = [
    productMetaEntry(product, "personalization", normalized.length > 0 ? 1 : 0),
    productMetaEntry(product, "_personalization", personalizationFieldKeys.personalization)
  ];

  if (normalized.length === 0) {
    return meta;
  }

  meta.push(
    productMetaEntry(product, "personalization_0_type", "Image"),
    productMetaEntry(product, "_personalization_0_type", personalizationFieldKeys.type),
    productMetaEntry(product, "personalization_0_image", ""),
    productMetaEntry(product, "_personalization_0_image", personalizationFieldKeys.image),
    productMetaEntry(product, "personalization_0_image_label", "Coloured Board"),
    productMetaEntry(product, "_personalization_0_image_label", personalizationFieldKeys.imageLabel),
    productMetaEntry(product, "personalization_0_image_frontend_label", "Personalise this item with coloured board"),
    productMetaEntry(product, "_personalization_0_image_frontend_label", personalizationFieldKeys.imageFrontendLabel),
    productMetaEntry(product, "personalization_0_image_items", normalized.length),
    productMetaEntry(product, "_personalization_0_image_items", personalizationFieldKeys.imageItems)
  );

  normalized.forEach((option, index) => {
    meta.push(
      productMetaEntry(product, `personalization_0_image_items_${index}_name`, option.color_name),
      productMetaEntry(product, `_personalization_0_image_items_${index}_name`, personalizationFieldKeys.itemName),
      productMetaEntry(product, `personalization_0_image_items_${index}_additional_price`, option.price_adjustment),
      productMetaEntry(product, `_personalization_0_image_items_${index}_additional_price`, personalizationFieldKeys.itemAdditionalPrice),
      productMetaEntry(
        product,
        `personalization_0_image_items_${index}_image`,
        option.option_image_url || option.swatch_image_url
      ),
      productMetaEntry(product, `_personalization_0_image_items_${index}_image`, personalizationFieldKeys.itemImage)
    );
  });

  return meta;
}

function colourBoardMetaData(product: WooProduct, options: ColourBoardOption[]) {
  const normalized = normalizedColourOptions(options);
  const rawJson = normalized.length > 0 ? JSON.stringify(normalized) : "";
  const payload = buildColourBoardAcfPayload(normalized);

  return [
    productMetaEntry(product, "color_options", rawJson),
    productMetaEntry(product, "legacy_colour_board_options", rawJson),
    productMetaEntry(product, "_fcw_colour_board_image_options", JSON.stringify(payload.options)),
    productMetaEntry(product, "_fcw_colour_board_acf_products_options", JSON.stringify(payload)),
    productMetaEntry(product, "_fcw_colour_board_option_count", normalized.length),
    ...colourBoardPersonalizationMetaData(product, normalized)
  ];
}

function normalizedSpecificationGroups(groups: SpecificationGroup[]) {
  return groups
    .map((group) => ({
      group_name: String(group.group_name ?? "Features").trim() || "Features",
      specifications: (group.specifications ?? [])
        .map((specification) => ({
          name: String(specification.name ?? "").trim(),
          value: String(specification.value ?? "").trim()
        }))
        .filter((specification) => specification.name || specification.value)
    }))
    .filter((group) => group.group_name || group.specifications.length > 0);
}

function specificationSignature(groups: SpecificationGroup[]) {
  return JSON.stringify(normalizedSpecificationGroups(groups));
}

function readInitialSpecificationGroups(product: WooProduct) {
  const meta = product.meta_data ?? [];
  const raw = meta.find((item) => item.key === "technical_specifications")?.value;
  const parsed = safeJsonArray<SpecificationGroup>(raw);

  if (parsed.length > 0) {
    return normalizedSpecificationGroups(parsed);
  }

  const groupCount = Number(meta.find((item) => item.key === "groups")?.value ?? 0);
  const groups: SpecificationGroup[] = [];

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupName = String(meta.find((item) => item.key === `groups_${groupIndex}_group_name`)?.value ?? "").trim();
    const specCount = Number(meta.find((item) => item.key === `groups_${groupIndex}_specifications`)?.value ?? 0);
    const specifications: SpecificationGroup["specifications"] = [];

    for (let specIndex = 0; specIndex < specCount; specIndex += 1) {
      const name = String(
        meta.find((item) => item.key === `groups_${groupIndex}_specifications_${specIndex}_name`)?.value ?? ""
      ).trim();
      const value = String(
        meta.find((item) => item.key === `groups_${groupIndex}_specifications_${specIndex}_value`)?.value ?? ""
      ).trim();

      if (name || value) {
        specifications.push({ name, value });
      }
    }

    if (groupName || specifications.length > 0) {
      groups.push({
        group_name: groupName || "Features",
        specifications
      });
    }
  }

  return normalizedSpecificationGroups(groups);
}

function parseFeatureSpecifications(descriptionHtml: string) {
  const featureBlock =
    descriptionHtml.match(/<h[1-6][^>]*>\s*Features\s*:?\s*<\/h[1-6]>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  const lines = featureBlock
    ? [...featureBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripTags(match[1]))
    : [];

  return lines
    .map((line) => {
      const [name = "", ...valueParts] = line.split(":");

      return {
        name: name.trim(),
        value: valueParts.join(":").trim()
      };
    })
    .filter((specification) => specification.name);
}

function specificationGroupsFromDescription(descriptionHtml: string) {
  const specifications = parseFeatureSpecifications(descriptionHtml);

  return specifications.length > 0
    ? [
        {
          group_name: "Features",
          specifications
        }
      ]
    : [];
}

function specificationMetaData(product: WooProduct, groups: SpecificationGroup[]) {
  const normalized = normalizedSpecificationGroups(groups);
  const meta = [
    productMetaEntry(product, "technical_specifications", JSON.stringify(normalized)),
    productMetaEntry(product, "_fcw_features_specification_count", normalized[0]?.specifications.length ?? 0),
    productMetaEntry(product, "groups", normalized.length),
    productMetaEntry(product, "_groups", "field_68b675504a3d7")
  ];

  normalized.forEach((group, groupIndex) => {
    meta.push(
      productMetaEntry(product, `groups_${groupIndex}_group_name`, group.group_name),
      productMetaEntry(product, `_groups_${groupIndex}_group_name`, "field_68b675604a3d8"),
      productMetaEntry(product, `groups_${groupIndex}_specifications`, group.specifications.length),
      productMetaEntry(product, `_groups_${groupIndex}_specifications`, "field_68b67470a9fce")
    );

    group.specifications.forEach((specification, specIndex) => {
      meta.push(
        productMetaEntry(product, `groups_${groupIndex}_specifications_${specIndex}_name`, specification.name),
        productMetaEntry(product, `_groups_${groupIndex}_specifications_${specIndex}_name`, "field_68b67479a9fcf"),
        productMetaEntry(product, `groups_${groupIndex}_specifications_${specIndex}_value`, specification.value),
        productMetaEntry(product, `_groups_${groupIndex}_specifications_${specIndex}_value`, "field_68b6747fa9fd0")
      );
    });
  });

  return meta;
}

function choiceToColourOption(choice: ColourBoardChoice): ColourBoardOption {
  return {
    option_group: choice.option_group,
    color_name: choice.color_name,
    color_hex: choice.color_hex,
    swatch_image_url: choice.swatch_image_url,
    option_image_url: choice.option_image_url,
    price_adjustment: choice.price_adjustment,
    default_option: choice.default_option,
    notes: choice.notes
  };
}

function colourChoiceLabel(choice: ColourBoardChoice) {
  const price = choice.price_adjustment ? ` +GBP ${choice.price_adjustment}` : "";
  const count = choice.source_count > 1 ? ` (${choice.source_count} products)` : "";

  return `${choice.color_name || "Unnamed colour"}${price}${count}`;
}

function mergeMetaData(
  current: ProductChanges["meta_data"] | undefined,
  incoming: NonNullable<ProductChanges["meta_data"]>
) {
  const byKey = new Map<string, NonNullable<ProductChanges["meta_data"]>[number]>();

  for (const item of current ?? []) {
    byKey.set(item.key, item);
  }

  for (const item of incoming) {
    byKey.set(item.key, item);
  }

  return [...byKey.values()];
}

function buildCategoryTree(categories: WooCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const childrenByParent = new Map<number, WooCategory[]>();

  for (const category of categories) {
    const parentId = byId.has(category.parent) ? category.parent : 0;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), category]);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }

  const visited = new Set<number>();

  function walk(category: WooCategory, depth: number, parentPath: string, ancestors: Set<number>): CategoryTreeNode | null {
    if (visited.has(category.id) || ancestors.has(category.id)) {
      return null;
    }

    visited.add(category.id);
    const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(category.id);

    return {
      category,
      path,
      depth,
      children: (childrenByParent.get(category.id) ?? [])
        .map((child) => walk(child, depth + 1, path, nextAncestors))
        .filter((node): node is CategoryTreeNode => Boolean(node))
    };
  }

  const roots = (childrenByParent.get(0) ?? [])
    .map((category) => walk(category, 0, "", new Set<number>()))
    .filter((node): node is CategoryTreeNode => Boolean(node));

  for (const category of [...categories].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)) {
    if (!visited.has(category.id)) {
      const node = walk(category, 0, "", new Set<number>());

      if (node) {
        roots.push(node);
      }
    }
  }

  return roots;
}

function selectedAncestorIds(categories: WooCategory[], selectedIds: number[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const expanded = new Set<number>();

  for (const id of selectedIds) {
    let current = byId.get(id);
    const seen = new Set<number>();

    while (current && current.parent && !seen.has(current.id)) {
      seen.add(current.id);
      expanded.add(current.parent);
      current = byId.get(current.parent);
    }
  }

  return expanded;
}

function CategoryTree({
  nodes,
  categoryIds,
  expandedIds,
  onToggleCategory,
  onToggleExpanded
}: {
  nodes: CategoryTreeNode[];
  categoryIds: number[];
  expandedIds: Set<number>;
  onToggleCategory: (id: number) => void;
  onToggleExpanded: (id: number) => void;
}) {
  return (
    <div className="category-tree" role="tree">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedIds.has(node.category.id);

        return (
          <div key={node.category.id} className="category-tree-branch" role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
            <div className="category-tree-row" style={{ "--category-depth": Math.min(node.depth, 5) } as CSSProperties}>
              <button
                className="category-tree-toggle"
                type="button"
                disabled={!hasChildren}
                onClick={() => onToggleExpanded(node.category.id)}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.category.name}`}
              >
                {hasChildren ? (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
              </button>
              <label className="category-tree-choice" title={node.path}>
                <input
                  type="checkbox"
                  checked={categoryIds.includes(node.category.id)}
                  onChange={() => onToggleCategory(node.category.id)}
                />
                <span>
                  <strong>{node.category.name}</strong>
                  <small>{node.path}</small>
                </span>
              </label>
            </div>
            {hasChildren && isExpanded ? (
              <CategoryTree
                nodes={node.children}
                categoryIds={categoryIds}
                expandedIds={expandedIds}
                onToggleCategory={onToggleCategory}
                onToggleExpanded={onToggleExpanded}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProductRelationshipEditor({
  title,
  description,
  selectedIds,
  currentProductId,
  onChange
}: {
  title: string;
  description: string;
  selectedIds: number[];
  currentProductId: number;
  onChange: (ids: number[]) => void;
}) {
  const [selectedProducts, setSelectedProducts] = useState<RelatedProductSummary[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RelatedProductSummary[]>([]);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const selectedIdKey = selectedIds.join(",");

  useEffect(() => {
    const controller = new AbortController();

    async function loadSelectedProducts() {
      setError("");

      if (selectedIds.length === 0) {
        setSelectedProducts([]);
        return;
      }

      setLoadingSelected(true);

      try {
        const params = new URLSearchParams({
          include: selectedIds.join(","),
          per_page: "100",
          status: "any",
          fields: relationshipFields
        });
        const response = await fetch(`/api/products?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json()) as ProductsResponse;

        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? "Could not load linked products.");
        }

        const byId = new Map((payload.data ?? []).map((product) => [product.id, toRelatedProduct(product)]));
        setSelectedProducts(selectedIds.map((id) => byId.get(id) ?? relatedProductFallback(id)));
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "Could not load linked products.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSelected(false);
        }
      }
    }

    loadSelectedProducts();

    return () => controller.abort();
  }, [selectedIdKey, selectedIds]);

  function removeProduct(id: number) {
    onChange(selectedIds.filter((item) => item !== id));
  }

  function addProduct(product: RelatedProductSummary) {
    if (product.id === currentProductId || selectedIds.includes(product.id)) {
      return;
    }

    onChange([...selectedIds, product.id]);
    setResults((current) => current.filter((item) => item.id !== product.id));
  }

  async function searchProducts() {
    const trimmedQuery = query.trim();

    setError("");

    if (trimmedQuery.length < 2) {
      setError("Search with at least 2 characters.");
      return;
    }

    setSearching(true);

    try {
      const params = new URLSearchParams({
        search: trimmedQuery,
        per_page: "12",
        status: "any",
        fields: relationshipFields
      });
      const skuParams = new URLSearchParams({
        sku: trimmedQuery,
        per_page: "12",
        status: "any",
        fields: relationshipFields
      });
      const [searchResponse, skuResponse] = await Promise.all([
        fetch(`/api/products?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/products?${skuParams.toString()}`, { cache: "no-store" })
      ]);
      const searchPayload = (await searchResponse.json()) as ProductsResponse;
      const skuPayload = (await skuResponse.json()) as ProductsResponse;

      if (!searchResponse.ok || searchPayload.error) {
        throw new Error(searchPayload.error ?? "Could not search products.");
      }

      if (!skuResponse.ok || skuPayload.error) {
        throw new Error(skuPayload.error ?? "Could not search products by SKU.");
      }

      const productsById = new Map<number, WooProduct>();

      for (const product of [...(skuPayload.data ?? []), ...(searchPayload.data ?? [])]) {
        productsById.set(product.id, product);
      }

      setResults(
        [...productsById.values()]
          .filter((product) => product.id !== currentProductId && !selectedIds.includes(product.id))
          .map(toRelatedProduct)
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not search products.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="relationship-editor">
      <div className="relationship-editor-head">
        <div>
          <strong>{title}</strong>
          <span className="subtle">{description}</span>
        </div>
        <span className="status neutral">{selectedIds.length} linked</span>
      </div>

      {error ? <p className="error compact-error">{error}</p> : null}

      <div className="relationship-list">
        {loadingSelected ? <div className="relationship-empty">Loading linked products...</div> : null}
        {!loadingSelected && selectedProducts.length === 0 ? (
          <div className="relationship-empty">No products linked yet.</div>
        ) : null}
        {selectedProducts.map((product) => (
          <div className="relationship-product selected" key={product.id}>
            {product.image ? <img src={product.image} alt="" /> : <span className="relationship-product-image" aria-hidden />}
            <div>
              <strong>{product.name}</strong>
              <span className="subtle">
                ID {product.id} / SKU {product.sku || "No SKU"}
              </span>
              <span className="subtle">
                {product.regularPrice ? `GBP ${product.regularPrice}` : "No regular price"} /{" "}
                {product.stockStatus || product.status || "No status"}
              </span>
            </div>
            <div className="relationship-actions">
              {product.permalink ? (
                <a className="icon-button secondary" href={product.permalink} target="_blank" rel="noreferrer" title="Open store page">
                  <ExternalLink size={16} />
                </a>
              ) : null}
              <button className="icon-button secondary" type="button" onClick={() => removeProduct(product.id)} title="Remove product">
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="relationship-search">
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                searchProducts();
              }
            }}
            placeholder="Search product name or SKU"
            type="search"
          />
        </label>
        <button className="button secondary" type="button" disabled={searching} onClick={searchProducts}>
          <Search size={16} />
          {searching ? "Searching" : "Search"}
        </button>
      </div>

      {results.length > 0 ? (
        <div className="relationship-results">
          {results.map((product) => (
            <div className="relationship-product" key={product.id}>
              {product.image ? <img src={product.image} alt="" /> : <span className="relationship-product-image" aria-hidden />}
              <div>
                <strong>{product.name}</strong>
                <span className="subtle">
                  ID {product.id} / SKU {product.sku || "No SKU"}
                </span>
              </div>
              <button className="button secondary" type="button" onClick={() => addProduct(product)}>
                <Plus size={16} />
                Add
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColourBoardEditor({
  options,
  onChange
}: {
  options: ColourBoardOption[];
  onChange: (options: ColourBoardOption[]) => void;
}) {
  const [selectedChoiceId, setSelectedChoiceId] = useState("");

  function updateOption(index: number, field: keyof ColourBoardOption, value: string | boolean) {
    onChange(
      options.map((option, optionIndex) => {
        if (field === "default_option") {
          return {
            ...option,
            default_option: optionIndex === index ? Boolean(value) : false
          };
        }

        return optionIndex === index ? { ...option, [field]: value } : option;
      })
    );
  }

  function addOption() {
    onChange([
      ...options,
      {
        option_group: "Case Colour",
        color_name: "",
        color_hex: "",
        swatch_image_url: "",
        option_image_url: "",
        price_adjustment: "0",
        default_option: options.length === 0,
        notes: ""
      }
    ]);
  }

  function addChoice() {
    const choice = COLOUR_BOARD_CHOICES.find((item) => item.id === selectedChoiceId);

    if (!choice) {
      return;
    }

    const option = choiceToColourOption(choice);
    const optionSignature = colourOptionSignature([option]);
    const alreadySelected = options.some((current) => colourOptionSignature([current]) === optionSignature);

    if (!alreadySelected) {
      onChange([...options, option]);
    }

    setSelectedChoiceId("");
  }

  function removeOption(index: number) {
    onChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  return (
    <div className="colour-board-editor">
      <div className="relationship-editor-head">
        <div>
          <strong>Colour Board</strong>
          <span className="subtle">Stored as colour board custom option meta, not WooCommerce variations.</span>
        </div>
        <span className="status neutral">{normalizedColourOptions(options).length} colours</span>
      </div>

      <div className="colour-choice-picker">
        <label>
          <Search size={16} />
          <select value={selectedChoiceId} onChange={(event) => setSelectedChoiceId(event.target.value)}>
            <option value="">Pick from {COLOUR_BOARD_CHOICES.length} CSV choices</option>
            {COLOUR_BOARD_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {colourChoiceLabel(choice)}
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" type="button" disabled={!selectedChoiceId} onClick={addChoice}>
          <Plus size={16} />
          Add choice
        </button>
      </div>

      <div className="colour-board-list">
        {options.length === 0 ? <div className="relationship-empty">No colour board options yet.</div> : null}
        {options.map((option, index) => (
          <div className="colour-board-row" key={index}>
            <div className="colour-board-swatch" title={option.color_name || "Colour"}>
              {option.swatch_image_url ? (
                <img src={option.swatch_image_url} alt="" />
              ) : (
                <span style={{ background: option.color_hex || "#f4f0e9" }} />
              )}
            </div>
            <div className="colour-board-fields">
              <div className="field">
                <label htmlFor={`colour_group_${index}`}>Group</label>
                <input
                  id={`colour_group_${index}`}
                  value={option.option_group ?? ""}
                  onChange={(event) => updateOption(index, "option_group", event.target.value)}
                  placeholder="Case Colour"
                />
              </div>
              <div className="field">
                <label htmlFor={`colour_name_${index}`}>Colour name</label>
                <input
                  id={`colour_name_${index}`}
                  value={option.color_name ?? ""}
                  onChange={(event) => updateOption(index, "color_name", event.target.value)}
                  placeholder="Black"
                />
              </div>
              <div className="field">
                <label htmlFor={`colour_hex_${index}`}>Hex</label>
                <input
                  id={`colour_hex_${index}`}
                  value={option.color_hex ?? ""}
                  onChange={(event) => updateOption(index, "color_hex", event.target.value)}
                  placeholder="#000000"
                />
              </div>
              <div className="field">
                <label htmlFor={`colour_price_${index}`}>Price adjustment</label>
                <input
                  id={`colour_price_${index}`}
                  value={option.price_adjustment ?? ""}
                  onChange={(event) => updateOption(index, "price_adjustment", event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field wide">
                <label htmlFor={`colour_swatch_${index}`}>Swatch image URL</label>
                <input
                  id={`colour_swatch_${index}`}
                  value={option.swatch_image_url ?? ""}
                  onChange={(event) => updateOption(index, "swatch_image_url", event.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="field wide">
                <label htmlFor={`colour_image_${index}`}>Option image URL</label>
                <input
                  id={`colour_image_${index}`}
                  value={option.option_image_url ?? ""}
                  onChange={(event) => updateOption(index, "option_image_url", event.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="field wide">
                <label htmlFor={`colour_notes_${index}`}>Notes</label>
                <input
                  id={`colour_notes_${index}`}
                  value={option.notes ?? ""}
                  onChange={(event) => updateOption(index, "notes", event.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="colour-board-actions">
              <label className="checkbox-field compact">
                <input
                  type="checkbox"
                  checked={Boolean(option.default_option)}
                  onChange={(event) => updateOption(index, "default_option", event.target.checked)}
                />
                Default
              </label>
              <button className="icon-button secondary" type="button" onClick={() => removeOption(index)} title="Remove colour">
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button className="button secondary" type="button" onClick={addOption}>
        <Plus size={16} />
        Add custom colour
      </button>
    </div>
  );
}

function SpecificationEditor({
  groups,
  onChange,
  onParseFromDescription
}: {
  groups: SpecificationGroup[];
  onChange: (groups: SpecificationGroup[]) => void;
  onParseFromDescription: () => void;
}) {
  function updateGroup(index: number, value: string) {
    onChange(groups.map((group, groupIndex) => (groupIndex === index ? { ...group, group_name: value } : group)));
  }

  function addGroup() {
    onChange([...groups, { group_name: "Features", specifications: [{ name: "", value: "" }] }]);
  }

  function removeGroup(index: number) {
    onChange(groups.filter((_, groupIndex) => groupIndex !== index));
  }

  function addSpecification(groupIndex: number) {
    onChange(
      groups.map((group, index) =>
        index === groupIndex
          ? { ...group, specifications: [...group.specifications, { name: "", value: "" }] }
          : group
      )
    );
  }

  function updateSpecification(groupIndex: number, specIndex: number, field: "name" | "value", value: string) {
    onChange(
      groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              specifications: group.specifications.map((specification, specificationIndex) =>
                specificationIndex === specIndex ? { ...specification, [field]: value } : specification
              )
            }
          : group
      )
    );
  }

  function removeSpecification(groupIndex: number, specIndex: number) {
    onChange(
      groups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              specifications: group.specifications.filter((_, specificationIndex) => specificationIndex !== specIndex)
            }
          : group
      )
    );
  }

  const specificationCount = groups.reduce((count, group) => count + group.specifications.length, 0);

  return (
    <div className="specification-editor">
      <div className="relationship-editor-head">
        <div>
          <strong>Specifications</strong>
          <span className="subtle">Saved to the technical specifications and ACF-style specification group meta.</span>
        </div>
        <span className="status neutral">{specificationCount} specs</span>
      </div>
      <div className="specification-toolbar">
        <button className="button secondary" type="button" onClick={onParseFromDescription}>
          <Search size={16} />
          Parse Features
        </button>
        <button className="button secondary" type="button" onClick={addGroup}>
          <Plus size={16} />
          Add group
        </button>
      </div>
      <div className="specification-groups">
        {groups.length === 0 ? <div className="relationship-empty">No specification groups yet.</div> : null}
        {groups.map((group, groupIndex) => (
          <div className="specification-group" key={groupIndex}>
            <div className="specification-group-head">
              <div className="field">
                <label htmlFor={`spec_group_${groupIndex}`}>Group name</label>
                <input
                  id={`spec_group_${groupIndex}`}
                  value={group.group_name}
                  onChange={(event) => updateGroup(groupIndex, event.target.value)}
                  placeholder="Features"
                />
              </div>
              <button className="icon-button secondary" type="button" onClick={() => removeGroup(groupIndex)} title="Remove group">
                <X size={16} />
              </button>
            </div>
            <div className="specification-list">
              {group.specifications.map((specification, specIndex) => (
                <div className="specification-row" key={specIndex}>
                  <div className="field">
                    <label htmlFor={`spec_name_${groupIndex}_${specIndex}`}>Name</label>
                    <input
                      id={`spec_name_${groupIndex}_${specIndex}`}
                      value={specification.name}
                      onChange={(event) => updateSpecification(groupIndex, specIndex, "name", event.target.value)}
                      placeholder="Material"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`spec_value_${groupIndex}_${specIndex}`}>Value</label>
                    <input
                      id={`spec_value_${groupIndex}_${specIndex}`}
                      value={specification.value}
                      onChange={(event) => updateSpecification(groupIndex, specIndex, "value", event.target.value)}
                      placeholder="1.5mm Steel"
                    />
                  </div>
                  <button
                    className="icon-button secondary"
                    type="button"
                    onClick={() => removeSpecification(groupIndex, specIndex)}
                    title="Remove specification"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button className="button secondary" type="button" onClick={() => addSpecification(groupIndex)}>
              <Plus size={16} />
              Add specification
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductEditor({
  product,
  categories
}: {
  product: WooProduct;
  categories: WooCategory[];
}) {
  const initialCategoryIds = useMemo(() => product.categories.map((item) => item.id), [product.categories]);
  const initialCrossSellIds = useMemo(() => product.cross_sell_ids ?? [], [product.cross_sell_ids]);
  const initialColourOptions = useMemo(() => initialColourBoardOptions(product), [product]);
  const initialColourSignature = useMemo(() => colourOptionSignature(initialColourOptions), [initialColourOptions]);
  const initialSpecificationGroups = useMemo(() => readInitialSpecificationGroups(product), [product]);
  const initialSpecificationSignature = useMemo(
    () => specificationSignature(initialSpecificationGroups),
    [initialSpecificationGroups]
  );
  const initialCustomNotes = useMemo(() => isTruthyMeta(productMetaValue(product, "custom_notes")), [product]);
  const categoryOptions = useMemo(() => getHierarchicalCategoryOptions(categories), [categories]);
  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);
  const currentCategoryPaths = useMemo(
    () => product.categories.map((item) => getCategoryPath(categories, item.id)),
    [categories, product.categories]
  );
  const initialAdvanced = useMemo(() => advancedText(product), [product]);
  const initialImages = useMemo(() => imageText(product), [product]);
  const [categoryIds, setCategoryIds] = useState<number[]>(initialCategoryIds);
  const [crossSellIds, setCrossSellIds] = useState<number[]>(initialCrossSellIds);
  const [colourOptions, setColourOptions] = useState<ColourBoardOption[]>(initialColourOptions);
  const [specificationGroups, setSpecificationGroups] = useState<SpecificationGroup[]>(initialSpecificationGroups);
  const [fullDescription, setFullDescription] = useState(product.description);
  const [advanced, setAdvanced] = useState(initialAdvanced);
  const [images, setImages] = useState(initialImages);
  const [categorySearch, setCategorySearch] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<number>>(
    () => selectedAncestorIds(categories, initialCategoryIds)
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleCategory(id: number) {
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function toggleExpandedCategory(id: number) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function expandSelectedCategories() {
    setExpandedCategoryIds(selectedAncestorIds(categories, categoryIds));
  }

  function parseSpecificationsFromDescription() {
    const parsed = specificationGroupsFromDescription(fullDescription);

    if (parsed.length === 0) {
      setError("No Features list was found in the full description.");
      return;
    }

    setError("");
    setSpecificationGroups(parsed);
  }

  const selectedCategoryOptions = useMemo(
    () => categoryIds
      .map((id) => categoryOptions.find((option) => option.category.id === id))
      .filter((option): option is (typeof categoryOptions)[number] => Boolean(option)),
    [categoryIds, categoryOptions]
  );

  useEffect(() => {
    const stockStatusField = document.getElementById("stock_status");
    const backordersField = document.getElementById("backorders");

    if (!(stockStatusField instanceof HTMLSelectElement) || !(backordersField instanceof HTMLSelectElement)) {
      return;
    }

    if (stockStatusField.value === "onbackorder" && backordersField.value !== "notify") {
      backordersField.value = "notify";
    }
  }, [product.stock_status, product.backorders]);

  const visibleCategoryOptions = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();

    return categoryOptions.filter((option) => {
      const isSelected = categoryIds.includes(option.category.id);
      const matchesQuery =
        !query ||
        option.path.toLowerCase().includes(query) ||
        option.category.name.toLowerCase().includes(query);

      return matchesQuery && (!showSelectedOnly || isSelected);
    });
  }, [categoryIds, categoryOptions, categorySearch, showSelectedOnly]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const changes: ProductChanges = {};

    const textFields: Array<keyof ProductChanges> = [
      "name",
      "sku",
      "regular_price",
      "sale_price",
      "status",
      "catalog_visibility",
      "stock_status",
      "short_description",
      "description"
    ];

    for (const field of textFields) {
      const value = String(form.get(field) ?? "");
      const current = String((product as unknown as Record<string, unknown>)[field] ?? "");
      if (value !== current) {
        (changes as Record<string, unknown>)[field] = value;
      }
    }

    const stockStatus = String(form.get("stock_status") ?? product.stock_status);
    const currentBackorders = product.backorders ?? "no";
    const nextBackorders = stockStatus === "onbackorder" ? "notify" : backordersValue(form.get("backorders"));

    if (nextBackorders !== currentBackorders) {
      changes.backorders = nextBackorders;
    }

    if (stockStatus === "onbackorder" && form.get("backorders") !== "notify") {
      changes.backorders = "notify";
    }

    const manageStock = form.get("manage_stock") === "on";
    if (manageStock !== product.manage_stock) {
      changes.manage_stock = manageStock;
    }

    const featured = form.get("featured") === "on";
    if (featured !== product.featured) {
      changes.featured = featured;
    }

    const customNotes = form.get("custom_notes") === "on";
    if (customNotes !== initialCustomNotes) {
      changes.meta_data = mergeMetaData(changes.meta_data, customNotesMetaData(product, customNotes));
    }

    const stockQuantityRaw = String(form.get("stock_quantity") ?? "");
    const stockQuantity = stockQuantityRaw.trim() === "" ? null : Number(stockQuantityRaw);
    if (Number.isNaN(stockQuantity)) {
      setError("Stock quantity must be a number.");
      setSubmitting(false);
      return;
    }
    if (stockQuantity !== product.stock_quantity) {
      changes.stock_quantity = stockQuantity;
    }

    const dimensions = {
      length: dimensionValue(form, "length"),
      width: dimensionValue(form, "width"),
      height: dimensionValue(form, "height")
    };

    if (Object.values(dimensions).some((value) => !isValidDimension(value))) {
      setError("Dimensions must be zero or a positive number.");
      setSubmitting(false);
      return;
    }

    const currentDimensions = {
      length: product.dimensions?.length?.trim() ?? "",
      width: product.dimensions?.width?.trim() ?? "",
      height: product.dimensions?.height?.trim() ?? ""
    };

    if (
      dimensions.length !== currentDimensions.length ||
      dimensions.width !== currentDimensions.width ||
      dimensions.height !== currentDimensions.height
    ) {
      changes.dimensions = dimensions;
    }

    if (sortedIds(categoryIds) !== sortedIds(initialCategoryIds)) {
      changes.categories = categoryIds.map((id) => ({ id }));
    }

    if (sortedIds(crossSellIds) !== sortedIds(initialCrossSellIds)) {
      changes.cross_sell_ids = crossSellIds;
    }

    if (images !== initialImages) {
      changes.images = images
        .split(/\r?\n/)
        .map((src) => src.trim())
        .filter(Boolean)
        .map((src) => ({ src }));
    }

    if (advanced !== initialAdvanced) {
      try {
        Object.assign(changes, JSON.parse(advanced));
      } catch {
        setError("Advanced JSON is not valid.");
        setSubmitting(false);
        return;
      }
    }

    if (colourOptionSignature(colourOptions) !== initialColourSignature) {
      changes.meta_data = mergeMetaData(changes.meta_data, colourBoardMetaData(product, colourOptions));
    }

    if (specificationSignature(specificationGroups) !== initialSpecificationSignature) {
      changes.meta_data = mergeMetaData(changes.meta_data, specificationMetaData(product, specificationGroups));
    }

    if (Object.keys(changes).length === 0) {
      setError("No changes to review yet.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "product",
          action: "update",
          resourceId: product.id,
          changes
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage("Review draft created.");
      window.location.assign("/reviews");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create review draft.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="editor-shell" onSubmit={onSubmit}>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Listing Details</h2>
          <button className="button" type="submit" disabled={submitting}>
            <Save size={17} />
            {submitting ? "Saving" : "Send to Review"}
          </button>
        </div>
        <div className="panel-body">
          {message ? <p className="notice">{message}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="form-grid">
            <div className="field wide">
              <label htmlFor="name">Product name</label>
              <input id="name" name="name" defaultValue={product.name} />
            </div>
            <div className="field">
              <label htmlFor="sku">SKU</label>
              <input id="sku" name="sku" defaultValue={product.sku} />
            </div>
            <div className="field">
              <label htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={product.status}>
                <option value="publish">Published</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="regular_price">Regular price</label>
              <input id="regular_price" name="regular_price" defaultValue={product.regular_price} />
            </div>
            <div className="field">
              <label htmlFor="sale_price">Sale price</label>
              <input id="sale_price" name="sale_price" defaultValue={product.sale_price} />
            </div>
            <div className="field">
              <label htmlFor="stock_status">Stock status</label>
              <select
                id="stock_status"
                name="stock_status"
                defaultValue={product.stock_status}
                onChange={(event) => {
                  const stockStatus = event.currentTarget.value;
                  const backordersField = document.getElementById("backorders");

                  if (stockStatus === "onbackorder" && backordersField instanceof HTMLSelectElement) {
                    backordersField.value = "notify";
                  }
                }}
              >
                <option value="instock">In stock</option>
                <option value="outofstock">Out of stock</option>
                <option value="onbackorder">On backorder</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="backorders">Backorders</label>
              <select
                id="backorders"
                name="backorders"
                defaultValue={product.backorders ?? "no"}
                onChange={(event) => {
                  const backorders = event.currentTarget.value;
                  const stockStatusField = document.getElementById("stock_status");

                  if (backorders === "notify" && stockStatusField instanceof HTMLSelectElement) {
                    stockStatusField.value = "onbackorder";
                  }
                }}
              >
                <option value="no">Do not allow</option>
                <option value="notify">Allow and notify customer</option>
                <option value="yes">Allow</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="stock_quantity">Stock quantity</label>
              <input
                id="stock_quantity"
                name="stock_quantity"
                type="number"
                defaultValue={product.stock_quantity ?? ""}
              />
            </div>
            <label className="checkbox-field">
              <input name="manage_stock" type="checkbox" defaultChecked={product.manage_stock} />
              Manage stock
            </label>
            <label className="checkbox-field">
              <input name="featured" type="checkbox" defaultChecked={product.featured} />
              Featured product
            </label>
            <label className="checkbox-field">
              <input name="custom_notes" type="checkbox" defaultChecked={initialCustomNotes} />
              Custom notes
            </label>
            <div className="field wide">
              <label htmlFor="catalog_visibility">Catalog visibility</label>
              <select id="catalog_visibility" name="catalog_visibility" defaultValue={product.catalog_visibility}>
                <option value="visible">Visible</option>
                <option value="catalog">Catalog only</option>
                <option value="search">Search only</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>
            <fieldset className="dimension-fields wide">
              <legend>
                <Ruler size={16} />
                Shipping dimensions
              </legend>
              <div className="field">
                <label htmlFor="dimension_length">Length</label>
                <input
                  id="dimension_length"
                  name="dimension_length"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  defaultValue={product.dimensions?.length ?? ""}
                />
              </div>
              <div className="field">
                <label htmlFor="dimension_width">Width</label>
                <input
                  id="dimension_width"
                  name="dimension_width"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  defaultValue={product.dimensions?.width ?? ""}
                />
              </div>
              <div className="field">
                <label htmlFor="dimension_height">Height</label>
                <input
                  id="dimension_height"
                  name="dimension_height"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  defaultValue={product.dimensions?.height ?? ""}
                />
              </div>
            </fieldset>
            <div className="field wide">
              <div className="category-field-head">
                <label>Categories</label>
                <span className="status neutral">{categoryIds.length} selected</span>
              </div>
              <div className="selected-category-paths refined" aria-label="Selected category hierarchy">
                {selectedCategoryOptions.length > 0 ? (
                  selectedCategoryOptions.map((option) => (
                    <span key={option.category.id}>
                      {option.path}
                      <button
                        type="button"
                        onClick={() => toggleCategory(option.category.id)}
                        aria-label={`Remove ${option.path}`}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))
                ) : (
                  <span>Uncategorized</span>
                )}
              </div>
              <div className="category-picker-toolbar">
                <label className="category-search">
                  <Search size={16} />
                  <input
                    value={categorySearch}
                    onChange={(event) => setCategorySearch(event.target.value)}
                    placeholder="Search category hierarchy"
                    type="search"
                  />
                </label>
                <button
                  className={`button secondary ${showSelectedOnly ? "active" : ""}`}
                  type="button"
                  onClick={() => setShowSelectedOnly((current) => !current)}
                >
                  {showSelectedOnly ? "Show all" : "Selected only"}
                </button>
                <button className="button secondary" type="button" onClick={expandSelectedCategories}>
                  Expand selected
                </button>
              </div>
              <div className="category-picker category-picker-refined">
                {!categorySearch.trim() && !showSelectedOnly ? (
                  <CategoryTree
                    nodes={categoryTree}
                    categoryIds={categoryIds}
                    expandedIds={expandedCategoryIds}
                    onToggleCategory={toggleCategory}
                    onToggleExpanded={toggleExpandedCategory}
                  />
                ) : visibleCategoryOptions.length > 0 ? visibleCategoryOptions.map((option) => (
                  <label
                    key={option.category.id}
                    className="category-choice category-choice-hierarchy"
                    style={{ "--category-depth": Math.min(option.depth, 4) } as CSSProperties}
                    title={option.path}
                  >
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(option.category.id)}
                      onChange={() => toggleCategory(option.category.id)}
                    />
                    <span>
                      <strong>{option.category.name}</strong>
                      <small>{option.path}</small>
                    </span>
                  </label>
                )) : <div className="category-picker-empty">No matching categories.</div>}
              </div>
            </div>
            <div className="field wide">
              <label htmlFor="short_description">Short description</label>
              <textarea id="short_description" name="short_description" defaultValue={product.short_description} />
            </div>
            <div className="field wide">
              <label htmlFor="description">Full description HTML</label>
              <textarea
                className="full-description-editor"
                id="description"
                name="description"
                value={fullDescription}
                onChange={(event) => setFullDescription(event.target.value)}
              />
            </div>
            <div className="field wide">
              <label>Specifications</label>
              <SpecificationEditor
                groups={specificationGroups}
                onChange={setSpecificationGroups}
                onParseFromDescription={parseSpecificationsFromDescription}
              />
            </div>
            <div className="field wide">
              <label>Accessories</label>
              <div className="relationship-grid">
                <ProductRelationshipEditor
                  title="Accessories / cross-sells"
                  description="Products shown as accessories or add-ons in WooCommerce."
                  selectedIds={crossSellIds}
                  currentProductId={product.id}
                  onChange={setCrossSellIds}
                />
              </div>
            </div>
            <div className="field wide">
              <label>Colour board</label>
              <ColourBoardEditor options={colourOptions} onChange={setColourOptions} />
            </div>
            <div className="field wide">
              <label htmlFor="images">Image URLs</label>
              <textarea id="images" value={images} onChange={(event) => setImages(event.target.value)} />
            </div>
            <div className="field wide">
              <label htmlFor="advanced">Advanced WooCommerce fields</label>
              <textarea id="advanced" value={advanced} onChange={(event) => setAdvanced(event.target.value)} />
            </div>
          </div>
        </div>
      </section>

      <aside className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Review Gate</h2>
          <ClipboardCheck size={18} />
        </div>
        <div className="panel-body sidebar-list">
          <p className="notice">
            Saving here only creates a review draft. WooCommerce is updated only after approval in
            the Review Queue.
          </p>
          <div>
            <span className="subtle">Current stock</span>
            <strong className={`status ${product.stock_status}`}>{product.stock_status}</strong>
          </div>
          <div>
            <span className="subtle">Current dimensions (L x W x H)</span>
            <strong>{dimensionsText(product)}</strong>
          </div>
          <div>
            <span className="subtle">Custom notes</span>
            <strong className={`status ${initialCustomNotes ? "approved" : "neutral"}`}>
              {initialCustomNotes ? "Yes" : "No"}
            </strong>
          </div>
          <div>
            <span className="subtle">Current categories</span>
            <div className="current-category-paths">
              {currentCategoryPaths.length > 0 ? (
                currentCategoryPaths.map((path) => <span key={path}>{path}</span>)
              ) : (
                <span>Uncategorized</span>
              )}
            </div>
          </div>
          <div>
            <span className="subtle">Current accessories</span>
            <strong>{initialCrossSellIds.length}</strong>
          </div>
          <div>
            <span className="subtle">Colour board options</span>
            <strong>{initialColourOptions.length}</strong>
          </div>
          <div>
            <span className="subtle">Specifications</span>
            <strong>
              {initialSpecificationGroups.reduce((count, group) => count + group.specifications.length, 0)}
            </strong>
          </div>
          <div className="image-stack">
            {product.images?.slice(0, 3).map((image) => (
              <img key={`${image.id}-${image.src}`} src={image.src} alt={image.alt ?? ""} />
            ))}
          </div>
        </div>
      </aside>
    </form>
  );
}
