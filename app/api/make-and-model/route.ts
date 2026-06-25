import { NextResponse } from "next/server";

import { getMakeModelReport } from "@/lib/make-model-validator";
import { listReviews } from "@/lib/review-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const report = await getMakeModelReport({
      refresh: url.searchParams.get("refresh") === "1"
    });
    const pendingProductIds = (await listReviews())
      .filter((review) => {
        const before = review.before as { source?: string } | null;

        return (
          review.resource === "product" &&
          review.action === "update" &&
          (review.status === "pending" || review.status === "failed") &&
          before?.source === "make_model_sheet" &&
          Boolean(review.resourceId)
        );
      })
      .map((review) => review.resourceId as number);

    return NextResponse.json({
      ...report,
      pendingProductIds: [...new Set(pendingProductIds)]
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not analyze Make and Model data." },
      { status: 500 }
    );
  }
}
