import "server-only";

import { isCategoryAncestor, normalizeCategoryName } from "@/lib/category-utils";
import { friendlyNetworkError, networkErrorKind } from "@/lib/network-errors";
import { getProductDuplicateSignals } from "@/lib/product-duplicates";
import type {
  CategoryChanges,
  CategoryMergeChanges,
  ProductMergeChanges,
  ProductChanges,
  WooAttributeTerm,
  WooCategory,
  WooGlobalAttribute,
  WooProduct,
  WooStoreCurrency,
  WooStoreTaxSettings,
  WooTaxRate,
  WooProductVariation
} from "@/lib/types";

type QueryValue = string | number | boolean | undefined | null;

type GetProductsParams = {
  page?: number;
  perPage?: number;
  orderby?: "date" | "id" | "include" | "title" | "slug" | "modified";
  order?: "asc" | "desc";
  search?: string;
  sku?: string;
  category?: string;
  stockStatus?: string;
  status?: string;
  fields?: string;
  include?: string;
  dimensions?: string;
};

const requestDelayMs = Number(process.env.WOOCOMMERCE_REQUEST_DELAY_MS ?? (process.env.VERCEL ? 500 : 150));
const configuredRequestTimeoutMs = Number(process.env.WOOCOMMERCE_REQUEST_TIMEOUT_MS ?? 30000);
const requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs >= 1000
  ? configuredRequestTimeoutMs
  : 30000;
let nextRequestAt = 0;
const customNotesCacheTtlMs = 5 * 60 * 1000;
const customNotesProductCache = new Map<string, { expiresAt: number; products: WooProduct[] }>();
const attributeTermCache = new Map<number, { expiresAt: number; terms: WooAttributeTerm[] }>();
let taxRateCache: { expiresAt: number; rates: WooTaxRate[] } | undefined;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRequestSlot() {
  if (requestDelayMs <= 0) {
    return;
  }

  const now = Date.now();
  const waitMs = Math.max(0, nextRequestAt - now);
  nextRequestAt = Math.max(now, nextRequestAt) + requestDelayMs;

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

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

function buildStoreApiUrl(path: string, query?: Record<string, QueryValue>) {
  const { storeUrl } = getConfig();
  const url = new URL(`/wp-json/wc/store/v1${path}`, storeUrl);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

function fallbackCurrency(): WooStoreCurrency {
  const configuredCode = process.env.WOOCOMMERCE_CURRENCY?.trim().toUpperCase();
  const code = configuredCode && /^[A-Z]{3}$/.test(configuredCode) ? configuredCode : "GBP";
  let symbol = code;

  try {
    symbol = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol"
    }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  } catch {
    // The ISO code remains a safe display fallback.
  }

  return {
    code,
    symbol,
    minorUnit: 2,
    decimalSeparator: ".",
    thousandSeparator: ",",
    prefix: symbol,
    suffix: ""
  };
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
  const maxAttempts = options.method && options.method !== "GET" ? 3 : 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForRequestSlot();

    let response: Response;

    try {
      response = await fetch(buildUrl(path, options.query), {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(requestTimeoutMs)
      });
    } catch (error) {
      const readOnlyRequest = !options.method || options.method === "GET";

      if (process.env.WOOCOMMERCE_DEBUG_NETWORK_ERRORS === "1") {
        console.warn("WooCommerce connection retry", {
          attempt,
          code: networkErrorKind(error),
          path
        });
      }

      if (readOnlyRequest && attempt < maxAttempts) {
        await sleep(Math.min(5000, 500 * 2 ** (attempt - 1)));
        continue;
      }

      throw friendlyNetworkError(error, "WooCommerce");
    }

    if (response.ok) {
      return {
        data: (await response.json()) as T,
        total: Number(response.headers.get("x-wp-total") ?? undefined) || undefined,
        totalPages: Number(response.headers.get("x-wp-totalpages") ?? undefined) || undefined
      };
    }

    const body = await response.text();
    const retryAfter = Number(response.headers.get("retry-after"));
    const shouldRetry = response.status === 429 || response.status >= 500;

    if (shouldRetry && attempt < maxAttempts) {
      const backoffMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(10000, 750 * 2 ** (attempt - 1));

      await sleep(backoffMs);
      continue;
    }

    if (response.status === 429) {
      throw new Error("WooCommerce is rate limiting requests. Please wait a minute, then refresh the validator.");
    }

    throw new Error(`WooCommerce ${response.status}: ${body || response.statusText}`);
  }

  throw new Error("WooCommerce request failed.");
}

export async function getProducts(params: GetProductsParams) {
  return wcFetch<WooProduct[]>("/products", {
    query: {
      per_page: params.perPage ?? 100,
      page: params.page ?? 1,
      orderby: params.orderby ?? "modified",
      order: params.order ?? "desc",
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

export async function getStoreCurrency(): Promise<WooStoreCurrency> {
  try {
    const response = await fetch(buildStoreApiUrl("/products", {
      per_page: 1,
      _fields: "prices"
    }), {
      cache: "no-store",
      signal: AbortSignal.timeout(requestTimeoutMs)
    });

    if (!response.ok) {
      return fallbackCurrency();
    }

    const products = await response.json() as Array<{
      prices?: {
        currency_code?: string;
        currency_symbol?: string;
        currency_minor_unit?: number;
        currency_decimal_separator?: string;
        currency_thousand_separator?: string;
        currency_prefix?: string;
        currency_suffix?: string;
      };
    }>;
    const prices = products[0]?.prices;
    const code = prices?.currency_code?.trim().toUpperCase() ?? "";

    if (!/^[A-Z]{3}$/.test(code)) {
      return fallbackCurrency();
    }

    return {
      code,
      symbol: prices?.currency_symbol || code,
      minorUnit: Number.isInteger(prices?.currency_minor_unit)
        ? Number(prices?.currency_minor_unit)
        : 2,
      decimalSeparator: prices?.currency_decimal_separator || ".",
      thousandSeparator: prices?.currency_thousand_separator || ",",
      prefix: prices?.currency_prefix ?? prices?.currency_symbol ?? "",
      suffix: prices?.currency_suffix ?? ""
    };
  } catch {
    return fallbackCurrency();
  }
}

export async function getStoreTaxSettings(): Promise<WooStoreTaxSettings> {
  const fallback: WooStoreTaxSettings = {
    pricesIncludeTax: process.env.WOOCOMMERCE_PRICES_INCLUDE_TAX === "yes",
    displayShop: process.env.WOOCOMMERCE_TAX_DISPLAY_SHOP === "incl" ? "incl" : "excl",
    displayCart: process.env.WOOCOMMERCE_TAX_DISPLAY_CART === "incl" ? "incl" : "excl"
  };

  try {
    const { data } = await wcFetch<Array<{ id?: string; value?: unknown }>>("/settings/tax");
    const value = (id: string) => String(data.find((item) => item.id === id)?.value ?? "");

    return {
      pricesIncludeTax: value("woocommerce_prices_include_tax") === "yes",
      displayShop: value("woocommerce_tax_display_shop") === "incl" ? "incl" : "excl",
      displayCart: value("woocommerce_tax_display_cart") === "incl" ? "incl" : "excl"
    };
  } catch {
    return fallback;
  }
}

export async function getTaxRates() {
  if (taxRateCache && taxRateCache.expiresAt > Date.now()) {
    return taxRateCache.rates;
  }

  const { data } = await wcFetch<WooTaxRate[]>("/taxes", {
    query: { per_page: 100 }
  });
  taxRateCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    rates: data
  };

  return data;
}

export async function getProductAttributes() {
  const { data } = await wcFetch<WooGlobalAttribute[]>("/products/attributes", {
    query: {
      per_page: 100
    }
  });

  return data;
}

export async function getProductAttributeTerms(attributeId: number) {
  const cached = attributeTermCache.get(attributeId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.terms;
  }

  const terms: WooAttributeTerm[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await wcFetch<WooAttributeTerm[]>(
      `/products/attributes/${attributeId}/terms`,
      {
        query: {
          per_page: 100,
          page
        }
      }
    );

    terms.push(...result.data);
    totalPages = result.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);

  const uniqueTerms = [...new Map(terms.map((term) => [term.id, term])).values()];
  attributeTermCache.set(attributeId, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    terms: uniqueTerms
  });

  return uniqueTerms;
}

export async function ensureProductAttributeTerms(attributeId: number, names: string[]) {
  const terms = await getProductAttributeTerms(attributeId);
  const knownNames = new Set(terms.map((term) => term.name.trim().toLowerCase()));
  const uniqueNames = [...new Map(
    names
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name])
  ).values()];

  for (const name of uniqueNames) {
    if (knownNames.has(name.toLowerCase())) {
      continue;
    }

    const { data } = await wcFetch<WooAttributeTerm>(
      `/products/attributes/${attributeId}/terms`,
      {
        method: "POST",
        body: { name }
      }
    );

    terms.push(data);
    knownNames.add(name.toLowerCase());
  }

  attributeTermCache.set(attributeId, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    terms
  });
}

export function productHasCustomNotes(product: { meta_data?: Array<{ key: string; value: unknown }> }) {
  const value = product.meta_data?.find((item) => item.key === "custom_notes")?.value;

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  return normalized === "1" || normalized === "yes" || normalized === "true" || normalized === "on";
}

export function productHasDimensions(product: Pick<WooProduct, "dimensions">) {
  return ["length", "width", "height"].every((field) => {
    const value = product.dimensions?.[field as keyof NonNullable<WooProduct["dimensions"]>];

    return Boolean(value?.trim());
  });
}

function customNotesCacheKey(params: GetProductsParams) {
  return JSON.stringify({
    search: params.search ?? "",
    sku: params.sku ?? "",
    category: params.category ?? "",
    stockStatus: params.stockStatus ?? "",
    status: params.status ?? "any",
    fields: params.fields ?? "",
    include: params.include ?? ""
  });
}

async function getCustomNotesFilterProducts(params: GetProductsParams) {
  const cacheKey = customNotesCacheKey(params);
  const cached = customNotesProductCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.products;
  }

  const products: WooProduct[] = [];
  let currentPage = 1;
  let totalPages = 1;

  do {
    const result = await getProducts({
      ...params,
      page: currentPage,
      perPage: 100
    });

    products.push(...result.data);
    totalPages = result.totalPages ?? 1;
    currentPage += 1;
  } while (currentPage <= totalPages);

  const uniqueProducts = [...new Map(products.map((product) => [product.id, product])).values()];

  customNotesProductCache.set(cacheKey, {
    expiresAt: Date.now() + customNotesCacheTtlMs,
    products: uniqueProducts
  });

  return uniqueProducts;
}

export async function getProductsByCustomNotes(
  params: GetProductsParams & { customNotes?: string; dimensions?: string }
) {
  const hasCustomNotesFilter = params.customNotes === "yes" || params.customNotes === "no";
  const hasDimensionsFilter = params.dimensions === "missing" || params.dimensions === "complete";

  if (!hasCustomNotesFilter && !hasDimensionsFilter) {
    return getProducts(params);
  }

  const page = params.page ?? 1;
  const perPage = params.perPage ?? 100;
  const products = await getCustomNotesFilterProducts(params);
  const filtered = products.filter((product) => {
    if (
      hasCustomNotesFilter &&
      productHasCustomNotes(product) !== (params.customNotes === "yes")
    ) {
      return false;
    }

    if (
      hasDimensionsFilter &&
      productHasDimensions(product) !== (params.dimensions === "complete")
    ) {
      return false;
    }

    return true;
  });
  const start = (page - 1) * perPage;
  const total = filtered.length;

  return {
    data: filtered.slice(start, start + perPage),
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage))
  };
}

export async function updateProduct(id: number, changes: ProductChanges) {
  const { data } = await wcFetch<WooProduct>(`/products/${id}`, {
    method: "PUT",
    body: changes
  });

  customNotesProductCache.clear();

  return data;
}

export async function createProduct(changes: ProductChanges) {
  const { data } = await wcFetch<WooProduct>("/products", {
    method: "POST",
    body: changes
  });

  customNotesProductCache.clear();

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
  const pages = [firstPage];

  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(
      await wcFetch<WooCategory[]>("/products/categories", {
        query: {
          ...query,
          page
        }
      })
    );
  }

  const categories = pages.flatMap((result) => result.data);

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
  const pages = [firstPage];

  for (let page = 2; page <= totalPages; page += 1) {
    pages.push(
      await getProducts({
        ...query,
        page
      })
    );
  }

  const products = pages.flatMap((result) => result.data);

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
