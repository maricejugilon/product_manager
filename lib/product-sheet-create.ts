import "server-only";

import { COLOUR_BOARD_CHOICES } from "@/lib/colour-board-choices";
import { friendlyNetworkError } from "@/lib/network-errors";
import {
  getProductSheetRow,
  getUpdatedListRow,
  type ProductSheetSource,
  type SheetCategoryHierarchy,
  type SheetProductRow
} from "@/lib/product-sheet";
import type { ProductChanges, WooCategory, WooProduct } from "@/lib/types";
import { getCategories, getProducts } from "@/lib/woocommerce";

export type ScrapedProductData = {
  url: string;
  title: string;
  descriptionHtml: string;
  descriptionText: string;
  sku: string;
  price: string;
  priceExVat: string;
  vatAmount: string;
  vatRate: string;
  priceCurrency: string;
  stockStatus?: ProductChanges["stock_status"];
  images: string[];
  colourOptions: ColourBoardOption[];
  accessories: AccessoryItem[];
};

type CategoryResolution = {
  categoryIds: number[];
  warnings: string[];
};

export type AccessoryItem = {
  name?: string;
  sku?: string;
  price?: string;
  url?: string;
  image_url?: string;
  source_product_id?: string;
  source_section_id?: string;
  source_section_type?: string;
  relationship_type?: string;
  option_group?: string;
  notes?: string;
};

export type ColourBoardOption = {
  option_group?: string;
  color_name?: string;
  color_hex?: string;
  swatch_image_url?: string;
  option_image_url?: string;
  price_adjustment?: string;
  default_option?: boolean;
  notes?: string;
};

export type SpecificationGroup = {
  group_name: string;
  specifications: Array<{ name: string; value: string }>;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function htmlDecode(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return htmlDecode(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonParse<T>(value: string): T[] {
  if (!value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function cleanDescriptionHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*\bxPromo\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function extractProductDescriptionHtml(html: string) {
  const prodDesc = html.match(/<div[^>]+id=["']prodDesc["'][\s\S]*?<\/h3>\s*<div[^>]+class=["']tab-content["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*\/\.tab-content\s*-->/i);

  if (prodDesc?.[1]) {
    return cleanDescriptionHtml(prodDesc[1]);
  }

  const tabContent = html.match(/<div[^>]+class=["']tab-content["'][^>]*>([\s\S]*?)<\/div>/i);

  return tabContent?.[1] ? cleanDescriptionHtml(tabContent[1]) : "";
}

function fieldValue(values: Record<string, string>, aliases: string[]) {
  const normalizedAliases = aliases.map((alias) => normalizeText(alias));
  const match = Object.entries(values).find(([key]) => {
    const normalizedKey = normalizeText(key);

    return normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias));
  });

  return match?.[1]?.trim() ?? "";
}

function findValue(values: Record<string, string>, includes: string[]) {
  const match = Object.entries(values).find(([key]) => {
    const normalized = normalizeText(key);

    return includes.every((item) => normalized.includes(normalizeText(item)));
  });

  return match?.[1]?.trim() ?? "";
}

function sheetField(row: SheetProductRow, aliases: string[]) {
  return fieldValue(row.values, aliases) || aliases.map((alias) => findValue(row.values, alias.split(/\s+/))).find(Boolean) || "";
}

export const PRODUCT_MANAGER_SHEET_FIELDS = {
  colourBoard: "colour_option",
  accessories: "accessories_option",
  customNotes: "custom_notes"
} as const;

export type ProductManagerSheetField = keyof typeof PRODUCT_MANAGER_SHEET_FIELDS;

const productManagerSheetFieldAliases: Record<ProductManagerSheetField, string[]> = {
  colourBoard: [
    "Colour Board",
    "Colour Option",
    "Colour",
    "Color"
  ],
  accessories: [
    "Accessories Option",
    "Accessories"
  ],
  customNotes: [
    "Meta: custom_notes",
    "Meta: _custom_notes",
    "_custom_notes",
    "Custom Notes",
    "Custom Note"
  ]
};

function productManagerSheetFieldEntry(row: SheetProductRow, field: ProductManagerSheetField) {
  const headers = [PRODUCT_MANAGER_SHEET_FIELDS[field], ...productManagerSheetFieldAliases[field]];

  for (const header of headers) {
    const entry = Object.entries(row.values).find(([key]) => key.trim() === header);

    if (entry) {
      return { header: entry[0], value: entry[1].trim() };
    }
  }

  for (const header of headers) {
    const normalizedHeader = normalizeText(header);
    const entry = Object.entries(row.values).find(([key]) => normalizeText(key) === normalizedHeader);

    if (entry) {
      return { header: entry[0], value: entry[1].trim() };
    }
  }

  return undefined;
}

export function hasProductManagerSheetField(row: SheetProductRow, field: ProductManagerSheetField) {
  return Boolean(productManagerSheetFieldEntry(row, field));
}

export function productManagerSheetFieldValue(row: SheetProductRow, field: ProductManagerSheetField) {
  return productManagerSheetFieldEntry(row, field)?.value ?? "";
}

function productManagerSheetDetailValue(
  row: SheetProductRow,
  field: "colourBoard" | "accessories"
) {
  const headers = field === "colourBoard"
    ? [
        "Meta: legacy_colour_board_options",
        "legacy_colour_board_options",
        "Meta: color_options",
        "color_options",
        "color",
        "colour"
      ]
    : [
        "Meta: product_accessories",
        "product_accessories",
        "Meta: _fcw_accessory_cross_sell_names",
        "_fcw_accessory_cross_sell_names",
        "accessories"
      ];

  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row.values, header)) {
      const value = row.values[header]?.trim() ?? "";

      if (value) {
        return value;
      }
    }
  }

  return "";
}

function explicitBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value);

  if (["1", "yes", "true", "on", "y", "present", "included", "required", "available"].includes(normalized)) {
    return true;
  }

  if (
    [
      "0",
      "no",
      "false",
      "off",
      "n",
      "none",
      "missing",
      "not present",
      "not included",
      "not required",
      "no option",
      "no colour option",
      "no color option",
      "no accessories",
      "absent",
      "error",
      "in stock",
      "out of stock",
      "on backorder"
    ].includes(normalized)
  ) {
    return false;
  }

  return undefined;
}

function pipeValues(value: string) {
  return value
    .split(/\s*\|\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMoney(value: string) {
  const parsed = value.replace(/[^0-9.]/g, "");

  return parsed && Number.isFinite(Number(parsed)) ? Number(parsed).toFixed(2) : "";
}

function productVatPrices(html: string) {
  const pricesSection = html.match(
    /<div[^>]+id=["']prodPrices["'][^>]*>([\s\S]*?)<!--\s*#prodPrices\s*-->/i
  )?.[1] ?? html;
  const inclusiveMarkup = pricesSection.match(
    /<span[^>]+class=["'][^"']*\bactual-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  )?.[1] ?? "";
  const exclusiveMarkup = pricesSection.match(
    /<span[^>]+class=["'][^"']*\bex-vat-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  )?.[1] ?? "";
  const price = parseMoney(stripTags(inclusiveMarkup));
  const priceExVat = parseMoney(stripTags(exclusiveMarkup));
  const inclusiveAmount = Number(price);
  const exclusiveAmount = Number(priceExVat);
  const vatAmount = price && priceExVat && inclusiveAmount >= exclusiveAmount
    ? (inclusiveAmount - exclusiveAmount).toFixed(2)
    : "";
  const vatRate = vatAmount && exclusiveAmount > 0
    ? ((Number(vatAmount) / exclusiveAmount) * 100).toFixed(2)
    : "";

  return { price, priceExVat, vatAmount, vatRate };
}

function statusFromAvailability(value: string): ProductChanges["stock_status"] | undefined {
  const normalized = normalizeText(value);

  if (
    /\b0+\s+in stock\b/.test(normalized) ||
    normalized.includes("outofstock") ||
    normalized.includes("out of stock") ||
    normalized.includes("soldout") ||
    normalized.includes("sold out") ||
    normalized.includes("discontinued") ||
    normalized.includes("currently unavailable")
  ) {
    return "outofstock";
  }

  if (
    normalized.includes("backorder") ||
    normalized.includes("preorder") ||
    normalized.includes("pre order") ||
    normalized.includes("available to order") ||
    normalized.includes("made to order")
  ) {
    return "onbackorder";
  }

  if (
    normalized.includes("instock") ||
    normalized.includes("in stock") ||
    normalized.includes("limitedavailability") ||
    normalized.includes("limited availability")
  ) {
    return "instock";
  }

  return undefined;
}

function productStockStatus(html: string, offerAvailability: unknown) {
  const availabilityElement = html.match(
    /<[^>]*(?:itemprop|item-prop)=["']availability["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  )?.[1];
  const stockClassElement = html.match(
    /<[^>]*class=["'][^"']*(?:in_stock|out_of_stock|on_backorder)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
  )?.[1];

  const visible = statusFromAvailability(stripTags(availabilityElement || stockClassElement || ""));

  return visible || statusFromAvailability(String(offerAvailability ?? ""));
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value.replace(/\\/g, "/"), baseUrl).toString();
  } catch {
    return "";
  }
}

function htmlAttribute(value: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));

  return match ? htmlDecode(match[1]).trim() : "";
}

function isSupportedImageUrl(value: string) {
  try {
    const url = new URL(value);

    return /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function parseJsonLd(html: string) {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(htmlDecode(script[1].trim()));
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const product = items.find((item) => item?.["@type"] === "Product" || item?.["@type"]?.includes?.("Product"));

      if (product) {
        return product as Record<string, unknown>;
      }
    } catch {
      // Some old pages include slightly imperfect JSON-LD. The fallback parsers below still recover useful data.
    }
  }

  return null;
}

function metaContent(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const match = html.match(pattern);

  return match ? htmlDecode(match[1]).trim() : "";
}

function jsonLdImages(value: unknown, baseUrl: string) {
  const images = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

  return images.map((image) => absoluteUrl(String(image), baseUrl)).filter(Boolean);
}

function parseProductColourOptions(html: string, baseUrl: string) {
  const opening = /<div[^>]*class=["'][^"']*\bcolour-boards\b[^"']*["'][^>]*>/i.exec(html);
  const remainder = opening
    ? html.slice((opening.index ?? 0) + opening[0].length)
    : "";
  const boundaryIndexes = [
    remainder.search(/<div[^>]*class=["'][^"']*\baccessories\b[^"']*["'][^>]*>/i),
    remainder.search(/<\/form>/i)
  ].filter((index) => index >= 0);
  const colourSection = boundaryIndexes.length > 0
    ? remainder.slice(0, Math.min(...boundaryIndexes))
    : remainder;
  const options = [...colourSection.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)]
    .map((match) => {
      const block = match[1];
      const input = block.match(/<input[^>]*class=["'][^"']*\blogAccessory\b[^"']*["'][^>]*>/i)?.[0] ?? "";

      if (!input) {
        return undefined;
      }

      const image = block.match(/<img[^>]*>/i)?.[0] ?? "";
      const name = htmlAttribute(input, "data-name") ||
        stripTags(block.match(/<div[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
      const imageUrl = absoluteUrl(
        htmlAttribute(image, "data-src") || htmlAttribute(image, "src"),
        baseUrl
      );

      if (!name) {
        return undefined;
      }

      return enrichColourBoardOption({
        option_group: "Personalise this item with coloured board",
        color_name: name,
        swatch_image_url: imageUrl,
        option_image_url: imageUrl,
        price_adjustment: parseMoney(htmlAttribute(input, "data-price")),
        default_option: false
      });
    })
    .filter((option): option is ColourBoardOption => Boolean(option));

  return [...new Map(
    options.map((option) => [normalizeText(String(option.color_name ?? "")), option])
  ).values()];
}

function parseProductAccessories(html: string, baseUrl: string) {
  const accessorySection = html.match(
    /<h3[^>]*>\s*Do you need accessories\?\s*<\/h3>([\s\S]*?)<\/div>\s*<!--\s*\.accessoriesGrid\s*-->/i
  )?.[1] ?? "";
  const accessories = [...accessorySection.matchAll(
    /<div[^>]*class=["']accessory["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*\.col\s*-->/gi
  )].map((match) => {
    const block = match[1];
    const input = block.match(/<input[^>]*class=["'][^"']*\blogAccessory\b[^"']*["'][^>]*>/i)?.[0] ?? "";
    const image = block.match(/<img[^>]*>/i)?.[0] ?? "";
    const sectionIdInput = block.match(/<input[^>]*class=["'][^"']*\bacc_sectionId\b[^"']*["'][^>]*>/i)?.[0] ?? "";
    const sectionTypeInput = block.match(/<input[^>]*class=["'][^"']*\bacc_sectionType\b[^"']*["'][^>]*>/i)?.[0] ?? "";
    const name = htmlAttribute(input, "data-name") ||
      stripTags(block.match(/<div[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const imageUrl = absoluteUrl(
      htmlAttribute(image, "data-src") || htmlAttribute(image, "src"),
      baseUrl
    );

    return {
      name,
      price: parseMoney(htmlAttribute(input, "data-price")),
      image_url: imageUrl,
      source_product_id: htmlAttribute(input, "data-id") || htmlAttribute(input, "value"),
      source_section_id: htmlAttribute(sectionIdInput, "value"),
      source_section_type: htmlAttribute(sectionTypeInput, "value"),
      relationship_type: "recommended",
      option_group: "Frequently bought with these accessories"
    } satisfies AccessoryItem;
  }).filter((accessory) => accessory.name);

  return [...new Map(
    accessories.map((accessory) => [
      accessory.source_product_id || normalizeAccessoryName(String(accessory.name ?? "")),
      accessory
    ])
  ).values()];
}

async function fetchLiveProductPage(url: string, timeoutMs = 30000) {
  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "FCW Product Sheet Validator"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw friendlyNetworkError(error, "Live product page");
  }
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Live URL scrape failed: ${response.status}`);
  }

  return { response, html };
}

export async function scrapeLiveProductStock(url: string) {
  const { response, html } = await fetchLiveProductPage(url, 15000);
  const jsonLd = parseJsonLd(html);
  const offers = jsonLd?.offers && typeof jsonLd.offers === "object"
    ? (jsonLd.offers as Record<string, unknown>)
    : {};

  return {
    url: response.url,
    stockStatus: productStockStatus(html, offers.availability)
  };
}

export async function scrapeLiveProduct(url: string): Promise<ScrapedProductData> {
  const { response, html } = await fetchLiveProductPage(url);

  const jsonLd = parseJsonLd(html);
  const offers = jsonLd?.offers && typeof jsonLd.offers === "object" ? (jsonLd.offers as Record<string, unknown>) : {};
  const title =
    (typeof jsonLd?.name === "string" ? htmlDecode(jsonLd.name) : "") ||
    metaContent(html, "og:title") ||
    stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const descriptionHtml = extractProductDescriptionHtml(html);
  const descriptionText =
    (descriptionHtml ? stripTags(descriptionHtml) : "") ||
    (typeof jsonLd?.description === "string" ? stripTags(jsonLd.description) : "") ||
    metaContent(html, "description");
  const sku = typeof jsonLd?.sku === "string" ? htmlDecode(jsonLd.sku).trim() : "";
  const vatPrices = productVatPrices(html);
  const price = vatPrices.price || parseMoney(String(offers.price ?? ""));
  const priceCurrency = typeof offers.priceCurrency === "string"
    ? offers.priceCurrency.trim().toUpperCase()
    : "";
  const stockStatus = productStockStatus(html, offers.availability);
  const images = [
    ...jsonLdImages(jsonLd?.image, response.url),
    absoluteUrl(metaContent(html, "og:image"), response.url)
  ].filter((image) => image && isSupportedImageUrl(image));

  return {
    url: response.url,
    title,
    descriptionHtml: descriptionHtml || `<p>${descriptionText}</p>`,
    descriptionText,
    sku,
    price,
    priceExVat: vatPrices.priceExVat,
    vatAmount: vatPrices.vatAmount,
    vatRate: vatPrices.vatRate,
    priceCurrency,
    stockStatus,
    images: [...new Set(images)],
    colourOptions: parseProductColourOptions(html, response.url),
    accessories: parseProductAccessories(html, response.url)
  };
}

export async function scrapeProductColourOptions(url: string): Promise<ColourBoardOption[]> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "FCW Product Sheet Validator"
    }
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Colour board scrape failed: ${response.status}`);
  }

  return parseProductColourOptions(html, response.url);
}

export async function scrapeProductAccessories(url: string): Promise<AccessoryItem[]> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "FCW Product Sheet Validator"
    }
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Accessory scrape failed: ${response.status}`);
  }

  return parseProductAccessories(html, response.url);
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

function normalizeCategoryName(value: string) {
  const normalized = htmlDecode(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " and ")
    .replace(/\bvisual\b/g, "video")
    .replace(/\bflight\s*cases?\b|\bflightcases?\b/g, "cases")
    .replace(/\bspares\b/g, "spare")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized === "toolbox backline cases" ? "backline tool cases" : normalized;
}

function categoryNamesMatch(first: string, second: string) {
  const normalizedFirst = normalizeCategoryName(first);
  const normalizedSecond = normalizeCategoryName(second);

  return (
    normalizedFirst === normalizedSecond ||
    (Math.min(normalizedFirst.length, normalizedSecond.length) >= 8 &&
      (normalizedFirst.includes(normalizedSecond) || normalizedSecond.includes(normalizedFirst)))
  );
}

function pathsMatch(first: string[], second: string[]) {
  return (
    first.length === second.length &&
    first.every((item, index) => categoryNamesMatch(item, second[index] ?? ""))
  );
}

function oneCategoryPath(categories: WooCategory[], categoryById: Map<number, WooCategory>) {
  const paths = new Set(
    categories.map((category) => categoryPath(category, categoryById).map(normalizeCategoryName).join(" > "))
  );

  return paths.size === 1 ? categories[0] : undefined;
}

function resolveCategory(categories: WooCategory[], hierarchy: SheetCategoryHierarchy) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const exact = categories.find((category) => pathsMatch(categoryPath(category, categoryById), hierarchy.path));

  if (exact) {
    return exact;
  }

  const suffix = categories.find((category) => {
    const path = categoryPath(category, categoryById);

    return (
      path.length < hierarchy.path.length &&
      pathsMatch(path, hierarchy.path.slice(hierarchy.path.length - path.length))
    );
  });

  if (suffix) {
    return suffix;
  }

  const leaf = hierarchy.path[hierarchy.path.length - 1];
  const normalizedLeaf = normalizeCategoryName(leaf);
  const parentPath = hierarchy.path.slice(0, -1);
  const parentAwareMatches = categories.filter((category) => {
    const path = categoryPath(category, categoryById);
    const categoryLeaf = normalizeCategoryName(path[path.length - 1] ?? "");

    return (
      path.length === hierarchy.path.length &&
      pathsMatch(path.slice(0, -1), parentPath) &&
      (categoryLeaf.includes(normalizedLeaf) || normalizedLeaf.includes(categoryLeaf))
    );
  });
  const parentAwareMatch = oneCategoryPath(parentAwareMatches, categoryById);

  if (parentAwareMatch) {
    return parentAwareMatch;
  }

  const leafMatches = categories.filter(
    (category) => normalizeCategoryName(category.name) === normalizedLeaf
  );

  return oneCategoryPath(leafMatches, categoryById);
}

export function resolveCategories(row: SheetProductRow, categories: WooCategory[]): CategoryResolution {
  const warnings: string[] = [];
  const categoryIds = row.categoryHierarchy
    .map((hierarchy) => {
      const category = resolveCategory(categories, hierarchy);

      if (!category) {
        warnings.push(`Could not find WooCommerce category path: ${hierarchy.label}`);
      }

      return category?.id;
    })
    .filter((id): id is number => Boolean(id));

  return {
    categoryIds: [...new Set(categoryIds)],
    warnings
  };
}

export function sheetProductPrice(row: SheetProductRow) {
  const acceptedHeaders = new Set([
    "price",
    "price (inc vat)",
    "regular price",
    "product price",
    "unit price",
    "rrp"
  ]);
  const exactPrice = Object.entries(row.values).find(
    ([key, value]) => acceptedHeaders.has(normalizeText(key)) && value.trim()
  )?.[1] ?? "";

  return parseMoney(
    exactPrice ||
      findValue(row.values, ["regular", "price"]) ||
      findValue(row.values, ["product", "price"])
  );
}

export function sheetCustomNotesExpected(row: SheetProductRow) {
  const value = productManagerSheetFieldValue(row, "customNotes");
  return explicitBoolean(value) ?? false;
}

export function sheetColourBoardExpected(row: SheetProductRow) {
  const value = productManagerSheetFieldValue(row, "colourBoard");

  const explicit = explicitBoolean(value);

  if (explicit !== undefined) {
    return explicit;
  }

  return rowColourOptions(row).length > 0;
}

export function sheetAccessoriesExpected(row: SheetProductRow) {
  const value = productManagerSheetFieldValue(row, "accessories");

  const explicit = explicitBoolean(value);

  if (explicit !== undefined) {
    return explicit;
  }

  return rowAccessories(row).length > 0;
}

export function sheetFeatureValue(row: SheetProductRow) {
  const entry = Object.entries(row.values).find(([key]) => {
    const normalized = normalizeText(key);
    return normalized === "feature" || normalized === "features";
  });

  return entry?.[1]?.trim() ?? "";
}

export function sheetSpecificationsExpected(row: SheetProductRow) {
  const value = sheetFeatureValue(row);

  return Boolean(value) && !/^(?:no|none|n\/?a|error|not available)(?:\b|$)/i.test(value);
}

export function sheetSpecificationGroups(row: SheetProductRow): SpecificationGroup[] {
  const specifications = sheetFeatureValue(row)
    .split(/\s*\|\s*/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf(":");

      return separator >= 0
        ? { name: item.slice(0, separator).trim(), value: item.slice(separator + 1).trim() }
        : { name: item, value: "" };
    })
    .filter((specification) => specification.name || specification.value);

  return specifications.length > 0
    ? [{ group_name: "Features", specifications }]
    : [];
}

export function rowAccessories(row: SheetProductRow) {
  const value = productManagerSheetDetailValue(row, "accessories");
  const json = safeJsonParse<AccessoryItem>(value).filter((item) => item && typeof item === "object");

  if (json.length > 0) {
    return json;
  }

  if (explicitBoolean(value) !== undefined) {
    return [];
  }

  return pipeValues(value)
    .filter((name) => !/^(?:error|no accessories)$/i.test(name))
    .filter((name) => normalizeText(name) !== normalizeText(row.name))
    .map((name) => ({
      name,
      relationship_type: "recommended",
      option_group: "Frequently bought with these accessories"
    }));
}

export function mergeProductAccessories(expected: AccessoryItem[], scraped: AccessoryItem[]) {
  if (expected.length === 0) {
    return scraped;
  }

  const scrapedByName = new Map(
    scraped.map((accessory) => [normalizeAccessoryName(String(accessory.name ?? "")), accessory])
  );

  return expected.map((accessory) => {
    const live = scrapedByName.get(normalizeAccessoryName(String(accessory.name ?? "")));

    return live ? { ...accessory, ...live } : accessory;
  });
}

function enrichColourBoardOption(option: ColourBoardOption): ColourBoardOption {
  const name = String(option.color_name ?? "").trim();
  const candidates = COLOUR_BOARD_CHOICES.filter(
    (choice) => normalizeText(choice.color_name) === normalizeText(name)
  );
  const price = String(option.price_adjustment ?? "").trim();
  const choice = candidates.find(
    (candidate) => price && String(candidate.price_adjustment).trim() === price
  ) ?? [...candidates].sort((first, second) => second.source_count - first.source_count)[0];

  if (!choice) {
    return option;
  }

  return {
    ...option,
    option_group: String(option.option_group ?? "").trim() || choice.option_group,
    color_name: name || choice.color_name,
    color_hex: String(option.color_hex ?? "").trim() || choice.color_hex,
    swatch_image_url: String(option.swatch_image_url ?? "").trim() || choice.swatch_image_url,
    option_image_url: String(option.option_image_url ?? "").trim() || choice.option_image_url,
    price_adjustment: price || choice.price_adjustment,
    notes: String(option.notes ?? "").trim() || choice.notes
  };
}

export function rowColourOptions(row: SheetProductRow) {
  const value = productManagerSheetDetailValue(row, "colourBoard");
  const json = safeJsonParse<ColourBoardOption>(value).filter((item) => item && typeof item === "object");

  if (json.length > 0) {
    return json.map(enrichColourBoardOption);
  }

  if (explicitBoolean(value) !== undefined) {
    return [];
  }

  return pipeValues(value)
    .filter((name) => !/^(?:error|no colou?r option)$/i.test(name))
    .map((name) => enrichColourBoardOption({
      option_group: "Personalise this item with coloured board",
      color_name: name,
      price_adjustment: "",
      default_option: false
    }));
}

export function mergeProductColourOptions(
  expected: ColourBoardOption[],
  scraped: ColourBoardOption[]
) {
  if (expected.length === 0) {
    return scraped;
  }

  const scrapedByName = new Map(
    scraped.map((option) => [normalizeText(String(option.color_name ?? "")), option])
  );

  return expected.map((option) => {
    const enriched = enrichColourBoardOption(option);
    const live = scrapedByName.get(normalizeText(String(enriched.color_name ?? "")));

    if (!live) {
      return enriched;
    }

    return {
      ...enriched,
      option_group: live.option_group || enriched.option_group,
      color_name: live.color_name || enriched.color_name,
      color_hex: live.color_hex || enriched.color_hex,
      swatch_image_url: live.swatch_image_url || enriched.swatch_image_url,
      option_image_url: live.option_image_url || enriched.option_image_url,
      price_adjustment: live.price_adjustment || enriched.price_adjustment,
      default_option: live.default_option ?? enriched.default_option,
      notes: live.notes || enriched.notes
    };
  });
}

type AccessoryProductMatch = {
  product: WooProduct;
  matchedBy: "sku" | "name" | "url";
};

const accessoryMatchCache = new Map<string, {
  expiresAt: number;
  promise: Promise<AccessoryProductMatch | undefined>;
}>();

export function normalizeAccessoryName(value: string) {
  return stripTags(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeAccessorySku(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function normalizeAccessoryUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

function preferredAccessoryProduct(products: WooProduct[]) {
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

async function findAccessoryProductUncached(accessory: AccessoryItem) {
  const name = String(accessory.name ?? "").trim();
  const sku = String(accessory.sku ?? "").trim();
  const sourceUrl = String(accessory.url ?? "").trim();

  if (sku) {
    const result = await getProducts({
      sku,
      perPage: 20,
      status: "any",
      fields: "id,name,sku,status,permalink"
    });
    const exactMatches = result.data.filter(
      (product) => normalizeAccessorySku(product.sku) === normalizeAccessorySku(sku)
    );
    const product = preferredAccessoryProduct(exactMatches);

    if (product) {
      return { product, matchedBy: "sku" as const };
    }
  }

  if (name) {
    const result = await getProducts({
      search: name,
      perPage: 50,
      status: "any",
      fields: "id,name,sku,status,permalink"
    });
    const exactMatches = result.data.filter(
      (product) => normalizeAccessoryName(product.name) === normalizeAccessoryName(name)
    );
    const exact = preferredAccessoryProduct(exactMatches);

    if (exact) {
      return { product: exact, matchedBy: "name" as const };
    }

    const normalizedUrl = normalizeAccessoryUrl(sourceUrl);
    const urlMatches = normalizedUrl
      ? result.data.filter((product) => normalizeAccessoryUrl(product.permalink) === normalizedUrl)
      : [];
    const urlMatch = preferredAccessoryProduct(urlMatches);

    if (urlMatch) {
      return { product: urlMatch, matchedBy: "url" as const };
    }
  }

  return undefined;
}

async function findAccessoryProduct(accessory: AccessoryItem) {
  const cacheKey = [
    normalizeAccessorySku(String(accessory.sku ?? "")),
    normalizeAccessoryName(String(accessory.name ?? "")),
    normalizeAccessoryUrl(String(accessory.url ?? ""))
  ].join("|");
  const cached = accessoryMatchCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = findAccessoryProductUncached(accessory);
  accessoryMatchCache.set(cacheKey, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    promise
  });
  void promise.catch(() => {
    if (accessoryMatchCache.get(cacheKey)?.promise === promise) {
      accessoryMatchCache.delete(cacheKey);
    }
  });
  void promise.then((match) => {
    if (!match && accessoryMatchCache.get(cacheKey)?.promise === promise) {
      accessoryMatchCache.delete(cacheKey);
    }
  });

  return promise;
}

export async function resolveAccessoryCrossSells(
  accessories: AccessoryItem[],
  options: { excludeProductId?: number } = {}
) {
  const ids: number[] = [];
  const linkedNames: string[] = [];
  const linkedSkus: string[] = [];
  const missing: string[] = [];
  const results = await Promise.all(
    accessories.map(async (accessory) => ({
      accessory,
      match: await findAccessoryProduct(accessory)
    }))
  );

  for (const { accessory, match } of results) {
    const name = String(accessory.name ?? "").trim();
    const sku = String(accessory.sku ?? "").trim();

    if (!name && !sku) {
      continue;
    }

    if (match?.product && match.product.id !== options.excludeProductId) {
      ids.push(match.product.id);
      linkedNames.push(name || match.product.name);

      const linkedSku = sku || match.product.sku;
      if (linkedSku) linkedSkus.push(linkedSku);
    } else {
      missing.push(name || sku);
    }
  }

  return {
    ids: [...new Set(ids)],
    linkedNames: [...new Set(linkedNames)],
    linkedSkus: [...new Set(linkedSkus)],
    missing: [...new Set(missing)]
  };
}

export function buildColourBoardAcfPayload(options: ColourBoardOption[]) {
  const items = options
    .map((option) => {
      const name = String(option.color_name ?? "").trim();
      const imageUrl = String(option.option_image_url || option.swatch_image_url || "").trim();

      if (!name && !imageUrl) {
        return undefined;
      }

      return {
        name,
        additional_price: String(option.price_adjustment ?? ""),
        image: imageUrl,
        _legacy_value: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        _legacy_swatch_image_url: String(option.swatch_image_url ?? ""),
        default: option.default_option ? 1 : 0
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const option = {
    type: "Image",
    image: {
      label: "Colour Board",
      frontend_label: "Personalise this item with coloured board",
      items
    }
  };

  return {
    products: {
      options: [option]
    },
    options: [option]
  };
}

export function colourBoardPersonalizationMeta(options: ColourBoardOption[]) {
  const items = options
    .map((option) => ({
      name: String(option.color_name ?? "").trim(),
      additional_price: String(option.price_adjustment ?? "").trim(),
      image: String(option.option_image_url || option.swatch_image_url || "").trim()
    }))
    .filter((item) => item.name || item.image);
  const meta: Array<{ key: string; value: unknown }> = [
    { key: "personalization", value: items.length > 0 ? 1 : 0 },
    { key: "_personalization", value: "field_68b4362b5c347" }
  ];

  if (items.length === 0) {
    meta.push(
      { key: "personalization_0_image_items", value: 0 },
      { key: "_personalization_0_image_items", value: "field_68b436e85c34c" }
    );
    return meta;
  }

  meta.push(
    { key: "personalization_0_type", value: "Image" },
    { key: "_personalization_0_type", value: "field_68b436665c348" },
    { key: "personalization_0_image", value: "" },
    { key: "_personalization_0_image", value: "field_68b436af5c349" },
    { key: "personalization_0_image_label", value: "Coloured Board" },
    { key: "_personalization_0_image_label", value: "field_68b436c95c34a" },
    { key: "personalization_0_image_frontend_label", value: "Personalise this item with coloured board" },
    { key: "_personalization_0_image_frontend_label", value: "field_68b436dc5c34b" },
    { key: "personalization_0_image_items", value: items.length },
    { key: "_personalization_0_image_items", value: "field_68b436e85c34c" }
  );

  items.forEach((item, index) => {
    meta.push(
      { key: `personalization_0_image_items_${index}_name`, value: item.name },
      { key: `_personalization_0_image_items_${index}_name`, value: "field_68b436f05c34d" },
      { key: `personalization_0_image_items_${index}_additional_price`, value: item.additional_price },
      { key: `_personalization_0_image_items_${index}_additional_price`, value: "field_68b436fa5c34e" },
      { key: `personalization_0_image_items_${index}_image`, value: item.image },
      { key: `_personalization_0_image_items_${index}_image`, value: "field_68b4370b5c34f" }
    );
  });

  return meta;
}

export function parseFeatureSpecifications(descriptionHtml: string) {
  if (!/Features/i.test(descriptionHtml)) {
    return [];
  }

  const featureBlock =
    descriptionHtml.match(/<h[1-6][^>]*>\s*Features\s*:?\s*<\/h[1-6]>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  const lines = featureBlock
    ? [...featureBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripTags(match[1]))
    : [];

  return lines
    .map((line) => {
      const [name = "", ...valueParts] = line.split(":");

      return {
        name: name.trim(),
        value: valueParts.join(":").trim()
      };
    })
    .filter((spec) => spec.name);
}

export function removeFeatureSection(descriptionHtml: string) {
  return descriptionHtml
    .replace(
      /<h([1-6])[^>]*>\s*(?:<[^>]+>\s*)*Features\s*:?\s*(?:<\/[^>]+>\s*)*<\/h\1>\s*(?:<ul[^>]*>[\s\S]*?<\/ul>|<ol[^>]*>[\s\S]*?<\/ol>)/gi,
      ""
    )
    .trim();
}

function buildSpecificationGroups(descriptionHtml: string): SpecificationGroup[] {
  const specifications = parseFeatureSpecifications(descriptionHtml);

  return specifications.length > 0
    ? [
        {
          group_name: "Features",
          specifications
        }
      ]
    : [];
}

export function specificationMeta(groups: SpecificationGroup[]) {
  const meta: Array<{ key: string; value: unknown }> = [
    { key: "technical_specifications", value: JSON.stringify(groups) },
    { key: "_fcw_features_specification_count", value: groups[0]?.specifications.length ?? 0 },
    { key: "groups", value: groups.length },
    { key: "_groups", value: "field_68b675504a3d7" }
  ];

  groups.forEach((group, groupIndex) => {
    meta.push(
      { key: `groups_${groupIndex}_group_name`, value: group.group_name },
      { key: `_groups_${groupIndex}_group_name`, value: "field_68b675604a3d8" },
      { key: `groups_${groupIndex}_specifications`, value: group.specifications.length },
      { key: `_groups_${groupIndex}_specifications`, value: "field_68b67470a9fce" }
    );

    group.specifications.forEach((specification, specIndex) => {
      meta.push(
        { key: `groups_${groupIndex}_specifications_${specIndex}_name`, value: specification.name },
        { key: `_groups_${groupIndex}_specifications_${specIndex}_name`, value: "field_68b67479a9fcf" },
        { key: `groups_${groupIndex}_specifications_${specIndex}_value`, value: specification.value },
        { key: `_groups_${groupIndex}_specifications_${specIndex}_value`, value: "field_68b6747fa9fd0" }
      );
    });
  });

  return meta;
}

export async function buildProductCreateDraft(
  rowNumber: number,
  source: ProductSheetSource = "product-manager",
  options: { row?: SheetProductRow; categories?: WooCategory[] } = {}
) {
  const row = options.row ?? (source === "updated-list"
    ? await getUpdatedListRow(rowNumber)
    : await getProductSheetRow(rowNumber));

  if (!row) {
    throw new Error("Sheet row was not found.");
  }

  if (!row.liveUrl) {
    throw new Error('This spreadsheet row does not have a "product -link" URL to scrape.');
  }

  const [scraped, categories] = await Promise.all([
    scrapeLiveProduct(row.liveUrl),
    options.categories ? Promise.resolve(options.categories) : getCategories()
  ]);
  const categoryResolution = resolveCategories(row, categories);

  if (categoryResolution.categoryIds.length === 0) {
    const hierarchy = row.categoryHierarchy.map((category) => category.label).join(", ");
    throw new Error(
      hierarchy
        ? `No WooCommerce category matches the spreadsheet hierarchy: ${hierarchy}. Product creation was stopped to prevent Uncategorized assignment.`
        : "This spreadsheet row does not have a category hierarchy. Product creation was stopped to prevent Uncategorized assignment."
    );
  }

  const sheetAccessories = rowAccessories(row);
  const accessories = sheetAccessoriesExpected(row)
    ? mergeProductAccessories(sheetAccessories, scraped.accessories)
    : sheetAccessories;
  const sheetColourOptions = rowColourOptions(row);
  const colourOptions = sheetColourBoardExpected(row)
    ? mergeProductColourOptions(sheetColourOptions, scraped.colourOptions)
    : sheetColourOptions;
  const colourBoardPayload = buildColourBoardAcfPayload(colourOptions);
  const accessoryCrossSells = await resolveAccessoryCrossSells(accessories);
  const spreadsheetSpecificationGroups = sheetSpecificationGroups(row);
  const specificationGroups = spreadsheetSpecificationGroups.length > 0
    ? spreadsheetSpecificationGroups
    : buildSpecificationGroups(scraped.descriptionHtml);
  const descriptionHtml = removeFeatureSection(scraped.descriptionHtml);
  const descriptionText = stripTags(descriptionHtml);
  const productName = row.name || scraped.title;
  const regularPrice = sheetProductPrice(row) || scraped.price;
  const rawAccessoriesJson = accessories.length > 0 ? JSON.stringify(accessories) : "";
  const rawColourJson = colourOptions.length > 0 ? JSON.stringify(colourOptions) : "";
  const customNotes = sheetCustomNotesExpected(row);
  const changes: ProductChanges = {
    type: "simple",
    name: productName,
    sku: row.sku || scraped.sku,
    status: "publish",
    catalog_visibility: "visible",
    regular_price: regularPrice,
    stock_status: scraped.stockStatus ?? "instock",
    manage_stock: false,
    categories: categoryResolution.categoryIds.map((id) => ({ id })),
    cross_sell_ids: accessoryCrossSells.ids,
    images: scraped.images.map((src) => ({ src, alt: productName })),
    short_description: descriptionText.slice(0, 300),
    description: descriptionHtml,
    meta_data: [
      { key: "_fcw_source", value: source === "updated-list" ? "updated_list" : "product_sheet_validator" },
      { key: "_fcw_sheet_row", value: row.rowNumber },
      { key: "_fcw_live_url", value: row.liveUrl },
      { key: "_fcw_scraped_url", value: scraped.url },
      { key: "_fcw_source_image_urls", value: scraped.images },
      { key: "_fcw_sheet_category_hierarchy", value: row.categoryHierarchy.map((category) => category.label) },
      { key: "_fcw_migration_warnings", value: [...categoryResolution.warnings, ...accessoryCrossSells.missing.map((item) => `Missing accessory cross-sell: ${item}`)] },
      { key: "custom_notes", value: customNotes ? "1" : "0" },
      { key: "product_accessories", value: rawAccessoriesJson },
      { key: "_fcw_accessory_cross_sell_ids", value: JSON.stringify(accessoryCrossSells.ids) },
      { key: "_fcw_accessory_cross_sell_names", value: JSON.stringify(accessoryCrossSells.linkedNames) },
      { key: "_fcw_accessory_cross_sell_skus", value: JSON.stringify(accessoryCrossSells.linkedSkus) },
      { key: "_fcw_accessory_cross_sell_missing_names", value: JSON.stringify(accessoryCrossSells.missing) },
      { key: "color_options", value: rawColourJson },
      { key: "legacy_colour_board_options", value: rawColourJson },
      { key: "_fcw_colour_board_image_options", value: JSON.stringify(colourBoardPayload.options) },
      { key: "_fcw_colour_board_acf_products_options", value: JSON.stringify(colourBoardPayload) },
      { key: "_fcw_colour_board_option_count", value: colourOptions.length },
      ...colourBoardPersonalizationMeta(colourOptions),
      ...specificationMeta(specificationGroups)
    ]
  };

  return {
    row,
    scraped,
    warnings: categoryResolution.warnings,
    changes
  };
}
