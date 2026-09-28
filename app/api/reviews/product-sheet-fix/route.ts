import { NextResponse } from "next/server";

import {
  buildProductSheetFix,
  type ProductSheetFixField
} from "@/lib/product-sheet-fix";
import {
  validateProductSheetFixTarget,
  validateProductSheetSourceRow
} from "@/lib/product-sheet-validator";
import { parseProductSheetSource } from "@/lib/product-sheet";
import { createReview, listReviews } from "@/lib/review-store";

const validFields = new Set<ProductSheetFixField>([
  "custom_notes",
  "colour_board",
  "accessories",
  "specifications"
]);

export const maxDuration = 300;

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

function productIdFromBody(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const productId = Number(value);

  if (!Number.isInteger(productId) || productId < 1) {
    throw new Error("A valid WooCommerce product ID is required.");
  }

  return productId;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = rowNumberFromBody(body.rowNumber);
    const productId = productIdFromBody(body.productId);
    const fields = fieldsFromBody(body.fields);
    const sheetSource = parseProductSheetSource(body.source);
    const existingReviews = (await listReviews()).filter((review) => {
      const before = review.before as {
        source?: string;
        sheetSource?: string;
        row?: { rowNumber?: number };
      } | null;

      return (
        review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "product_sheet_validator_fix" &&
        (before.sheetSource ?? "product-manager") === sheetSource &&
        before.row?.rowNumber === rowNumber
      );
    });
    const coveredFields = new Set(
      existingReviews.flatMap((review) => {
        const before = review.before as { fields?: ProductSheetFixField[] } | null;
        return before?.fields ?? [];
      })
    );
    const fieldsToCreate = fields.filter((field) => !coveredFields.has(field));

    if (fieldsToCreate.length === 0) {
      return NextResponse.json({
        review: existingReviews[0],
        fields: [],
        skippedFields: fields,
        alreadyExists: true,
        warnings: []
      });
    }

    const result = productId
      ? await validateProductSheetFixTarget(rowNumber, productId, sheetSource)
      : await validateProductSheetSourceRow(rowNumber, sheetSource);

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    if (!("product" in result) || !result.product || ("status" in result && result.status !== "matched")) {
      return NextResponse.json(
        { error: "This row needs one clear WooCommerce product match before its fields can be fixed." },
        { status: 400 }
      );
    }

    const mismatchedFields = fieldsToCreate.filter((field) => {
      if (field === "custom_notes") {
        return result.customNotesComparison.sheet && !result.customNotesComparison.woo;
      }

      if (field === "colour_board") {
        return result.colourBoardComparison.sheetExpected && !result.colourBoardComparison.matches;
      }

      if (field === "specifications") {
        return result.specificationsComparison.sheet && !result.specificationsComparison.woo;
      }

      return result.accessoriesComparison.sheetExpected && !result.accessoriesComparison.matches;
    });

    if (mismatchedFields.length === 0) {
      return NextResponse.json({
        fields: [],
        skippedFields: fields,
        alreadyMatches: true,
        warnings: []
      });
    }

    const draft = await buildProductSheetFix(result.row, result.product, mismatchedFields);
    const review = await createReview({
      resource: "product",
      action: "update",
      resourceId: result.product.id,
      title: `Fix sheet fields for ${result.product.name}: ${mismatchedFields.join(", ")}`,
      before: {
        source: "product_sheet_validator_fix",
        sheetSource,
        row: result.row,
        product: result.product,
        fields: mismatchedFields,
        warnings: draft.warnings
      },
      changes: draft.changes
    });

    return NextResponse.json({
      review,
      fields: mismatchedFields,
      skippedFields: fields.filter((field) => coveredFields.has(field)),
      warnings: draft.warnings
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create product field fix review." },
      { status: 400 }
    );
  }
}
