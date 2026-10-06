import { NextResponse } from "next/server";

import { getUpdatedListRow, parseProductSheetSource } from "@/lib/product-sheet";
import { scrapeLiveProductStock } from "@/lib/product-sheet-create";
import { createReview, listReviews, patchReview } from "@/lib/review-store";
import { normalizeUpdatedListProductName, normalizeUpdatedListSku } from "@/lib/updated-list";
import { getProduct } from "@/lib/woocommerce";

export const maxDuration = 300;

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`A valid ${label} is required.`);
  }
  return parsed;
}

function stockLabel(value: string) {
  if (value === "instock") return "In stock";
  if (value === "outofstock") return "Out of stock";
  if (value === "onbackorder") return "On backorder";
  return value || "Not known";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = positiveInteger(body.rowNumber, "sheet row number");
    const productId = positiveInteger(body.productId, "WooCommerce product ID");
    const sheetSource = parseProductSheetSource(body.source);

    if (sheetSource !== "updated-list") {
      return NextResponse.json({ error: "Live stock sync is only available for the Updated List." }, { status: 400 });
    }

    const [row, product] = await Promise.all([
      getUpdatedListRow(rowNumber),
      getProduct(productId)
    ]);

    if (!row) {
      return NextResponse.json({ error: "The spreadsheet row or WooCommerce product was not found." }, { status: 404 });
    }

    const rowSku = normalizeUpdatedListSku(row.sku || "");
    const productSku = normalizeUpdatedListSku(product.sku || "");
    const skuMatches = Boolean(rowSku && productSku && rowSku === productSku);
    const nameMatches = normalizeUpdatedListProductName(row.name || "") ===
      normalizeUpdatedListProductName(product.name || "");

    if (!skuMatches && !nameMatches) {
      return NextResponse.json(
        { error: "This row no longer has one clear WooCommerce product match. Refresh the list and try again." },
        { status: 409 }
      );
    }

    if (!row.liveUrl) {
      return NextResponse.json({ error: "This spreadsheet row does not have a product-link to check." }, { status: 400 });
    }

    const scraped = await scrapeLiveProductStock(row.liveUrl);
    const stockStatus = scraped.stockStatus;

    if (!stockStatus) {
      return NextResponse.json(
        { error: "No clear stock status could be read from the spreadsheet product-link." },
        { status: 409 }
      );
    }

    const backorders = stockStatus === "onbackorder" ? "notify" as const : "no" as const;

    const wooStockStatus = product.stock_status ?? "";
    const wooBackorders = product.backorders ?? "no";

    if (wooStockStatus === stockStatus && wooBackorders === backorders) {
      return NextResponse.json({
        alreadyMatches: true,
        stockStatus,
        stockLabel: stockLabel(stockStatus),
        backorders,
        sourceUrl: scraped.url
      });
    }

    const existingReview = (await listReviews()).find((review) => {
      const before = review.before as { source?: string; row?: { rowNumber?: number } } | null;
      return review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "updated_list_stock_sync" &&
        before.row?.rowNumber === rowNumber;
    });
    const reviewInput = {
      resource: "product" as const,
      action: "update" as const,
      resourceId: product.id,
      title: `Sync product-link stock for ${row.name}: ${stockLabel(wooStockStatus)} to ${stockLabel(stockStatus)}`,
      before: {
        source: "updated_list_stock_sync",
        sheetSource,
        row: {
          rowNumber: row.rowNumber,
          values: row.values,
          sku: row.sku,
          name: row.name,
          liveUrl: row.liveUrl,
          categories: row.categories,
          categoryHierarchy: row.categoryHierarchy
        },
        product: {
          id: product.id,
          name: product.name,
          stock_status: wooStockStatus,
          backorders: wooBackorders,
          manage_stock: product.manage_stock,
          stock_quantity: product.stock_quantity
        },
        expectedStockStatus: stockStatus,
        expectedBackorders: backorders,
        scrapedProductUrl: scraped.url
      },
      changes: {
        stock_status: stockStatus,
        backorders
      }
    };
    const review = existingReview
      ? await patchReview(existingReview.id, { ...reviewInput, status: "pending", error: undefined, reviewedAt: undefined })
      : await createReview(reviewInput);

    return NextResponse.json({
      review,
      stockStatus,
      stockLabel: stockLabel(stockStatus),
      backorders,
      sourceUrl: scraped.url,
      alreadyExists: Boolean(existingReview)
    }, { status: existingReview ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the stock update review." },
      { status: 400 }
    );
  }
}
