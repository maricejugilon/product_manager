import { NextResponse } from "next/server";

import { createReview } from "@/lib/review-store";
import type { ProductChanges, WooProduct } from "@/lib/types";
import { getProduct } from "@/lib/woocommerce";

function uniqueProductIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Select at least one product.");
  }

  const ids = [...new Set(value.map((item) => Number(item)))].filter(
    (item) => Number.isInteger(item) && item > 0
  );

  if (ids.length === 0) {
    throw new Error("Select at least one product.");
  }

  if (ids.length > 100) {
    throw new Error("Bulk custom notes updates are limited to 100 products at a time.");
  }

  return ids;
}

function isTruthyMeta(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  const normalized = String(value ?? "").trim().toLowerCase();

  return normalized === "1" || normalized === "yes" || normalized === "true" || normalized === "on";
}

function metaValue(product: WooProduct, key: string) {
  return product.meta_data?.find((item) => item.key === key)?.value;
}

function metaEntry(product: WooProduct, key: string, value: unknown) {
  const existing = product.meta_data?.find((item) => item.key === key);

  return {
    ...(existing?.id ? { id: existing.id } : {}),
    key,
    value
  };
}

function customNotesMetaData(product: WooProduct, enabled: boolean) {
  const meta = [metaEntry(product, "custom_notes", enabled ? "1" : "0")];
  const fieldKey = metaValue(product, "_custom_notes");

  if (fieldKey) {
    meta.push(metaEntry(product, "_custom_notes", fieldKey));
  }

  return meta;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productIds = uniqueProductIds(body.productIds);
    const customNotes = isTruthyMeta(body.customNotes);
    const reviewIds: string[] = [];
    let skipped = 0;

    for (const productId of productIds) {
      const product = await getProduct(productId);
      const currentCustomNotes = isTruthyMeta(metaValue(product, "custom_notes"));

      if (currentCustomNotes === customNotes) {
        skipped += 1;
        continue;
      }

      const changes: ProductChanges = {
        meta_data: customNotesMetaData(product, customNotes)
      };
      const review = await createReview({
        resource: "product",
        action: "update",
        resourceId: product.id,
        title: `Bulk custom notes ${customNotes ? "enable" : "disable"}: ${product.name}`,
        before: product,
        changes
      });

      reviewIds.push(review.id);
    }

    return NextResponse.json({
      created: reviewIds.length,
      skipped,
      reviewIds
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create bulk custom notes reviews." },
      { status: 400 }
    );
  }
}
