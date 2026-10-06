import { NextResponse } from "next/server";

import { parseProductSheetSource } from "@/lib/product-sheet";
import { scrapeLiveProduct } from "@/lib/product-sheet-create";
import { createReview, listReviews, patchReview } from "@/lib/review-store";
import { getUpdatedListData } from "@/lib/updated-list";
import { getTaxRates } from "@/lib/woocommerce";

export const maxDuration = 300;

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`A valid ${label} is required.`);
  }

  return parsed;
}

function normalizedPrice(value: string | undefined) {
  const parsed = Number(value);
  return value?.trim() && Number.isFinite(parsed) ? parsed.toFixed(2) : "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rowNumber = positiveInteger(body.rowNumber, "sheet row number");
    const productId = positiveInteger(body.productId, "WooCommerce product ID");
    const sheetSource = parseProductSheetSource(body.source);
    if (sheetSource !== "updated-list") {
      return NextResponse.json({ error: "Price sync is only available for the Updated List." }, { status: 400 });
    }

    const data = await getUpdatedListData();
    const row = data.rows.find((candidate) => candidate.sheetRowNumber === rowNumber);

    if (!row?.wooId) {
      return NextResponse.json({ error: "The spreadsheet row or WooCommerce product was not found." }, { status: 404 });
    }

    if (row.ambiguousMatch || row.wooId !== productId) {
      return NextResponse.json(
        { error: "This row no longer has one clear WooCommerce product match. Refresh the list and try again." },
        { status: 409 }
      );
    }

    if (!row.sourceProductUrl) {
      return NextResponse.json(
        { error: "This spreadsheet row does not have a product-link to scrape." },
        { status: 400 }
      );
    }

    const [scraped, taxRates] = await Promise.all([
      scrapeLiveProduct(row.sourceProductUrl),
      getTaxRates()
    ]);
    const price = data.tax.pricesIncludeTax ? scraped.price : scraped.priceExVat;
    const currencyCode = scraped.priceCurrency || data.currency.code;
    const scrapedVatRate = Number(scraped.vatRate);
    const matchingTaxRate = Number.isFinite(scrapedVatRate)
      ? [...taxRates]
          .sort((first, second) => Number(first.class !== "standard") - Number(second.class !== "standard"))
          .find((rate) => Math.abs(Number(rate.rate) - scrapedVatRate) < 0.01)
      : undefined;

    if (!matchingTaxRate) {
      return NextResponse.json(
        {
          error: scraped.vatRate
            ? `The product-link VAT rate ${scraped.vatRate}% does not match a configured WooCommerce tax rate.`
            : "No VAT rate could be calculated from the product-link prices."
        },
        { status: 409 }
      );
    }
    const taxClass = matchingTaxRate.class === "standard" ? "" : matchingTaxRate.class;

    if (!price) {
      return NextResponse.json(
        {
          error: data.tax.pricesIncludeTax
            ? "No VAT-inclusive product price could be scraped from the spreadsheet product-link."
            : "No VAT-exclusive product price could be scraped from the spreadsheet product-link."
        },
        { status: 400 }
      );
    }

    const regularPrice = normalizedPrice(row.wooRegularPrice);
    const salePrice = normalizedPrice(row.wooSalePrice);
    const livePrice = normalizedPrice(row.wooLivePrice);
    const vatDataMatches =
      normalizedPrice(row.wooSavedPriceIncVat) === normalizedPrice(scraped.price) &&
      normalizedPrice(row.wooSavedPriceExVat) === normalizedPrice(scraped.priceExVat) &&
      normalizedPrice(row.wooSavedVatAmount) === normalizedPrice(scraped.vatAmount) &&
      normalizedPrice(row.wooSavedVatRate) === normalizedPrice(scraped.vatRate) &&
      row.wooSavedPriceCurrency.toUpperCase() === currencyCode.toUpperCase() &&
      row.wooSavedVatTaxClass === matchingTaxRate.class &&
      row.wooSavedVatRateName === matchingTaxRate.name;

    if (
      regularPrice === price &&
      !salePrice &&
      livePrice === price &&
      row.wooTaxStatus === "taxable" &&
      row.wooTaxClass === taxClass &&
      vatDataMatches
    ) {
      return NextResponse.json({
        alreadyMatches: true,
        price,
        priceIncVat: scraped.price,
        priceExVat: scraped.priceExVat,
        vatAmount: scraped.vatAmount,
        vatRate: scraped.vatRate,
        taxClass,
        taxClassLabel: matchingTaxRate.class === "standard" ? "Standard" : matchingTaxRate.name,
        taxRateName: matchingTaxRate.name,
        currencyCode,
        sourceUrl: scraped.url
      });
    }

    const existingReview = (await listReviews()).find((review) => {
      const before = review.before as {
        source?: string;
        sheetSource?: string;
        row?: { rowNumber?: number };
      } | null;

      return (
        review.resource === "product" &&
        review.action === "update" &&
        (review.status === "pending" || review.status === "failed") &&
        before?.source === "updated_list_price_sync" &&
        (before.sheetSource ?? "updated-list") === sheetSource &&
        before.row?.rowNumber === rowNumber
      );
    });
    const reviewInput = {
      resource: "product" as const,
      action: "update" as const,
      resourceId: row.wooId,
      title: `Sync product-link price for ${row.name}: ${currencyCode} ${livePrice || regularPrice || "not set"} to ${currencyCode} ${price} ${data.tax.pricesIncludeTax ? "inc VAT" : "ex VAT"}${scraped.price ? ` (${currencyCode} ${scraped.price} inc VAT)` : ""}; tax status Taxable, class ${matchingTaxRate.class === "standard" ? "Standard" : matchingTaxRate.name}`,
      before: {
        source: "updated_list_price_sync",
        sheetSource,
        row: {
          rowNumber: row.sheetRowNumber,
          values: { "price (inc vat)": row.sheetPrice },
          sku: row.sku,
          name: row.name,
          liveUrl: row.sourceProductUrl,
          categories: [],
          categoryHierarchy: []
        },
        product: {
          id: row.wooId,
          name: row.name,
          regular_price: regularPrice,
          sale_price: salePrice,
          price: livePrice,
          tax_status: row.wooTaxStatus,
          tax_class: row.wooTaxClass
        },
        expectedPrice: price,
        expectedPriceIncVat: scraped.price,
        expectedPriceExVat: scraped.priceExVat,
        vatAmount: scraped.vatAmount,
        vatRate: scraped.vatRate,
        currency: { ...data.currency, code: currencyCode },
        tax: data.tax,
        wooTaxRate: matchingTaxRate,
        scrapedProductUrl: scraped.url,
        previousRegularPrice: regularPrice,
        previousSalePrice: salePrice,
        previousLivePrice: livePrice
      },
      changes: {
        regular_price: price,
        sale_price: "",
        tax_status: "taxable" as const,
        tax_class: taxClass
      }
    };
    const review = existingReview
      ? await patchReview(existingReview.id, {
          ...reviewInput,
          status: "pending",
          error: undefined,
          reviewedAt: undefined
        })
      : await createReview(reviewInput);

    return NextResponse.json({
      review,
      price,
      priceIncVat: scraped.price,
      priceExVat: scraped.priceExVat,
      vatAmount: scraped.vatAmount,
      vatRate: scraped.vatRate,
      taxClass,
      taxClassLabel: matchingTaxRate.class === "standard" ? "Standard" : matchingTaxRate.name,
      taxRateName: matchingTaxRate.name,
      currencyCode,
      sourceUrl: scraped.url,
      alreadyExists: Boolean(existingReview)
    }, { status: existingReview ? 200 : 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create the price update review." },
      { status: 400 }
    );
  }
}
