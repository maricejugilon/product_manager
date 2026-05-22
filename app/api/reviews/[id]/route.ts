import { NextResponse } from "next/server";

import { getReview } from "@/lib/review-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id } = await context.params;
  const review = await getReview(id);

  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  return NextResponse.json(review);
}
