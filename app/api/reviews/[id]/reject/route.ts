import { NextResponse } from "next/server";

import { getReview, isReviewStorageMissing, patchReview } from "@/lib/review-store";

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

  if (review.status === "approved") {
    return NextResponse.json({ error: "Approved reviews cannot be rejected." }, { status: 400 });
  }

  const updated = await patchReview(id, {
    status: "rejected",
    reviewedAt: new Date().toISOString()
  });

  return NextResponse.json(updated);
}
