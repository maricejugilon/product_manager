import { NextResponse } from "next/server";

import { approveReview } from "@/lib/review-approval";
import { getReview } from "@/lib/review-store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await context.params;
  const review = await getReview(id);

  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.status === "approved" || review.status === "rejected") {
    return NextResponse.json({ error: `Review is already ${review.status}.` }, { status: 400 });
  }

  const updated = await approveReview(review);
  return NextResponse.json(updated, { status: updated.status === "failed" ? 500 : 200 });
}
