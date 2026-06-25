import "server-only";

import { parseCsv } from "@/lib/csv";
import { getProductSheetRows } from "@/lib/product-sheet";
import { readProductSheetValidatorCache } from "@/lib/product-sheet-validator-cache";
import type { WooGlobalAttribute, WooProduct, WooProductAttribute } from "@/lib/types";
import { getAllProducts, getProductAttributes, getProducts } from "@/lib/woocommerce";

export type MakeModelProductResult = {
  sku: string;
  baseSku: string;
  makes: string[];
  models: string[];
  sourceLinks: number;
  sourceRows: number[];
  status: "matched" | "missing_woo" | "ambiguous";
  product?: {
    id: number;
    name: string;
    sku: string;
    permalink: string;
    status: string;
    image: string;
  };
  candidates: Array<{ id: number; name: string; sku: string }>;
  wooMakes: string[];
  wooModels: string[];
  makeMatches: boolean;
  modelMatches: boolean;
  matches: boolean;
};

export type MakeModelUnresolvedLink = {
  rowNumber: number;
  make: string;
  model: string;
  url: string;
  legacyProductId: string;
};

export type MakeModelReport = {
  updatedAt: string;
  scanSource: "validator_cache" | "woocommerce";
  sheetRows: number;
  productLinks: number;
  verifiedLinks: number;
  unresolvedLinks: MakeModelUnresolvedLink[];
  attributeConfig: {
    make: WooGlobalAttribute;
    model: WooGlobalAttribute;
  };
  products: MakeModelProductResult[];
};

type CachedReport = {
  expiresAt: number;
  report: MakeModelReport;
};

type MakeModelSheetRow = {
  rowNumber: number;
  make: string;
  model: string;
  productUrls: string[];
};

const spreadsheetId = "1KbsqFWTBddlzkttsYodaO6fTQkQSccci4YESxgW_N08";
const makeModelSheetName = "Make and Model";
const reportCacheMs = 5 * 60 * 1000;
const wooFields = "id,name,sku,permalink,status,images,attributes";
const wooSkuFields = "id,sku";
let reportCache: CachedReport | null = null;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function unique(values: string[]) {
  const byNormalized = new Map<string, string>();

  for (const value of values) {
    const clean = value.trim();

    if (clean && !byNormalized.has(normalize(clean))) {
      byNormalized.set(normalize(clean), clean);
    }
  }

  return [...byNormalized.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

function sameValues(left: string[], right: string[]) {
  const normalizedLeft = unique(left).map(normalize);
  const normalizedRight = unique(right).map(normalize);

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function headerIndex(headers: string[], name: string) {
  return headers.findIndex((header) => normalize(header) === normalize(name));
}

async function fetchMakeModelRows() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", makeModelSheetName);

  const response = await fetch(url, { cache: "no-store" });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Make and Model sheet export failed: ${response.status}`);
  }

  if (/^\s*</.test(body)) {
    throw new Error("Make and Model sheet did not return CSV.");
  }

  const [headers = [], ...rows] = parseCsv(body);
  const makeIndex = headerIndex(headers, "Make");
  const modelIndex = headerIndex(headers, "Model");
  const productIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /^product \d+$/i.test(header.trim()))
    .map(({ index }) => index);

  if (makeIndex < 0 || modelIndex < 0 || productIndexes.length === 0) {
    throw new Error("Make and Model sheet requires Make, Model, and Product columns.");
  }

  return rows.map((cells, index): MakeModelSheetRow => ({
    rowNumber: index + 2,
    make: cells[makeIndex]?.trim() ?? "",
    model: cells[modelIndex]?.trim() ?? "",
    productUrls: productIndexes.map((cellIndex) => cells[cellIndex]?.trim() ?? "").filter(Boolean)
  }));
}

function legacyProductId(value: string) {
  try {
    const item = new URL(value).searchParams.get("item") ?? "";

    return item.match(/-(\d+)-(\d+)$/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function sheetBaseSku(value: string) {
  return canonicalSku(value.replace(/\s*\([^)]*\)\s*$/, ""));
}

function canonicalSku(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function wooBaseSkus(product: WooProduct) {
  const currentSku = canonicalSku(product.sku);
  const generatedBase = canonicalSku(product.sku.replace(/-\d{9,}-\d+$/, ""));

  return unique([currentSku, generatedBase]).map(canonicalSku);
}

function attributeOptions(product: WooProduct, attribute: WooGlobalAttribute) {
  return (
    product.attributes?.find(
      (item) => item.id === attribute.id || normalize(item.name ?? "") === normalize(attribute.name)
    )?.options ?? []
  );
}

function findAttribute(attributes: WooGlobalAttribute[], name: string) {
  const attribute = attributes.find((item) => normalize(item.name) === normalize(name));

  if (!attribute) {
    throw new Error(`WooCommerce global attribute "${name}" was not found.`);
  }

  return attribute;
}

function productSummary(product: WooProduct) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    permalink: product.permalink,
    status: product.status,
    image: product.images?.[0]?.src ?? ""
  };
}

export function makeModelAttributes(
  product: WooProduct,
  config: MakeModelReport["attributeConfig"],
  makes: string[],
  models: string[]
): WooProductAttribute[] {
  const retained = (product.attributes ?? []).filter(
    (attribute) =>
      attribute.id !== config.make.id &&
      attribute.id !== config.model.id &&
      normalize(attribute.name ?? "") !== normalize(config.make.name) &&
      normalize(attribute.name ?? "") !== normalize(config.model.name)
  );

  return [
    ...retained,
    {
      id: config.make.id,
      name: config.make.name,
      position: 1,
      visible: true,
      variation: false,
      options: unique(makes)
    },
    {
      id: config.model.id,
      name: config.model.name,
      position: 2,
      visible: true,
      variation: false,
      options: unique(models)
    }
  ];
}

export async function getMakeModelReport(options: { refresh?: boolean } = {}) {
  if (!options.refresh && reportCache && reportCache.expiresAt > Date.now()) {
    return reportCache.report;
  }

  const makeModelRows = await fetchMakeModelRows();
  const productRows = await getProductSheetRows();
  const productRowByLegacyId = new Map(
    productRows
      .map((row) => [legacyProductId(row.liveUrl), row] as const)
      .filter(([id, row]) => Boolean(id && row.sku))
  );
  const groupedBySku = new Map<
    string,
    { sku: string; makes: string[]; models: string[]; sourceRows: number[]; sourceLinks: number }
  >();
  const unresolvedLinks: MakeModelUnresolvedLink[] = [];
  let productLinks = 0;
  let verifiedLinks = 0;

  for (const row of makeModelRows) {
    for (const url of row.productUrls) {
      productLinks += 1;
      const productId = legacyProductId(url);
      const productRow = productRowByLegacyId.get(productId);

      if (!productRow?.sku) {
        unresolvedLinks.push({
          rowNumber: row.rowNumber,
          make: row.make,
          model: row.model,
          url,
          legacyProductId: productId
        });
        continue;
      }

      verifiedLinks += 1;
      const key = sheetBaseSku(productRow.sku);
      const grouped = groupedBySku.get(key) ?? {
        sku: productRow.sku,
        makes: [],
        models: [],
        sourceRows: [],
        sourceLinks: 0
      };

      grouped.makes.push(row.make);
      grouped.models.push(row.model);
      grouped.sourceRows.push(row.rowNumber);
      grouped.sourceLinks += 1;
      groupedBySku.set(key, grouped);
    }
  }

  const attributes = await getProductAttributes();
  const attributeConfig = {
    make: findAttribute(attributes, "Make"),
    model: findAttribute(attributes, "Model")
  };
  const validatorCache = options.refresh ? null : await readProductSheetValidatorCache();
  const cachedProducts = [
    ...new Map(
      (validatorCache?.results ?? [])
        .map((result) => result.product)
        .filter((product): product is WooProduct => Boolean(product))
        .map((product) => [product.id, product])
    ).values()
  ];
  const scanSource: MakeModelReport["scanSource"] =
    cachedProducts.length > 0 ? "validator_cache" : "woocommerce";
  const wooSkuProducts =
    cachedProducts.length > 0 ? cachedProducts : await getAllProducts({ fields: wooSkuFields });
  const wooProductIdsByBaseSku = new Map<string, number[]>();

  for (const product of wooSkuProducts) {
    for (const sku of wooBaseSkus(product)) {
      const productIds = wooProductIdsByBaseSku.get(sku) ?? [];
      productIds.push(product.id);
      wooProductIdsByBaseSku.set(sku, productIds);
    }
  }

  const matchedProductIds = [
    ...new Set(
      [...groupedBySku.keys()].flatMap((baseSku) => wooProductIdsByBaseSku.get(baseSku) ?? [])
    )
  ];
  const wooProducts =
    matchedProductIds.length > 0
      ? (
          await getProducts({
            page: 1,
            perPage: 100,
            status: "any",
            include: matchedProductIds.join(","),
            fields: wooFields
          })
        ).data
      : [];
  const wooProductById = new Map(wooProducts.map((product) => [product.id, product]));
  const products = [...groupedBySku.entries()]
    .map(([baseSku, grouped]): MakeModelProductResult => {
      const candidates = [
        ...new Set(wooProductIdsByBaseSku.get(baseSku) ?? [])
      ];
      const product = candidates.length === 1 ? wooProductById.get(candidates[0]) : undefined;
      const makes = unique(grouped.makes);
      const models = unique(grouped.models);
      const wooMakes = product ? unique(attributeOptions(product, attributeConfig.make)) : [];
      const wooModels = product ? unique(attributeOptions(product, attributeConfig.model)) : [];
      const makeMatches = Boolean(product) && sameValues(makes, wooMakes);
      const modelMatches = Boolean(product) && sameValues(models, wooModels);

      return {
        sku: grouped.sku,
        baseSku,
        makes,
        models,
        sourceLinks: grouped.sourceLinks,
        sourceRows: [...new Set(grouped.sourceRows)].sort((left, right) => left - right),
        status: product ? "matched" : candidates.length > 1 ? "ambiguous" : "missing_woo",
        product: product ? productSummary(product) : undefined,
        candidates: candidates.map((candidateId) => {
          const candidate = wooProductById.get(candidateId);
          const skuCandidate = wooSkuProducts.find((item) => item.id === candidateId);

          return {
            id: candidateId,
            name: candidate?.name ?? `Product #${candidateId}`,
            sku: candidate?.sku ?? skuCandidate?.sku ?? ""
          };
        }),
        wooMakes,
        wooModels,
        makeMatches,
        modelMatches,
        matches: makeMatches && modelMatches
      };
    })
    .sort((left, right) => {
      if (left.matches !== right.matches) {
        return left.matches ? 1 : -1;
      }

      return (left.product?.name ?? left.sku).localeCompare(
        right.product?.name ?? right.sku,
        undefined,
        { sensitivity: "base" }
      );
    });
  const report: MakeModelReport = {
    updatedAt: new Date().toISOString(),
    scanSource,
    sheetRows: makeModelRows.length,
    productLinks,
    verifiedLinks,
    unresolvedLinks,
    attributeConfig,
    products
  };

  reportCache = {
    expiresAt: Date.now() + reportCacheMs,
    report
  };

  return report;
}
