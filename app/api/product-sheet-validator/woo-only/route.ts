import { NextResponse } from "next/server";

import { getWooOnlyProducts } from "@/lib/product-sheet-woo-only";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const report = await getWooOnlyProducts({
      refresh: url.searchParams.get("refresh") === "1"
    });

    return NextResponse.json({
      products: report.products,
      total: report.products.length,
      updatedAt: report.updatedAt
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not compare WooCommerce products with the sheet."
      },
      { status: 500 }
    );
  }
}
