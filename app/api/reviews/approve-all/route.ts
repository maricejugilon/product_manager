import { NextResponse } from "next/server";

import { approveAllActionableReviews } from "@/lib/review-approval";

export async function POST() {
  try {
    const result = await approveAllActionableReviews();
    return NextResponse.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not approve reviews." },
      { status: 500 }
    );
  }
}
