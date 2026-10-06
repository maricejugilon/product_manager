import { NextResponse } from "next/server";

import { scrapeLiveProductStock } from "@/lib/product-sheet-create";

export const maxDuration = 300;

function stockRows(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Map<number, { rowNumber: number; sourceUrl: string }>();

  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const rowNumber = Number((item as Record<string, unknown>).rowNumber);
    const sourceUrl = String((item as Record<string, unknown>).sourceUrl ?? "").trim();

    if (!Number.isInteger(rowNumber) || rowNumber < 1 || !sourceUrl) return;

    try {
      const parsed = new URL(sourceUrl);
      const hostname = parsed.hostname.toLowerCase();
      const trustedHost = hostname === "flightcasewarehouse.co.uk" || hostname.endsWith(".flightcasewarehouse.co.uk");

      if (parsed.protocol === "https:" && trustedHost) {
        unique.set(rowNumber, { rowNumber, sourceUrl: parsed.toString() });
      }
    } catch {
      // Invalid or untrusted URLs are omitted from the scrape queue.
    }
  });

  return [...unique.values()].slice(0, 12);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const queue = stockRows(body.rows);

    if (queue.length === 0) {
      return NextResponse.json(
        { error: "At least one valid Flightcase Warehouse product-link is required." },
        { status: 400 }
      );
    }

    const results: Array<{
      rowNumber: number;
      sourceUrl: string;
      resolvedUrl?: string;
      stockStatus?: "instock" | "outofstock" | "onbackorder";
      checkedAt: string;
      error?: string;
    }> = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < queue.length) {
        const item = queue[nextIndex];
        nextIndex += 1;
        const sourceUrl = item.sourceUrl;
        const checkedAt = new Date().toISOString();

        try {
          const scraped = await scrapeLiveProductStock(sourceUrl);
          results.push({
            rowNumber: item.rowNumber,
            sourceUrl,
            resolvedUrl: scraped.url,
            stockStatus: scraped.stockStatus,
            checkedAt,
            ...(!scraped.stockStatus ? { error: "No clear stock status was found on the product-link page." } : {})
          });
        } catch (error) {
          results.push({
            rowNumber: item.rowNumber,
            sourceUrl,
            checkedAt,
            error: error instanceof Error ? error.message : "Could not check the product-link stock status."
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));

    return NextResponse.json({
      results: results.sort(
        (first, second) =>
          queue.findIndex((item) => item.rowNumber === first.rowNumber) -
          queue.findIndex((item) => item.rowNumber === second.rowNumber)
      )
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not check live stock statuses." },
      { status: 500 }
    );
  }
}
