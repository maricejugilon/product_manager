import { NextResponse } from "next/server";

import { buildProductCreateDraft } from "@/lib/product-sheet-create";
import { parseProductSheetSource } from "@/lib/product-sheet";
import { findLikelyDraftProduct, validateProductSheetSourceRow } from "@/lib/product-sheet-validator";
import { createReview, listReviews, patchReview } from "@/lib/review-store";

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
    const reviews = await listReviews();
    const existingCreateReview = reviews.find((review) => {
      const before = review.before as { row?: { rowNumber?: number }; sheetSource?: string } | null;

      return (
        review.resource === "product" &&
        review.action === "create" &&
        (review.status === "pending" || review.status === "failed") &&
        (before?.sheetSource ?? "product-manager") === sheetSource &&
        before?.row?.rowNumber === rowNumber
      );
    });

    const result = await validateProductSheetSourceRow(rowNumber, sheetSource);

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    const matchedProductStatus = String(result.product?.status ?? "").trim().toLowerCase();
    const draftProduct = result.status === "matched" && matchedProductStatus === "draft"
      ? result.product
      : result.status === "not_found"
        ? findLikelyDraftProduct(result.row, result.candidates)
        : undefined;

    if (draftProduct) {
      const existingDraftReview = reviews.find((review) => {
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

      if (existingDraftReview) {
        return NextResponse.json({
          review: existingDraftReview,
          alreadyExists: true,
          mode: "update_draft",
          warnings: []
        });
      }

      const draft = await buildProductCreateDraft(rowNumber, sheetSource);
      const reviewInput = {
        resource: "product" as const,
        action: "update" as const,
        resourceId: draftProduct.id,
        title: `Update and publish draft product ${draftProduct.name}`,
        before: {
           source: "product_sheet_validator_publish",
           sheetSource,
          row: draft.row,
          product: draftProduct,
          scraped: draft.scraped,
          warnings: draft.warnings
        },
        changes: {
          ...draft.changes,
          status: "publish" as const
        }
      };
      const review = existingCreateReview
        ? await patchReview(existingCreateReview.id, {
            ...reviewInput,
            status: "pending",
            error: undefined,
            reviewedAt: undefined
          })
        : await createReview(reviewInput);

      return NextResponse.json({
        review,
        convertedFromCreate: Boolean(existingCreateReview),
        mode: "update_draft",
        warnings: draft.warnings
      }, { status: existingCreateReview ? 200 : 201 });
    }

    if (result.status === "matched" || result.status === "ambiguous") {
      return NextResponse.json({
        error: matchedProductStatus === "publish"
          ? "This product already exists and is published in WooCommerce. Refresh Updated List to load its current status."
          : "This row already has a WooCommerce match. Review it before creating a new product.",
        matchStatus: result.status,
        productId: result.product?.id,
        productStatus: result.product?.status
      }, { status: 400 });
    }

    if (existingCreateReview) {
      return NextResponse.json({
        review: existingCreateReview,
        alreadyExists: true,
        mode: "create",
        warnings: []
      });
    }

    const draft = await buildProductCreateDraft(rowNumber, sheetSource);
    const review = await createReview({
      resource: "product",
      action: "create",
      title: `Create product from sheet row #${rowNumber}: ${draft.changes.name}`,
      before: {
        source: "product_sheet_validator",
        sheetSource,
        row: draft.row,
        scraped: draft.scraped,
        warnings: draft.warnings
      },
      changes: draft.changes
    });

    return NextResponse.json({ review, mode: "create", warnings: draft.warnings }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create product review from sheet row." },
      { status: 400 }
    );
  }
}
