import "server-only";

import { getUpdatedListRows } from "@/lib/product-sheet";
import {
  productSheetQaCheckNeedsFix,
  productSheetQaChecks,
  resolveProductSheetQaCheck,
  type ProductSheetQaCheck
} from "@/lib/product-sheet-qa";
import {
  rowAccessories,
  sheetProductPrice,
  sheetAccessoriesExpected,
  sheetColourBoardExpected,
  sheetCustomNotesExpected,
  sheetFeatureValue,
  sheetSpecificationsExpected
} from "@/lib/product-sheet-create";
import type { WooProduct, WooStoreCurrency, WooStoreTaxSettings } from "@/lib/types";
import { readUpdatedListDataCache, writeUpdatedListDataCache } from "@/lib/updated-list-check-store";
import { getProducts, getStoreCurrency, getStoreTaxSettings, productHasCustomNotes } from "@/lib/woocommerce";

let updatedListLoadPromise: Promise<UpdatedListData> | undefined;
let updatedListRefreshPromise: Promise<UpdatedListData> | undefined;

export type UpdatedListSheetDuplicateMatch = {
  rowNumber: number;
  name: string;
  sku: string;
  matchedBy: Array<"sku" | "name">;
};

export type UpdatedListRow = {
  rowNumber: number;
  sheetRowNumber: number;
  name: string;
  sourceName: string;
  normalizedName: string;
  sku: string;
  sheetSku: string;
  wooId?: number;
  wooPermalink?: string;
  sourceProductUrl: string;
  wooMatch: boolean;
  wooStatus: string;
  ambiguousMatch: boolean;
  wooMatches?: Array<{
    id: number;
    name: string;
    sku: string;
    status: string;
    permalink?: string;
  }>;
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
  sheetPrice: string;
  wooRegularPrice: string;
  wooSalePrice: string;
  wooLivePrice: string;
  wooTaxStatus: string;
  wooTaxClass: string;
  wooStockStatus: WooProduct["stock_status"] | "";
  wooBackorders: NonNullable<WooProduct["backorders"]> | "";
  wooManageStock: boolean;
  wooStockQuantity: number | null;
  wooSavedPriceIncVat: string;
  wooSavedPriceExVat: string;
  wooSavedVatAmount: string;
  wooSavedVatRate: string;
  wooSavedPriceCurrency: string;
  wooSavedVatTaxClass: string;
  wooSavedVatRateName: string;
  wooDateModified: string;
  priceLastSyncedAt: string;
  stockLastSyncedAt: string;
  priceMatches: boolean;
  qaCustomNotes: ProductSheetQaCheck;
  qaAccessories: ProductSheetQaCheck;
  qaColour: ProductSheetQaCheck;
  sheetDuplicateMatches: UpdatedListSheetDuplicateMatch[];
};

export type UpdatedListData = {
  updatedAt: string;
  currency: WooStoreCurrency;
  tax: WooStoreTaxSettings;
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

export function updatedListRowNeedsPriceUpdate(
  row: Pick<UpdatedListRow, "wooMatch" | "ambiguousMatch" | "sheetPrice" | "priceMatches">
) {
  return row.wooMatch && !row.ambiguousMatch && Boolean(row.sheetPrice) && !row.priceMatches;
}

export function updatedListRowNeedsQa(
  row: Pick<UpdatedListRow, "qaCustomNotes" | "qaAccessories" | "qaColour">
) {
  return productSheetQaCheckNeedsFix(row.qaCustomNotes) ||
    productSheetQaCheckNeedsFix(row.qaAccessories) ||
    productSheetQaCheckNeedsFix(row.qaColour);
}

export function updatedListRowHasQaReport(
  row: Pick<UpdatedListRow, "qaCustomNotes" | "qaAccessories" | "qaColour">
) {
  return row.qaCustomNotes.failed || row.qaAccessories.failed || row.qaColour.failed;
}

export function updatedListRowHasSheetDuplicate(
  row: Pick<UpdatedListRow, "sheetDuplicateMatches">
) {
  return (row.sheetDuplicateMatches?.length ?? 0) > 0;
}

export function updatedListRowCanCheckPrice(
  row: Pick<UpdatedListRow, "wooMatch" | "ambiguousMatch" | "sourceProductUrl">
) {
  return row.wooMatch && !row.ambiguousMatch && Boolean(row.sourceProductUrl);
}

function normalizedPrice(value: string | undefined) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) ? parsed.toFixed(2) : "";
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

function primitiveArray(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
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

function colourBoardValuesInWoo(product: Pick<WooProduct, "meta_data"> | undefined) {
  const count = Number(productMetaValue(product, "personalization_0_image_items") ?? 0);
  const safeCount = Number.isFinite(count) && count > 0 ? count : 0;
  const names = Array.from({ length: safeCount }, (_, index) =>
    String(productMetaValue(product, `personalization_0_image_items_${index}_name`) ?? "").trim()
  ).filter(Boolean);

  return { count: safeCount, names };
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

function accessoryNamesInWoo(
  product: Pick<WooProduct, "cross_sell_ids" | "meta_data"> | undefined,
  productNameById: Map<number, string>
) {
  const linkedIds = [...new Set(product?.cross_sell_ids ?? [])];
  const linked = linkedIds
    .map((id) => productNameById.get(id)?.trim() ?? "")
    .filter(Boolean);

  if (linked.length === linkedIds.length) {
    return linked;
  }

  const raw = validObjectArray(productMetaValue(product, "product_accessories"))
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean);
  const trackedValue = productMetaValue(product, "_fcw_accessory_cross_sell_names");
  let tracked: string[] = [];

  if (Array.isArray(trackedValue)) {
    tracked = trackedValue.map(String).map((item) => item.trim()).filter(Boolean);
  } else if (typeof trackedValue === "string" && trackedValue.trim()) {
    try {
      const parsed = JSON.parse(trackedValue);
      if (Array.isArray(parsed)) tracked = parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      tracked = [];
    }
  }

  return [...new Set([...linked, ...raw, ...tracked])];
}

function accessoryLinksWereVerified(
  product: Pick<WooProduct, "cross_sell_ids" | "meta_data"> | undefined
) {
  const currentIds = [...new Set(product?.cross_sell_ids ?? [])]
    .map(Number)
    .filter(Number.isFinite)
    .sort((first, second) => first - second);
  const trackedIds = primitiveArray(productMetaValue(product, "_fcw_accessory_cross_sell_ids"))
    .map(Number)
    .filter(Number.isFinite)
    .sort((first, second) => first - second);
  const missingNames = primitiveArray(
    productMetaValue(product, "_fcw_accessory_cross_sell_missing_names")
  ).map(String).filter((name) => name.trim());

  return currentIds.length > 0 &&
    currentIds.length === trackedIds.length &&
    currentIds.every((id, index) => id === trackedIds[index]) &&
    missingNames.length === 0;
}

function resolveDuplicateQaRows(rows: UpdatedListRow[]) {
  const rowsByProduct = new Map<string, UpdatedListRow[]>();

  for (const row of rows) {
    if (!row.wooId) continue;
    const key = `${row.wooId}|${row.normalizedName}`;
    rowsByProduct.set(key, [...(rowsByProduct.get(key) ?? []), row]);
  }

  for (const duplicates of rowsByProduct.values()) {
    if (duplicates.length < 2) continue;

    for (const field of ["qaCustomNotes", "qaAccessories", "qaColour"] as const) {
      const hasResolvedReport = duplicates.some((row) => row[field].failed && row[field].resolved);

      if (!hasResolvedReport) continue;

      for (const row of duplicates) {
        const check = row[field];
        if (!check.failed || check.resolved) continue;
        row[field] = {
          ...check,
          resolved: true,
          reason: "Another Product list row for this WooCommerce product already matches the current value."
        };
      }
    }
  }

  return rows;
}

function resolveSheetDuplicateRows(rows: UpdatedListRow[]) {
  const rowsByName = new Map<string, UpdatedListRow[]>();
  const rowsBySku = new Map<string, UpdatedListRow[]>();

  for (const row of rows) {
    if (row.normalizedName) {
      rowsByName.set(row.normalizedName, [...(rowsByName.get(row.normalizedName) ?? []), row]);
    }

    const normalizedSku = normalizeUpdatedListSku(row.sheetSku ?? row.sku);
    if (normalizedSku) {
      rowsBySku.set(normalizedSku, [...(rowsBySku.get(normalizedSku) ?? []), row]);
    }
  }

  return rows.map((row) => {
    const matches = new Map<number, UpdatedListSheetDuplicateMatch>();

    function addMatches(candidates: UpdatedListRow[], matchedBy: "sku" | "name") {
      for (const candidate of candidates) {
        if (candidate.sheetRowNumber === row.sheetRowNumber) continue;
        const existing = matches.get(candidate.sheetRowNumber);
        matches.set(candidate.sheetRowNumber, {
          rowNumber: candidate.sheetRowNumber,
          name: candidate.name,
          sku: candidate.sheetSku ?? candidate.sku,
          matchedBy: existing
            ? [...new Set([...existing.matchedBy, matchedBy])]
            : [matchedBy]
        });
      }
    }

    const normalizedSku = normalizeUpdatedListSku(row.sheetSku ?? row.sku);
    if (normalizedSku) addMatches(rowsBySku.get(normalizedSku) ?? [], "sku");
    if (row.normalizedName) addMatches(rowsByName.get(row.normalizedName) ?? [], "name");

    return {
      ...row,
      sheetDuplicateMatches: [...matches.values()].sort((first, second) => first.rowNumber - second.rowNumber)
    };
  });
}

function resolveUpdatedListRows(rows: UpdatedListRow[]) {
  return resolveSheetDuplicateRows(resolveDuplicateQaRows(rows));
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

function relevantProductMatches(products: WooProduct[]) {
  const active = products.filter((product) => product.status !== "draft" && product.status !== "trash");
  return active.length > 0 ? active : products;
}

async function getIdentityProducts() {
  const query = {
    perPage: 100,
    status: "any",
    orderby: "id" as const,
    order: "asc" as const,
    fields: "id,name,sku,status,permalink,regular_price,sale_price,price,tax_status,tax_class,stock_status,backorders,manage_stock,stock_quantity,date_modified"
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
  const [sheetRows, wooProducts, currency, tax] = await Promise.all([
    getUpdatedListRows(),
    getIdentityProducts(),
    getStoreCurrency(),
    getStoreTaxSettings()
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
          fields: "id,name,sku,status,permalink,regular_price,sale_price,price,tax_status,tax_class,stock_status,backorders,manage_stock,stock_quantity,date_modified"
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
      const allMatches = [...new Map(
        (skuMatches.length > 0 ? skuMatches : nameMatches).map((product) => [product.id, product])
      ).values()];
      const matches = relevantProductMatches(allMatches);
      const wooProduct = preferredProduct(matches);
      const accessoryNames = rowAccessories(sheetRow)
        .map((accessory) => normalizeUpdatedListProductName(String(accessory.name ?? "")))
        .filter(Boolean);
      const sheetPrice = sheetProductPrice(sheetRow);
      const wooRegularPrice = normalizedPrice(wooProduct?.regular_price);
      const wooSalePrice = normalizedPrice(wooProduct?.sale_price);
      const wooLivePrice = normalizedPrice(wooProduct?.price);
      const priceMatches = !sheetPrice || (
        wooRegularPrice === sheetPrice &&
        !wooSalePrice &&
        wooLivePrice === sheetPrice
      );
      const qaChecks = productSheetQaChecks(sheetRow);

      return {
        rowNumber: sheetRow.rowNumber,
        sheetRowNumber: sheetRow.rowNumber,
        name,
        sourceName: name,
        sourceProductUrl: sheetRow.liveUrl,
        normalizedName,
        sheetSku: sheetRow.sku?.trim() ?? "",
        sku: sheetRow.sku?.trim() || wooProduct?.sku || "",
        wooProduct,
        wooMatch: Boolean(wooProduct),
        wooStatus: wooProduct?.status ?? "missing",
        ambiguousMatch: matches.length > 1,
        wooMatches: matches.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          status: product.status,
          permalink: product.permalink
        })),
        customNotesExpected: sheetCustomNotesExpected(sheetRow),
        colourBoardExpected: sheetColourBoardExpected(sheetRow),
        accessoriesExpected: sheetAccessoriesExpected(sheetRow),
        accessoriesExpectedCount: new Set(accessoryNames).size,
        specificationsExpected: sheetSpecificationsExpected(sheetRow),
        specificationsFeature: sheetFeatureValue(sheetRow),
        sheetPrice,
        wooRegularPrice,
        wooSalePrice,
        wooLivePrice,
        wooTaxStatus: wooProduct?.tax_status ?? "",
        wooTaxClass: wooProduct?.tax_class ?? "",
        wooStockStatus: wooProduct?.stock_status ?? ("" as const),
        wooBackorders: wooProduct?.backorders ?? ("" as const),
        wooManageStock: wooProduct?.manage_stock ?? false,
        wooStockQuantity: wooProduct?.stock_quantity ?? null,
        wooDateModified: wooProduct?.date_modified ?? "",
        priceMatches,
        qaChecks
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
              row.specificationsExpected ||
              row.qaChecks.customNotes.failed ||
              row.qaChecks.accessories.failed ||
              row.qaChecks.colour.failed ||
              row.sourceProductUrl ||
              (row.sheetPrice && !row.priceMatches))
        )
        .map((row) => row.wooProduct!.id)
    )
  ];
  const featureProducts = await getFeatureProducts(featureProductIds);
  const productNameById = new Map(
    wooProducts.map((product) => [product.id, product.name || ""])
  );
  const rows: UpdatedListRow[] = preliminaryRows.map((row) => {
    const featureProduct = row.wooProduct ? featureProducts.get(row.wooProduct.id) : undefined;
    const accessoriesPresentCount = accessoryCountInWoo(featureProduct);
    const accessoryNames = accessoryNamesInWoo(featureProduct, productNameById);
    const colourBoard = colourBoardValuesInWoo(featureProduct);
    const customNotesPresent = productHasCustomNotes(featureProduct ?? {});
    const accessoriesPresent = row.accessoriesExpectedCount > 0
      ? accessoriesPresentCount >= row.accessoriesExpectedCount
      : hasAccessoriesInWoo(featureProduct);

    let qaAccessories = resolveProductSheetQaCheck(row.qaChecks.accessories, {
      present: accessoriesPresentCount > 0,
      count: accessoriesPresentCount,
      names: accessoryNames
    });

    if (
      qaAccessories.failed &&
      !qaAccessories.resolved &&
      qaAccessories.expectedCount === accessoriesPresentCount &&
      accessoryLinksWereVerified(featureProduct)
    ) {
      qaAccessories = {
        ...qaAccessories,
        resolved: true,
        reason: `WooCommerce has ${accessoriesPresentCount} verified accessory links from the approved QA update.`
      };
    }

    return {
      rowNumber: row.rowNumber,
      sheetRowNumber: row.sheetRowNumber,
      name: row.name,
      sourceName: row.sourceName,
      normalizedName: row.normalizedName,
      sku: row.sku,
      sheetSku: row.sheetSku,
      wooId: row.wooProduct?.id,
      wooPermalink: row.wooProduct?.permalink,
      sourceProductUrl: row.sourceProductUrl,
      wooMatch: row.wooMatch,
      wooStatus: row.wooStatus,
      ambiguousMatch: row.ambiguousMatch,
      wooMatches: row.wooMatches,
      customNotesExpected: row.customNotesExpected,
      colourBoardExpected: row.colourBoardExpected,
      accessoriesExpected: row.accessoriesExpected,
      accessoriesExpectedCount: row.accessoriesExpectedCount,
      specificationsExpected: row.specificationsExpected,
      specificationsFeature: row.specificationsFeature,
      customNotesPresent,
      colourBoardPresent: hasColourBoardInWoo(featureProduct),
      accessoriesPresent,
      accessoriesPresentCount,
      specificationsPresent: hasSpecificationsInWoo(featureProduct),
      sheetPrice: row.sheetPrice,
      wooRegularPrice: row.wooRegularPrice,
      wooSalePrice: row.wooSalePrice,
      wooLivePrice: row.wooLivePrice,
      wooTaxStatus: row.wooTaxStatus,
      wooTaxClass: row.wooTaxClass,
      wooStockStatus: row.wooStockStatus,
      wooBackorders: row.wooBackorders,
      wooManageStock: row.wooManageStock,
      wooStockQuantity: row.wooStockQuantity,
      wooSavedPriceIncVat: String(productMetaValue(featureProduct, "fcw_price_inc_vat") ?? ""),
      wooSavedPriceExVat: String(productMetaValue(featureProduct, "fcw_price_ex_vat") ?? ""),
      wooSavedVatAmount: String(productMetaValue(featureProduct, "fcw_vat_amount") ?? ""),
      wooSavedVatRate: String(productMetaValue(featureProduct, "fcw_vat_rate") ?? ""),
      wooSavedPriceCurrency: String(productMetaValue(featureProduct, "fcw_price_currency") ?? ""),
      wooSavedVatTaxClass: String(productMetaValue(featureProduct, "fcw_vat_tax_class") ?? ""),
      wooSavedVatRateName: String(productMetaValue(featureProduct, "fcw_vat_rate_name") ?? ""),
      wooDateModified: row.wooDateModified,
      priceLastSyncedAt: String(productMetaValue(featureProduct, "_fcw_price_synced_at") ?? ""),
      stockLastSyncedAt: String(productMetaValue(featureProduct, "_fcw_stock_synced_at") ?? ""),
      priceMatches: row.priceMatches,
      qaCustomNotes: resolveProductSheetQaCheck(row.qaChecks.customNotes, {
        present: customNotesPresent
      }),
      qaAccessories,
      qaColour: resolveProductSheetQaCheck(row.qaChecks.colour, {
        present: colourBoard.count > 0,
        count: colourBoard.count,
        names: colourBoard.names
      }),
      sheetDuplicateMatches: []
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    currency,
    tax,
    rows: resolveUpdatedListRows(rows)
  };
}

export async function getUpdatedListData() {
  // The explicit Refresh data action owns live synchronization. Keep serving the
  // last successful shared snapshot when WooCommerce is slow or unavailable.
  const cached = await readUpdatedListDataCache<UpdatedListData>(Number.POSITIVE_INFINITY);
  if (cached) return { ...cached, rows: resolveUpdatedListRows(cached.rows) };

  if (!updatedListLoadPromise) {
    updatedListLoadPromise = loadUpdatedListData()
      .then(async (data) => {
        await writeUpdatedListDataCache(data);
        return data;
      })
      .catch(async (error) => {
        const stale = await readUpdatedListDataCache<UpdatedListData>(Number.POSITIVE_INFINITY);
        if (stale) return { ...stale, rows: resolveUpdatedListRows(stale.rows) };
        throw error;
      })
      .finally(() => {
        updatedListLoadPromise = undefined;
      });
  }

  return updatedListLoadPromise;
}

export async function refreshUpdatedListData() {
  if (!updatedListRefreshPromise) {
    updatedListRefreshPromise = loadUpdatedListData()
      .then(async (data) => {
        await writeUpdatedListDataCache(data);
        return data;
      })
      .finally(() => {
        updatedListRefreshPromise = undefined;
      });
  }

  return updatedListRefreshPromise;
}
