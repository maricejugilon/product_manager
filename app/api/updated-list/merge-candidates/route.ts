import { NextResponse } from "next/server";

import { getUpdatedListRow } from "@/lib/product-sheet";
import { normalizeUpdatedListProductName, normalizeUpdatedListSku } from "@/lib/updated-list";
import { getProducts } from "@/lib/woocommerce";

function rowNumberFromBody(value: unknown) {
  const rowNumber = Number(value);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error("A valid sheet row number is required.");
  return rowNumber;
}

function candidate(product: Awaited<ReturnType<typeof getProducts>>["data"][number]) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    status: product.status,
    permalink: product.permalink
  };
}

function relevantMatches(products: Awaited<ReturnType<typeof getProducts>>["data"]) {
  const active = products.filter((product) => product.status !== "draft" && product.status !== "trash");
  return active.length > 0 ? active : products;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = rowNumberFromBody(body.rowNumber);
    const row = await getUpdatedListRow(rowNumber);

    if (!row) return NextResponse.json({ error: "Spreadsheet row was not found." }, { status: 404 });

    if (row.sku) {
      const result = await getProducts({
        sku: row.sku,
        perPage: 20,
        status: "any",
        fields: "id,name,sku,status,permalink"
      });
      const exact = relevantMatches(result.data.filter(
        (product) => normalizeUpdatedListSku(product.sku) === normalizeUpdatedListSku(row.sku)
      ));

      if (exact.length > 1) {
        return NextResponse.json({ candidates: exact.map(candidate), matchedBy: "sku" });
      }
    }

    const result = await getProducts({
      search: row.name,
      perPage: 20,
      status: "any",
      fields: "id,name,sku,status,permalink"
    });
    const exact = relevantMatches(result.data.filter(
      (product) => normalizeUpdatedListProductName(product.name) === normalizeUpdatedListProductName(row.name)
    ));

    return NextResponse.json({
      candidates: [...new Map(exact.map((product) => [product.id, candidate(product)])).values()],
      matchedBy: "name"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load matching WooCommerce products." },
      { status: 500 }
    );
  }
}
