"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  GitBranch,
  GitMerge,
  Search,
  ShieldCheck
} from "lucide-react";

import {
  buildProductMergeChanges,
  defaultProductMergeTarget,
  getProductDetailMatches,
  getProductDetailSummary,
  getProductDuplicateSignals,
  type DuplicateProductGroup
} from "@/lib/product-duplicates";
import type { WooProduct } from "@/lib/types";

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

function groupSearchText(group: DuplicateProductGroup) {
  return [
    group.title,
    ...group.matchReasons,
    ...group.products.flatMap((product) => [
      product.id,
      product.name,
      product.sku,
      categoryText(product)
    ])
  ]
    .join(" ")
    .toLowerCase();
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
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups[0] ? [groups[0].key] : [])
  );
  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();

    return query ? groups.filter((group) => groupSearchText(group).includes(query)) : groups;
  }, [groups, search]);
  const flaggedProductCount = useMemo(
    () => new Set(groups.flatMap((group) => group.products.map((product) => product.id))).size,
    [groups]
  );

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
          <h2>Review duplicate candidates</h2>
          <p className="page-copy">
            Select the listing to keep, choose how the other listing should be handled, and send
            the decision to the Review Queue.
          </p>
        </div>
        <div className="metrics">
          <span className="metric">
            <ShieldCheck size={18} />
            <strong>{groups.length}</strong>
            Groups
          </span>
          <span className="metric">
            <Copy size={18} />
            <strong>{flaggedProductCount}</strong>
            Products flagged
          </span>
        </div>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {groups.length === 0 ? (
        <div className="empty panel">No duplicate products found in this scan.</div>
      ) : (
        <>
          <div className="duplicate-list-toolbar">
            <label className="duplicate-search">
              <Search size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search product name, SKU, ID, or category"
              />
            </label>
            <span className="subtle">
              {filteredGroups.length} of {groups.length} groups
            </span>
          </div>

          {filteredGroups.length === 0 ? (
            <div className="empty panel">No duplicate groups match this search.</div>
          ) : (
          <div className="duplicate-groups">
          {filteredGroups.map((group) => {
            const targetId = targetByGroup[group.key] ?? defaultProductMergeTarget(group.products).id;
            const target = group.products.find((product) => product.id === targetId) ?? group.products[0];
            const recommendedTarget = defaultProductMergeTarget(group.products);
            const mode = modeByGroup[group.key] ?? "duplicate";
            const variationAttributeName = attributeByGroup[group.key] ?? "Variant";

            return (
              <details
                className="duplicate-card duplicate-review-group"
                key={group.key}
                open={openGroups.has(group.key)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;

                  setOpenGroups((current) => {
                    const next = new Set(current);

                    if (isOpen) {
                      next.add(group.key);
                    } else {
                      next.delete(group.key);
                    }

                    return next;
                  });
                }}
              >
                <summary className="duplicate-group-summary">
                  <div className="duplicate-group-title">
                    <ChevronDown className="duplicate-group-chevron" size={18} />
                    <div>
                      <h3>{group.title}</h3>
                      <span className="subtle">{group.products.length} possible matches</span>
                    </div>
                  </div>
                  <div className="duplicate-group-signals">
                    {group.matchReasons.map((reason) => (
                      <span className="duplicate-signal" key={reason}>{reason}</span>
                    ))}
                    <span className="status neutral">Keep #{targetId}</span>
                  </div>
                </summary>

                <div className="duplicate-decision-panel">
                  <div className="duplicate-decision-heading">
                    <div>
                      <span className="duplicate-step-label">Product to keep</span>
                      <strong>#{target.id} {target.name}</strong>
                    </div>
                    {target.id === recommendedTarget.id ? (
                      <span className="status approved">
                        <CheckCircle2 size={14} />
                        Recommended
                      </span>
                    ) : null}
                  </div>

                  <div className="duplicate-mode-picker" aria-label="Merge type">
                    <button
                      className={mode === "duplicate" ? "active" : ""}
                      type="button"
                      onClick={() =>
                        setModeByGroup((current) => ({ ...current, [group.key]: "duplicate" }))
                      }
                    >
                      <Copy size={18} />
                      <span>
                        <strong>Merge duplicate</strong>
                        <small>Combine missing details and hide the other listing.</small>
                      </span>
                    </button>
                    <button
                      className={mode === "variation" ? "active" : ""}
                      type="button"
                      onClick={() =>
                        setModeByGroup((current) => ({ ...current, [group.key]: "variation" }))
                      }
                    >
                      <GitBranch size={18} />
                      <span>
                        <strong>Create variations</strong>
                        <small>Keep both choices under one variable product.</small>
                      </span>
                    </button>
                  </div>

                  {mode === "variation" ? (
                    <div className="field duplicate-variant-field">
                      <label htmlFor={`variation-attribute-${group.key}`}>Variation name</label>
                      <input
                        id={`variation-attribute-${group.key}`}
                        value={variationAttributeName}
                        onChange={(event) =>
                          setAttributeByGroup((current) => ({
                            ...current,
                            [group.key]: event.target.value
                          }))
                        }
                        placeholder="Example: Size, Model, Capacity"
                      />
                    </div>
                  ) : null}
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
                            <label className="duplicate-keep-choice">
                              <input
                                type="radio"
                                name={`keep-${group.key}`}
                                value={product.id}
                                checked={isTarget}
                                onChange={() =>
                                  setTargetByGroup((current) => ({
                                    ...current,
                                    [group.key]: product.id
                                  }))
                                }
                              />
                              <span>{isTarget ? "Selected to keep" : "Keep this product"}</span>
                            </label>
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
                          <span className="duplicate-column-label">Listing</span>
                          <strong className={`status ${product.status === "publish" ? "approved" : "neutral"}`}>
                            {product.status}
                          </strong>
                          <small>
                            {product.regular_price ? `GBP ${product.regular_price}` : "No regular price"} /{" "}
                            {product.stock_status}
                          </small>
                        </div>

                        <div>
                          <span className="duplicate-column-label">Completeness</span>
                          <strong>{detailSummary.score} points</strong>
                          <small>{detailSummary.facts.slice(0, 5).join(", ")}</small>
                        </div>

                        <div>
                          <span className="duplicate-column-label">Why it matched</span>
                          <div className="duplicate-signal-list">
                            {duplicateSignals.map((signal) => (
                              <span className="duplicate-signal" key={signal}>{signal}</span>
                            ))}
                          </div>
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
                            <span className="status approved">
                              <CheckCircle2 size={14} />
                              Kept product
                            </span>
                          ) : (
                            <>
                              <span className="duplicate-outcome">
                                {mode === "variation"
                                  ? `Becomes a ${variationAttributeName || "Variant"} option`
                                  : "Details merge into kept product; listing becomes hidden"}
                              </span>
                              <button
                                className="button"
                                type="button"
                                disabled={busyKey !== null}
                                onClick={() => createMergeReview(group, product)}
                              >
                                <GitMerge size={17} />
                                {busy ? "Creating review" : "Send to review"}
                              </button>
                            </>
                          )}
                        </div>

                        {preview ? (
                          <details className="product-merge-preview">
                            <summary className="subtle">
                              Advanced change preview
                            </summary>
                            <p className="subtle">
                              {mode === "variation"
                                ? `Creates a variable product with ${preview.targetVariation ? "a kept-product variation and " : ""}a variation from this listing.`
                                : `${changeCount(preview.targetChanges)} kept-product fields and ${changeCount(preview.sourceChanges)} duplicate-product fields will change.`}
                            </p>
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
              </details>
            );
          })}
          </div>
          )}
        </>
      )}
    </section>
  );
}
