import { NextResponse } from "next/server";

import { approveReview } from "@/lib/review-approval";
import { acquireReviewLock, getReview, isReviewStorageMissing, releaseReviewLock } from "@/lib/review-store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  if (isReviewStorageMissing()) {
    return NextResponse.json(
      { error: "Review storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel." },
      { status: 503 }
    );
  }

  const { id } = await context.params;
  const review = await getReview(id);

  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.status === "approved" || review.status === "rejected") {
    return NextResponse.json({ error: `Review is already ${review.status}.` }, { status: 400 });
  }

  const lockToken = await acquireReviewLock(id);

  if (!lockToken) {
    return NextResponse.json({ error: "This review is already being approved." }, { status: 409 });
  }

  try {
    const latestReview = await getReview(id);

    if (!latestReview) {
      return NextResponse.json({ error: "Review not found." }, { status: 404 });
    }

    if (latestReview.status === "approved" || latestReview.status === "rejected") {
      return NextResponse.json({ error: `Review is already ${latestReview.status}.` }, { status: 400 });
    }

    const updated = await approveReview(latestReview);
    return NextResponse.json(updated, { status: updated.status === "failed" ? 500 : 200 });
  } finally {
    try {
      await releaseReviewLock(id, lockToken);
    } catch {
      // The lock has a short TTL, so a release failure should not hide the approval result.
    }
  }
}
