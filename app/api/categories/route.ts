import { NextResponse } from "next/server";

import { getCategories } from "@/lib/woocommerce";

export async function GET() {
  try {
    return NextResponse.json(await getCategories());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load categories." },
      { status: 500 }
    );
  }
}
