import { NextResponse } from "next/server";

import { listReviews } from "@/lib/review-store";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  const reviews = await listReviews();
  const rowNumbers = reviews
    .filter(
      (review) =>
        review.resource === "product" &&
        review.action === "create" &&
        (review.status === "pending" || review.status === "failed")
    )
    .map((review) => {
      const before = isRecord(review.before) ? review.before : {};
      const row = isRecord(before.row) ? before.row : {};
      const rowNumber = Number(row.rowNumber);

      return Number.isInteger(rowNumber) ? rowNumber : 0;
    })
    .filter((rowNumber) => rowNumber > 0);
  const fixesByRow: Record<string, string[]> = {};

  for (const review of reviews) {
    if (
      review.resource !== "product" ||
      review.action !== "update" ||
      (review.status !== "pending" && review.status !== "failed")
    ) {
      continue;
    }

    const before = isRecord(review.before) ? review.before : {};

    if (before.source !== "product_sheet_validator_fix") {
      continue;
    }

    const row = isRecord(before.row) ? before.row : {};
    const rowNumber = Number(row.rowNumber);
    const fields = Array.isArray(before.fields)
      ? before.fields.filter((field): field is string => typeof field === "string")
      : [];

    if (Number.isInteger(rowNumber) && rowNumber > 0) {
      fixesByRow[String(rowNumber)] = [...new Set([...(fixesByRow[String(rowNumber)] ?? []), ...fields])];
    }
  }

  return NextResponse.json({ rowNumbers: [...new Set(rowNumbers)], fixesByRow });
}
