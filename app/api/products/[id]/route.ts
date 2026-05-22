import { NextResponse } from "next/server";

import { getProduct } from "@/lib/woocommerce";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getProduct(Number(id)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load product." },
      { status: 500 }
    );
  }
}
