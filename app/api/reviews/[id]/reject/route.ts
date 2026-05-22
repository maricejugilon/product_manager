import { NextResponse } from "next/server";

import { getReview, patchReview } from "@/lib/review-store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
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
