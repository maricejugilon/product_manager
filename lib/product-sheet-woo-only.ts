import "server-only";

import { getProductSheetRows } from "@/lib/product-sheet";
import type { WooCategory, WooProduct } from "@/lib/types";
import { getAllProducts, getCategories } from "@/lib/woocommerce";

export type WooOnlyProduct = {
  id: number;
  name: string;
  sku: string;
  status: string;
  catalogVisibility: string;
  permalink: string;
  image: string;
  categoryHierarchy: string[];
  dateModified: string;
};

type WooOnlyCache = {
  expiresAt: number;
  updatedAt: string;
  products: WooOnlyProduct[];
};

const cacheDurationMs = 5 * 60 * 1000;
const wooOnlyFields = "id,name,sku,status,catalog_visibility,permalink,images,categories,date_modified";
let wooOnlyCache: WooOnlyCache | null = null;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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

function productCategoryHierarchy(product: WooProduct, categories: WooCategory[]) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return [
    ...new Set(
      product.categories
        .map((productCategory) => {
          const category = categoryById.get(productCategory.id);
          const path = category ? categoryPath(category, categoryById) : [productCategory.name ?? ""];

          return path.filter(Boolean).join(" > ");
        })
        .filter(Boolean)
    )
  ];
}

export async function getWooOnlyProducts(options: { refresh?: boolean } = {}) {
  const now = Date.now();

  if (!options.refresh && wooOnlyCache && wooOnlyCache.expiresAt > now) {
    return wooOnlyCache;
  }

  const sheetRows = await getProductSheetRows();
  const wooProducts = await getAllProducts({ fields: wooOnlyFields });
  const categories = await getCategories();
  const sheetSkus = new Set(sheetRows.map((row) => normalize(row.sku)).filter(Boolean));
  const sheetNames = new Set(sheetRows.map((row) => normalize(row.name)).filter(Boolean));
  const products = wooProducts
    .filter((product) => {
      const skuMatch = Boolean(product.sku) && sheetSkus.has(normalize(product.sku));
      const nameMatch = Boolean(product.name) && sheetNames.has(normalize(product.name));

      return !skuMatch && !nameMatch;
    })
    .map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      status: product.status,
      catalogVisibility: product.catalog_visibility,
      permalink: product.permalink,
      image: product.images[0]?.src ?? "",
      categoryHierarchy: productCategoryHierarchy(product, categories),
      dateModified: product.date_modified ?? ""
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  const updatedAt = new Date().toISOString();

  wooOnlyCache = {
    expiresAt: now + cacheDurationMs,
    updatedAt,
    products
  };

  return wooOnlyCache;
}
