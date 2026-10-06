import { NextResponse } from "next/server";

import { scrapeLiveProduct } from "@/lib/product-sheet-create";
import { getUpdatedListData } from "@/lib/updated-list";

export const maxDuration = 300;

function rowNumbers(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(Number)
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  ].slice(0, 12);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requestedRows = rowNumbers(body.rowNumbers);

    if (requestedRows.length === 0) {
      return NextResponse.json({ error: "At least one valid spreadsheet row is required." }, { status: 400 });
    }

    const data = await getUpdatedListData();
    const rowsByNumber = new Map(data.rows.map((row) => [row.sheetRowNumber, row]));
    const queue = requestedRows.map((rowNumber) => ({
      rowNumber,
      row: rowsByNumber.get(rowNumber)
    }));
    const results: Array<{
      rowNumber: number;
      sourceUrl: string;
      resolvedUrl?: string;
      price?: string;
      priceExVat?: string;
      vatAmount?: string;
      vatRate?: string;
      currencyCode?: string;
      scrapedAt: string;
      error?: string;
    }> = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < queue.length) {
        const item = queue[nextIndex];
        nextIndex += 1;
        const sourceUrl = item.row?.sourceProductUrl ?? "";
        const scrapedAt = new Date().toISOString();

        if (!item.row) {
          results.push({ rowNumber: item.rowNumber, sourceUrl, scrapedAt, error: "Spreadsheet row not found." });
          continue;
        }

        if (!sourceUrl) {
          results.push({ rowNumber: item.rowNumber, sourceUrl, scrapedAt, error: "No product-link in the spreadsheet." });
          continue;
        }

        try {
          const scraped = await scrapeLiveProduct(sourceUrl);

          results.push({
            rowNumber: item.rowNumber,
            sourceUrl,
            resolvedUrl: scraped.url,
            price: scraped.price,
            priceExVat: scraped.priceExVat,
            vatAmount: scraped.vatAmount,
            vatRate: scraped.vatRate,
            currencyCode: scraped.priceCurrency || data.currency.code,
            scrapedAt,
            ...(!scraped.price ? { error: "No product price was found on the product-link page." } : {})
          });
        } catch (error) {
          results.push({
            rowNumber: item.rowNumber,
            sourceUrl,
            scrapedAt,
            error: error instanceof Error ? error.message : "Could not scrape the product-link page."
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));

    return NextResponse.json({
      currency: data.currency,
      results: results.sort((first, second) => requestedRows.indexOf(first.rowNumber) - requestedRows.indexOf(second.rowNumber))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not scrape live product prices." },
      { status: 500 }
    );
  }
}
