import "server-only";

import {
  buildColourBoardAcfPayload,
  colourBoardPersonalizationMeta,
  mergeProductAccessories,
  mergeProductColourOptions,
  resolveAccessoryCrossSells,
  rowAccessories,
  rowColourOptions,
  sheetAccessoriesExpected,
  sheetColourBoardExpected,
  sheetCustomNotesExpected,
  sheetSpecificationGroups,
  sheetSpecificationsExpected,
  scrapeProductColourOptions,
  scrapeProductAccessories,
  specificationMeta
} from "@/lib/product-sheet-create";
import type { SheetProductRow } from "@/lib/product-sheet";
import type { ProductChanges, WooProduct } from "@/lib/types";

export type ProductSheetFixField = "custom_notes" | "colour_board" | "accessories" | "specifications";

export type ProductSheetFixOverrides = {
  customNotesExpected?: boolean;
  colourBoardExpected?: boolean;
  accessoriesExpected?: boolean;
  accessoryNames?: string[];
  colourNames?: string[];
  accessoriesExpectedCount?: number;
  colourBoardExpectedCount?: number;
};

function metaEntry(product: WooProduct, key: string, value: unknown) {
  const existing = product.meta_data?.find((item) => item.key === key);

  return {
    ...(existing?.id ? { id: existing.id } : {}),
    key,
    value
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function metaValue(product: WooProduct, key: string) {
  return product.meta_data?.find((item) => item.key === key)?.value;
}

function safeArray<T>(value: unknown) {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function preserveExistingByName<T extends { name?: string; color_name?: string }>(
  expected: T[],
  existing: T[]
) {
  const existingByName = new Map(
    existing.map((item) => [normalizeText(String(item.color_name ?? item.name ?? "")), item])
  );

  return expected.map((item) => {
    const name = String(item.color_name ?? item.name ?? "");

    const current = existingByName.get(normalizeText(name));

    return current ? { ...current, ...item } : item;
  });
}

function mergeExistingColourOptions<T extends { color_name?: string }>(expected: T[], existing: T[]) {
  const existingByName = new Map(
    existing.map((item) => [normalizeText(String(item.color_name ?? "")), item])
  );

  return expected.map((item) => {
    const current = existingByName.get(normalizeText(String(item.color_name ?? "")));

    return current ? { ...current, ...item } : item;
  });
}

function uniqueByName<T>(items: T[], name: (item: T) => string) {
  return [...new Map(
    items
      .filter((item) => name(item).trim())
      .map((item) => [normalizeText(name(item)), item])
  ).values()];
}

function combineByName<T>(
  first: T[],
  second: T[],
  name: (item: T) => string
) {
  const combined = new Map<string, T>();

  for (const item of first) {
    const key = normalizeText(name(item));
    if (key) combined.set(key, item);
  }

  for (const item of second) {
    const key = normalizeText(name(item));
    if (!key) continue;
    const existing = combined.get(key);
    combined.set(key, existing ? { ...existing, ...item } : item);
  }

  return [...combined.values()];
}

function selectExpectedItemsByCount<T>(
  sheetItems: T[],
  scrapedItems: T[],
  expectedCount: number,
  name: (item: T) => string
) {
  const sheetByName = new Map(
    sheetItems.map((item) => [normalizeText(name(item)), item])
  );
  const scrapedByName = new Map(
    scrapedItems.map((item) => [normalizeText(name(item)), item])
  );

  // A source with the exact QA count defines membership. This prevents naming
  // differences between the sheet and live page from creating duplicate options.
  if (sheetItems.length === expectedCount) {
    return sheetItems.map((item) => {
      const scrapedItem = scrapedByName.get(normalizeText(name(item)));
      return scrapedItem ? { ...item, ...scrapedItem } : item;
    });
  }

  if (scrapedItems.length === expectedCount) {
    return scrapedItems.map((item) => {
      const sheetItem = sheetByName.get(normalizeText(name(item)));
      return sheetItem ? { ...sheetItem, ...item } : item;
    });
  }

  return combineByName(sheetItems, scrapedItems, name);
}

function mergeMeta(
  current: NonNullable<ProductChanges["meta_data"]>,
  incoming: NonNullable<ProductChanges["meta_data"]>
) {
  const byKey = new Map(current.map((item) => [item.key, item]));

  for (const item of incoming) {
    byKey.set(item.key, item);
  }

  return [...byKey.values()];
}

export async function buildProductSheetFix(
  row: SheetProductRow,
  product: WooProduct,
  fields: ProductSheetFixField[],
  overrides: ProductSheetFixOverrides = {}
) {
  const changes: ProductChanges = {};
  let metaData: NonNullable<ProductChanges["meta_data"]> = [];
  const warnings: string[] = [];

  if (fields.includes("custom_notes")) {
    const expected = overrides.customNotesExpected ?? sheetCustomNotesExpected(row);
    metaData.push(metaEntry(product, "custom_notes", expected ? "1" : "0"));
    const acfFieldKey = product.meta_data?.find((item) => item.key === "_custom_notes")?.value;

    if (acfFieldKey) {
      metaData.push(metaEntry(product, "_custom_notes", acfFieldKey));
    }
  }

  if (fields.includes("colour_board")) {
    const expected = overrides.colourBoardExpected ?? sheetColourBoardExpected(row);
    const sheetOptions = expected
      ? uniqueByName([
          ...rowColourOptions(row),
          ...(overrides.colourNames ?? []).map((name) => ({
            option_group: "Personalise this item with coloured board",
            color_name: name,
            price_adjustment: "",
            default_option: false
          }))
        ], (option) => String(option.color_name ?? ""))
      : [];
    let scrapedOptions: Awaited<ReturnType<typeof scrapeProductColourOptions>> = [];

    if (expected && row.liveUrl) {
      try {
        scrapedOptions = await scrapeProductColourOptions(row.liveUrl);
      } catch (error) {
        warnings.push(
          `Could not read live colour-board prices; fallback values will be used: ${
            error instanceof Error ? error.message : "unknown scrape error"
          }`
        );
      }
    }

    const expectedOptions = expected
      ? overrides.colourBoardExpectedCount !== undefined
        ? selectExpectedItemsByCount(
            sheetOptions,
            scrapedOptions,
            overrides.colourBoardExpectedCount,
            (option) => String(option.color_name ?? "")
          )
        : mergeProductColourOptions(sheetOptions, scrapedOptions)
      : [];

    if (expected && expectedOptions.length === 0) {
      throw new Error("The sheet expects a colour board, but no colour options could be read from the sheet or product link.");
    }

    const existingOptions = safeArray<ReturnType<typeof rowColourOptions>[number]>(
      metaValue(product, "legacy_colour_board_options") ?? metaValue(product, "color_options")
    );
    const options = mergeExistingColourOptions(expectedOptions, existingOptions);
    const rawJson = options.length > 0 ? JSON.stringify(options) : "";
    const payload = buildColourBoardAcfPayload(options);

    metaData = mergeMeta(metaData, [
      { key: "color_options", value: rawJson },
      { key: "legacy_colour_board_options", value: rawJson },
      { key: "_fcw_colour_board_image_options", value: JSON.stringify(payload.options) },
      { key: "_fcw_colour_board_acf_products_options", value: JSON.stringify(payload) },
      { key: "_fcw_colour_board_option_count", value: options.length },
      ...colourBoardPersonalizationMeta(options)
    ].map((item) => metaEntry(product, item.key, item.value)));
  }

  if (fields.includes("accessories")) {
    const expected = overrides.accessoriesExpected ?? sheetAccessoriesExpected(row);
    const sheetAccessories = expected
      ? uniqueByName([
          ...rowAccessories(row),
          ...(overrides.accessoryNames ?? []).map((name) => ({
            name,
            relationship_type: "recommended",
            option_group: "Frequently bought with these accessories"
          }))
        ], (accessory) => String(accessory.name ?? ""))
      : [];
    let scrapedAccessories: Awaited<ReturnType<typeof scrapeProductAccessories>> = [];

    if (expected && row.liveUrl) {
      try {
        scrapedAccessories = await scrapeProductAccessories(row.liveUrl);
      } catch (error) {
        warnings.push(
          `Could not read accessories from the product link: ${
            error instanceof Error ? error.message : "unknown scrape error"
          }`
        );
      }
    }

    const expectedAccessories = expected
      ? overrides.accessoriesExpectedCount !== undefined
        ? selectExpectedItemsByCount(
            sheetAccessories,
            scrapedAccessories,
            overrides.accessoriesExpectedCount,
            (accessory) => String(accessory.name ?? "")
          )
        : mergeProductAccessories(sheetAccessories, scrapedAccessories)
      : [];

    if (expected && expectedAccessories.length === 0) {
      throw new Error(
        row.liveUrl
          ? "The sheet expects accessories, but no accessory products could be read from its product -link."
          : 'The sheet expects accessories, but its details are empty and the row has no "product -link" to scrape.'
      );
    }

    const existingAccessories = safeArray<ReturnType<typeof rowAccessories>[number]>(
      metaValue(product, "product_accessories")
    );
    const accessories = preserveExistingByName(expectedAccessories, existingAccessories);
    const crossSells = await resolveAccessoryCrossSells(accessories, {
      excludeProductId: product.id
    });

    changes.cross_sell_ids = crossSells.ids;
    metaData = mergeMeta(metaData, [
      metaEntry(product, "product_accessories", accessories.length > 0 ? JSON.stringify(accessories) : ""),
      metaEntry(product, "_fcw_accessory_cross_sell_ids", JSON.stringify(crossSells.ids)),
      metaEntry(product, "_fcw_accessory_cross_sell_names", JSON.stringify(crossSells.linkedNames)),
      metaEntry(product, "_fcw_accessory_cross_sell_skus", JSON.stringify(crossSells.linkedSkus)),
      metaEntry(product, "_fcw_accessory_cross_sell_missing_names", JSON.stringify(crossSells.missing))
    ]);
    warnings.push(
      ...crossSells.missing.map(
        (name) => `Accessory is not in WooCommerce; approval will create it from Product list: ${name}`
      )
    );
  }

  if (fields.includes("specifications")) {
    const groups = sheetSpecificationGroups(row);

    if (sheetSpecificationsExpected(row) && groups.length === 0) {
      throw new Error("The sheet expects specifications, but its Feature value is empty or invalid.");
    }

    metaData = mergeMeta(
      metaData,
      specificationMeta(groups).map((item) => metaEntry(product, item.key, item.value))
    );
  }

  if (metaData.length > 0) {
    changes.meta_data = metaData;
  }

  return { changes, warnings };
}
