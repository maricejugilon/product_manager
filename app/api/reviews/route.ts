import { NextResponse } from "next/server";

import { createReview, isReviewStorageMissing, listReviews } from "@/lib/review-store";
import { compactCategoryChanges, compactProductChanges, hasMeaningfulChanges } from "@/lib/sanitize";
import { getCategory, getProduct } from "@/lib/woocommerce";

export async function GET() {
  return NextResponse.json(await listReviews());
}

export async function POST(request: Request) {
  try {
    if (isReviewStorageMissing()) {
      return NextResponse.json(
        { error: "Review storage is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const resource = body.resource;
    const action = body.action;
    const resourceId = body.resourceId ? Number(body.resourceId) : undefined;

    if (resource === "product" && action === "update" && resourceId) {
      const changes = compactProductChanges(body.changes);
      if (!hasMeaningfulChanges(changes)) {
        return NextResponse.json({ error: "No product changes were submitted." }, { status: 400 });
      }

      const before = await getProduct(resourceId);
      const review = await createReview({
        resource,
        action,
        resourceId,
        title: `Update product: ${before.name}`,
        before,
        changes
      });

      return NextResponse.json(review, { status: 201 });
    }

    if (resource === "product" && action === "create") {
      const changes = compactProductChanges(body.changes);
      if (!changes.name || !hasMeaningfulChanges(changes)) {
        return NextResponse.json({ error: "Product name is required." }, { status: 400 });
      }

      const review = await createReview({
        resource,
        action,
        title: `Create product: ${changes.name}`,
        before: body.before ?? null,
        changes
      });

      return NextResponse.json(review, { status: 201 });
    }

    if (resource === "category" && action === "update" && resourceId) {
      const changes = compactCategoryChanges(body.changes);
      if (!hasMeaningfulChanges(changes)) {
        return NextResponse.json({ error: "No category changes were submitted." }, { status: 400 });
      }

      const before = await getCategory(resourceId);
      const review = await createReview({
        resource,
        action,
        resourceId,
        title: `Update category: ${before.name}`,
        before,
        changes
      });

      return NextResponse.json(review, { status: 201 });
    }

    if (resource === "category" && action === "create") {
      const changes = compactCategoryChanges(body.changes);
      if (!changes.name || !hasMeaningfulChanges(changes)) {
        return NextResponse.json({ error: "Category name is required." }, { status: 400 });
      }

      const review = await createReview({
        resource,
        action,
        title: `Create category: ${changes.name}`,
        before: null,
        changes
      });

      return NextResponse.json(review, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported review request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create review." },
      { status: 500 }
    );
  }
}
