import "server-only";

import {
  buildColourBoardAcfPayload,
  colourBoardPersonalizationMeta,
  resolveAccessoryCrossSells,
  rowAccessories,
  rowColourOptions,
  sheetAccessoriesExpected,
  sheetColourBoardExpected,
  sheetCustomNotesExpected
} from "@/lib/product-sheet-create";
import type { SheetProductRow } from "@/lib/product-sheet";
import type { ProductChanges, WooProduct } from "@/lib/types";

export type ProductSheetFixField = "custom_notes" | "colour_board" | "accessories";

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

    return existingByName.get(normalizeText(name)) ?? item;
  });
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
  fields: ProductSheetFixField[]
) {
  const changes: ProductChanges = {};
  let metaData: NonNullable<ProductChanges["meta_data"]> = [];
  const warnings: string[] = [];

  if (fields.includes("custom_notes")) {
    metaData.push(metaEntry(product, "custom_notes", sheetCustomNotesExpected(row) ? "1" : "0"));
    const acfFieldKey = product.meta_data?.find((item) => item.key === "_custom_notes")?.value;

    if (acfFieldKey) {
      metaData.push(metaEntry(product, "_custom_notes", acfFieldKey));
    }
  }

  if (fields.includes("colour_board")) {
    const expectedOptions = rowColourOptions(row);

    if (sheetColourBoardExpected(row) && expectedOptions.length === 0) {
      throw new Error("The sheet expects a colour board, but its color details are empty or marked ERROR.");
    }

    const existingOptions = safeArray<ReturnType<typeof rowColourOptions>[number]>(
      metaValue(product, "legacy_colour_board_options") ?? metaValue(product, "color_options")
    );
    const options = preserveExistingByName(expectedOptions, existingOptions);
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
    const expectedAccessories = rowAccessories(row);

    if (sheetAccessoriesExpected(row) && expectedAccessories.length === 0) {
      throw new Error("The sheet expects accessories, but its accessories details are empty or marked ERROR.");
    }

    const existingAccessories = safeArray<ReturnType<typeof rowAccessories>[number]>(
      metaValue(product, "product_accessories")
    );
    const accessories = preserveExistingByName(expectedAccessories, existingAccessories);
    const crossSells = await resolveAccessoryCrossSells(accessories);

    changes.cross_sell_ids = crossSells.ids;
    metaData = mergeMeta(metaData, [
      metaEntry(product, "product_accessories", accessories.length > 0 ? JSON.stringify(accessories) : ""),
      metaEntry(product, "_fcw_accessory_cross_sell_ids", JSON.stringify(crossSells.ids)),
      metaEntry(product, "_fcw_accessory_cross_sell_names", JSON.stringify(crossSells.linkedNames)),
      metaEntry(product, "_fcw_accessory_cross_sell_skus", JSON.stringify(crossSells.linkedSkus)),
      metaEntry(product, "_fcw_accessory_cross_sell_missing_names", JSON.stringify(crossSells.missing))
    ]);
    warnings.push(...crossSells.missing.map((name) => `Accessory product not found: ${name}`));
  }

  if (metaData.length > 0) {
    changes.meta_data = metaData;
  }

  return { changes, warnings };
}
