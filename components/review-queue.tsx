"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, ExternalLink, X } from "lucide-react";

import ProgressBar from "@/components/progress-bar";
import type { ReviewRecord } from "@/lib/types";

function formatReviewDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const phtDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = phtDate.getUTCFullYear();
  const month = String(phtDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(phtDate.getUTCDate()).padStart(2, "0");
  const hour24 = phtDate.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(phtDate.getUTCMinutes()).padStart(2, "0");
  const second = String(phtDate.getUTCSeconds()).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";

  return `${year}-${month}-${day} ${hour12}:${minute}:${second} ${suffix} PHT`;
}

type ReviewProductSnapshot = {
  id: number;
  name: string;
  sku: string;
  permalink: string;
  image: string;
  status: string;
  stockStatus: string;
  regularPrice: string;
  categories: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function productSnapshot(value: unknown): ReviewProductSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNumber(value.id);

  if (!id) {
    return null;
  }

  const images = Array.isArray(value.images) ? value.images : [];
  const image =
    images
      .filter(isRecord)
      .map((item) => asString(item.src))
      .find(Boolean) ?? "";
  const categories = Array.isArray(value.categories)
    ? value.categories
        .filter(isRecord)
        .map((category) => asString(category.name) || `#${asNumber(category.id) ?? ""}`)
        .filter(Boolean)
    : [];

  return {
    id,
    name: asString(value.name) || `Product #${id}`,
    sku: asString(value.sku),
    permalink: asString(value.permalink),
    image,
    status: asString(value.status),
    stockStatus: asString(value.stock_status),
    regularPrice: asString(value.regular_price),
    categories
  };
}

function productMergeSummary(review: ReviewRecord) {
  if (review.resource !== "product_merge" || !isRecord(review.before)) {
    return null;
  }

  const checks = isRecord(review.before.checks) ? review.before.checks : {};
  const changes = isRecord(review.changes) ? (review.changes as Record<string, unknown>) : {};
  const mode = changes.mode === "variation" ? "variation" : "duplicate";

  return {
    mode,
    variationAttributeName: asString(changes.variationAttributeName),
    sourceVariationOption: asString(changes.sourceVariationOption),
    targetVariationOption: asString(changes.targetVariationOption),
    source: productSnapshot(review.before.source),
    target: productSnapshot(review.before.target),
    matchReasons: stringList(checks.matchReasons),
    detailMatches: stringList(checks.detailMatches)
  };
}

function ReviewProductCard({ label, product }: { label: string; product: ReviewProductSnapshot }) {
  return (
    <div className="review-product-card">
      {product.image ? (
        <a href={product.permalink || `/products/${product.id}`} target={product.permalink ? "_blank" : undefined} rel="noreferrer">
          <img src={product.image} alt="" />
        </a>
      ) : (
        <span className="review-product-image" aria-hidden />
      )}
      <div>
        <span className="subtle">{label}</span>
        <strong>
          #{product.id} {product.name}
        </strong>
        <span className="subtle">SKU: {product.sku || "No SKU"}</span>
        <span className="subtle">
          {product.regularPrice ? `GBP ${product.regularPrice}` : "No regular price"} /{" "}
          {product.stockStatus || product.status || "No status"}
        </span>
        <span className="subtle">{product.categories.join(", ") || "Uncategorized"}</span>
        <span className="product-link-row">
          <a href={`/products/${product.id}`}>Edit in manager</a>
          {product.permalink ? (
            <a href={product.permalink} target="_blank" rel="noreferrer">
              Store page
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function ProductMergeReviewSummary({ review }: { review: ReviewRecord }) {
  const summary = productMergeSummary(review);

  if (!summary || (!summary.source && !summary.target)) {
    return null;
  }

  return (
    <div className="review-merge-summary">
      <div className="review-merge-mode">
        <span className="status neutral">{summary.mode === "variation" ? "Variable product" : "Duplicate merge"}</span>
        {summary.mode === "variation" ? (
          <span className="subtle">
            {summary.variationAttributeName || "Variant"}: {summary.targetVariationOption || "kept product"} /{" "}
            {summary.sourceVariationOption || "duplicate product"}
          </span>
        ) : null}
      </div>
      <div className="review-merge-products">
        {summary.source ? <ReviewProductCard label="Duplicate product" product={summary.source} /> : null}
        {summary.target ? <ReviewProductCard label="Keep product" product={summary.target} /> : null}
      </div>
      {summary.matchReasons.length > 0 || summary.detailMatches.length > 0 ? (
        <div className="review-merge-checks">
          {summary.matchReasons.length > 0 ? (
            <span className="subtle">Match: {summary.matchReasons.join(", ")}</span>
          ) : null}
          {summary.detailMatches.length > 0 ? (
            <span className="subtle">Details: {summary.detailMatches.join(", ")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function ReviewQueue({ reviews }: { reviews: ReviewRecord[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"approve" | "reject" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const actionableReviews = reviews.filter(
    (review) => review.status === "pending" || review.status === "failed"
  );
  const actionableCount = actionableReviews.length;

  async function act(id: string, action: "approve" | "reject") {
    const progressLabel = action === "approve" ? "Approving review" : "Rejecting review";

    setBusyId(id);
    setBusyAction(action);
    setMessage("");
    setError("");
    setProgress({ current: 0, total: 1, label: progressLabel });

    try {
      const response = await fetch(`/api/reviews/${id}/${action}`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      setProgress({ current: 1, total: 1, label: progressLabel });
      setMessage(`Review ${action === "approve" ? "approved" : "rejected"}.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review action failed.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
      setProgress(null);
    }
  }

  async function approveAll() {
    if (actionableCount === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Approve and publish ${actionableCount} pending/failed review${actionableCount === 1 ? "" : "s"} to WooCommerce?`
    );

    if (!confirmed) {
      return;
    }

    setBulkBusy(true);
    setMessage("");
    setError("");
    setProgress({ current: 0, total: actionableReviews.length, label: "Approving reviews" });

    try {
      let approved = 0;
      let failed = 0;

      for (const [index, review] of actionableReviews.entries()) {
        const response = await fetch(`/api/reviews/${review.id}/approve`, { method: "POST" });

        if (response.ok) {
          approved += 1;
        } else {
          failed += 1;
        }

        setProgress({
          current: index + 1,
          total: actionableReviews.length,
          label: "Approving reviews"
        });
      }

      setMessage(
        `Approved ${approved} review${approved === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approve all failed.");
    } finally {
      setBulkBusy(false);
      setProgress(null);
    }
  }

  if (reviews.length === 0) {
    return <div className="empty panel">No review drafts yet.</div>;
  }

  return (
    <section className="review-list">
      <div className="review-toolbar">
        <div>
          <strong>{actionableCount} ready to approve</strong>
          <span className="subtle">Pending and failed reviews can be published together.</span>
        </div>
        <button
          className="button success"
          type="button"
          disabled={bulkBusy || busyId !== null || actionableCount === 0}
          onClick={approveAll}
        >
          <CheckCheck size={17} />
          {bulkBusy ? "Approving" : "Approve All"}
        </button>
      </div>
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {progress ? <ProgressBar {...progress} /> : null}
      {reviews.map((review) => (
        <article className="review-item" key={review.id}>
          <div className="review-main">
            <div>
              <span className={`status ${review.status}`}>{review.status}</span>
              <h2>{review.title}</h2>
              <p className="subtle">
                {review.resource} {review.action}
                {review.resourceId ? ` #${review.resourceId}` : ""} -{" "}
                {formatReviewDate(review.createdAt)}
              </p>
              {review.error ? <p className="error">{review.error}</p> : null}
            </div>
            <div className="actions">
              {(review.resource === "product" || review.resource === "product_merge") && review.resourceId ? (
                <a className="icon-button secondary" href={`/products/${review.resourceId}`} title="Open product">
                  <ExternalLink size={17} />
                </a>
              ) : null}
              {review.status === "pending" || review.status === "failed" ? (
                <>
                  <button
                    className="button success"
                    type="button"
                    disabled={bulkBusy || busyId !== null}
                    onClick={() => act(review.id, "approve")}
                  >
                    <Check size={17} />
                    {busyId === review.id && busyAction === "approve" ? "Approving" : "Approve"}
                  </button>
                  <button
                    className="button danger"
                    type="button"
                    disabled={bulkBusy || busyId !== null}
                    onClick={() => act(review.id, "reject")}
                  >
                    <X size={17} />
                    {busyId === review.id && busyAction === "reject" ? "Rejecting" : "Reject"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <ProductMergeReviewSummary review={review} />
          <details>
            <summary className="panel-body">View change payload</summary>
            <div className="panel-body">
              <pre className="json-box">{JSON.stringify({ before: review.before, changes: review.changes }, null, 2)}</pre>
            </div>
          </details>
        </article>
      ))}
    </section>
  );
}
