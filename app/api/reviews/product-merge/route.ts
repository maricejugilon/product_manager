import { NextResponse } from "next/server";

import {
  buildProductMergeChanges,
  getProductDetailMatches,
  getProductDuplicateSignals
} from "@/lib/product-duplicates";
import { createReview, listReviews } from "@/lib/review-store";
import { getProduct } from "@/lib/woocommerce";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceId = Number(body.sourceId);
    const targetId = Number(body.targetId);
    const mode = body.mode === "variation" ? "variation" : "duplicate";
    const variationAttributeName =
      typeof body.variationAttributeName === "string" ? body.variationAttributeName : undefined;
    const sourceVariationOption =
      typeof body.sourceVariationOption === "string" ? body.sourceVariationOption : undefined;
    const targetVariationOption =
      typeof body.targetVariationOption === "string" ? body.targetVariationOption : undefined;

    if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId <= 0 || targetId <= 0) {
      return NextResponse.json({ error: "Source and target products are required." }, { status: 400 });
    }

    if (sourceId === targetId) {
      return NextResponse.json({ error: "Source and target products must be different." }, { status: 400 });
    }

    const existing = (await listReviews()).find((review) => {
      const changes = review.changes as { mode?: string; sourceId?: number; targetId?: number };
      return review.resource === "product_merge" &&
        review.action === "merge" &&
        (review.status === "pending" || review.status === "failed") &&
        changes.mode === mode &&
        changes.sourceId === sourceId &&
        changes.targetId === targetId;
    });

    if (existing) {
      return NextResponse.json({ ...existing, alreadyExists: true });
    }

    const [source, target] = await Promise.all([getProduct(sourceId), getProduct(targetId)]);
    const matchReasons = getProductDuplicateSignals(source, target);

    if (matchReasons.length === 0) {
      return NextResponse.json(
        { error: "These products do not currently match by name or SKU. Review them manually before merging." },
        { status: 400 }
      );
    }

    const changes = buildProductMergeChanges(source, target, matchReasons, {
      mode,
      variationAttributeName,
      sourceVariationOption,
      targetVariationOption
    });
    const review = await createReview({
      resource: "product_merge",
      action: "merge",
      resourceId: source.id,
      title:
        mode === "variation"
          ? `Create variation: ${source.name} #${source.id} under #${target.id}`
          : `Merge product: ${source.name} #${source.id} into #${target.id}`,
      before: {
        source,
        target,
        checks: {
          matchReasons,
          detailMatches: getProductDetailMatches(source, target)
        }
      },
      changes
    });

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create product merge review." },
      { status: 500 }
    );
  }
}
