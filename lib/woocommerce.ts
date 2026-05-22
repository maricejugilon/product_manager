import "server-only";

import { isCategoryAncestor, normalizeCategoryName } from "@/lib/category-utils";
import { getProductDuplicateSignals } from "@/lib/product-duplicates";
import type {
  CategoryChanges,
  CategoryMergeChanges,
  ProductMergeChanges,
  ProductChanges,
  WooCategory,
  WooProduct,
  WooProductVariation
} from "@/lib/types";

type QueryValue = string | number | boolean | undefined | null;

function getConfig() {
  const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

  if (!storeUrl || !key || !secret) {
    throw new Error("WooCommerce environment variables are missing.");
  }

  return {
    storeUrl: storeUrl.replace(/\/$/, ""),
    auth: Buffer.from(`${key}:${secret}`).toString("base64")
  };
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const { storeUrl } = getConfig();
  const url = new URL(`/wp-json/wc/v3${path}`, storeUrl);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

async function wcFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    query?: Record<string, QueryValue>;
    body?: unknown;
  } = {}
): Promise<{ data: T; total?: number; totalPages?: number }> {
  const { auth } = getConfig();
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WooCommerce ${response.status}: ${body || response.statusText}`);
  }

  return {
    data: (await response.json()) as T,
    total: Number(response.headers.get("x-wp-total") ?? undefined) || undefined,
    totalPages: Number(response.headers.get("x-wp-totalpages") ?? undefined) || undefined
  };
}

export async function getProducts(params: {
  page?: number;
  perPage?: number;
  search?: string;
  sku?: string;
  category?: string;
  stockStatus?: string;
  status?: string;
  fields?: string;
  include?: string;
}) {
  return wcFetch<WooProduct[]>("/products", {
    query: {
      per_page: params.perPage ?? 100,
      page: params.page ?? 1,
      orderby: "modified",
      order: "desc",
      search: params.search,
      sku: params.sku,
      category: params.category,
      stock_status: params.stockStatus,
      status: params.status || "any",
      _fields: params.fields,
      include: params.include
    }
  });
}

export async function getProduct(id: number) {
  const { data } = await wcFetch<WooProduct>(`/products/${id}`);
  return data;
}

export async function updateProduct(id: number, changes: ProductChanges) {
  const { data } = await wcFetch<WooProduct>(`/products/${id}`, {
    method: "PUT",
    body: changes
  });

  return data;
}

export async function createProduct(changes: ProductChanges) {
  const { data } = await wcFetch<WooProduct>("/products", {
    method: "POST",
    body: changes
  });

  return data;
}

export async function createProductVariation(productId: number, changes: ProductMergeChanges["sourceVariation"]) {
  const { data } = await wcFetch<WooProductVariation>(`/products/${productId}/variations`, {
    method: "POST",
    body: changes
  });

  return data;
}

export async function getCategories() {
  const query = {
    per_page: 100,
    hide_empty: false,
    orderby: "name",
    order: "asc"
  };
  const firstPage = await wcFetch<WooCategory[]>("/products/categories", {
    query: {
      ...query,
      page: 1
    }
  });
  const totalPages = firstPage.totalPages ?? 1;
  const remainingPages =
    totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            wcFetch<WooCategory[]>("/products/categories", {
              query: {
                ...query,
                page: index + 2
              }
            })
          )
        )
      : [];
  const categories = [firstPage, ...remainingPages].flatMap((result) => result.data);

  return [...new Map(categories.map((category) => [category.id, category])).values()];
}

export async function getCategory(id: number) {
  const { data } = await wcFetch<WooCategory>(`/products/categories/${id}`);
  return data;
}

export async function createCategory(changes: CategoryChanges) {
  const { data } = await wcFetch<WooCategory>("/products/categories", {
    method: "POST",
    body: changes
  });

  return data;
}

export async function updateCategory(id: number, changes: CategoryChanges) {
  const { data } = await wcFetch<WooCategory>(`/products/categories/${id}`, {
    method: "PUT",
    body: changes
  });

  return data;
}

export async function deleteCategory(id: number) {
  const { data } = await wcFetch<WooCategory>(`/products/categories/${id}`, {
    method: "DELETE",
    query: {
      force: true
    }
  });

  return data;
}

export async function getProductsByCategory(categoryId: number) {
  const products: WooProduct[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await getProducts({
      page,
      perPage: 100,
      category: String(categoryId),
      status: "any"
    });

    products.push(...result.data);
    totalPages = result.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return products;
}

const duplicateScanFields = [
  "id",
  "name",
  "slug",
  "permalink",
  "date_modified",
  "type",
  "status",
  "featured",
  "catalog_visibility",
  "sku",
  "price",
  "regular_price",
  "sale_price",
  "stock_status",
  "manage_stock",
  "stock_quantity",
  "categories",
  "tags",
  "images",
  "short_description",
  "description",
  "attributes",
  "dimensions",
  "weight",
  "shipping_class",
  "purchase_note",
  "menu_order"
].join(",");

export async function getAllProducts(params: { category?: string; status?: string; fields?: string } = {}) {
  const query = {
    perPage: 100,
    category: params.category,
    status: params.status ?? "any",
    fields: params.fields
  };
  const firstPage = await getProducts({
    ...query,
    page: 1
  });
  const totalPages = firstPage.totalPages ?? 1;
  const remainingPages =
    totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            getProducts({
              ...query,
              page: index + 2
            })
          )
        )
      : [];

  const products = [firstPage, ...remainingPages].flatMap((result) => result.data);

  return [...new Map(products.map((product) => [product.id, product])).values()];
}

export async function getProductsForDuplicateScan(params: { category?: string; status?: string } = {}) {
  return getAllProducts({
    ...params,
    fields: duplicateScanFields
  });
}

export async function getProductsByCategoryIds(categoryIds: number[]) {
  const productGroups = await Promise.all(
    categoryIds.map((categoryId) =>
      getProductsForDuplicateScan({
        category: String(categoryId),
        status: "any"
      })
    )
  );
  const products = productGroups.flat();

  return [...new Map(products.map((product) => [product.id, product])).values()];
}

export async function mergeCategoryIntoTarget(changes: CategoryMergeChanges) {
  const categories = await getCategories();
  const source = categories.find((category) => category.id === changes.sourceId);
  const target = categories.find((category) => category.id === changes.targetId);

  if (!source || !target) {
    throw new Error("Source or target category no longer exists.");
  }

  if (normalizeCategoryName(source.name) !== normalizeCategoryName(target.name)) {
    throw new Error("Categories no longer have the same normalized name.");
  }

  if (isCategoryAncestor(categories, source.id, target.id)) {
    throw new Error("Cannot merge a parent category into its own child category.");
  }

  const children = categories.filter((category) => category.parent === source.id && category.id !== target.id);
  const products = await getProductsByCategory(source.id);
  const movedChildIds: number[] = [];
  const movedProductIds: number[] = [];

  for (const child of children) {
    await updateCategory(child.id, { parent: target.id });
    movedChildIds.push(child.id);
  }

  for (const product of products) {
    const categoryIds = product.categories.map((category) => category.id);

    if (!categoryIds.includes(source.id)) {
      continue;
    }

    const nextCategoryIds = [...new Set(categoryIds.map((id) => (id === source.id ? target.id : id)))];
    await updateProduct(product.id, {
      categories: nextCategoryIds.map((id) => ({ id }))
    });
    movedProductIds.push(product.id);
  }

  const deletedCategory = await deleteCategory(source.id);

  return {
    sourceId: source.id,
    targetId: target.id,
    movedChildIds,
    movedProductIds,
    deletedCategory
  };
}

function hasChanges(changes: ProductChanges) {
  return Object.keys(changes).length > 0;
}

export async function mergeProductIntoTarget(changes: ProductMergeChanges) {
  const [source, target] = await Promise.all([getProduct(changes.sourceId), getProduct(changes.targetId)]);
  const duplicateSignals = getProductDuplicateSignals(source, target);
  const mode = changes.mode ?? "duplicate";

  if (duplicateSignals.length === 0) {
    throw new Error("Products no longer look like duplicates. Review them again before merging.");
  }

  if (mode === "variation") {
    const parentChanges = changes.parentChanges ?? changes.targetChanges;
    const updatedTarget = hasChanges(parentChanges) ? await updateProduct(target.id, parentChanges) : target;
    const updatedSource = hasChanges(changes.sourceChanges)
      ? await updateProduct(source.id, changes.sourceChanges)
      : source;
    const targetVariation = changes.targetVariation
      ? await createProductVariation(target.id, changes.targetVariation)
      : undefined;
    const sourceVariation = changes.sourceVariation
      ? await createProductVariation(target.id, changes.sourceVariation)
      : undefined;

    return {
      mode,
      sourceId: source.id,
      targetId: target.id,
      matchReasons: duplicateSignals,
      parentChanges,
      sourceChanges: changes.sourceChanges,
      updatedTarget,
      updatedSource,
      targetVariation,
      sourceVariation
    };
  }

  const updatedTarget = hasChanges(changes.targetChanges)
    ? await updateProduct(target.id, changes.targetChanges)
    : target;
  const updatedSource = hasChanges(changes.sourceChanges)
    ? await updateProduct(source.id, changes.sourceChanges)
    : source;

  return {
    sourceId: source.id,
    targetId: target.id,
    matchReasons: duplicateSignals,
    targetChanges: changes.targetChanges,
    sourceChanges: changes.sourceChanges,
    updatedTarget,
    updatedSource
  };
}
