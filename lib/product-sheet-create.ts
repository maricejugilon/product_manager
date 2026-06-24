import "server-only";

import { COLOUR_BOARD_CHOICES } from "@/lib/colour-board-choices";
import { getProductSheetRow, type SheetCategoryHierarchy, type SheetProductRow } from "@/lib/product-sheet";
import type { ProductChanges, WooCategory } from "@/lib/types";
import { getCategories, getProducts } from "@/lib/woocommerce";

type ScrapedProductData = {
  url: string;
  title: string;
  descriptionHtml: string;
  descriptionText: string;
  sku: string;
  price: string;
  stockStatus?: ProductChanges["stock_status"];
  images: string[];
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

type SpecificationGroup = {
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
  const normalizedAliases = new Set(aliases.map(normalizeText));
  const match = Object.entries(values).find(([key]) => normalizedAliases.has(normalizeText(key)));

  return match?.[1]?.trim() ?? "";
}

function findValue(values: Record<string, string>, includes: string[]) {
  const match = Object.entries(values).find(([key]) => {
    const normalized = normalizeText(key);

    return includes.every((item) => normalized.includes(item));
  });

  return match?.[1]?.trim() ?? "";
}

function sheetField(row: SheetProductRow, aliases: string[]) {
  return fieldValue(row.values, aliases) || aliases.map((alias) => findValue(row.values, alias.split(/\s+/))).find(Boolean) || "";
}

function exactSheetField(row: SheetProductRow, header: string) {
  return Object.entries(row.values).find(([key]) => key.trim() === header)?.[1]?.trim() ?? "";
}

function isYes(value: string) {
  return ["1", "yes", "true", "on"].includes(normalizeText(value));
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

function statusFromAvailability(value: string): ProductChanges["stock_status"] | undefined {
  const normalized = normalizeText(value);

  if (normalized.includes("instock") || normalized.includes("in stock")) {
    return "instock";
  }

  if (normalized.includes("outofstock") || normalized.includes("out of stock")) {
    return "outofstock";
  }

  if (normalized.includes("backorder")) {
    return "onbackorder";
  }

  return undefined;
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value.replace(/\\/g, "/"), baseUrl).toString();
  } catch {
    return "";
  }
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

export async function scrapeLiveProduct(url: string): Promise<ScrapedProductData> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "FCW Product Sheet Validator"
    }
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Live URL scrape failed: ${response.status}`);
  }

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
  const price = parseMoney(String(offers.price ?? ""));
  const stockStatus = statusFromAvailability(String(offers.availability ?? ""));
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
    stockStatus,
    images: [...new Set(images)]
  };
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

function pathsMatch(first: string[], second: string[]) {
  return (
    first.length === second.length &&
    first.every((item, index) => normalizeText(item) === normalizeText(second[index] ?? ""))
  );
}

function resolveCategory(categories: WooCategory[], hierarchy: SheetCategoryHierarchy) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const exact = categories.find((category) => pathsMatch(categoryPath(category, categoryById), hierarchy.path));

  if (exact) {
    return exact;
  }

  const leaf = hierarchy.path[hierarchy.path.length - 1];
  const leafMatches = categories.filter((category) => normalizeText(category.name) === normalizeText(leaf));

  return leafMatches.length === 1 ? leafMatches[0] : undefined;
}

function resolveCategories(row: SheetProductRow, categories: WooCategory[]): CategoryResolution {
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

function sheetPrice(row: SheetProductRow) {
  return parseMoney(
    fieldValue(row.values, ["price", "regular price", "sale price", "live price"]) ||
      findValue(row.values, ["price"])
  );
}

export function sheetCustomNotesExpected(row: SheetProductRow) {
  return isYes(exactSheetField(row, "custom notes"));
}

export function sheetColourBoardExpected(row: SheetProductRow) {
  return isYes(exactSheetField(row, "Color"));
}

export function sheetAccessoriesExpected(row: SheetProductRow) {
  return isYes(exactSheetField(row, "Accessories"));
}

export function rowAccessories(row: SheetProductRow) {
  const json = safeJsonParse<AccessoryItem>(
    sheetField(row, ["meta:product_accessories", "product_accessories", "product accessories"])
  ).filter((item) => item && typeof item === "object");

  if (json.length > 0) {
    return json;
  }

  return pipeValues(exactSheetField(row, "accessories"))
    .filter((name) => !/^(?:error|no accessories)$/i.test(name))
    .filter((name) => normalizeText(name) !== normalizeText(row.name))
    .map((name) => ({
      name,
      relationship_type: "recommended",
      option_group: "Frequently bought with these accessories"
    }));
}

export function rowColourOptions(row: SheetProductRow) {
  const json = safeJsonParse<ColourBoardOption>(
    sheetField(row, ["meta:legacy_colour_board_options", "legacy_colour_board_options", "meta:color_options", "color_options"])
  ).filter((item) => item && typeof item === "object");

  if (json.length > 0) {
    return json;
  }

  const choicesByName = new Map(
    COLOUR_BOARD_CHOICES.map((choice) => [normalizeText(choice.color_name), choice])
  );

  return pipeValues(exactSheetField(row, "color"))
    .filter((name) => !/^(?:error|no colou?r option)$/i.test(name))
    .map((name) => {
      const choice = choicesByName.get(normalizeText(name));

      return choice
        ? {
            option_group: choice.option_group,
            color_name: choice.color_name,
            color_hex: choice.color_hex,
            swatch_image_url: choice.swatch_image_url,
            option_image_url: choice.option_image_url,
            price_adjustment: choice.price_adjustment,
            default_option: choice.default_option,
            notes: choice.notes
          }
        : {
            option_group: "Personalise this item with coloured board",
            color_name: name,
            price_adjustment: "0",
            default_option: false
          };
    });
}

async function findAccessoryProduct(accessory: AccessoryItem) {
  const name = String(accessory.name ?? "").trim();
  const sku = String(accessory.sku ?? "").trim();

  if (name) {
    const result = await getProducts({ search: name, perPage: 10, status: "any" });
    const exact = result.data.find((product) => normalizeText(product.name) === normalizeText(name));

    if (exact) {
      return { product: exact, matchedBySku: false };
    }

    if (result.data.length === 1) {
      return { product: result.data[0], matchedBySku: false };
    }
  }

  if (sku) {
    const result = await getProducts({ sku, perPage: 10, status: "any" });
    const exact = result.data.find((product) => normalizeText(product.sku) === normalizeText(sku));

    if (exact) {
      return { product: exact, matchedBySku: true };
    }

    if (result.data.length === 1) {
      return { product: result.data[0], matchedBySku: true };
    }
  }

  return undefined;
}

export async function resolveAccessoryCrossSells(accessories: AccessoryItem[]) {
  const ids: number[] = [];
  const linkedNames: string[] = [];
  const linkedSkus: string[] = [];
  const missing: string[] = [];

  for (const accessory of accessories) {
    const name = String(accessory.name ?? "").trim();
    const sku = String(accessory.sku ?? "").trim();

    if (!name && !sku) {
      continue;
    }

    const match = await findAccessoryProduct(accessory);

    if (match?.product) {
      ids.push(match.product.id);
      if (name) {
        linkedNames.push(name);
      }
      if (match.matchedBySku && sku) {
        linkedSkus.push(sku);
      }
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

function specificationMeta(groups: SpecificationGroup[]) {
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

export async function buildProductCreateDraft(rowNumber: number) {
  const row = await getProductSheetRow(rowNumber);

  if (!row) {
    throw new Error("Sheet row was not found.");
  }

  if (!row.liveUrl) {
    throw new Error("This sheet row does not have a Live URL to scrape.");
  }

  const [scraped, categories] = await Promise.all([scrapeLiveProduct(row.liveUrl), getCategories()]);
  const categoryResolution = resolveCategories(row, categories);
  const accessories = rowAccessories(row);
  const colourOptions = rowColourOptions(row);
  const colourBoardPayload = buildColourBoardAcfPayload(colourOptions);
  const accessoryCrossSells = await resolveAccessoryCrossSells(accessories);
  const specificationGroups = buildSpecificationGroups(scraped.descriptionHtml);
  const productName = row.name || scraped.title;
  const regularPrice = sheetPrice(row) || scraped.price;
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
    short_description: scraped.descriptionText.slice(0, 300),
    description: scraped.descriptionHtml,
    meta_data: [
      { key: "_fcw_source", value: "product_sheet_validator" },
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
