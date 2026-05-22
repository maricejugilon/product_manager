import { NextResponse } from "next/server";

import {
  mergeProductSheetValidatorSyncCache,
  promoteProductSheetValidatorSyncCache,
  readProductSheetValidatorCache,
  resetProductSheetValidatorSyncCache
} from "@/lib/product-sheet-validator-cache";
import { refreshProductSheetValidatorBatch, validateProductSheetBatch } from "@/lib/product-sheet-validator";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 8);
    const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : 8;
    const shouldSync = url.searchParams.get("sync") === "1";
    const shouldRefreshWoo = url.searchParams.get("refresh") === "1";

    if (!shouldSync) {
      const cache = await readProductSheetValidatorCache();
      const cachedResults = cache?.results ?? [];

      if (shouldRefreshWoo) {
        if (!cache || cachedResults.length === 0) {
          return NextResponse.json({
            offset: safeOffset,
            limit: safeLimit,
            total: 0,
            cachedCount: 0,
            updatedAt: null,
            source: "empty",
            nextOffset: null,
            results: []
          });
        }

        if (safeOffset === 0) {
          await resetProductSheetValidatorSyncCache();
        }

        const batch = await refreshProductSheetValidatorBatch(cachedResults, {
          offset: safeOffset,
          limit: safeLimit
        });
        const syncCache = await mergeProductSheetValidatorSyncCache({
          total: batch.total,
          results: batch.results
        });
        const committedCache = batch.nextOffset === null ? await promoteProductSheetValidatorSyncCache() : null;

        return NextResponse.json({
          ...batch,
          cachedCount: (committedCache ?? syncCache).results.length,
          updatedAt: (committedCache ?? syncCache).updatedAt,
          committed: Boolean(committedCache),
          source: "refresh"
        });
      }

      const results = cachedResults.slice(safeOffset, safeOffset + safeLimit);

      return NextResponse.json({
        offset: safeOffset,
        limit: safeLimit,
        total: cache?.total ?? 0,
        cachedCount: cachedResults.length,
        updatedAt: cache?.updatedAt ?? null,
        source: cache ? "cache" : "empty",
        nextOffset: safeOffset + results.length < cachedResults.length ? safeOffset + results.length : null,
        results
      });
    }

    if (safeOffset === 0) {
      await resetProductSheetValidatorSyncCache();
    }

    const batch = await validateProductSheetBatch({
      offset: safeOffset,
      limit: safeLimit
    });
    const syncCache = await mergeProductSheetValidatorSyncCache({
      total: batch.total,
      results: batch.results
    });
    const committedCache = batch.nextOffset === null ? await promoteProductSheetValidatorSyncCache() : null;

    return NextResponse.json({
      ...batch,
      cachedCount: (committedCache ?? syncCache).results.length,
      updatedAt: (committedCache ?? syncCache).updatedAt,
      committed: Boolean(committedCache),
      source: "sync"
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not validate the product sheet." },
      { status: 500 }
    );
  }
}
