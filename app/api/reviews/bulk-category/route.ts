import { NextResponse } from "next/server";

import { createReview } from "@/lib/review-store";
import type { ProductChanges } from "@/lib/types";
import { getCategory, getProduct } from "@/lib/woocommerce";

type BulkCategoryMode = "add" | "set" | "remove";

function isBulkCategoryMode(value: unknown): value is BulkCategoryMode {
  return value === "add" || value === "set" || value === "remove";
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
    throw new Error("Bulk category updates are limited to 100 products at a time.");
  }

  return ids;
}

function categoryIdsForMode(currentIds: number[], categoryId: number, mode: BulkCategoryMode) {
  if (mode === "set") {
    return [categoryId];
  }

  if (mode === "remove") {
    return currentIds.filter((id) => id !== categoryId);
  }

  return [...new Set([...currentIds, categoryId])];
}

function sameIds(first: number[], second: number[]) {
  const sortedFirst = [...first].sort((a, b) => a - b);
  const sortedSecond = [...second].sort((a, b) => a - b);

  return sortedFirst.length === sortedSecond.length && sortedFirst.every((id, index) => id === sortedSecond[index]);
}

function actionLabel(mode: BulkCategoryMode) {
  if (mode === "set") {
    return "replace categories";
  }

  if (mode === "remove") {
    return "remove category";
  }

  return "assign category";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productIds = uniqueProductIds(body.productIds);
    const categoryId = Number(body.categoryId);
    const mode = isBulkCategoryMode(body.mode) ? body.mode : "add";

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ error: "Choose a category first." }, { status: 400 });
    }

    const category = await getCategory(categoryId);
    const reviewIds: string[] = [];
    let skipped = 0;

    for (const productId of productIds) {
      const product = await getProduct(productId);
      const currentIds = product.categories.map((item) => item.id);
      const nextIds = categoryIdsForMode(currentIds, category.id, mode);

      if (sameIds(currentIds, nextIds)) {
        skipped += 1;
        continue;
      }

      const changes: ProductChanges = {
        categories: nextIds.map((id) => ({ id }))
      };
      const review = await createReview({
        resource: "product",
        action: "update",
        resourceId: product.id,
        title: `Bulk ${actionLabel(mode)}: ${product.name}`,
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
      { error: error instanceof Error ? error.message : "Could not create bulk category reviews." },
      { status: 400 }
    );
  }
}
