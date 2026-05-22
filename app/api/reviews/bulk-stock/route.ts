import { NextResponse } from "next/server";

import { createReview } from "@/lib/review-store";
import type { ProductChanges, WooProduct } from "@/lib/types";
import { getProduct } from "@/lib/woocommerce";

type BulkStockMode = "add" | "set";
type BulkStockStatus = "keep" | WooProduct["stock_status"];

function isBulkStockStatus(value: unknown): value is BulkStockStatus {
  return value === "keep" || value === "instock" || value === "outofstock" || value === "onbackorder";
}

function isBulkStockMode(value: unknown): value is BulkStockMode {
  return value === "add" || value === "set";
}

function parseQuantity(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const quantity = Number(value);

  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
    throw new Error("Stock quantity must be a whole number of 0 or more.");
  }

  return quantity;
}

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
    throw new Error("Bulk stock updates are limited to 100 products at a time.");
  }

  return ids;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productIds = uniqueProductIds(body.productIds);
    const mode = isBulkStockMode(body.mode) ? body.mode : "add";
    const stockStatus = isBulkStockStatus(body.stockStatus) ? body.stockStatus : "keep";
    const quantity = parseQuantity(body.quantity);
    const manageStock = Boolean(body.manageStock);

    if (quantity === undefined && stockStatus === "keep" && !manageStock) {
      return NextResponse.json({ error: "No stock changes were submitted." }, { status: 400 });
    }

    const reviewIds: string[] = [];
    let skipped = 0;

    for (const productId of productIds) {
      const product = await getProduct(productId);
      const changes: ProductChanges = {};

      if (quantity !== undefined) {
        const currentQuantity = product.stock_quantity ?? 0;
        const nextQuantity = mode === "add" ? currentQuantity + quantity : quantity;

        if (nextQuantity !== product.stock_quantity) {
          changes.stock_quantity = nextQuantity;
        }
      }

      if (stockStatus !== "keep" && stockStatus !== product.stock_status) {
        changes.stock_status = stockStatus;
      }

      if (manageStock && !product.manage_stock) {
        changes.manage_stock = true;
      }

      if (Object.keys(changes).length === 0) {
        skipped += 1;
        continue;
      }

      const review = await createReview({
        resource: "product",
        action: "update",
        resourceId: product.id,
        title: `Bulk stock update: ${product.name}`,
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
      { error: error instanceof Error ? error.message : "Could not create bulk stock reviews." },
      { status: 400 }
    );
  }
}
