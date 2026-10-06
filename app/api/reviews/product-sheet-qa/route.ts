import { NextResponse } from "next/server";

import {
  buildProductSheetFix,
  type ProductSheetFixField,
  type ProductSheetFixOverrides
} from "@/lib/product-sheet-fix";
import {
  parseProductSheetQaCheck,
  type ProductSheetQaCheck,
  type ProductSheetQaField
} from "@/lib/product-sheet-qa";
import { parseProductSheetSource } from "@/lib/product-sheet";
import { validateProductSheetFixTarget, validateProductSheetSourceRow } from "@/lib/product-sheet-validator";
import { createReview, listReviews } from "@/lib/review-store";

export const maxDuration = 300;

const validFields = new Set<ProductSheetQaField>([
  "qa_custom_notes",
  "qa_accessories",
  "qa_colour"
]);

const fixFieldByQaField: Record<ProductSheetQaField, ProductSheetFixField> = {
  qa_custom_notes: "custom_notes",
  qa_accessories: "accessories",
  qa_colour: "colour_board"
};

function rowNumberFromBody(value: unknown) {
  const rowNumber = Number(value);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("A valid sheet row number is required.");
  return rowNumber;
}

function productIdFromBody(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const productId = Number(value);
  if (!Number.isInteger(productId) || productId < 1) throw new Error("A valid WooCommerce product ID is required.");
  return productId;
}

function fieldsFromBody(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Choose at least one failed QA field to fix.");
  const fields = [...new Set(value.filter((field): field is ProductSheetQaField =>
    typeof field === "string" && validFields.has(field as ProductSheetQaField)
  ))];
  if (fields.length === 0) throw new Error("Choose at least one failed QA field to fix.");
  return fields;
}

function expectedState(check: ProductSheetQaCheck) {
  if (check.expectedBoolean !== undefined) return check.expectedBoolean;
  if (check.expectedCount !== undefined) return check.expectedCount > 0;
  if (check.missing.length > 0) return true;
  return undefined;
}

function overridesFromChecks(checks: ProductSheetQaCheck[]) {
  const overrides: ProductSheetFixOverrides = {};

  for (const check of checks) {
    const expected = expectedState(check);
    if (expected === undefined) continue;
    if (check.field === "qa_custom_notes") overrides.customNotesExpected = expected;
    if (check.field === "qa_accessories") {
      overrides.accessoriesExpected = expected;
      overrides.accessoryNames = check.expectedNames ?? check.missing;
      overrides.accessoriesExpectedCount = check.expectedCount;
    }
    if (check.field === "qa_colour") {
      overrides.colourBoardExpected = expected;
      overrides.colourNames = check.expectedNames ?? check.missing;
      overrides.colourBoardExpectedCount = check.expectedCount;
    }
  }

  return overrides;
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

      return review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "updated_list_qa_fix" &&
        (before.sheetSource ?? "updated-list") === sheetSource &&
        before.row?.rowNumber === rowNumber;
    });
    const coveredFields = new Set(existingReviews.flatMap((review) => {
      const before = review.before as { qaFields?: ProductSheetQaField[] } | null;
      return before?.qaFields ?? [];
    }));
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

    if (!result) return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    if (!("product" in result) || !result.product || ("status" in result && result.status !== "matched")) {
      return NextResponse.json(
        { error: "This QA row needs one clear WooCommerce product match before it can be fixed." },
        { status: 400 }
      );
    }

    const checks = fieldsToCreate.map((field) => parseProductSheetQaCheck(result.row, field));
    const activeChecks = checks.filter((check) => check.failed);

    if (activeChecks.length === 0) {
      return NextResponse.json({
        fields: [],
        skippedFields: fields,
        alreadyMatches: true,
        warnings: []
      });
    }

    const unresolved = activeChecks.filter((check) => expectedState(check) === undefined);
    if (unresolved.length > 0) {
      throw new Error(
        `Could not determine the expected value for: ${unresolved.map((check) => check.label).join(", ")}. Add "Expected YES/NO" or "Count expected N" to the QA result.`
      );
    }

    const fixFields = activeChecks.map((check) => fixFieldByQaField[check.field]);
    const overrides = overridesFromChecks(activeChecks);
    const draft = await buildProductSheetFix(result.row, result.product, fixFields, overrides);
    const accessoryCheck = activeChecks.find((check) => check.field === "qa_accessories");
    const colourCheck = activeChecks.find((check) => check.field === "qa_colour");
    const accessoryValue = draft.changes.meta_data?.find((item) => item.key === "product_accessories")?.value;
    const accessoryCount = typeof accessoryValue === "string" && accessoryValue
      ? (JSON.parse(accessoryValue) as unknown[]).length
      : 0;
    const colourCount = Number(
      draft.changes.meta_data?.find((item) => item.key === "personalization_0_image_items")?.value ?? 0
    );

    if (accessoryCheck?.expectedCount !== undefined && accessoryCount !== accessoryCheck.expectedCount) {
      throw new Error(
        `QA expects ${accessoryCheck.expectedCount} accessories, but only ${accessoryCount} could be read from the spreadsheet and product-link. Update the source details before creating this fix.`
      );
    }

    if (colourCheck?.expectedCount !== undefined && colourCount !== colourCheck.expectedCount) {
      throw new Error(
        `QA expects ${colourCheck.expectedCount} colour options, but only ${colourCount} could be read from the spreadsheet and product-link. Update the source details before creating this fix.`
      );
    }

    if (body.validateOnly === true) {
      return NextResponse.json({
        validated: true,
        fields: activeChecks.map((check) => check.field),
        counts: { accessories: accessoryCount, colourBoard: colourCount },
        warnings: draft.warnings
      });
    }

    const review = await createReview({
      resource: "product",
      action: "update",
      resourceId: result.product.id,
      title: `Fix QA checks for ${result.product.name}: ${activeChecks.map((check) => check.label).join(", ")}`,
      before: {
        source: "updated_list_qa_fix",
        sheetSource,
        row: result.row,
        product: result.product,
        fields: fixFields,
        qaFields: activeChecks.map((check) => check.field),
        qaChecks: activeChecks,
        expectedCounts: {
          accessories: activeChecks.find((check) => check.field === "qa_accessories")?.expectedCount,
          colourBoard: activeChecks.find((check) => check.field === "qa_colour")?.expectedCount
        },
        warnings: draft.warnings
      },
      changes: draft.changes
    });

    return NextResponse.json({
      review,
      fields: activeChecks.map((check) => check.field),
      skippedFields: fields.filter((field) => coveredFields.has(field)),
      warnings: draft.warnings
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the QA fix review." },
      { status: 400 }
    );
  }
}
