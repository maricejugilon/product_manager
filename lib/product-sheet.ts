import "server-only";

import { parseCsv } from "@/lib/csv";
import { friendlyNetworkError } from "@/lib/network-errors";

export type SheetCategoryHierarchy = {
  parent: string;
  subCategory: string;
  grandChildCategory: string;
  path: string[];
  label: string;
};

export type SheetProductRow = {
  rowNumber: number;
  values: Record<string, string>;
  sku: string;
  name: string;
  liveUrl: string;
  categories: string[];
  categoryHierarchy: SheetCategoryHierarchy[];
};

export type ProductSheetSource = "product-manager" | "updated-list";

type SheetConfig = {
  spreadsheetId: string;
  sheetName: string;
  gid?: string;
};

const defaultSheetConfig: SheetConfig = {
  spreadsheetId: "1KbsqFWTBddlzkttsYodaO6fTQkQSccci4YESxgW_N08",
  sheetName: "Product List",
  gid: "1647381397"
};

const updatedListSheetConfig: SheetConfig = {
  spreadsheetId: "1fWu2mxc0LWDUtd_YZQColdkQxwcbsXuihCZ-HcAvlPA",
  sheetName: "Product list"
};

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getValue(values: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const match = Object.entries(values).find(
    ([key, value]) => normalizedAliases.has(normalizeHeader(key)) && value.trim()
  );

  return match?.[1]?.trim() ?? "";
}

function findValue(values: Record<string, string>, includes: string[]) {
  const match = Object.entries(values).find(([key, value]) => {
    const normalized = normalizeHeader(key);

    return value.trim() && includes.every((item) => normalized.includes(item));
  });

  return match?.[1]?.trim() ?? "";
}

function parseCategories(value: string) {
  return value
    .split(/[,;|\n]+/g)
    .map((item) => {
      const trimmed = item.trim();
      const pathParts = trimmed.split(/\s*(?:>|\/)\s*/g).filter(Boolean);

      return pathParts[pathParts.length - 1] ?? trimmed;
    })
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeLiveUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("/")) {
    return new URL(trimmed, "https://www.flightcasewarehouse.co.uk").toString();
  }

  if (trimmed.includes("product.asp")) {
    return new URL(trimmed, "https://www.flightcasewarehouse.co.uk/type/").toString();
  }

  return `https://www.flightcasewarehouse.co.uk/type/product.asp?item=${encodeURIComponent(trimmed)}`;
}

function sheetSku(value: string) {
  return value.trim().replace(/\s+\([^)]*\)\s*$/, "").trim();
}

function parseCategoryCell(value: string) {
  return value
    .split(/[,;|\n]+/g)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function categoryCellValue(values: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const match = Object.entries(values).find(
      ([key, value]) => normalizeHeader(key) === normalizedAlias && value.trim()
    );
    const value = match?.[1]?.trim() ?? "";

    if (value && !/^https?:\/\//i.test(value)) {
      return value;
    }
  }

  return "";
}

function valueAt(values: string[], index: number) {
  if (values.length === 0) {
    return "";
  }

  return values[index] ?? (values.length === 1 ? values[0] : "");
}

function categoryHierarchyFromValues(values: Record<string, string>) {
  const parentText = categoryCellValue(values, [
    "column 1",
    "main category",
    "parent category",
    "category level 1",
    "categories",
    "category",
    "product categories",
    "product category"
  ]);
  const subCategoryText = categoryCellValue(values, [
    "sub categories",
    "sub category",
    "subcategory",
    "sub-category",
    "category level 2"
  ]);
  const grandChildText = categoryCellValue(values, [
    "grand child categories",
    "grand child category",
    "grandchild categories",
    "grandchild category",
    "category level 3"
  ]);
  const parents = parseCategoryCell(parentText);
  const subCategories = parseCategoryCell(subCategoryText);
  const grandChildCategories = parseCategoryCell(grandChildText);
  const count = Math.max(parents.length, subCategories.length, grandChildCategories.length);

  return Array.from({ length: count }, (_, index) => {
    const parent = valueAt(parents, index);
    const subCategory = valueAt(subCategories, index);
    const grandChildCategory = valueAt(grandChildCategories, index);
    const path = [parent, subCategory, grandChildCategory].filter(Boolean);

    return {
      parent,
      subCategory,
      grandChildCategory,
      path,
      label: path.join(" > ")
    };
  }).filter((category) => category.path.length > 0);
}

function rowFromValues(rowNumber: number, values: Record<string, string>): SheetProductRow {
  const sku = sheetSku(
    getValue(values, ["sku", "product sku", "item sku", "stock keeping unit", "product code"]) ||
      findValue(values, ["sku"])
  );
  const name =
    getValue(values, ["name", "product name", "title", "product title"]) ||
    findValue(values, ["product", "name"]) ||
    findValue(values, ["title"]);
  const categoryText = categoryCellValue(values, [
    "column 1",
    "main category",
    "parent category",
    "categories",
    "category",
    "product categories",
    "product category"
  ]);
  const liveUrl =
    getValue(values, [
      "product -link",
      "product-link",
      "product link",
      "product link/external link",
      "live url",
      "live link",
      "product url",
      "external url",
      "url",
      "link"
    ]) ||
    findValue(values, ["live", "url"]) ||
    findValue(values, ["url"]);
  const categoryHierarchy = categoryHierarchyFromValues(values);
  const hierarchyLeaves = categoryHierarchy
    .map((category) => category.path[category.path.length - 1])
    .filter(Boolean);

  return {
    rowNumber,
    values,
    sku,
    name,
    liveUrl: normalizeLiveUrl(liveUrl),
    categories: hierarchyLeaves.length ? hierarchyLeaves : parseCategories(categoryText),
    categoryHierarchy
  };
}

async function fetchPublicCsv(config: SheetConfig = defaultSheetConfig) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", config.sheetName);
  url.searchParams.set("_ts", Date.now().toString());

  if (config.gid) {
    url.searchParams.set("gid", config.gid);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    throw friendlyNetworkError(error, "Google Sheets");
  }
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Google Sheets CSV export failed: ${response.status} ${body.slice(0, 120)}`);
  }

  if (/^\s*</.test(body)) {
    throw new Error("Google Sheet did not return CSV. Share the sheet publicly or configure API access.");
  }

  return body;
}

export async function getProductSheetRows(config: SheetConfig = defaultSheetConfig) {
  const csv = await fetchPublicCsv(config);
  const rows = parseCsv(csv);
  const [headers = [], ...dataRows] = rows;
  const cleanHeaders = headers.map((header, index) => header.trim() || `Column ${index + 1}`);

  return dataRows.map((cells, index) => {
    const values = Object.fromEntries(cleanHeaders.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ""]));

    return rowFromValues(index + 2, values);
  });
}

export async function getProductSheetRow(rowNumber: number, config: SheetConfig = defaultSheetConfig) {
  return (await getProductSheetRows(config)).find((row) => row.rowNumber === rowNumber);
}

export async function getUpdatedListRows() {
  return getProductSheetRows(updatedListSheetConfig);
}

export async function getUpdatedListRow(rowNumber: number) {
  return getProductSheetRow(rowNumber, updatedListSheetConfig);
}

export function productSheetSourceLabel(source: ProductSheetSource) {
  return source === "updated-list" ? "Product list" : "Product Manager";
}

export function parseProductSheetSource(value: unknown): ProductSheetSource {
  return value === "updated-list" ? "updated-list" : "product-manager";
}
