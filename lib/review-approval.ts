import "server-only";

import { revalidateTag } from "next/cache";

import { resolveColourBoardImagesInChanges } from "@/lib/colour-board-media";
import {
  getProductSheetRows,
  getUpdatedListRows,
  parseProductSheetSource,
  type SheetProductRow
} from "@/lib/product-sheet";
import {
  buildProductCreateDraft,
  normalizeAccessoryName,
  normalizeAccessorySku,
  normalizeAccessoryUrl,
  resolveAccessoryCrossSells,
  rowAccessories,
  sheetAccessoriesExpected,
  scrapeProductAccessories,
  type AccessoryItem
} from "@/lib/product-sheet-create";
import { buildProductSheetFix } from "@/lib/product-sheet-fix";
import { deleteReview, listReviews, patchReview } from "@/lib/review-store";
import type {
  CategoryChanges,
  CategoryMergeChanges,
  ProductChanges,
  ProductMergeChanges,
  ReviewRecord,
  WooCategory,
  WooProduct
} from "@/lib/types";
import {
  createCategory,
  createProduct,
  deleteCategory,
  ensureProductAttributeTerms,
  getCategories,
  getProduct,
  getProducts,
  mergeCategoryIntoTarget,
  mergeProductIntoTarget,
  updateCategory,
  updateProduct
} from "@/lib/woocommerce";

export type ApproveAllResult = {
  total: number;
  approved: number;
  failed: number;
  results: Array<{
    id: string;
    title: string;
    status: ReviewRecord["status"];
    error?: string;
  }>;
};

type ProductReviewBefore = {
  source?: string;
  sheetSource?: string;
  row?: SheetProductRow;
  fields?: string[];
  attributeConfig?: {
    make?: { id?: number };
    model?: { id?: number };
  };
  expected?: {
    make?: string[];
    model?: string[];
  };
};

function mergeProductChanges(current: ProductChanges, incoming: ProductChanges) {
  const metaData = new Map(
    (current.meta_data ?? []).map((item) => [item.key, item])
  );

  for (const item of incoming.meta_data ?? []) {
    metaData.set(item.key, item);
  }

  return {
    ...current,
    ...incoming,
    ...(metaData.size > 0 ? { meta_data: [...metaData.values()] } : {})
  };
}

function safeProductImages(changes: ProductChanges) {
  const images = (changes.images ?? []).filter((image) => {
    if (!image.src) {
      return Boolean(image.id);
    }

    try {
      const url = new URL(image.src);
      return /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname);
    } catch {
      return false;
    }
  });

  return images.length > 0 ? images : undefined;
}

async function createOrUpdateProduct(changes: ProductChanges) {
  const resolvedChanges = await resolveColourBoardImagesInChanges(changes);
  const safeChanges: ProductChanges = {
    ...resolvedChanges,
    images: safeProductImages(resolvedChanges)
  };
  const sku = safeChanges.sku?.trim();

  if (sku) {
    const existingProducts = await getProducts({ sku, status: "any", perPage: 10 });
    const normalizedSku = normalizeAccessorySku(sku);
    const exactSkuMatches = existingProducts.data.filter(
      (product) => normalizeAccessorySku(product.sku) === normalizedSku
    );

    if (exactSkuMatches.length === 1) {
      return updateProduct(exactSkuMatches[0].id, safeChanges);
    }

    if (exactSkuMatches.length > 1) {
      throw new Error(
        `More than one WooCommerce product uses SKU ${sku}. Resolve the duplicate SKUs before retrying this review.`
      );
    }
  }

  return createProduct(safeChanges);
}

function accessoryLabel(accessory: AccessoryItem) {
  return String(accessory.name || accessory.sku || accessory.url || "Unnamed accessory").trim();
}

function sourceProductIdFromUrl(value: string) {
  try {
    const item = new URL(value).searchParams.get("item") ?? "";
    return item.match(/-(\d+)-\d+$/)?.[1] ?? "";
  } catch {
    return "";
  }
}

function uniqueAccessorySheetRow(
  accessory: AccessoryItem,
  rows: SheetProductRow[],
  parentRowNumber: number
) {
  const candidates = rows.filter((row) => row.rowNumber !== parentRowNumber);
  const strategies = [
    {
      value: normalizeAccessorySku(String(accessory.sku ?? "")),
      matches: (row: SheetProductRow) => normalizeAccessorySku(row.sku) === normalizeAccessorySku(String(accessory.sku ?? ""))
    },
    {
      value: normalizeAccessoryUrl(String(accessory.url ?? "")),
      matches: (row: SheetProductRow) => normalizeAccessoryUrl(row.liveUrl) === normalizeAccessoryUrl(String(accessory.url ?? ""))
    },
    {
      value: normalizeAccessoryName(String(accessory.name ?? "")),
      matches: (row: SheetProductRow) => normalizeAccessoryName(row.name) === normalizeAccessoryName(String(accessory.name ?? ""))
    }
  ];

  for (const strategy of strategies) {
    if (!strategy.value) {
      continue;
    }

    const matches = candidates.filter(strategy.matches);
    const usableMatches = matches.filter((row) => row.liveUrl);

    if (usableMatches.length === 1) {
      return usableMatches[0];
    }

    if (usableMatches.length > 1) {
      const identities = new Set(
        usableMatches.map((row) =>
          normalizeAccessorySku(row.sku) || sourceProductIdFromUrl(row.liveUrl) || normalizeAccessoryUrl(row.liveUrl)
        )
      );

      if (identities.size === 1) {
        return usableMatches[0];
      }

      throw new Error(
        `Accessory ${accessoryLabel(accessory)} matches more than one Product list row. Give it a unique SKU or product-link before retrying.`
      );
    }

    if (matches.length === 1) {
      throw new Error(
        `Accessory ${accessoryLabel(accessory)} has a Product list row but no product-link to scrape.`
      );
    }
  }

  return undefined;
}

function accessoriesRootCategory(categories: WooCategory[]) {
  const acceptedNames = new Set(["accessories spare", "accessories spares"]);
  return categories.find(
    (category) => category.parent === 0 && acceptedNames.has(normalizeAccessoryName(category.name))
  );
}

function scrapedAccessoryChanges(
  accessory: AccessoryItem,
  categories: WooCategory[],
  parentUrl: string
): ProductChanges {
  const category = accessoriesRootCategory(categories);

  if (!category) {
    throw new Error(
      "WooCommerce does not have an Accessories & Spares root category. The accessory was not created to prevent Uncategorized assignment."
    );
  }

  const name = String(accessory.name ?? "").trim();
  const price = String(accessory.price ?? "").trim();
  const imageUrl = String(accessory.image_url ?? "").trim();

  return {
    type: "simple",
    name,
    status: "publish",
    catalog_visibility: "visible",
    ...(price ? { regular_price: price } : {}),
    stock_status: "instock",
    manage_stock: false,
    categories: [{ id: category.id }],
    ...(imageUrl ? { images: [{ src: imageUrl, alt: name }] } : {}),
    meta_data: [
      { key: "_fcw_source", value: "updated_list_accessory_scrape" },
      { key: "_fcw_accessory_source_parent_url", value: parentUrl },
      { key: "_fcw_source_accessory_id", value: accessory.source_product_id ?? "" },
      { key: "_fcw_source_accessory_section_id", value: accessory.source_section_id ?? "" },
      { key: "_fcw_source_accessory_section_type", value: accessory.source_section_type ?? "" }
    ]
  };
}

function setProductMetaValues(
  changes: ProductChanges,
  values: Array<{ key: string; value: unknown }>
) {
  const byKey = new Map((changes.meta_data ?? []).map((item) => [item.key, item]));

  for (const value of values) {
    const existing = byKey.get(value.key);
    byKey.set(value.key, { ...(existing?.id ? { id: existing.id } : {}), ...value });
  }

  return { ...changes, meta_data: [...byKey.values()] };
}

function accessoriesFromChanges(changes: ProductChanges) {
  const value = changes.meta_data?.find((item) => item.key === "product_accessories")?.value;

  if (Array.isArray(value)) {
    return value as AccessoryItem[];
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AccessoryItem[]) : [];
  } catch {
    return [];
  }
}

async function resolveReviewAccessories(
  review: ReviewRecord,
  changes: ProductChanges
): Promise<ProductChanges> {
  const before = review.before as ProductReviewBefore | null;
  const row = before?.row;
  const hasAccessoryPayload = before?.fields?.includes("accessories") ||
    changes.meta_data?.some((item) => item.key === "product_accessories");

  if (!row?.values || !hasAccessoryPayload) {
    return changes;
  }

  const payloadAccessories = accessoriesFromChanges(changes);
  let accessories = payloadAccessories.length > 0 ? payloadAccessories : rowAccessories(row);

  if (accessories.length === 0 && sheetAccessoriesExpected(row) && row.liveUrl) {
    accessories = await scrapeProductAccessories(row.liveUrl);
  }

  if (accessories.length === 0) {
    return changes;
  }

  const source = parseProductSheetSource(before?.sheetSource);
  const sheetRows = source === "updated-list" ? await getUpdatedListRows() : await getProductSheetRows();
  const linkedIds: number[] = [];
  const linkedNames: string[] = [];
  const linkedSkus: string[] = [];
  const pendingCreates: Array<{
    accessory: AccessoryItem;
    row?: SheetProductRow;
    scraped?: AccessoryItem;
  }> = [];

  for (const accessory of accessories) {
    const match = await resolveAccessoryCrossSells([accessory], {
      excludeProductId: review.resourceId
    });

    if (match.ids.length > 0) {
      linkedIds.push(...match.ids);
      linkedNames.push(...match.linkedNames);
      linkedSkus.push(...match.linkedSkus);
      continue;
    }

    pendingCreates.push({ accessory, row: uniqueAccessorySheetRow(accessory, sheetRows, row.rowNumber) });
  }

  if (pendingCreates.length > 0) {
    const missingSheetRows = pendingCreates.filter((pending) => !pending.row);

    if (missingSheetRows.length > 0) {
      if (!row.liveUrl) {
        throw new Error(
          `The parent Product list row has no product-link to scrape missing accessories: ${missingSheetRows.map((pending) => accessoryLabel(pending.accessory)).join(", ")}`
        );
      }

      const scrapedAccessories = await scrapeProductAccessories(row.liveUrl);

      for (const pending of missingSheetRows) {
        const normalizedName = normalizeAccessoryName(String(pending.accessory.name ?? ""));
        const matches = scrapedAccessories.filter(
          (accessory) => normalizeAccessoryName(String(accessory.name ?? "")) === normalizedName
        );

        if (matches.length !== 1) {
          throw new Error(
            `Accessory ${accessoryLabel(pending.accessory)} has no unique Product list row and could not be uniquely scraped from the parent product-link.`
          );
        }

        pending.scraped = matches[0];
      }
    }

    const categories = await getCategories();

    for (const pending of pendingCreates) {
      const productChanges = pending.row
        ? (await buildProductCreateDraft(pending.row.rowNumber, source, {
            row: pending.row,
            categories
          })).changes
        : scrapedAccessoryChanges(pending.scraped!, categories, row.liveUrl);
      const product: WooProduct = await createOrUpdateProduct(productChanges);

      if (product.id === review.resourceId) {
        throw new Error(`Accessory ${accessoryLabel(pending.accessory)} resolves to the parent product itself.`);
      }

      linkedIds.push(product.id);
      linkedNames.push(String(pending.accessory.name || product.name).trim());
      if (pending.accessory.sku || product.sku) {
        linkedSkus.push(String(pending.accessory.sku || product.sku).trim());
      }
    }
  }

  const uniqueIds = [...new Set(linkedIds)];
  const uniqueNames = [...new Set(linkedNames.filter(Boolean))];
  const uniqueSkus = [...new Set(linkedSkus.filter(Boolean))];
  const migrationWarnings = changes.meta_data?.find((item) => item.key === "_fcw_migration_warnings")?.value;
  const remainingWarnings = Array.isArray(migrationWarnings)
    ? migrationWarnings.filter((warning) => !String(warning).startsWith("Missing accessory cross-sell:"))
    : migrationWarnings;

  return setProductMetaValues(
    { ...changes, cross_sell_ids: uniqueIds },
    [
      { key: "product_accessories", value: JSON.stringify(accessories) },
      { key: "_fcw_accessory_cross_sell_ids", value: JSON.stringify(uniqueIds) },
      { key: "_fcw_accessory_cross_sell_names", value: JSON.stringify(uniqueNames) },
      { key: "_fcw_accessory_cross_sell_skus", value: JSON.stringify(uniqueSkus) },
      { key: "_fcw_accessory_cross_sell_missing_names", value: "[]" },
      ...(remainingWarnings !== undefined
        ? [{ key: "_fcw_migration_warnings", value: remainingWarnings }]
        : [])
    ]
  );
}

async function publishReview(review: ReviewRecord) {
  if (review.resource === "product" && review.action === "update" && review.resourceId) {
    const before = review.before as ProductReviewBefore | null;

    if (before?.source === "make_model_sheet") {
      const makeAttributeId = Number(before.attributeConfig?.make?.id);
      const modelAttributeId = Number(before.attributeConfig?.model?.id);

      if (!Number.isInteger(makeAttributeId) || !Number.isInteger(modelAttributeId)) {
        throw new Error("Make and Model attribute configuration is missing from this review.");
      }

      await ensureProductAttributeTerms(makeAttributeId, before.expected?.make ?? []);
      await ensureProductAttributeTerms(modelAttributeId, before.expected?.model ?? []);
    }

    let sourceChanges = review.changes as ProductChanges;

    if (
      before?.source === "product_sheet_validator_fix" &&
      before.fields?.includes("colour_board") &&
      before.row
    ) {
      const product = await getProduct(review.resourceId);
      const refreshed = await buildProductSheetFix(before.row, product, ["colour_board"]);
      sourceChanges = mergeProductChanges(sourceChanges, refreshed.changes);
    }

    let changes = await resolveColourBoardImagesInChanges(sourceChanges);
    changes = await resolveReviewAccessories(review, changes);

    if (
      before?.source === "product_sheet_validator_fix" &&
      before.fields?.includes("accessories") &&
      !changes.cross_sell_ids?.length
    ) {
      throw new Error(
        "No accessory products could be matched or created from Product list. Check the accessory names and product-link fields, then retry."
      );
    }

    let updated = await updateProduct(review.resourceId, changes);

    if (
      before?.source === "product_sheet_validator_fix" &&
      before.fields?.includes("colour_board")
    ) {
      const expectedCount = Number(
        changes.meta_data?.find((item) => item.key === "personalization_0_image_items")?.value ?? 0
      );
      let savedCount = Number(
        updated.meta_data?.find((item) => item.key === "personalization_0_image_items")?.value ?? 0
      );

      if (expectedCount > 0 && savedCount < expectedCount && changes.meta_data?.length) {
        updated = await updateProduct(review.resourceId, { meta_data: changes.meta_data });
        savedCount = Number(
          updated.meta_data?.find((item) => item.key === "personalization_0_image_items")?.value ?? 0
        );
      }

      if (expectedCount > 0 && savedCount < expectedCount) {
        throw new Error(
          `WooCommerce saved ${savedCount} of ${expectedCount} colour-board options in Products > Options after retrying.`
        );
      }
    }

    if (
      before?.source === "product_sheet_validator_fix" &&
      before.fields?.includes("accessories") &&
      changes.cross_sell_ids?.length
    ) {
      let savedIds = new Set(updated.cross_sell_ids ?? []);
      let missingIds = changes.cross_sell_ids.filter((id) => !savedIds.has(id));

      if (missingIds.length > 0) {
        updated = await updateProduct(review.resourceId, {
          cross_sell_ids: changes.cross_sell_ids
        });
        savedIds = new Set(updated.cross_sell_ids ?? []);
        missingIds = changes.cross_sell_ids.filter((id) => !savedIds.has(id));
      }

      if (missingIds.length > 0) {
        throw new Error(
          `WooCommerce did not save ${missingIds.length} of ${changes.cross_sell_ids.length} accessory links after retrying. Please retry this review.`
        );
      }
    }

    return updated;
  }

  if (review.resource === "product" && review.action === "create") {
    const changes = await resolveReviewAccessories(review, review.changes as ProductChanges);
    return createOrUpdateProduct(changes);
  }

  if (review.resource === "category" && review.action === "update" && review.resourceId) {
    return updateCategory(review.resourceId, review.changes as CategoryChanges);
  }

  if (review.resource === "category" && review.action === "create") {
    return createCategory(review.changes as CategoryChanges);
  }

  if (review.resource === "category" && review.action === "delete" && review.resourceId) {
    return deleteCategory(review.resourceId);
  }

  if (review.resource === "category_merge" && review.action === "merge") {
    return mergeCategoryIntoTarget(review.changes as CategoryMergeChanges);
  }

  if (review.resource === "product_merge" && review.action === "merge") {
    return mergeProductIntoTarget(review.changes as ProductMergeChanges);
  }

  throw new Error("Unsupported review action.");
}

export async function approveReview(review: ReviewRecord) {
  try {
    await publishReview(review);

    if (review.resource === "product" || review.resource === "product_merge") {
      revalidateTag("updated-list-data", { expire: 0 });
    }

    const completed: ReviewRecord = {
      ...review,
      status: "approved",
      error: undefined,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await deleteReview(review.id);
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WooCommerce update failed.";
    const updated = await patchReview(review.id, {
      status: "failed",
      error: message,
      reviewedAt: new Date().toISOString()
    });

    if (!updated) {
      throw error;
    }

    return updated;
  }
}

export async function approveAllActionableReviews(): Promise<ApproveAllResult> {
  const actionable = (await listReviews()).filter(
    (review) => review.status === "pending" || review.status === "failed"
  );
  const results: ApproveAllResult["results"] = [];

  let approved = 0;
  let failed = 0;

  for (const review of actionable) {
    const updated = await approveReview(review);

    if (updated.status === "approved") {
      approved += 1;
    } else {
      failed += 1;
    }

    results.push({
      id: updated.id,
      title: updated.title,
      status: updated.status,
      error: updated.error
    });
  }

  return {
    total: actionable.length,
    approved,
    failed,
    results
  };
}
