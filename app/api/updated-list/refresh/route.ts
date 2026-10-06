import { NextResponse } from "next/server";

import {
  refreshUpdatedListData,
  updatedListRowCanCheckPrice,
  updatedListRowIsDraft,
  updatedListRowIsMissing,
  updatedListRowHasSheetDuplicate,
  updatedListRowNeedsSpecifications,
  updatedListRowNeedsPriceUpdate,
  updatedListRowNeedsQa,
  updatedListRowNeedsUpdate
} from "@/lib/updated-list";

export const maxDuration = 300;

const refreshScopes = new Set([
  "list",
  "missing",
  "drafts",
  "mismatches",
  "specifications",
  "qa",
  "prices",
  "stocks"
]);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { scope?: unknown };
    const requestedScope = typeof body.scope === "string" && refreshScopes.has(body.scope)
      ? body.scope
      : "list";
    const data = await refreshUpdatedListData();

    return NextResponse.json({
      refreshed: true,
      scope: requestedScope,
      refreshedAll: requestedScope === "list",
      updatedAt: data.updatedAt,
      source: "Product list",
      currency: data.currency,
      tax: data.tax,
      totalRows: data.rows.length,
      missingProducts: data.rows.filter(updatedListRowIsMissing).length,
      draftProducts: data.rows.filter(updatedListRowIsDraft).length,
      specificationsMissing: data.rows.filter(updatedListRowNeedsSpecifications).length,
      fieldFixes: data.rows.filter(updatedListRowNeedsUpdate).length,
      qaFailures: data.rows.filter(updatedListRowNeedsQa).length,
      sheetDuplicateRows: data.rows.filter(updatedListRowHasSheetDuplicate).length,
      priceUpdates: data.rows.filter(updatedListRowNeedsPriceUpdate).length,
      livePriceCandidates: data.rows.filter(updatedListRowCanCheckPrice).length,
      liveStockCandidates: data.rows.filter(updatedListRowCanCheckPrice).length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not refresh the updated list." },
      { status: 500 }
    );
  }
}
