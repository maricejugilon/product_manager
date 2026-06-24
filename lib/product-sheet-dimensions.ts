import "server-only";

import { getProductSheetRows, type SheetProductRow } from "@/lib/product-sheet";
import { parseFeatureSpecifications, scrapeLiveProduct } from "@/lib/product-sheet-create";
import type { WooProduct } from "@/lib/types";

type ProductDimensions = {
  length: string;
  width: string;
  height: string;
};

let sheetRowsCache: {
  expiresAt: number;
  rows: SheetProductRow[];
} | null = null;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function cachedSheetRows() {
  if (sheetRowsCache && sheetRowsCache.expiresAt > Date.now()) {
    return sheetRowsCache.rows;
  }

  const rows = await getProductSheetRows();
  sheetRowsCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    rows
  };

  return rows;
}

function findSheetRow(product: WooProduct, rows: SheetProductRow[]) {
  const sku = normalize(product.sku);

  if (sku) {
    const skuMatch = rows.find((row) => normalize(row.sku) === sku);

    if (skuMatch) {
      return skuMatch;
    }
  }

  const name = normalize(product.name);

  return name ? rows.find((row) => normalize(row.name) === name) : undefined;
}

function dimensionFeature(descriptionHtml: string) {
  return parseFeatureSpecifications(descriptionHtml).find((feature) => {
    const name = normalize(feature.name).replace(/[^a-z0-9]+/g, " ");

    return (
      name.includes("ext dims") ||
      name.includes("external dims") ||
      name.includes("external dimensions")
    );
  });
}

function decimal(value: string) {
  const parsed = Number(value.replace(",", "."));

  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "";
}

function labeledDimension(value: string, labels: string[]) {
  const labelPattern = labels.join("|");
  const before = value.match(
    new RegExp(`\\b(?:${labelPattern})\\b\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`, "i")
  );
  const after = value.match(
    new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:mm|cm|m)?\\s*\\b(?:${labelPattern})\\b`, "i")
  );

  return decimal(before?.[1] ?? after?.[1] ?? "");
}

export function parseExternalDimensions(rawValue: string): ProductDimensions | null {
  const length = labeledDimension(rawValue, ["length", "len", "depth", "deep", "d", "l"]);
  const width = labeledDimension(rawValue, ["width", "wide", "w"]);
  const height = labeledDimension(rawValue, ["height", "high", "h"]);

  if (length && width && height) {
    return { length, width, height };
  }

  const numbers = [...rawValue.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => decimal(match[0])).filter(Boolean);

  if (numbers.length !== 3) {
    return null;
  }

  const orderHint = normalize(rawValue).match(/\b([lwdh])\s*x\s*([lwdh])\s*x\s*([lwdh])\b/);

  if (orderHint) {
    const values = new Map(orderHint.slice(1).map((label, index) => [label, numbers[index]]));
    const hintedLength = values.get("l") ?? values.get("d") ?? "";
    const hintedWidth = values.get("w") ?? "";
    const hintedHeight = values.get("h") ?? "";

    if (hintedLength && hintedWidth && hintedHeight) {
      return {
        length: hintedLength,
        width: hintedWidth,
        height: hintedHeight
      };
    }
  }

  return {
    length: numbers[0],
    width: numbers[1],
    height: numbers[2]
  };
}

export async function dimensionsFromProductSheet(product: WooProduct) {
  const rows = await cachedSheetRows();
  const row = findSheetRow(product, rows);

  if (!row) {
    throw new Error("No matching Google Sheet row was found by SKU or product name.");
  }

  if (!row.liveUrl) {
    throw new Error(`Google Sheet row ${row.rowNumber} does not have a Link value.`);
  }

  const scraped = await scrapeLiveProduct(row.liveUrl);
  const feature = dimensionFeature(scraped.descriptionHtml);

  if (!feature?.value) {
    throw new Error(`No Features > Ext Dims value was found on sheet row ${row.rowNumber}.`);
  }

  const dimensions = parseExternalDimensions(feature.value);

  if (!dimensions) {
    throw new Error(`Could not parse Ext Dims "${feature.value}" on sheet row ${row.rowNumber}.`);
  }

  return {
    dimensions,
    rawValue: feature.value,
    rowNumber: row.rowNumber,
    sourceUrl: row.liveUrl
  };
}
