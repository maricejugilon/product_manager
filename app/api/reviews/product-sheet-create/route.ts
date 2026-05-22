import { NextResponse } from "next/server";

import { buildProductCreateDraft } from "@/lib/product-sheet-create";
import { validateProductSheetBatch } from "@/lib/product-sheet-validator";
import { createReview, listReviews } from "@/lib/review-store";

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
    const existingReview = (await listReviews()).find((review) => {
      const before = review.before as { row?: { rowNumber?: number } } | null;

      return (
        review.resource === "product" &&
        review.action === "create" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.row?.rowNumber === rowNumber
      );
    });

    if (existingReview) {
      return NextResponse.json({ error: "This sheet row already has a pending product create review." }, { status: 409 });
    }

    const validation = await validateProductSheetBatch({ offset: rowNumber - 2, limit: 1 });
    const result = validation.results[0];

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    if (result.status === "matched" || result.status === "ambiguous") {
      return NextResponse.json({ error: "This row already has a WooCommerce match. Review it before creating a new product." }, { status: 400 });
    }

    const draft = await buildProductCreateDraft(rowNumber);
    const review = await createReview({
      resource: "product",
      action: "create",
      title: `Create product from sheet row #${rowNumber}: ${draft.changes.name}`,
      before: {
        source: "product_sheet_validator",
        row: draft.row,
        scraped: draft.scraped,
        warnings: draft.warnings
      },
      changes: draft.changes
    });

    return NextResponse.json({ review, warnings: draft.warnings }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create product review from sheet row." },
      { status: 400 }
    );
  }
}
