import { NextResponse } from "next/server";

import { getMakeModelReport, makeModelAttributes } from "@/lib/make-model-validator";
import { createReview, listReviews } from "@/lib/review-store";
import type { ProductChanges } from "@/lib/types";
import { getProduct } from "@/lib/woocommerce";

export const maxDuration = 300;

function productIdsFromBody(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  const ids = [...new Set(values.map((item) => Number(item)))].filter(
    (item) => Number.isInteger(item) && item > 0
  );

  if (ids.length === 0) {
    throw new Error("Select at least one SKU-verified product.");
  }

  if (ids.length > 20) {
    throw new Error("Make and Model reviews are limited to 20 products at a time.");
  }

  return ids;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productIds = productIdsFromBody(body.productIds ?? body.productId);
    const report = await getMakeModelReport();
    const existingReviews = await listReviews();
    const pendingProductIds = new Set(
      existingReviews
        .filter((review) => {
          const before = review.before as { source?: string } | null;

          return (
            review.resource === "product" &&
            review.action === "update" &&
            (review.status === "pending" || review.status === "failed") &&
            before?.source === "make_model_sheet" &&
            Boolean(review.resourceId)
          );
        })
        .map((review) => review.resourceId as number)
    );
    const reviewIds: string[] = [];
    const warnings: Array<{ productId: number; message: string }> = [];
    let skipped = 0;

    for (const productId of productIds) {
      try {
        const result = report.products.find((item) => item.product?.id === productId);

        if (!result || result.status !== "matched" || !result.product) {
          throw new Error("Product does not have one SKU-verified WooCommerce match.");
        }

        if (result.matches) {
          skipped += 1;
          continue;
        }

        if (pendingProductIds.has(productId)) {
          throw new Error("A Make and Model review is already pending for this product.");
        }

        const product = await getProduct(productId);
        const changes: ProductChanges = {
          attributes: makeModelAttributes(
            product,
            report.attributeConfig,
            result.makes,
            result.models
          )
        };
        const review = await createReview({
          resource: "product",
          action: "update",
          resourceId: product.id,
          title: `Sync Make and Model: ${product.name}`,
          before: {
            source: "make_model_sheet",
            sheetSku: result.sku,
            verifiedBaseSku: result.baseSku,
            sourceRows: result.sourceRows,
            attributeConfig: report.attributeConfig,
            product: {
              id: product.id,
              name: product.name,
              sku: product.sku,
              permalink: product.permalink,
              images: product.images,
              status: product.status,
              stock_status: product.stock_status,
              regular_price: product.regular_price,
              categories: product.categories
            },
            current: {
              make: result.wooMakes,
              model: result.wooModels
            },
            expected: {
              make: result.makes,
              model: result.models
            }
          },
          changes
        });

        reviewIds.push(review.id);
        pendingProductIds.add(productId);
      } catch (error) {
        warnings.push({
          productId,
          message: error instanceof Error ? error.message : "Could not create Make and Model review."
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
      { error: error instanceof Error ? error.message : "Could not create Make and Model reviews." },
      { status: 400 }
    );
  }
}
