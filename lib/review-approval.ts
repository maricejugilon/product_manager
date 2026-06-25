import "server-only";

import { resolveColourBoardImagesInChanges } from "@/lib/colour-board-media";
import { listReviews, patchReview } from "@/lib/review-store";
import type { CategoryChanges, CategoryMergeChanges, ProductChanges, ProductMergeChanges, ReviewRecord } from "@/lib/types";
import {
  createCategory,
  createProduct,
  deleteCategory,
  ensureProductAttributeTerms,
  mergeCategoryIntoTarget,
  mergeProductIntoTarget,
  updateCategory,
  updateProduct
} from "@/lib/woocommerce";

export type ApproveAllResult = {
  total: number;
  approved: number;
  failed: number;
  results: Array<{
    id: string;
    title: string;
    status: ReviewRecord["status"];
    error?: string;
  }>;
};

async function publishReview(review: ReviewRecord) {
  if (review.resource === "product" && review.action === "update" && review.resourceId) {
    const before = review.before as {
      source?: string;
      attributeConfig?: {
        make?: { id?: number };
        model?: { id?: number };
      };
      expected?: {
        make?: string[];
        model?: string[];
      };
    } | null;

    if (before?.source === "make_model_sheet") {
      const makeAttributeId = Number(before.attributeConfig?.make?.id);
      const modelAttributeId = Number(before.attributeConfig?.model?.id);

      if (!Number.isInteger(makeAttributeId) || !Number.isInteger(modelAttributeId)) {
        throw new Error("Make and Model attribute configuration is missing from this review.");
      }

      await ensureProductAttributeTerms(makeAttributeId, before.expected?.make ?? []);
      await ensureProductAttributeTerms(modelAttributeId, before.expected?.model ?? []);
    }

    const changes = await resolveColourBoardImagesInChanges(review.changes as ProductChanges);

    return updateProduct(review.resourceId, changes);
  }

  if (review.resource === "product" && review.action === "create") {
    const changes = await resolveColourBoardImagesInChanges(review.changes as ProductChanges);
    const safeImages = (changes.images ?? []).filter((image) => {
      if (!image.src) {
        return Boolean(image.id);
      }

      try {
        const url = new URL(image.src);

        return /\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname);
      } catch {
        return false;
      }
    });

    return createProduct({
      ...changes,
      images: safeImages.length > 0 ? safeImages : undefined
    });
  }

  if (review.resource === "category" && review.action === "update" && review.resourceId) {
    return updateCategory(review.resourceId, review.changes as CategoryChanges);
  }

  if (review.resource === "category" && review.action === "create") {
    return createCategory(review.changes as CategoryChanges);
  }

  if (review.resource === "category" && review.action === "delete" && review.resourceId) {
    return deleteCategory(review.resourceId);
  }

  if (review.resource === "category_merge" && review.action === "merge") {
    return mergeCategoryIntoTarget(review.changes as CategoryMergeChanges);
  }

  if (review.resource === "product_merge" && review.action === "merge") {
    return mergeProductIntoTarget(review.changes as ProductMergeChanges);
  }

  throw new Error("Unsupported review action.");
}

export async function approveReview(review: ReviewRecord) {
  try {
    const result = await publishReview(review);
    const updated = await patchReview(review.id, {
      status: "approved",
      result,
      error: undefined,
      reviewedAt: new Date().toISOString()
    });

    if (!updated) {
      throw new Error("Review not found after publishing.");
    }

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WooCommerce update failed.";
    const updated = await patchReview(review.id, {
      status: "failed",
      error: message,
      reviewedAt: new Date().toISOString()
    });

    if (!updated) {
      throw error;
    }

    return updated;
  }
}

export async function approveAllActionableReviews(): Promise<ApproveAllResult> {
  const actionable = (await listReviews()).filter(
    (review) => review.status === "pending" || review.status === "failed"
  );
  const results: ApproveAllResult["results"] = [];

  let approved = 0;
  let failed = 0;

  for (const review of actionable) {
    const updated = await approveReview(review);

    if (updated.status === "approved") {
      approved += 1;
    } else {
      failed += 1;
    }

    results.push({
      id: updated.id,
      title: updated.title,
      status: updated.status,
      error: updated.error
    });
  }

  return {
    total: actionable.length,
    approved,
    failed,
    results
  };
}
