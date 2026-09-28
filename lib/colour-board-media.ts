import "server-only";

import { COLOUR_BOARD_CHOICES } from "@/lib/colour-board-choices";
import type { ProductChanges, WooProduct } from "@/lib/types";
import { getAllProducts } from "@/lib/woocommerce";

type MetaEntry = NonNullable<ProductChanges["meta_data"]>[number];

type ColourBoardOption = {
  color_name?: string;
  swatch_image_url?: string;
  option_image_url?: string;
  price_adjustment?: string;
};

type WordPressMedia = {
  id?: number;
  source_url?: string;
};

let mediaLookupCache: Promise<Map<string, string>> | null = null;

function asString(value: unknown) {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function safeJsonParse(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function metaValue(meta: WooProduct["meta_data"] | undefined, key: string) {
  return meta?.find((item) => item.key === key)?.value;
}

function normalizedOptionName(option: ColourBoardOption) {
  return asString(option.color_name).trim().toLowerCase();
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);

    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function imageFileName(value: string) {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1)).toLowerCase();
  } catch {
    return "";
  }
}

async function findWordPressMediaId(imageUrl: string) {
  const storeUrl = process.env.WOOCOMMERCE_STORE_URL;
  const fileName = imageFileName(imageUrl);

  if (!storeUrl || !fileName) {
    return undefined;
  }

  const search = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");

  try {
    const url = new URL("/wp-json/wp/v2/media", storeUrl);
    url.searchParams.set("search", search);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("_fields", "id,source_url");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      return undefined;
    }

    const media = await response.json() as WordPressMedia[];
    const exact = media.find((item) => imageFileName(asString(item.source_url)) === fileName);

    return exact?.id ? String(exact.id) : undefined;
  } catch {
    return undefined;
  }
}

function optionKey(option: ColourBoardOption, imageUrl: string) {
  return [
    normalizedOptionName(option),
    asString(option.price_adjustment).trim(),
    normalizeUrl(imageUrl)
  ].join("|");
}

function optionNameKey(option: ColourBoardOption) {
  return `name:${normalizedOptionName(option)}`;
}

function optionNamePriceKey(option: ColourBoardOption) {
  return `name-price:${normalizedOptionName(option)}|${asString(option.price_adjustment).trim()}`;
}

function addMediaCandidate(candidates: Map<string, Map<string, number>>, key: string, imageId: string) {
  if (!key || key === "name:" || key === "name-price:|") {
    return;
  }

  const counts = candidates.get(key) ?? new Map<string, number>();

  counts.set(imageId, (counts.get(imageId) ?? 0) + 1);
  candidates.set(key, counts);
}

function addLookup(
  lookup: Map<string, string>,
  candidates: Map<string, Map<string, number>>,
  option: ColourBoardOption,
  image: unknown
) {
  const imageId = asString(image).trim();

  if (!/^\d+$/.test(imageId)) {
    return;
  }

  addMediaCandidate(candidates, optionNameKey(option), imageId);
  addMediaCandidate(candidates, optionNamePriceKey(option), imageId);

  for (const url of [option.option_image_url, option.swatch_image_url].map(asString).filter(Boolean)) {
    lookup.set(normalizeUrl(url), imageId);
    lookup.set(optionKey(option, url), imageId);
  }
}

function optionsFromProductPersonalizationMeta(metaData: WooProduct["meta_data"] | undefined) {
  const count = Number(metaValue(metaData, "personalization_0_image_items") ?? 0);
  const options: ColourBoardOption[] = [];

  for (let index = 0; index < count; index += 1) {
    const image = asString(metaValue(metaData, `personalization_0_image_items_${index}_image`)).trim();

    options.push({
      color_name: asString(metaValue(metaData, `personalization_0_image_items_${index}_name`)).trim(),
      price_adjustment: asString(metaValue(metaData, `personalization_0_image_items_${index}_additional_price`)).trim(),
      option_image_url: image,
      swatch_image_url: image
    });
  }

  return options.filter((option) => option.color_name || option.option_image_url);
}

function addCandidateLookups(lookup: Map<string, string>, candidates: Map<string, Map<string, number>>) {
  for (const [key, counts] of candidates) {
    const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    const best = sorted[0];

    if (best && !lookup.has(key)) {
      lookup.set(key, best[0]);
    }
  }
}

async function buildColourBoardMediaLookup() {
  const lookup = new Map<string, string>();
  const candidates = new Map<string, Map<string, number>>();
  const products = await getAllProducts({
    status: "any",
    fields: "id,meta_data"
  });

  for (const product of products) {
    const legacyOptions = safeJsonParse(metaValue(product.meta_data, "legacy_colour_board_options"));
    const fallbackOptions = safeJsonParse(metaValue(product.meta_data, "color_options"));
    const options = [
      ...(Array.isArray(legacyOptions) ? legacyOptions as ColourBoardOption[] : []),
      ...(Array.isArray(fallbackOptions) ? fallbackOptions as ColourBoardOption[] : [])
    ];

    for (const [index, option] of options.entries()) {
      addLookup(lookup, candidates, option, metaValue(product.meta_data, `personalization_0_image_items_${index}_image`));
    }

    for (const [index, option] of optionsFromProductPersonalizationMeta(product.meta_data).entries()) {
      addLookup(lookup, candidates, option, metaValue(product.meta_data, `personalization_0_image_items_${index}_image`));
    }
  }

  addCandidateLookups(lookup, candidates);

  const missingChoices = COLOUR_BOARD_CHOICES.filter(
    (choice) => !lookup.has(optionNamePriceKey(choice)) && !lookup.has(optionNameKey(choice))
  );

  for (const choice of missingChoices) {
    const imageUrl = choice.option_image_url || choice.swatch_image_url;
    const mediaId = await findWordPressMediaId(imageUrl);

    if (mediaId) {
      addLookup(lookup, candidates, choice, mediaId);
    }
  }

  addCandidateLookups(lookup, candidates);

  return lookup;
}

async function getColourBoardMediaLookup() {
  mediaLookupCache ??= buildColourBoardMediaLookup();
  return mediaLookupCache;
}

function changedMetaValue(metaData: MetaEntry[], key: string) {
  return metaData.find((item) => item.key === key)?.value;
}

function setChangedMetaValue(metaData: MetaEntry[], key: string, value: unknown) {
  const existing = metaData.find((item) => item.key === key);

  if (existing) {
    existing.value = value;
  }
}

function resolveImageValue(lookup: Map<string, string>, option: ColourBoardOption, imageValue: unknown) {
  const image = asString(imageValue).trim();

  if (/^\d+$/.test(image)) {
    return image;
  }

  return (
    (image ? lookup.get(optionKey(option, image)) : undefined) ??
    (image ? lookup.get(normalizeUrl(image)) : undefined) ??
    lookup.get(optionNamePriceKey(option)) ??
    lookup.get(optionNameKey(option)) ??
    image
  );
}

function updatePayloadImages(value: unknown, lookup: Map<string, string>, options: ColourBoardOption[]) {
  const parsed = safeJsonParse(value);

  if (!parsed) {
    return value;
  }

  const containers: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? [
          ...(((parsed as { options?: unknown[] }).options ?? []) as unknown[]),
          ...((((parsed as { products?: { options?: unknown[] } }).products?.options ?? []) as unknown[]))
        ]
      : [];

  for (const container of containers) {
    const items =
      typeof container === "object" && container !== null
        ? ((container as { image?: { items?: unknown[] } }).image?.items ?? [])
        : [];

    items.forEach((item, index) => {
      if (typeof item !== "object" || item === null) {
        return;
      }

      const record = item as { image?: unknown; _legacy_image_url?: string };
      const option = {
        color_name: asString((record as { name?: unknown }).name) || options[index]?.color_name,
        price_adjustment:
          asString((record as { additional_price?: unknown }).additional_price) || options[index]?.price_adjustment,
        option_image_url: options[index]?.option_image_url,
        swatch_image_url: options[index]?.swatch_image_url
      };
      const originalImage = asString(record.image);
      const resolved = resolveImageValue(lookup, option, originalImage);

      if (resolved !== originalImage) {
        record._legacy_image_url = originalImage;
        record.image = resolved;
      }
    });
  }

  return JSON.stringify(parsed);
}

function optionsFromPersonalizationMeta(metaData: MetaEntry[]) {
  const count = Number(changedMetaValue(metaData, "personalization_0_image_items") ?? 0);
  const options: ColourBoardOption[] = [];

  for (let index = 0; index < count; index += 1) {
    const image = asString(changedMetaValue(metaData, `personalization_0_image_items_${index}_image`)).trim();

    options.push({
      color_name: asString(changedMetaValue(metaData, `personalization_0_image_items_${index}_name`)).trim(),
      price_adjustment: asString(changedMetaValue(metaData, `personalization_0_image_items_${index}_additional_price`)).trim(),
      option_image_url: image,
      swatch_image_url: image
    });
  }

  return options.filter((option) => option.color_name || option.option_image_url);
}

export async function resolveColourBoardImagesInChanges(changes: ProductChanges) {
  const metaData = changes.meta_data;

  if (!metaData?.some((item) => item.key.startsWith("personalization_0_image_items_") || item.key.includes("colour_board"))) {
    return changes;
  }

  const rawOptions =
    safeJsonParse(changedMetaValue(metaData, "legacy_colour_board_options")) ??
    safeJsonParse(changedMetaValue(metaData, "color_options"));
  const options = Array.isArray(rawOptions)
    ? (rawOptions as ColourBoardOption[])
    : optionsFromPersonalizationMeta(metaData);

  if (options.length === 0) {
    return changes;
  }

  const lookup = await getColourBoardMediaLookup();

  options.forEach((option, index) => {
    const key = `personalization_0_image_items_${index}_image`;
    const image = changedMetaValue(metaData, key);
    const resolved = resolveImageValue(lookup, option, image);

    if (resolved !== asString(image).trim()) {
      setChangedMetaValue(metaData, key, resolved);
    }
  });

  for (const key of ["_fcw_colour_board_image_options", "_fcw_colour_board_acf_products_options"]) {
    const value = changedMetaValue(metaData, key);

    if (value !== undefined) {
      setChangedMetaValue(metaData, key, updatePayloadImages(value, lookup, options));
    }
  }

  return changes;
}
