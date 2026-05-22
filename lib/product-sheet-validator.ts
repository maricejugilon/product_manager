import "server-only";

import { getProductSheetRows, type SheetProductRow } from "@/lib/product-sheet";
import type { WooCategory, WooProduct } from "@/lib/types";
import { getCategories, getProducts } from "@/lib/woocommerce";

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
};

let categoriesCache: {
  expiresAt: number;
  categories: WooCategory[];
} | null = null;

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

      if (skuResult.data.length === 1) {
        return {
          status: "matched" as const,
          matchMethod: "sku" as const,
          product: skuResult.data[0],
          candidates: skuResult.data
        };
      }

      if (skuResult.data.length > 1) {
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
      const exactName = nameResult.data.find((product) => normalizeText(product.name) === normalizeText(row.name));

      if (exactName) {
        return {
          status: "matched" as const,
          matchMethod: "name" as const,
          product: exactName,
          candidates: nameResult.data,
          error: lookupErrors.join(" ")
        };
      }

      if (nameResult.data.length === 1) {
        return {
          status: "matched" as const,
          matchMethod: "name" as const,
          product: nameResult.data[0],
          candidates: nameResult.data,
          error: lookupErrors.join(" ")
        };
      }

      if (nameResult.data.length > 1) {
        return {
          status: "ambiguous" as const,
          matchMethod: "name" as const,
          product: nameResult.data[0],
          candidates: nameResult.data,
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
    candidates: []
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
        categoryComparison: compareCategories(row, match.product, categories)
      };
    } catch (error) {
      return {
        row,
        status: "error",
        matchMethod: "none",
        candidates: [],
        error: error instanceof Error ? error.message : "WooCommerce lookup failed.",
        categoryComparison: compareCategories(row, undefined, categories)
      };
    }
  });
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
