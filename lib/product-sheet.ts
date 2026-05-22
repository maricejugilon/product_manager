import "server-only";

import { parseCsv } from "@/lib/csv";

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

const spreadsheetId = "1KbsqFWTBddlzkttsYodaO6fTQkQSccci4YESxgW_N08";
const sheetName = "Product List";
const gid = "1647381397";

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getValue(values: Record<string, string>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  const match = Object.entries(values).find(([key]) => normalizedAliases.has(normalizeHeader(key)));

  return match?.[1]?.trim() ?? "";
}

function findValue(values: Record<string, string>, includes: string[]) {
  const match = Object.entries(values).find(([key]) => {
    const normalized = normalizeHeader(key);

    return includes.every((item) => normalized.includes(item));
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

function parseCategoryCell(value: string) {
  return value
    .split(/[,;|\n]+/g)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function valueAt(values: string[], index: number) {
  if (values.length === 0) {
    return "";
  }

  return values[index] ?? (values.length === 1 ? values[0] : "");
}

function categoryHierarchyFromValues(values: Record<string, string>) {
  const parentText =
    getValue(values, ["categories", "category", "product categories", "product category"]) ||
    findValue(values, ["categor"]);
  const subCategoryText =
    getValue(values, ["sub categories", "sub category", "subcategory", "sub-category"]) ||
    findValue(values, ["sub", "categor"]);
  const grandChildText =
    getValue(values, ["grand child categories", "grand child category", "grandchild categories", "grandchild category"]) ||
    findValue(values, ["grand", "categor"]);
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
  const sku =
    getValue(values, ["sku", "product sku", "item sku", "stock keeping unit"]) ||
    findValue(values, ["sku"]);
  const name =
    getValue(values, ["name", "product name", "title", "product title"]) ||
    findValue(values, ["product", "name"]) ||
    findValue(values, ["title"]);
  const categoryText =
    getValue(values, ["categories", "category", "product categories", "product category"]) ||
    findValue(values, ["categor"]);
  const liveUrl =
    getValue(values, ["live url", "live link", "product url", "url", "link"]) ||
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

async function fetchPublicCsv() {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  url.searchParams.set("gid", gid);

  const response = await fetch(url, {
    cache: "no-store"
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Google Sheets CSV export failed: ${response.status} ${body.slice(0, 120)}`);
  }

  if (/^\s*</.test(body)) {
    throw new Error("Google Sheet did not return CSV. Share the sheet publicly or configure API access.");
  }

  return body;
}

export async function getProductSheetRows() {
  const csv = await fetchPublicCsv();
  const rows = parseCsv(csv);
  const [headers = [], ...dataRows] = rows;
  const cleanHeaders = headers.map((header, index) => header.trim() || `Column ${index + 1}`);

  return dataRows.map((cells, index) => {
    const values = Object.fromEntries(cleanHeaders.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ""]));

    return rowFromValues(index + 2, values);
  });
}

export async function getProductSheetRow(rowNumber: number) {
  return (await getProductSheetRows()).find((row) => row.rowNumber === rowNumber);
}
