"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileQuestion,
  HelpCircle,
  RefreshCw,
  Search,
  Send,
  Tags,
  X
} from "lucide-react";

import ProgressBar from "@/components/progress-bar";
import PagePurpose from "@/components/page-purpose";
import type {
  MakeModelProductResult,
  MakeModelReport,
  MakeModelUnresolvedLink
} from "@/lib/make-model-validator";

type MakeModelResponse = MakeModelReport & {
  pendingProductIds: number[];
  error?: string;
};

type View = "issues" | "matched" | "missing_woo" | "unresolved";
const pageSize = 10;

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function compactValues(values: string[]) {
  if (values.length === 0) {
    return "None";
  }

  return values.length > 3
    ? `${values.slice(0, 3).join(", ")} +${values.length - 3} more`
    : values.join(", ");
}

function ValueList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="make-model-empty-value">None</span>;
  }

  return (
    <div className="make-model-value-list">
      {values.map((value) => (
        <span key={value}>{value}</span>
      ))}
    </div>
  );
}

function ProductRow({
  result,
  selected,
  pending,
  busy,
  disabled,
  onToggle,
  onReview
}: {
  result: MakeModelProductResult;
  selected: boolean;
  pending: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onReview: () => void;
}) {
  const product = result.product;
  const canReview = Boolean(product && result.status === "matched" && !result.matches);

  return (
    <article className={`make-model-product ${selected ? "selected" : ""}`}>
      <div className="make-model-product-select">
        <input
          type="checkbox"
          aria-label={`Select ${product?.name ?? result.sku}`}
          checked={selected}
          disabled={!canReview || pending || disabled}
          onChange={onToggle}
        />
      </div>
      <div className="make-model-product-main">
        {product?.image ? <img src={product.image} alt="" /> : <span className="make-model-product-image" aria-hidden />}
        <div>
          {product ? (
            <Link href={`/products/${product.id}`}>
              <strong>{product.name}</strong>
            </Link>
          ) : (
            <strong>No verified WooCommerce product</strong>
          )}
          <span className="subtle">Sheet SKU: {result.sku}</span>
          {product ? (
            <>
              <span className="subtle">Woo SKU: {product.sku || "Not set"} / ID {product.id}</span>
              <span className="make-model-links">
                <Link href={`/products/${product.id}`}>Manage product</Link>
                {product.permalink ? (
                  <a href={product.permalink} target="_blank" rel="noreferrer">
                    Store page <ExternalLink size={12} />
                  </a>
                ) : null}
              </span>
            </>
          ) : result.candidates.length > 0 ? (
            <span className="subtle">{result.candidates.length} products share this SKU</span>
          ) : null}
        </div>
      </div>
      <div className="make-model-comparison">
        <div>
          <div className="make-model-comparison-head">
            <strong>Make</strong>
            <span className={`status ${result.makeMatches ? "approved" : "pending"}`}>
              {result.makeMatches ? "Matches" : "Needs update"}
            </span>
          </div>
          <details>
            <summary title={`Sheet: ${compactValues(result.makes)} | Woo: ${compactValues(result.wooMakes)}`}>
              Sheet {result.makes.length} / Woo {result.wooMakes.length}
            </summary>
            <div className="make-model-diff">
              <div>
                <span>Google Sheet</span>
                <ValueList values={result.makes} />
              </div>
              <div>
                <span>WooCommerce</span>
                <ValueList values={result.wooMakes} />
              </div>
            </div>
          </details>
        </div>
        <div>
          <div className="make-model-comparison-head">
            <strong>Model</strong>
            <span className={`status ${result.modelMatches ? "approved" : "pending"}`}>
              {result.modelMatches ? "Matches" : "Needs update"}
            </span>
          </div>
          <details>
            <summary title={`Sheet: ${compactValues(result.models)} | Woo: ${compactValues(result.wooModels)}`}>
              Sheet {result.models.length} / Woo {result.wooModels.length}
            </summary>
            <div className="make-model-diff">
              <div>
                <span>Google Sheet</span>
                <ValueList values={result.models} />
              </div>
              <div>
                <span>WooCommerce</span>
                <ValueList values={result.wooModels} />
              </div>
            </div>
          </details>
        </div>
      </div>
      <div className="make-model-source">
        <span>{result.sourceLinks} product links</span>
        <span>{result.sourceRows.length} sheet rows</span>
        <span className={`status ${result.status === "matched" ? "approved" : "failed"}`}>
          {result.status === "matched"
            ? "SKU verified"
            : result.status === "ambiguous"
              ? "SKU ambiguous"
              : "Woo product missing"}
        </span>
      </div>
      <div className="make-model-action">
        {result.matches ? (
          <span className="status approved">
            <CheckCircle2 size={14} /> Correct
          </span>
        ) : canReview ? (
          <button className="button secondary" type="button" disabled={pending || disabled} onClick={onReview}>
            <Send size={15} />
            {busy ? "Creating" : pending ? "For review" : "Send to review"}
          </button>
        ) : (
          <span className="subtle">Cannot review</span>
        )}
      </div>
    </article>
  );
}

export default function MakeModelTool() {
  const [report, setReport] = useState<MakeModelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View>("issues");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());
  const [showHelp, setShowHelp] = useState(false);

  async function loadReport(refresh = false) {
    setLoading(!refresh);
    setRefreshing(refresh);
    setError("");

    try {
      const response = await fetch(`/api/make-and-model${refresh ? "?refresh=1" : ""}`, {
        cache: "no-store"
      });
      const payload = (await response.json()) as MakeModelResponse;

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not analyze Make and Model data.");
      }

      setReport(payload);
      setPendingIds(new Set(payload.pendingProductIds));
      setSelectedIds([]);
      setMessage(refresh ? "Make and Model report refreshed." : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not analyze Make and Model data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, []);

  useEffect(() => {
    if (!showHelp) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowHelp(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showHelp]);

  const issueProducts = useMemo(
    () => report?.products.filter((result) => result.status === "matched" && !result.matches) ?? [],
    [report]
  );
  const matchedProducts = useMemo(
    () => report?.products.filter((result) => result.matches) ?? [],
    [report]
  );
  const missingProducts = useMemo(
    () => report?.products.filter((result) => result.status !== "matched") ?? [],
    [report]
  );
  const visibleItems = useMemo(() => {
    const query = normalize(search);

    if (view === "unresolved") {
      const items = report?.unresolvedLinks ?? [];

      return query
        ? items.filter((item) =>
            [item.make, item.model, item.url, item.legacyProductId].some((value) =>
              normalize(value).includes(query)
            )
          )
        : items;
    }

    const products =
      view === "issues" ? issueProducts : view === "matched" ? matchedProducts : missingProducts;

    return query
      ? products.filter((result) =>
          [
            result.sku,
            result.product?.name ?? "",
            result.product?.sku ?? "",
            ...result.makes,
            ...result.models
          ].some((value) => normalize(value).includes(query))
        )
      : products;
  }, [issueProducts, matchedProducts, missingProducts, report, search, view]);
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = visibleItems.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
  }, [view, search]);

  async function createReviews(productIds: number[]) {
    if (productIds.length === 0) {
      setError("Select at least one product that needs an update.");
      return;
    }

    setBusyIds(new Set(productIds));
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/reviews/make-and-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds })
      });
      const payload = (await response.json()) as {
        created?: number;
        skipped?: number;
        warnings?: Array<{ productId: number; message: string }>;
        error?: string;
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not create Make and Model reviews.");
      }

      const failedIds = new Set(payload.warnings?.map((warning) => warning.productId) ?? []);
      const successfulIds = productIds.filter((id) => !failedIds.has(id));
      setPendingIds((current) => new Set([...current, ...successfulIds]));
      setSelectedIds([]);
      setMessage(
        `Created ${payload.created ?? 0} Make and Model review${payload.created === 1 ? "" : "s"}${
          payload.skipped ? `, skipped ${payload.skipped} correct product${payload.skipped === 1 ? "" : "s"}` : ""
        }.`
      );

      if (payload.warnings?.length) {
        setError(payload.warnings.slice(0, 4).map((warning) => warning.message).join(" "));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create Make and Model reviews.");
    } finally {
      setBusyIds(new Set());
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Make and Model</h1>
          <p className="page-copy">
            Compare the Make and Model sheet with WooCommerce. Products are verified by SKU, and
            every update must be approved in the Review Queue.
          </p>
        </div>
        <div className="make-model-head-actions">
          <button className="button secondary" type="button" onClick={() => setShowHelp(true)}>
            <HelpCircle size={16} />
            Help
          </button>
          <button className="button secondary" type="button" disabled={loading || refreshing} onClick={() => loadReport(true)}>
            <RefreshCw size={16} />
            {refreshing ? "Refreshing" : "Refresh report"}
          </button>
        </div>
      </div>

      <PagePurpose
        icon={<Tags size={22} />}
        title="Match spreadsheet makes and models to WooCommerce products"
        description="Use this page to verify products by SKU, compare their Make and Model attributes with the dedicated Google Sheet tab, and prepare corrections for products that do not match."
        note={<><strong>This is an attribute audit.</strong><span>SKU problems and unresolved sheet links must be investigated before an update can be reviewed.</span></>}
      />

      {loading || refreshing ? (
        <ProgressBar
          label={refreshing ? "Refreshing Make and Model analysis" : "Checking sheet and WooCommerce SKUs"}
          current={0}
          total={1}
        />
      ) : null}
      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {report ? (
        <>
          <div className="metrics make-model-metrics">
            <span className="metric">
              <Tags size={17} />
              <strong>{issueProducts.length}</strong>
              Need update
            </span>
            <span className="metric">
              <CheckCircle2 size={17} />
              <strong>{matchedProducts.length}</strong>
              Correct
            </span>
            <span className="metric">
              <FileQuestion size={17} />
              <strong>{missingProducts.length}</strong>
              SKU problems
            </span>
            <span className="metric">
              <strong>{report.unresolvedLinks.length}</strong>
              Links without Product List SKU
            </span>
          </div>

          <section className="make-model-panel">
            <div className="make-model-toolbar">
              <div className="make-model-tabs" aria-label="Make and Model views">
                {[
                  ["issues", `Needs update (${issueProducts.length})`],
                  ["matched", `Correct (${matchedProducts.length})`],
                  ["missing_woo", `SKU problems (${missingProducts.length})`],
                  ["unresolved", `Unresolved links (${report.unresolvedLinks.length})`]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    className={view === value ? "active" : ""}
                    type="button"
                    onClick={() => setView(value as View)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="make-model-search">
                <Search size={16} />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search product, SKU, make, or model"
                />
              </label>
            </div>

            {view === "issues" ? (
              <div className="make-model-selection">
                <div>
                  <strong>{selectedIds.length} selected</strong>
                  <span>Only SKU-verified products can be sent to review.</span>
                </div>
                <button
                  className="button"
                  type="button"
                  disabled={selectedIds.length === 0 || busyIds.size > 0}
                  onClick={() => createReviews(selectedIds.slice(0, 20))}
                >
                  <Send size={16} />
                  Send selected to review
                </button>
              </div>
            ) : null}

            {pageItems.length === 0 ? (
              <div className="empty panel">No items in this view.</div>
            ) : view === "unresolved" ? (
              <div className="make-model-unresolved-list">
                {(pageItems as MakeModelUnresolvedLink[]).map((item) => (
                  <article key={`${item.rowNumber}-${item.url}`}>
                    <div>
                      <strong>{item.make || "No make"} / {item.model || "No model"}</strong>
                      <span className="subtle">Sheet row {item.rowNumber}</span>
                    </div>
                    <span className="subtle">
                      {item.legacyProductId ? `Legacy product ID ${item.legacyProductId}` : "No legacy product ID"}
                    </span>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      Open source link <ExternalLink size={13} />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              <div className="make-model-products">
                {(pageItems as MakeModelProductResult[]).map((result) => {
                  const productId = result.product?.id ?? 0;

                  return (
                    <ProductRow
                      key={result.baseSku}
                      result={result}
                      selected={selectedIds.includes(productId)}
                      pending={pendingIds.has(productId)}
                      busy={busyIds.has(productId)}
                      disabled={busyIds.size > 0}
                      onToggle={() => toggleSelected(productId)}
                      onReview={() => createReviews([productId])}
                    />
                  );
                })}
              </div>
            )}

            <div className="make-model-pagination">
              <span>
                {visibleItems.length === 0
                  ? "0 items"
                  : `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, visibleItems.length)} of ${visibleItems.length}`}
              </span>
              <button
                className="icon-button secondary"
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                title="Previous page"
              >
                <ChevronLeft size={17} />
              </button>
              <strong>{safePage} / {totalPages}</strong>
              <button
                className="icon-button secondary"
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                title="Next page"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </section>
        </>
      ) : null}

      {showHelp ? (
        <div className="make-model-help-backdrop" role="presentation" onMouseDown={() => setShowHelp(false)}>
          <section
            className="make-model-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="make-model-help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="make-model-help-head">
              <div>
                <span className="make-model-help-icon">
                  <HelpCircle size={20} />
                </span>
                <div>
                  <h2 id="make-model-help-title">How to use Make and Model</h2>
                  <p>Check the sheet data, review differences, and prepare safe WooCommerce updates.</p>
                </div>
              </div>
              <button
                className="icon-button secondary"
                type="button"
                onClick={() => setShowHelp(false)}
                aria-label="Close Make and Model help"
              >
                <X size={18} />
              </button>
            </div>

            <div className="make-model-help-steps">
              <article>
                <span>1</span>
                <div>
                  <h3>Start with Needs update</h3>
                  <p>These products have a verified SKU, but their Make or Model values differ from the Google Sheet.</p>
                </div>
              </article>
              <article>
                <span>2</span>
                <div>
                  <h3>Open the comparison</h3>
                  <p>Click “Sheet / Woo” under Make or Model to see exactly what the sheet contains and what WooCommerce has now.</p>
                </div>
              </article>
              <article>
                <span>3</span>
                <div>
                  <h3>Select the products you trust</h3>
                  <p>Use the checkbox for one or more products. SKU problems and unresolved links cannot be selected.</p>
                </div>
              </article>
              <article>
                <span>4</span>
                <div>
                  <h3>Send to Review Queue</h3>
                  <p>Create review drafts, inspect them in Review Queue, then approve only the updates you want published.</p>
                </div>
              </article>
            </div>

            <div className="make-model-help-statuses">
              <h3>What the tabs mean</h3>
              <dl>
                <div>
                  <dt>Needs update</dt>
                  <dd>SKU verified; Make or Model differs.</dd>
                </div>
                <div>
                  <dt>Correct</dt>
                  <dd>Sheet and WooCommerce already match.</dd>
                </div>
                <div>
                  <dt>SKU problems</dt>
                  <dd>No single WooCommerce product could be safely verified.</dd>
                </div>
                <div>
                  <dt>Unresolved links</dt>
                  <dd>The Make and Model link has no matching SKU in Product List.</dd>
                </div>
              </dl>
            </div>

            <div className="make-model-help-safety">
              <CheckCircle2 size={18} />
              <p><strong>Nothing changes immediately.</strong> “Send to review” only creates a draft. WooCommerce changes after approval in Review Queue.</p>
            </div>

            <div className="make-model-help-footer">
              <button className="button" type="button" onClick={() => setShowHelp(false)}>
                Got it
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
