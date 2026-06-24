import { NextResponse } from "next/server";

import { dimensionsFromProductSheet } from "@/lib/product-sheet-dimensions";
import { createReview } from "@/lib/review-store";
import type { ProductChanges } from "@/lib/types";
import { getProduct } from "@/lib/woocommerce";

export const maxDuration = 300;

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

  if (ids.length > 10) {
    throw new Error("Dimension sync is limited to 10 products per batch.");
  }

  return ids;
}

function sameDimensions(
  current: { length?: string; width?: string; height?: string } | undefined,
  next: { length: string; width: string; height: string }
) {
  return (
    (current?.length?.trim() ?? "") === next.length &&
    (current?.width?.trim() ?? "") === next.width &&
    (current?.height?.trim() ?? "") === next.height
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productIds = uniqueProductIds(body.productIds);
    const reviewIds: string[] = [];
    const warnings: Array<{ productId: number; productName?: string; message: string }> = [];
    let skipped = 0;

    for (const productId of productIds) {
      let productName: string | undefined;

      try {
        const product = await getProduct(productId);
        productName = product.name;
        const source = await dimensionsFromProductSheet(product);

        if (sameDimensions(product.dimensions, source.dimensions)) {
          skipped += 1;
          continue;
        }

        const changes: ProductChanges = {
          dimensions: source.dimensions
        };
        const review = await createReview({
          resource: "product",
          action: "update",
          resourceId: product.id,
          title: `Sync dimensions from sheet: ${product.name}`,
          before: product,
          changes
        });

        reviewIds.push(review.id);
      } catch (error) {
        warnings.push({
          productId,
          productName,
          message: error instanceof Error ? error.message : "Could not sync dimensions."
        });
      }
    }

    return NextResponse.json({
      created: reviewIds.length,
      skipped,
      failed: warnings.length,
      reviewIds,
      warnings
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create dimension sync reviews." },
      { status: 400 }
    );
  }
}
