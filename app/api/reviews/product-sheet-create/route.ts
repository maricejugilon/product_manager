import { NextResponse } from "next/server";

import { buildProductCreateDraft } from "@/lib/product-sheet-create";
import { getUpdatedListRows, parseProductSheetSource } from "@/lib/product-sheet";
import { findLikelyDraftProduct, validateProductSheetSourceRow } from "@/lib/product-sheet-validator";
import { createReview, listReviews, patchReview } from "@/lib/review-store";
import {
  getUpdatedListData,
  normalizeUpdatedListProductName,
  normalizeUpdatedListSku
} from "@/lib/updated-list";

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

    if (sheetSource === "updated-list") {
      const identityRow = (await getUpdatedListData()).rows.find(
        (row) => row.sheetRowNumber === rowNumber
      );

      if (identityRow?.wooMatch || identityRow?.ambiguousMatch) {
        return NextResponse.json(
          {
            error: identityRow.ambiguousMatch
              ? "This spreadsheet row has multiple WooCommerce matches. Resolve the matches before creating a product."
              : `This product already exists in WooCommerce${identityRow.wooStatus ? ` with status ${identityRow.wooStatus}` : ""}. Refresh Missing Products to load its current status.`,
            productId: identityRow.wooId,
            productStatus: identityRow.wooStatus
          },
          { status: 409 }
        );
      }
    }

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

    const result = await validateProductSheetSourceRow(rowNumber, sheetSource, {
      requireSkuMatch: true
    });

    if (!result) {
      return NextResponse.json({ error: "Sheet row was not found." }, { status: 404 });
    }

    if (sheetSource === "updated-list" && !result.row.productCode.trim()) {
      return NextResponse.json(
        { error: "This Product list row does not have a value in the Product code field." },
        { status: 400 }
      );
    }

    if (sheetSource === "updated-list" && result.row.productCode) {
      const normalizedSku = normalizeUpdatedListSku(result.row.productCode);
      const duplicateSkuRows = (await getUpdatedListRows()).filter(
        (row) => normalizeUpdatedListSku(row.productCode || "") === normalizedSku
      );

      if (duplicateSkuRows.length > 1) {
        const distinctNames = new Set(
          duplicateSkuRows.map((row) => normalizeUpdatedListProductName(row.name || ""))
        );

        if (distinctNames.size > 1) {
          return NextResponse.json(
            {
              error: `Product Code ${result.row.productCode} is used by multiple spreadsheet product names. Resolve it in Sheet Duplicates before creating a product.`
            },
            { status: 409 }
          );
        }

        const canonicalRow = Math.min(...duplicateSkuRows.map((row) => row.rowNumber));
        if (rowNumber !== canonicalRow) {
          return NextResponse.json(
            {
              error: `This is a duplicate spreadsheet row. Use sheet row ${canonicalRow} to create Product Code ${result.row.productCode}.`,
              canonicalRow
            },
            { status: 409 }
          );
        }
      }
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
