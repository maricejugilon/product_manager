"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, ExternalLink, GitMerge, ShieldCheck } from "lucide-react";

import {
  buildProductMergeChanges,
  defaultProductMergeTarget,
  getProductCompletenessScore,
  getProductDetailMatches,
  getProductDetailSummary,
  getProductDuplicateSignals,
  type DuplicateProductGroup
} from "@/lib/product-duplicates";
import type { WooProduct } from "@/lib/types";

function productLabel(product: WooProduct) {
  return `#${product.id} - ${product.sku || "No SKU"} - ${product.name}`;
}

function categoryText(product: WooProduct) {
  return product.categories.map((category) => category.name).filter(Boolean).join(", ") || "Uncategorized";
}

function changeCount(value: object) {
  return Object.keys(value).length;
}

function primaryImage(product: WooProduct) {
  return product.images?.find((image) => image.src)?.src ?? "";
}

function defaultVariationOption(product: WooProduct) {
  return product.sku || product.name || `Product ${product.id}`;
}

export default function ProductDuplicateTool({
  groups,
  productsScanned
}: {
  groups: DuplicateProductGroup[];
  productsScanned: number;
}) {
  const router = useRouter();
  const [targetByGroup, setTargetByGroup] = useState<Record<string, number>>({});
  const [modeByGroup, setModeByGroup] = useState<Record<string, "duplicate" | "variation">>({});
  const [attributeByGroup, setAttributeByGroup] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function createMergeReview(group: DuplicateProductGroup, source: WooProduct) {
    const targetId = targetByGroup[group.key] ?? defaultProductMergeTarget(group.products).id;
    const target = group.products.find((product) => product.id === targetId);
    const mode = modeByGroup[group.key] ?? "duplicate";
    const variationAttributeName = attributeByGroup[group.key]?.trim() || "Variant";

    if (!target) {
      setError("Target product was not found.");
      return;
    }

    const confirmed = window.confirm(
      mode === "variation"
        ? `Create a review to convert product #${target.id} into a variable product and add #${source.id} as a variation?`
        : `Create a review to merge product #${source.id} into #${target.id}? Approval will update the kept product and hide the duplicate.`
    );

    if (!confirmed) {
      return;
    }

    setBusyKey(`${group.key}-${source.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/reviews/product-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          targetId,
          mode,
          variationAttributeName
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage(
        mode === "variation"
          ? `Variation review created for ${source.name} #${source.id}. Approve it in the Review Queue.`
          : `Merge review created for ${source.name} #${source.id}. Approve it in the Review Queue.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create product merge review.");
    } finally {
      setBusyKey(null);
    }
  }

  if (productsScanned === 0) {
    return <div className="empty panel">No products found for this category filter.</div>;
  }

  return (
    <section className="product-duplicate-section">
      <div className="category-merge-head">
        <div>
          <h2>Duplicate Product Check</h2>
          <p className="page-copy">
            Products are grouped when names match or SKU values overlap. Pick the product to keep,
            compare details, then create a merge review.
          </p>
        </div>
        <span className="metric">
          <ShieldCheck size={18} />
          <strong>{groups.length}</strong>
          Duplicate groups
        </span>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {groups.length === 0 ? (
        <div className="empty panel">No duplicate products found in this scan.</div>
      ) : (
        <div className="duplicate-groups">
          {groups.map((group) => {
            const targetId = targetByGroup[group.key] ?? defaultProductMergeTarget(group.products).id;
            const target = group.products.find((product) => product.id === targetId) ?? group.products[0];
            const mode = modeByGroup[group.key] ?? "duplicate";
            const variationAttributeName = attributeByGroup[group.key] ?? "Variant";

            return (
              <article className="duplicate-card" key={group.key}>
                <div className="duplicate-card-head">
                  <div>
                    <h3>{group.title}</h3>
                    <span className="subtle">
                      {group.products.length} products matched by {group.matchReasons.join(", ")}
                    </span>
                  </div>
                  <div className="product-merge-controls">
                    <div className="field">
                      <label htmlFor={`product-target-${group.key}`}>Keep product</label>
                      <select
                        id={`product-target-${group.key}`}
                        value={targetId}
                        onChange={(event) =>
                          setTargetByGroup((current) => ({
                            ...current,
                            [group.key]: Number(event.target.value)
                          }))
                        }
                      >
                        {group.products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {productLabel(product)} ({getProductCompletenessScore(product)} detail score)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`merge-mode-${group.key}`}>Merge as</label>
                      <select
                        id={`merge-mode-${group.key}`}
                        value={mode}
                        onChange={(event) =>
                          setModeByGroup((current) => ({
                            ...current,
                            [group.key]: event.target.value === "variation" ? "variation" : "duplicate"
                          }))
                        }
                      >
                        <option value="duplicate">Duplicate product</option>
                        <option value="variation">Variable product</option>
                      </select>
                    </div>
                    {mode === "variation" ? (
                      <div className="field">
                        <label htmlFor={`variation-attribute-${group.key}`}>Variant attribute</label>
                        <input
                          id={`variation-attribute-${group.key}`}
                          value={variationAttributeName}
                          onChange={(event) =>
                            setAttributeByGroup((current) => ({
                              ...current,
                              [group.key]: event.target.value
                            }))
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="product-duplicate-compare">
                  {group.products.map((product) => {
                    const isTarget = product.id === targetId;
                    const busy = busyKey === `${group.key}-${product.id}`;
                    const duplicateSignals = isTarget ? group.matchReasons : getProductDuplicateSignals(product, target);
                    const detailMatches = isTarget ? [] : getProductDetailMatches(product, target);
                    const detailSummary = getProductDetailSummary(product);
                    const preview = isTarget
                      ? null
                      : buildProductMergeChanges(product, target, duplicateSignals, {
                          mode,
                          variationAttributeName
                        });

                    return (
                      <div className={`product-duplicate-row ${isTarget ? "target" : ""}`} key={product.id}>
                        <div className="product-duplicate-main">
                          {primaryImage(product) && product.permalink ? (
                            <a href={product.permalink} target="_blank" rel="noreferrer" title="Open store page">
                              <img className="product-duplicate-image" src={primaryImage(product)} alt="" />
                            </a>
                          ) : primaryImage(product) ? (
                            <img className="product-duplicate-image" src={primaryImage(product)} alt="" />
                          ) : (
                            <span className="product-duplicate-image" aria-hidden />
                          )}
                          <div>
                            <strong>
                              #{product.id} {product.name}
                            </strong>
                            <span className="subtle">SKU: {product.sku || "No SKU"}</span>
                            <span className="subtle">Categories: {categoryText(product)}</span>
                            <span className="product-link-row">
                              <Link href={`/products/${product.id}`}>Edit in manager</Link>
                              {product.permalink ? (
                                <a href={product.permalink} target="_blank" rel="noreferrer">
                                  Store page
                                </a>
                              ) : null}
                            </span>
                          </div>
                        </div>

                        <div>
                          <span className="subtle">Listing</span>
                          <strong>{product.status}</strong>
                          <small>
                            {product.regular_price ? `GBP ${product.regular_price}` : "No regular price"} /{" "}
                            {product.stock_status}
                          </small>
                        </div>

                        <div>
                          <span className="subtle">Details</span>
                          <strong>{detailSummary.score}</strong>
                          <small>{detailSummary.facts.slice(0, 5).join(", ")}</small>
                        </div>

                        <div>
                          <span className="subtle">Checks</span>
                          <small>{duplicateSignals.join(", ")}</small>
                          {mode === "variation" ? (
                            <small>Variant option: {defaultVariationOption(product)}</small>
                          ) : null}
                          {!isTarget && detailMatches.length > 0 ? <small>{detailMatches.join(", ")}</small> : null}
                        </div>

                        <div className="actions">
                          <Link className="icon-button secondary" href={`/products/${product.id}`} title="Edit product">
                            <Edit3 size={17} />
                          </Link>
                          {product.permalink ? (
                            <a
                              className="icon-button secondary"
                              href={product.permalink}
                              target="_blank"
                              rel="noreferrer"
                              title="Open store page"
                            >
                              <ExternalLink size={17} />
                            </a>
                          ) : null}
                          {isTarget ? (
                            <span className="status approved">Target</span>
                          ) : (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => createMergeReview(group, product)}
                            >
                              <GitMerge size={17} />
                              {busy ? "Creating" : mode === "variation" ? "Variation Review" : "Merge Review"}
                            </button>
                          )}
                        </div>

                        {preview ? (
                          <details className="product-merge-preview">
                            <summary className="subtle">
                              {mode === "variation"
                                ? `Review preview: variable product, ${preview.targetVariation ? "kept product variation, " : ""}duplicate variation`
                                : `Review preview: ${changeCount(preview.targetChanges)} target changes, ${changeCount(preview.sourceChanges)} duplicate changes`}
                            </summary>
                            <pre className="json-box">
                              {JSON.stringify(
                                {
                                  mode: preview.mode,
                                  targetProduct: preview.targetId,
                                  targetChanges: preview.parentChanges ?? preview.targetChanges,
                                  targetVariation: preview.targetVariation,
                                  duplicateProduct: preview.sourceId,
                                  duplicateChanges: preview.sourceChanges,
                                  duplicateVariation: preview.sourceVariation
                                },
                                null,
                                2
                              )}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
