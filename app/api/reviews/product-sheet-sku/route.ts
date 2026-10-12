import { NextResponse } from "next/server";

import { getUpdatedListRows } from "@/lib/product-sheet";
import { createReview, listReviews, patchReview } from "@/lib/review-store";
import {
  normalizeUpdatedListProductName,
  normalizeUpdatedListSku,
  updatedListProductMatchesCode
} from "@/lib/updated-list";
import { getProduct, getProducts } from "@/lib/woocommerce";

export const maxDuration = 300;

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = positiveInteger(body.rowNumber, "Sheet row number");
    const productId = positiveInteger(body.productId, "WooCommerce product ID");
    const rows = await getUpdatedListRows();
    const row = rows.find((item) => item.rowNumber === rowNumber);

    if (!row) {
      return NextResponse.json({ error: "The Product list row was not found." }, { status: 404 });
    }

    const newSku = row.productCode?.trim() ?? "";
    if (!newSku) {
      return NextResponse.json({ error: "This Product list row does not have a Product Code." }, { status: 400 });
    }

    const normalizedName = normalizeUpdatedListProductName(row.name || "");
    const sameCodeRows = rows.filter(
      (item) => normalizeUpdatedListSku(item.productCode || "") === normalizeUpdatedListSku(newSku)
    );
    const namesForCode = new Set(
      sameCodeRows.map((item) => normalizeUpdatedListProductName(item.name || "")).filter(Boolean)
    );
    if (namesForCode.size > 1) {
      return NextResponse.json(
        { error: `Product Code ${newSku} is used by multiple spreadsheet products. Resolve it in Sheet Duplicates before fixing the SKU.` },
        { status: 409 }
      );
    }

    const [product, skuLookup, reviews] = await Promise.all([
      getProduct(productId),
      getProducts({ sku: newSku, perPage: 20, status: "any", fields: "id,name,sku,status,permalink" }),
      listReviews()
    ]);

    const productNameMatches = normalizeUpdatedListProductName(product.name || "") === normalizedName;
    const productCodeMatches = updatedListProductMatchesCode(product, newSku);
    const codesForName = new Set(
      rows
        .filter((item) => normalizeUpdatedListProductName(item.name || "") === normalizedName)
        .map((item) => normalizeUpdatedListSku(item.productCode || ""))
        .filter(Boolean)
    );

    if (!productCodeMatches && (!productNameMatches || codesForName.size > 1)) {
      return NextResponse.json(
        { error: "The WooCommerce product no longer matches this Product code. Refresh data first." },
        { status: 409 }
      );
    }

    if (normalizeUpdatedListSku(product.sku || "") === normalizeUpdatedListSku(newSku)) {
      return NextResponse.json(
        { error: "This WooCommerce product already uses the current Product Code. Refresh data to remove it from the list." },
        { status: 409 }
      );
    }

    const skuOwner = skuLookup.data.find(
      (candidate) =>
        candidate.id !== productId &&
        normalizeUpdatedListSku(candidate.sku || "") === normalizeUpdatedListSku(newSku)
    );

    if (skuOwner) {
      return NextResponse.json(
        {
          error: `Product Code ${newSku} is already used by WooCommerce product #${skuOwner.id} ${skuOwner.name}. Refresh data before continuing.`
        },
        { status: 409 }
      );
    }

    const existingProductReview = reviews.find((review) => {
      const before = review.before as { source?: string } | null;
      return review.resource === "product" &&
        review.action === "update" &&
        review.resourceId === productId &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "updated_list_sku_fix";
    });
    const existingReview = reviews.find((review) => {
      const changes = review.changes as { sku?: string } | null;
      return review.resource === "product" &&
        review.action === "update" &&
        review.resourceId === productId &&
        (review.status === "pending" || review.status === "failed") &&
        normalizeUpdatedListSku(changes?.sku || "") === normalizeUpdatedListSku(newSku);
    });

    if (existingReview) {
      return NextResponse.json({ review: existingReview, alreadyExists: true });
    }

    const reviewInput = {
      resource: "product",
      action: "update",
      resourceId: productId,
      title: `Update product SKU: ${product.name}`,
      before: {
        source: "updated_list_sku_fix",
        row: {
          rowNumber: row.rowNumber,
          name: row.name,
          sku: newSku
        },
        product
      },
      changes: { sku: newSku }
    } as const;
    const review = existingProductReview
      ? await patchReview(existingProductReview.id, {
          ...reviewInput,
          status: "pending",
          error: undefined,
          reviewedAt: undefined
        })
      : await createReview(reviewInput);

    return NextResponse.json(
      { review, alreadyExists: false, correctedExisting: Boolean(existingProductReview) },
      { status: existingProductReview ? 200 : 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the SKU fix review." },
      { status: 500 }
    );
  }
}
