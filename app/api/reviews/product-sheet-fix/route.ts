import { NextResponse } from "next/server";

import {
  buildProductSheetFix,
  type ProductSheetFixField
} from "@/lib/product-sheet-fix";
import { validateProductSheetBatch } from "@/lib/product-sheet-validator";
import { createReview, listReviews } from "@/lib/review-store";

const validFields = new Set<ProductSheetFixField>(["custom_notes", "colour_board", "accessories"]);

function rowNumberFromBody(value: unknown) {
  const rowNumber = Number(value);

  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error("A valid sheet row number is required.");
  }

  return rowNumber;
}

function fieldsFromBody(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Choose at least one sheet field to fix.");
  }

  const fields = [...new Set(value.filter((field): field is ProductSheetFixField =>
    typeof field === "string" && validFields.has(field as ProductSheetFixField)
  ))];

  if (fields.length === 0) {
    throw new Error("Choose at least one sheet field to fix.");
  }

  return fields;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = rowNumberFromBody(body.rowNumber);
    const fields = fieldsFromBody(body.fields);
    const existingReview = (await listReviews()).find((review) => {
      const before = review.before as {
        source?: string;
        row?: { rowNumber?: number };
        fields?: ProductSheetFixField[];
      } | null;

      return (
        review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "product_sheet_validator_fix" &&
        before.row?.rowNumber === rowNumber &&
        fields.some((field) => before.fields?.includes(field))
      );
    });

    if (existingReview) {
      return NextResponse.json(
        { error: "One or more selected fields already have a pending review for this sheet row." },
        { status: 409 }
      );
    }

    const validation = await validateProductSheetBatch({ offset: rowNumber - 2, limit: 1 });
    const result = validation.results[0];

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    if (result.status !== "matched" || !result.product) {
      return NextResponse.json(
        { error: "This row needs one clear WooCommerce product match before its fields can be fixed." },
        { status: 400 }
      );
    }

    const mismatchedFields = fields.filter((field) => {
      if (field === "custom_notes") {
        return !result.customNotesComparison.matches;
      }

      if (field === "colour_board") {
        return !result.colourBoardComparison.matches;
      }

      return !result.accessoriesComparison.matches;
    });

    if (mismatchedFields.length === 0) {
      return NextResponse.json({ error: "The selected fields already match WooCommerce." }, { status: 400 });
    }

    const draft = await buildProductSheetFix(result.row, result.product, mismatchedFields);
    const review = await createReview({
      resource: "product",
      action: "update",
      resourceId: result.product.id,
      title: `Fix sheet fields for ${result.product.name}: ${mismatchedFields.join(", ")}`,
      before: {
        source: "product_sheet_validator_fix",
        row: result.row,
        product: result.product,
        fields: mismatchedFields,
        warnings: draft.warnings
      },
      changes: draft.changes
    });

    return NextResponse.json({ review, fields: mismatchedFields, warnings: draft.warnings }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create product field fix review." },
      { status: 400 }
    );
  }
}
