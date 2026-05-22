import type { CategoryChanges, ProductChanges } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function hasMeaningfulChanges(changes: object) {
  return Object.keys(changes).length > 0;
}

export function compactProductChanges(input: unknown): ProductChanges {
  if (!isRecord(input)) {
    return {};
  }

  const changes: ProductChanges = {};
  const textFields = [
    "type",
    "name",
    "sku",
    "regular_price",
    "sale_price",
    "status",
    "catalog_visibility",
    "short_description",
    "description",
    "weight",
    "shipping_class",
    "purchase_note"
  ] as const;

  for (const field of textFields) {
    const value = asString(input[field]);
    if (value !== undefined) {
      changes[field] = value;
    }
  }

  const featured = asBoolean(input.featured);
  if (featured !== undefined) {
    changes.featured = featured;
  }

  const manageStock = asBoolean(input.manage_stock);
  if (manageStock !== undefined) {
    changes.manage_stock = manageStock;
  }

  const stockQuantity = input.stock_quantity === null ? null : asNumber(input.stock_quantity);
  if (stockQuantity !== undefined || input.stock_quantity === null) {
    changes.stock_quantity = stockQuantity;
  }

  if (
    input.stock_status === "instock" ||
    input.stock_status === "outofstock" ||
    input.stock_status === "onbackorder"
  ) {
    changes.stock_status = input.stock_status;
  }

  if (Array.isArray(input.categories)) {
    changes.categories = input.categories
      .map((category) => (isRecord(category) ? asNumber(category.id) : asNumber(category)))
      .filter((id): id is number => id !== undefined)
      .map((id) => ({ id }));
  }

  if (Array.isArray(input.cross_sell_ids)) {
    changes.cross_sell_ids = input.cross_sell_ids
      .map((id) => asNumber(id))
      .filter((id): id is number => id !== undefined);
  }

  if (Array.isArray(input.images)) {
    changes.images = input.images
      .filter(isRecord)
      .map((image) => ({
        id: asNumber(image.id),
        src: asString(image.src),
        alt: asString(image.alt)
      }))
      .filter((image) => image.id !== undefined || image.src);
  }

  if (Array.isArray(input.tags)) {
    changes.tags = input.tags
      .map((tag) => (isRecord(tag) ? asNumber(tag.id) : asNumber(tag)))
      .filter((id): id is number => id !== undefined)
      .map((id) => ({ id }));
  }

  if (Array.isArray(input.attributes)) {
    changes.attributes = input.attributes.filter(isRecord) as ProductChanges["attributes"];
  }

  if (Array.isArray(input.meta_data)) {
    changes.meta_data = input.meta_data.filter(isRecord) as ProductChanges["meta_data"];
  }

  if (isRecord(input.dimensions)) {
    changes.dimensions = {
      length: asString(input.dimensions.length),
      width: asString(input.dimensions.width),
      height: asString(input.dimensions.height)
    };
  }

  const menuOrder = asNumber(input.menu_order);
  if (menuOrder !== undefined) {
    changes.menu_order = menuOrder;
  }

  return changes;
}

export function compactCategoryChanges(input: unknown): CategoryChanges {
  if (!isRecord(input)) {
    return {};
  }

  const changes: CategoryChanges = {};

  for (const field of ["name", "slug", "description", "display"] as const) {
    const value = asString(input[field]);
    if (value !== undefined) {
      changes[field] = value;
    }
  }

  const parent = asNumber(input.parent);
  if (parent !== undefined) {
    changes.parent = parent;
  }

  if (input.image === null) {
    changes.image = null;
  } else if (isRecord(input.image)) {
    changes.image = {
      id: asNumber(input.image.id),
      src: asString(input.image.src),
      alt: asString(input.image.alt)
    };
  }

  return changes;
}
