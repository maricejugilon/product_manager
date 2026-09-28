import { NextResponse } from "next/server";

import { buildProductCreateDraft } from "@/lib/product-sheet-create";
import { parseProductSheetSource } from "@/lib/product-sheet";
import { validateProductSheetSourceRow } from "@/lib/product-sheet-validator";
import { createReview, listReviews } from "@/lib/review-store";

export const maxDuration = 300;

function rowNumberFromBody(value: unknown) {
  const rowNumber = Number(value);

  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("A valid sheet row number is required.");
  }

  return rowNumber;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = rowNumberFromBody(body.rowNumber);
    const sheetSource = parseProductSheetSource(body.source);
    const existingReview = (await listReviews()).find((review) => {
      const before = review.before as { row?: { rowNumber?: number }; source?: string; sheetSource?: string } | null;

      return (
        review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "product_sheet_validator_publish" &&
        (before.sheetSource ?? "product-manager") === sheetSource &&
        before.row?.rowNumber === rowNumber
      );
    });

    if (existingReview) {
      return NextResponse.json({ review: existingReview, alreadyExists: true, warnings: [] });
    }

    const result = await validateProductSheetSourceRow(rowNumber, sheetSource);

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    if (result.status !== "matched" || !result.product) {
      return NextResponse.json({ error: "This row needs a clear WooCommerce product match before it can be published." }, { status: 400 });
    }

    if (result.product.status !== "draft") {
      return NextResponse.json({ error: "This product is already published in WooCommerce." }, { status: 400 });
    }

    const draft = await buildProductCreateDraft(rowNumber, sheetSource);

    const review = await createReview({
      resource: "product",
      action: "update",
      resourceId: result.product.id,
      title: `Publish draft product ${result.product.name}`,
      before: {
        source: "product_sheet_validator_publish",
        sheetSource,
        row: draft.row,
        product: result.product,
        scraped: draft.scraped,
        warnings: draft.warnings
      },
      changes: {
        ...draft.changes,
        status: "publish"
      }
    });

    return NextResponse.json({ review, warnings: draft.warnings }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the publish draft review." },
      { status: 400 }
    );
  }
}
