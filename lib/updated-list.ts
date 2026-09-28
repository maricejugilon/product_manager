import "server-only";

import { unstable_cache } from "next/cache";

import { getUpdatedListRows } from "@/lib/product-sheet";
import {
  rowAccessories,
  sheetAccessoriesExpected,
  sheetColourBoardExpected,
  sheetCustomNotesExpected,
  sheetFeatureValue,
  sheetSpecificationsExpected
} from "@/lib/product-sheet-create";
import type { WooProduct } from "@/lib/types";
import { getProducts, productHasCustomNotes } from "@/lib/woocommerce";

export const updatedListCacheTag = "updated-list-data";

export type UpdatedListRow = {
  rowNumber: number;
  sheetRowNumber: number;
  name: string;
  sourceName: string;
  normalizedName: string;
  sku: string;
  wooId?: number;
  wooPermalink?: string;
  wooMatch: boolean;
  wooStatus: string;
  ambiguousMatch: boolean;
  customNotesExpected: boolean;
  colourBoardExpected: boolean;
  accessoriesExpected: boolean;
  accessoriesExpectedCount: number;
  specificationsExpected: boolean;
  specificationsFeature: string;
  customNotesPresent: boolean;
  colourBoardPresent: boolean;
  accessoriesPresent: boolean;
  accessoriesPresentCount: number;
  specificationsPresent: boolean;
};

export type UpdatedListData = {
  updatedAt: string;
  rows: UpdatedListRow[];
};

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return named[entity.toLowerCase()] ?? match;
  });
}

export function normalizeUpdatedListProductName(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeUpdatedListSku(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function updatedListRowIsMissing(
  row: Pick<UpdatedListRow, "wooMatch">
) {
  return !row.wooMatch;
}

export function updatedListRowIsDraft(
  row: Pick<UpdatedListRow, "wooMatch" | "ambiguousMatch" | "wooStatus">
) {
  return row.wooMatch && !row.ambiguousMatch && row.wooStatus === "draft";
}

export function updatedListRowNeedsUpdate(row: UpdatedListRow) {
  return (
    row.wooMatch &&
    !row.ambiguousMatch &&
    ((row.customNotesExpected && !row.customNotesPresent) ||
      (row.colourBoardExpected && !row.colourBoardPresent) ||
      (row.accessoriesExpected && !row.accessoriesPresent))
  );
}

export function updatedListRowNeedsSpecifications(
  row: Pick<
    UpdatedListRow,
    "wooMatch" | "ambiguousMatch" | "specificationsExpected" | "specificationsPresent"
  >
) {
  return (
    row.wooMatch &&
    !row.ambiguousMatch &&
    row.specificationsExpected &&
    !row.specificationsPresent
  );
}

function productMetaValue(product: Pick<WooProduct, "meta_data"> | undefined, key: string) {
  return product?.meta_data?.find((item) => item.key === key)?.value;
}

function validObjectArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [];
  } catch {
    return [];
  }
}

function hasColourBoardInWoo(product: Pick<WooProduct, "meta_data"> | undefined) {
  const count = Number(productMetaValue(product, "personalization_0_image_items") ?? 0);

  if (!Number.isFinite(count) || count < 1) {
    return false;
  }

  return Boolean(product?.meta_data?.some((item) =>
    /^personalization_0_image_items_\d+_name$/.test(item.key) &&
    String(item.value ?? "").trim()
  ));
}

function hasAccessoriesInWoo(
  product: Pick<WooProduct, "cross_sell_ids" | "meta_data"> | undefined
) {
  return (product?.cross_sell_ids?.length ?? 0) > 0;
}

function accessoryCountInWoo(
  product: Pick<WooProduct, "cross_sell_ids"> | undefined
) {
  return new Set(product?.cross_sell_ids ?? []).size;
}

function hasSpecificationsInWoo(product: Pick<WooProduct, "meta_data"> | undefined) {
  const groups = validObjectArray(productMetaValue(product, "technical_specifications"));
  const hasJsonSpecifications = groups.some((group) =>
    validObjectArray(group.specifications).some((specification) =>
      Boolean(String(specification.name ?? specification.value ?? "").trim())
    )
  );

  if (hasJsonSpecifications) {
    return true;
  }

  const featureCount = Number(productMetaValue(product, "_fcw_features_specification_count") ?? 0);
  if (Number.isFinite(featureCount) && featureCount > 0) {
    return true;
  }

  return Boolean(product?.meta_data?.some((item) =>
    /^groups_\d+_specifications_\d+_(?:name|value)$/.test(item.key) &&
    String(item.value ?? "").trim()
  ));
}

function addToIndex(index: Map<string, WooProduct[]>, key: string, product: WooProduct) {
  if (!key) {
    return;
  }

  const matches = index.get(key) ?? [];
  matches.push(product);
  index.set(key, matches);
}

function preferredProduct(products: WooProduct[]) {
  const statusPriority: Record<string, number> = {
    publish: 0,
    private: 1,
    pending: 2,
    draft: 3
  };

  return [...products].sort(
    (first, second) =>
      (statusPriority[first.status] ?? 9) - (statusPriority[second.status] ?? 9) ||
      second.id - first.id
  )[0];
}

async function getIdentityProducts() {
  const query = {
    perPage: 100,
    status: "any",
    orderby: "id" as const,
    order: "asc" as const,
    fields: "id,name,sku,status,permalink"
  };
  const firstPage = await getProducts({ ...query, page: 1 });
  const totalPages = firstPage.totalPages ?? 1;
  const products = [...firstPage.data];
  // The Woo client still staggers request starts; this only avoids waiting at small batch boundaries.
  const concurrency = 20;

  for (let page = 2; page <= totalPages; page += concurrency) {
    const pageNumbers = Array.from(
      { length: Math.min(concurrency, totalPages - page + 1) },
      (_, index) => page + index
    );
    const results = await Promise.all(
      pageNumbers.map((pageNumber) => getProducts({ ...query, page: pageNumber }))
    );

    products.push(...results.flatMap((result) => result.data));
  }

  return [...new Map(products.map((product) => [product.id, product])).values()];
}

async function getFeatureProducts(productIds: number[]) {
  const batches = Array.from(
    { length: Math.ceil(productIds.length / 100) },
    (_, index) => productIds.slice(index * 100, index * 100 + 100)
  );
  const results = await Promise.all(
    batches.map((ids) =>
      getProducts({
        include: ids.join(","),
        perPage: 100,
        status: "any",
        fields: "id,meta_data,cross_sell_ids"
      })
    )
  );
  const products = results.flatMap((result) => result.data);

  return new Map(products.map((product) => [product.id, product]));
}

async function loadUpdatedListData(): Promise<UpdatedListData> {
  const [sheetRows, wooProducts] = await Promise.all([
    getUpdatedListRows(),
    getIdentityProducts()
  ]);
  const productByName = new Map<string, WooProduct[]>();
  const productBySku = new Map<string, WooProduct[]>();

  for (const product of wooProducts) {
    addToIndex(productByName, normalizeUpdatedListProductName(product.name || ""), product);
    addToIndex(productBySku, normalizeUpdatedListSku(product.sku || ""), product);
  }

  const unresolvedSkus = [
    ...new Map(
      sheetRows
        .map((row) => ({
          sku: row.sku?.trim() ?? "",
          normalizedSku: normalizeUpdatedListSku(row.sku || ""),
          normalizedName: normalizeUpdatedListProductName(row.name || "")
        }))
        .filter(
          (row) =>
            row.normalizedSku &&
            !(productBySku.get(row.normalizedSku)?.length) &&
            !(productByName.get(row.normalizedName)?.length)
        )
        .map((row) => [row.normalizedSku, row])
    ).values()
  ];
  const skuLookupConcurrency = 10;

  for (let index = 0; index < unresolvedSkus.length; index += skuLookupConcurrency) {
    const batch = unresolvedSkus.slice(index, index + skuLookupConcurrency);
    const results = await Promise.all(
      batch.map((row) =>
        getProducts({
          sku: row.sku,
          perPage: 10,
          status: "any",
          fields: "id,name,sku,status,permalink"
        })
      )
    );

    results.flatMap((result) => result.data).forEach((product) => {
      addToIndex(productByName, normalizeUpdatedListProductName(product.name || ""), product);
      addToIndex(productBySku, normalizeUpdatedListSku(product.sku || ""), product);
    });
  }

  const preliminaryRows = sheetRows
    .map((sheetRow) => {
      const name = sheetRow.name?.trim() ?? "";
      const normalizedName = normalizeUpdatedListProductName(name);
      const normalizedSku = normalizeUpdatedListSku(sheetRow.sku || "");
      const skuMatches = normalizedSku ? productBySku.get(normalizedSku) ?? [] : [];
      const nameMatches = normalizedName ? productByName.get(normalizedName) ?? [] : [];
      const matches = skuMatches.length > 0 ? skuMatches : nameMatches;
      const wooProduct = preferredProduct(matches);
      const accessoryNames = rowAccessories(sheetRow)
        .map((accessory) => normalizeUpdatedListProductName(String(accessory.name ?? "")))
        .filter(Boolean);

      return {
        rowNumber: sheetRow.rowNumber,
        sheetRowNumber: sheetRow.rowNumber,
        name,
        sourceName: name,
        normalizedName,
        sku: sheetRow.sku?.trim() || wooProduct?.sku || "",
        wooProduct,
        wooMatch: Boolean(wooProduct),
        wooStatus: wooProduct?.status ?? "missing",
        ambiguousMatch: matches.length > 1,
        customNotesExpected: sheetCustomNotesExpected(sheetRow),
        colourBoardExpected: sheetColourBoardExpected(sheetRow),
        accessoriesExpected: sheetAccessoriesExpected(sheetRow),
        accessoriesExpectedCount: new Set(accessoryNames).size,
        specificationsExpected: sheetSpecificationsExpected(sheetRow),
        specificationsFeature: sheetFeatureValue(sheetRow)
      };
    })
    .filter((row) => row.name);
  const featureProductIds = [
    ...new Set(
      preliminaryRows
        .filter(
          (row) =>
            row.wooProduct &&
            !row.ambiguousMatch &&
            (row.customNotesExpected ||
              row.colourBoardExpected ||
              row.accessoriesExpected ||
              row.specificationsExpected)
        )
        .map((row) => row.wooProduct!.id)
    )
  ];
  const featureProducts = await getFeatureProducts(featureProductIds);
  const rows: UpdatedListRow[] = preliminaryRows.map((row) => {
    const featureProduct = row.wooProduct ? featureProducts.get(row.wooProduct.id) : undefined;
    const accessoriesPresentCount = accessoryCountInWoo(featureProduct);
    const accessoriesPresent = row.accessoriesExpectedCount > 0
      ? accessoriesPresentCount >= row.accessoriesExpectedCount
      : hasAccessoriesInWoo(featureProduct);

    return {
      rowNumber: row.rowNumber,
      sheetRowNumber: row.sheetRowNumber,
      name: row.name,
      sourceName: row.sourceName,
      normalizedName: row.normalizedName,
      sku: row.sku,
      wooId: row.wooProduct?.id,
      wooPermalink: row.wooProduct?.permalink,
      wooMatch: row.wooMatch,
      wooStatus: row.wooStatus,
      ambiguousMatch: row.ambiguousMatch,
      customNotesExpected: row.customNotesExpected,
      colourBoardExpected: row.colourBoardExpected,
      accessoriesExpected: row.accessoriesExpected,
      accessoriesExpectedCount: row.accessoriesExpectedCount,
      specificationsExpected: row.specificationsExpected,
      specificationsFeature: row.specificationsFeature,
      customNotesPresent: productHasCustomNotes(featureProduct ?? {}),
      colourBoardPresent: hasColourBoardInWoo(featureProduct),
      accessoriesPresent,
      accessoriesPresentCount,
      specificationsPresent: hasSpecificationsInWoo(featureProduct)
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    rows
  };
}

const getCachedUpdatedListData = unstable_cache(
  loadUpdatedListData,
  ["updated-list-data-v21"],
  { revalidate: 300, tags: [updatedListCacheTag] }
);

export async function getUpdatedListData() {
  return getCachedUpdatedListData();
}
