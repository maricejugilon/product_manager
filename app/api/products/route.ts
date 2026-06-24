import { NextResponse } from "next/server";

import { getProductsByCustomNotes } from "@/lib/woocommerce";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await getProductsByCustomNotes({
      page: Number(url.searchParams.get("page") ?? 1),
      perPage: Number(url.searchParams.get("per_page") ?? 100),
      search: url.searchParams.get("search") ?? "",
      sku: url.searchParams.get("sku") ?? "",
      category: url.searchParams.get("category") ?? "",
      stockStatus: url.searchParams.get("stock_status") ?? "",
      customNotes: url.searchParams.get("custom_notes") ?? "",
      dimensions: url.searchParams.get("dimensions") ?? "",
      status: url.searchParams.get("status") ?? "any",
      include: url.searchParams.get("include") ?? ""
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load products." },
      { status: 500 }
    );
  }
}
