"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  PackageSearch,
  PlusCircle,
  RefreshCw,
  Search,
  SearchX,
  Wrench
} from "lucide-react";

import ProgressBar from "@/components/progress-bar";
import type { ProductSheetValidationResult } from "@/lib/product-sheet-validator";
import type { WooOnlyProduct } from "@/lib/product-sheet-woo-only";

type ProductSheetValidatorResponse = {
  offset: number;
  limit: number;
  total: number;
  cachedCount?: number;
  updatedAt?: string | null;
  source?: "cache" | "empty" | "sync" | "refresh";
  nextOffset: number | null;
  results: ProductSheetValidationResult[];
  error?: string;
};

const syncBatchSize = 5;
const cacheBatchSize = 5000;
const pageSize = 10;

type ProductSheetFixField = "custom_notes" | "colour_board" | "accessories";
type ViewFilter =
  | "unmatched"
  | "category_issues"
  | "custom_notes"
  | "colour_board"
  | "accessories"
  | "woo_only"
  | "all"
  | "for_review";
type LoadMode = "cache" | "sync" | "refresh";

function statusClass(result: ProductSheetValidationResult) {
  if (result.status === "matched" && result.categoryComparison.matches && !hasMigrationIssue(result)) {
    return "approved";
  }

  if (result.status === "not_found" || result.status === "missing_lookup" || result.status === "error") {
    return "failed";
  }

  return "pending";
}

function statusLabel(result: ProductSheetValidationResult) {
  if (result.status === "missing_lookup") {
    return "Missing lookup";
  }

  if (result.status === "not_found") {
    return "No Woo match";
  }

  if (result.status === "error") {
    return "Lookup error";
  }

  if (result.status === "ambiguous") {
    return "Needs review";
  }

  if (!result.categoryComparison.matches) {
    return "Category mismatch";
  }

  return hasMigrationIssue(result) ? "Field mismatch" : "Matched";
}

function CategoryHierarchyList({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <span className="subtle">None</span>;
  }

  const visibleValues = values.slice(0, 2);
  const hiddenCount = values.length - visibleValues.length;

  return (
    <ul className="category-hierarchy-list">
      {visibleValues.map((value) => (
        <li key={value} title={value}>
          {value}
        </li>
      ))}
      {hiddenCount > 0 ? <li className="category-hierarchy-more">+{hiddenCount} more</li> : null}
    </ul>
  );
}

function CategoryDiffs({ result }: { result: ProductSheetValidationResult }) {
  const missing = result.categoryComparison.missingInWoo;
  const extra = result.categoryComparison.extraInWoo;

  if (result.categoryComparison.matches) {
    return <span className="status approved">Categories match</span>;
  }

  return (
    <div className="sheet-category-diffs">
      {missing.length > 0 ? (
        <span className="category-diff-popover">
          <button className="status pending" type="button" aria-label={`Show ${missing.length} missing category details`}>
          Missing {missing.length}
          </button>
          <span className="category-diff-card" role="tooltip">
            <strong>Missing in WooCommerce</strong>
            {missing.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        </span>
      ) : null}
      {extra.length > 0 ? (
        <span className="category-diff-popover">
          <button className="status neutral" type="button" aria-label={`Show ${extra.length} extra category details`}>
          Extra {extra.length}
          </button>
          <span className="category-diff-card" role="tooltip">
            <strong>Extra in WooCommerce</strong>
            {extra.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function metric(results: ProductSheetValidationResult[], predicate: (result: ProductSheetValidationResult) => boolean) {
  return results.filter(predicate).length;
}

function comparisonMatches(comparison: { matches: boolean } | undefined) {
  return comparison?.matches ?? true;
}

function hasMigrationIssue(result: ProductSheetValidationResult) {
  return (
    !comparisonMatches(result.customNotesComparison) ||
    !comparisonMatches(result.colourBoardComparison) ||
    !comparisonMatches(result.accessoriesComparison)
  );
}

function compactValues(values: string[] | undefined) {
  if (!values?.length) {
    return "None";
  }

  return values.length > 2 ? `${values.slice(0, 2).join(", ")} +${values.length - 2} more` : values.join(", ");
}

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function MigrationFieldCheck({
  label,
  available,
  matches,
  sheetText,
  wooText,
  pending,
  busy,
  disabled,
  onFix
}: {
  label: string;
  available: boolean;
  matches: boolean;
  sheetText: string;
  wooText: string;
  pending: boolean;
  busy: boolean;
  disabled: boolean;
  onFix: () => void;
}) {
  return (
    <div className="sheet-field-check">
      <div>
        <strong>{label}</strong>
        <span className={`status ${!available ? "neutral" : matches ? "approved" : "pending"}`}>
          {!available ? "Sync needed" : matches ? "Match" : "Mismatch"}
        </span>
        <span className="sheet-field-help">
          <CircleHelp size={14} />
          <span role="tooltip">
            {!available ? (
              <span>Run Sync to load this field from the current Google Sheet.</span>
            ) : (
              <>
                <strong>Sheet</strong>
                <span>{sheetText}</span>
                <strong>WooCommerce</strong>
                <span>{wooText}</span>
              </>
            )}
          </span>
        </span>
      </div>
      {available && !matches ? (
        <button className="button secondary compact-button" type="button" disabled={disabled || pending} onClick={onFix}>
          <Wrench size={14} />
          {busy ? "Creating" : pending ? "For review" : "Fix"}
        </button>
      ) : null}
    </div>
  );
}

function formatCacheDate(value: string | null) {
  if (!value) {
    return "No cached report";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const phtDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = phtDate.getUTCFullYear();
  const month = String(phtDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(phtDate.getUTCDate()).padStart(2, "0");
  const hour = String(phtDate.getUTCHours()).padStart(2, "0");
  const minute = String(phtDate.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute} PHT`;
}

async function fetchBatch(offset: number, limit: number, signal: AbortSignal, mode: LoadMode = "cache") {
  const modeQuery = mode === "sync" ? "&sync=1" : mode === "refresh" ? "&refresh=1" : "";
  const response = await fetch(`/api/product-sheet-validator?offset=${offset}&limit=${limit}${modeQuery}`, {
    cache: "no-store",
    signal
  });
  const payload = (await response.json()) as ProductSheetValidatorResponse;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "Could not validate the product sheet.");
  }

  return payload;
}

async function fetchWooOnlyProducts(signal: AbortSignal, refresh = false) {
  const response = await fetch(`/api/product-sheet-validator/woo-only${refresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
    signal
  });
  const payload = (await response.json()) as {
    products?: WooOnlyProduct[];
    total?: number;
    updatedAt?: string;
    error?: string;
  };

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? "Could not load products that are only in WooCommerce.");
  }

  return {
    products: payload.products ?? [],
    total: payload.total ?? 0,
    updatedAt: payload.updatedAt ?? null
  };
}

export default function ProductSheetValidator() {
  const [results, setResults] = useState<ProductSheetValidationResult[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshedCount, setRefreshedCount] = useState(0);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [creatingRow, setCreatingRow] = useState<number | null>(null);
  const [creatingFix, setCreatingFix] = useState<string | null>(null);
  const [reviewedRows, setReviewedRows] = useState<Set<number>>(() => new Set());
  const [pendingFixes, setPendingFixes] = useState<Record<number, ProductSheetFixField[]>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("unmatched");
  const [wooOnlyProducts, setWooOnlyProducts] = useState<WooOnlyProduct[]>([]);
  const [wooOnlyLoaded, setWooOnlyLoaded] = useState(false);
  const [wooOnlyLoading, setWooOnlyLoading] = useState(false);
  const [wooOnlyError, setWooOnlyError] = useState("");
  const [wooOnlyUpdatedAt, setWooOnlyUpdatedAt] = useState<string | null>(null);
  const [wooOnlySearch, setWooOnlySearch] = useState("");
  const [archivingProduct, setArchivingProduct] = useState<number | null>(null);
  const [archiveReviews, setArchiveReviews] = useState<Set<number>>(() => new Set());

  async function loadRows(mode: LoadMode, signal: AbortSignal) {
    const sync = mode === "sync";
    const refresh = mode === "refresh";

    setIsLoading(mode === "cache");
    setIsSyncing(sync);
    setIsRefreshing(refresh);
    setRefreshedCount(0);
    setError("");
    setMessage(
      sync
        ? "Syncing latest sheet and WooCommerce data. Cached rows will update as batches finish."
        : refresh
          ? "Refreshing WooCommerce matches from the cached sheet rows."
          : ""
    );

    if (!refresh) {
      setResults([]);
      setTotal(0);
    }

    try {
      const reviewsResponse = await fetch("/api/reviews/product-sheet-create/rows", {
        cache: "no-store",
        signal
      });

      if (reviewsResponse.ok) {
        const payload = (await reviewsResponse.json()) as {
          rowNumbers?: number[];
          fixesByRow?: Record<string, ProductSheetFixField[]>;
        };
        setReviewedRows(new Set(payload.rowNumbers ?? []));
        setPendingFixes(
          Object.fromEntries(
            Object.entries(payload.fixesByRow ?? {}).map(([rowNumber, fields]) => [Number(rowNumber), fields])
          )
        );
      }

      let nextOffset: number | null = 0;

      while (nextOffset !== null) {
        const batch = await fetchBatch(
          nextOffset,
          sync || refresh ? syncBatchSize : cacheBatchSize,
          signal,
          mode
        );

        setTotal(batch.total);
        setCacheUpdatedAt(batch.updatedAt ?? null);
        if (refresh) {
          setRefreshedCount(Math.min(batch.offset + batch.results.length, batch.total));
        }
        setResults((current) => {
          const byRow = new Map(current.map((result) => [result.row.rowNumber, result]));

          for (const result of batch.results) {
            byRow.set(result.row.rowNumber, result);
          }

          return [...byRow.values()].sort((a, b) => a.row.rowNumber - b.row.rowNumber);
        });
        nextOffset = batch.nextOffset;
      }

      if (sync) {
        setMessage("Product sheet validator cache updated.");
      } else if (refresh) {
        setMessage("WooCommerce matches refreshed from the latest store data.");
      }
    } catch (caught) {
      if (!signal.aborted) {
        setError(caught instanceof Error ? caught.message : "Could not validate the product sheet.");
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
        setIsSyncing(false);
        setIsRefreshing(false);
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    loadRows("cache", controller.signal);

    return () => controller.abort();
  }, []);

  function syncRows() {
    const controller = new AbortController();

    loadRows("sync", controller.signal);
  }

  function refreshWooRows() {
    const controller = new AbortController();

    loadRows("refresh", controller.signal);
  }

  async function loadWooOnlyProducts(refresh = false) {
    const controller = new AbortController();

    setWooOnlyLoading(true);
    setWooOnlyLoaded(true);
    setWooOnlyError("");

    try {
      const payload = await fetchWooOnlyProducts(controller.signal, refresh);
      setWooOnlyProducts(payload.products);
      setWooOnlyUpdatedAt(payload.updatedAt);
    } catch (caught) {
      setWooOnlyError(
        caught instanceof Error ? caught.message : "Could not load products that are only in WooCommerce."
      );
    } finally {
      setWooOnlyLoading(false);
    }
  }

  async function createArchiveReview(product: WooOnlyProduct) {
    setArchivingProduct(product.id);
    setWooOnlyError("");
    setMessage("");

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          resource: "product",
          action: "update",
          resourceId: product.id,
          changes: {
            status: "draft",
            catalog_visibility: "hidden"
          }
        })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not create the archive review.");
      }

      setArchiveReviews((current) => new Set(current).add(product.id));
      setMessage(`Archive review created for ${product.name}. Approve it in the Review Queue.`);
    } catch (caught) {
      setWooOnlyError(caught instanceof Error ? caught.message : "Could not create the archive review.");
    } finally {
      setArchivingProduct(null);
    }
  }

  useEffect(() => {
    if (viewFilter === "woo_only" && !wooOnlyLoaded && !wooOnlyLoading) {
      loadWooOnlyProducts();
    }
  }, [viewFilter, wooOnlyLoaded, wooOnlyLoading]);

  const cleanMatches = useMemo(
    () => metric(
      results,
      (result) =>
        result.status === "matched" &&
        result.categoryComparison.matches &&
        !hasMigrationIssue(result)
    ),
    [results]
  );
  const needsReview = useMemo(
    () => metric(
      results,
      (result) => result.status !== "matched" || !result.categoryComparison.matches || hasMigrationIssue(result)
    ),
    [results]
  );
  const unmatchedCount = useMemo(
    () => metric(results, (result) => result.status === "not_found" || result.status === "missing_lookup"),
    [results]
  );
  const categoryIssueCount = useMemo(
    () => metric(results, (result) => Boolean(result.product) && !result.categoryComparison.matches),
    [results]
  );
  const customNotesIssueCount = useMemo(
    () => metric(results, (result) => Boolean(result.product) && !comparisonMatches(result.customNotesComparison)),
    [results]
  );
  const colourBoardIssueCount = useMemo(
    () => metric(results, (result) => Boolean(result.product) && !comparisonMatches(result.colourBoardComparison)),
    [results]
  );
  const accessoriesIssueCount = useMemo(
    () => metric(results, (result) => Boolean(result.product) && !comparisonMatches(result.accessoriesComparison)),
    [results]
  );
  const forReviewCount = useMemo(
    () =>
      metric(
        results,
        (result) =>
          reviewedRows.has(result.row.rowNumber) ||
          (pendingFixes[result.row.rowNumber]?.length ?? 0) > 0
      ),
    [results, reviewedRows, pendingFixes]
  );
  const filteredResults = useMemo(() => {
    if (viewFilter === "unmatched") {
      return results.filter((result) => result.status === "not_found" || result.status === "missing_lookup");
    }

    if (viewFilter === "category_issues") {
      return results.filter((result) => Boolean(result.product) && !result.categoryComparison.matches);
    }

    if (viewFilter === "custom_notes") {
      return results.filter((result) => Boolean(result.product) && !comparisonMatches(result.customNotesComparison));
    }

    if (viewFilter === "colour_board") {
      return results.filter((result) => Boolean(result.product) && !comparisonMatches(result.colourBoardComparison));
    }

    if (viewFilter === "accessories") {
      return results.filter((result) => Boolean(result.product) && !comparisonMatches(result.accessoriesComparison));
    }

    if (viewFilter === "for_review") {
      return results.filter(
        (result) =>
          reviewedRows.has(result.row.rowNumber) ||
          (pendingFixes[result.row.rowNumber]?.length ?? 0) > 0
      );
    }

    return results;
  }, [results, reviewedRows, pendingFixes, viewFilter]);
  const filteredWooOnlyProducts = useMemo(() => {
    const query = normalizeSearch(wooOnlySearch);

    if (!query) {
      return wooOnlyProducts;
    }

    return wooOnlyProducts.filter((product) =>
      [product.name, product.sku, product.status, ...product.categoryHierarchy]
        .some((value) => normalizeSearch(value).includes(query))
    );
  }, [wooOnlyProducts, wooOnlySearch]);
  const activeResultCount =
    viewFilter === "woo_only" ? filteredWooOnlyProducts.length : filteredResults.length;
  const totalPages = Math.max(1, Math.ceil(activeResultCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const pageResults = filteredResults.slice(pageStart, pageStart + pageSize);
  const pageWooOnlyProducts = filteredWooOnlyProducts.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [viewFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil(filteredResults.length / pageSize))));
  }, [activeResultCount]);

  async function createProductReview(rowNumber: number) {
    setCreatingRow(rowNumber);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/reviews/product-sheet-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rowNumber })
      });
      const payload = (await response.json()) as { error?: string; warnings?: string[] };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not create product review.");
      }

      setReviewedRows((current) => new Set(current).add(rowNumber));
      setMessage(
        payload.warnings?.length
          ? `Product create review created with ${payload.warnings.length} mapping warning${payload.warnings.length === 1 ? "" : "s"}. It will publish after approval.`
          : "Product create review created. It will publish after approval."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create product review.");
    } finally {
      setCreatingRow(null);
    }
  }

  async function createFieldFixReview(rowNumber: number, field: ProductSheetFixField) {
    const busyKey = `${rowNumber}-${field}`;
    setCreatingFix(busyKey);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/reviews/product-sheet-fix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rowNumber, fields: [field] })
      });
      const payload = (await response.json()) as {
        error?: string;
        fields?: ProductSheetFixField[];
        warnings?: string[];
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not create product field fix review.");
      }

      setPendingFixes((current) => ({
        ...current,
        [rowNumber]: [...new Set([...(current[rowNumber] ?? []), ...(payload.fields ?? [field])])]
      }));
      setMessage(
        payload.warnings?.length
          ? `Fix review created with ${payload.warnings.length} accessory warning${payload.warnings.length === 1 ? "" : "s"}.`
          : "Fix review created. Approve it in the Review Queue."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create product field fix review.");
    } finally {
      setCreatingFix(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Product Sheet Validator</h1>
          <p className="page-copy">
            Read-only validation for the Google Sheet Product List tab. Rows are matched to WooCommerce by SKU first,
            then product name, with category differences called out.
          </p>
        </div>
        <div className="metrics">
          <span className="metric">
            <FileSpreadsheet size={18} />
            <strong>{total || results.length}</strong>
            Sheet rows
          </span>
          <span className="metric">
            <CheckCircle2 size={18} />
            <strong>{cleanMatches}</strong>
            Clean matches
          </span>
          <span className="metric">
            <AlertTriangle size={18} />
            <strong>{needsReview}</strong>
            Needs review
          </span>
          <span className="metric">
            <RefreshCw size={18} />
            <strong>{results.length}</strong>
            Cached
          </span>
          <button className="button secondary" type="button" disabled={isSyncing || isRefreshing} onClick={syncRows}>
            <RefreshCw size={16} />
            {isSyncing ? "Syncing" : "Sync"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={isSyncing || isRefreshing || results.length === 0}
            onClick={refreshWooRows}
          >
            <RefreshCw size={16} />
            {isRefreshing ? "Refreshing" : "Refresh Woo"}
          </button>
        </div>
      </div>

      {isLoading || isSyncing || isRefreshing ? (
        <ProgressBar
          label={
            isSyncing
              ? "Syncing validator cache"
              : isRefreshing
                ? "Refreshing WooCommerce matches"
                : "Loading cached validator rows"
          }
          current={isRefreshing ? refreshedCount : results.length}
          total={total || results.length || 1}
        />
      ) : null}

      {error ? (
        <p className="error">
          {error}
          {error.toLowerCase().includes("woocommerce")
            ? ""
            : " The sheet must be accessible through Google Sheets CSV export for this validator."}
        </p>
      ) : null}
      {message ? <p className="notice">{message}</p> : null}

      {!isLoading && !error && results.length === 0 ? (
        <div className="empty panel">No cached validator rows yet. Click Sync to build the report.</div>
      ) : null}

      {!isLoading ? (
        <section className="product-sheet-panel">
          <div className="product-sheet-toolbar">
            <div className="product-sheet-tabs" aria-label="Product sheet filters">
              {[
                ["unmatched", `No match (${unmatchedCount})`],
                ["category_issues", `Category issues (${categoryIssueCount})`],
                ["custom_notes", `Custom notes (${customNotesIssueCount})`],
                ["colour_board", `Colour board (${colourBoardIssueCount})`],
                ["accessories", `Accessories (${accessoriesIssueCount})`],
                ["woo_only", `Woo only (${wooOnlyLoaded ? wooOnlyProducts.length : "load"})`],
                ["all", `All (${results.length})`],
                ["for_review", `For review (${forReviewCount})`]
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={viewFilter === value ? "active" : ""}
                  type="button"
                  onClick={() => setViewFilter(value as ViewFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="product-sheet-pager">
              <span className="subtle">
                {activeResultCount === 0
                  ? "No rows"
                  : `${pageStart + 1}-${Math.min(pageStart + (viewFilter === "woo_only" ? pageWooOnlyProducts.length : pageResults.length), activeResultCount)} of ${activeResultCount}`}
                {isSyncing ? ` synced from ${total || "..."}` : ""}
                {isRefreshing ? ` refreshed from ${total || "..."}` : ""}
              </span>
              <span className="subtle">
                Updated {formatCacheDate(viewFilter === "woo_only" ? wooOnlyUpdatedAt : cacheUpdatedAt)}
              </span>
              <button
                className="icon-button secondary"
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                title="Previous page"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="product-sheet-page-count">
                {safeCurrentPage} / {totalPages}
              </span>
              <button
                className="icon-button secondary"
                type="button"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                title="Next page"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          {viewFilter === "woo_only" ? (
            <div className="product-sheet-woo-only">
              <div className="product-sheet-woo-only-tools">
                <label>
                  <Search size={16} />
                  <input
                    type="search"
                    value={wooOnlySearch}
                    onChange={(event) => {
                      setWooOnlySearch(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder="Search name, SKU, status, or category"
                  />
                </label>
                <button
                  className="button secondary"
                  type="button"
                  disabled={wooOnlyLoading}
                  onClick={() => loadWooOnlyProducts(true)}
                >
                  <RefreshCw size={16} />
                  {wooOnlyLoading ? "Checking" : "Refresh list"}
                </button>
              </div>

              {wooOnlyLoading ? (
                <ProgressBar label="Comparing all WooCommerce products with the Google Sheet" current={0} total={1} />
              ) : null}
              {wooOnlyError ? <p className="error">{wooOnlyError}</p> : null}
              {!wooOnlyLoading && !wooOnlyError && pageWooOnlyProducts.length === 0 ? (
                <div className="empty panel product-sheet-empty">
                  <PackageSearch size={20} />
                  {wooOnlySearch
                    ? "No WooCommerce-only products match this search."
                    : "Every WooCommerce product has a matching sheet SKU or product name."}
                </div>
              ) : null}
              {pageWooOnlyProducts.length > 0 ? (
                <div className="table-wrap product-sheet-table product-sheet-woo-only-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Category hierarchy</th>
                        <th>Status</th>
                        <th>Last modified</th>
                        <th>Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageWooOnlyProducts.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <div className="product-sheet-woo-product">
                              {product.image ? <img src={product.image} alt="" /> : <span aria-hidden />}
                              <div>
                                <Link className="product-sheet-title" href={`/products/${product.id}`}>
                                  <strong>{product.name}</strong>
                                </Link>
                                <span className="subtle">WooCommerce ID {product.id}</span>
                              </div>
                            </div>
                          </td>
                          <td>{product.sku || <span className="subtle">No SKU</span>}</td>
                          <td>
                            <CategoryHierarchyList values={product.categoryHierarchy} />
                          </td>
                          <td>
                            <span className={`status ${product.status === "publish" ? "approved" : "neutral"}`}>
                              {product.status}
                            </span>
                          </td>
                          <td>
                            <span className="subtle">{formatCacheDate(product.dateModified || null)}</span>
                          </td>
                          <td>
                            <Link className="button secondary compact-button" href={`/products/${product.id}`}>
                              Manage
                            </Link>
                            {product.status === "draft" && product.catalogVisibility === "hidden" ? (
                              <span className="status neutral product-sheet-archive-status">Archived</span>
                            ) : (
                              <button
                                className="button secondary compact-button product-sheet-archive-button"
                                type="button"
                                disabled={archivingProduct !== null || archiveReviews.has(product.id)}
                                onClick={() => createArchiveReview(product)}
                                title="Create a review to make this product draft and hide it from the catalog"
                              >
                                <Archive size={14} />
                                {archivingProduct === product.id
                                  ? "Creating"
                                  : archiveReviews.has(product.id)
                                    ? "For review"
                                    : "Archive"}
                              </button>
                            )}
                            {product.permalink ? (
                              <a
                                className="subtle product-sheet-woo-store-link"
                                href={product.permalink}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View in store
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : pageResults.length === 0 ? (
            <div className="empty panel product-sheet-empty">No rows in this view.</div>
          ) : (
            <div className="table-wrap product-sheet-table">
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Sheet product</th>
                <th>WooCommerce match</th>
                <th>Sheet category hierarchy</th>
                <th>Woo category hierarchy</th>
                <th>Category check</th>
                <th>Sheet field checks</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageResults.map((result) => (
                <tr key={result.row.rowNumber}>
                  <td>#{result.row.rowNumber}</td>
                  <td>
                    <strong className="product-sheet-title" title={result.row.name || "No product name"}>
                      {result.row.name || "No product name"}
                    </strong>
                    <span className="subtle">SKU: {result.row.sku || "No SKU"}</span>
                    {result.row.liveUrl ? (
                      <a className="subtle" href={result.row.liveUrl} target="_blank" rel="noreferrer">
                        Live URL
                      </a>
                    ) : null}
                  </td>
                  <td>
                    {result.product ? (
                      <>
                        <Link
                          className="product-sheet-title"
                          href={`/products/${result.product.id}`}
                          title={result.product.name}
                        >
                          <strong>{result.product.name}</strong>
                        </Link>
                        <span className="subtle">
                          ID {result.product.id} / SKU {result.product.sku || "No SKU"} / {result.matchMethod} /{" "}
                          {result.product.status}
                        </span>
                        {result.product.permalink ? (
                          <a className="subtle" href={result.product.permalink} target="_blank" rel="noreferrer">
                            View in WooCommerce
                          </a>
                        ) : null}
                        {result.candidates.length > 1 ? (
                          <span className="subtle">{result.candidates.length} candidates found</span>
                        ) : null}
                        {result.error ? <span className="subtle">{result.error}</span> : null}
                      </>
                    ) : (
                      <>
                        <span className="subtle">
                          <SearchX size={15} /> No matching product
                        </span>
                        {result.error ? <span className="subtle">{result.error}</span> : null}
                      </>
                    )}
                  </td>
                  <td>
                    <CategoryHierarchyList values={result.categoryComparison.sheet} />
                  </td>
                  <td>
                    <CategoryHierarchyList values={result.categoryComparison.woo} />
                  </td>
                  <td>
                    <CategoryDiffs result={result} />
                  </td>
                  <td>
                    {result.customNotesComparison &&
                    result.colourBoardComparison &&
                    result.accessoriesComparison ? (
                      <div className="sheet-field-checks">
                        <MigrationFieldCheck
                          label="Custom notes"
                          available={result.customNotesComparison.available}
                          matches={result.customNotesComparison.matches}
                          sheetText={result.customNotesComparison.sheet ? "Yes" : "No"}
                          wooText={result.customNotesComparison.woo ? "Yes" : "No"}
                          pending={pendingFixes[result.row.rowNumber]?.includes("custom_notes") ?? false}
                          busy={creatingFix === `${result.row.rowNumber}-custom_notes`}
                          disabled={creatingFix !== null || result.status !== "matched"}
                          onFix={() => createFieldFixReview(result.row.rowNumber, "custom_notes")}
                        />
                        <MigrationFieldCheck
                          label="Colour board"
                          available={result.colourBoardComparison.available}
                          matches={result.colourBoardComparison.matches}
                          sheetText={`${result.colourBoardComparison.sheetExpected ? "Expected" : "Not expected"}: ${compactValues(result.colourBoardComparison.sheetValues)}`}
                          wooText={`${result.colourBoardComparison.wooPresent ? "Present" : "Not present"}: ${compactValues(result.colourBoardComparison.wooValues)}`}
                          pending={pendingFixes[result.row.rowNumber]?.includes("colour_board") ?? false}
                          busy={creatingFix === `${result.row.rowNumber}-colour_board`}
                          disabled={
                            creatingFix !== null ||
                            result.status !== "matched" ||
                            (result.colourBoardComparison.sheetExpected &&
                              result.colourBoardComparison.sheetValues.length === 0)
                          }
                          onFix={() => createFieldFixReview(result.row.rowNumber, "colour_board")}
                        />
                        <MigrationFieldCheck
                          label="Accessories"
                          available={result.accessoriesComparison.available}
                          matches={result.accessoriesComparison.matches}
                          sheetText={`${result.accessoriesComparison.sheetExpected ? "Expected" : "Not expected"}: ${compactValues(result.accessoriesComparison.sheetValues)}`}
                          wooText={`${result.accessoriesComparison.wooPresent ? "Present" : "Not present"}: ${compactValues(result.accessoriesComparison.wooValues)}`}
                          pending={pendingFixes[result.row.rowNumber]?.includes("accessories") ?? false}
                          busy={creatingFix === `${result.row.rowNumber}-accessories`}
                          disabled={
                            creatingFix !== null ||
                            result.status !== "matched" ||
                            (result.accessoriesComparison.sheetExpected &&
                              result.accessoriesComparison.sheetValues.length === 0)
                          }
                          onFix={() => createFieldFixReview(result.row.rowNumber, "accessories")}
                        />
                      </div>
                    ) : (
                      <div className="sheet-field-checks">
                        {["Custom notes", "Colour board", "Accessories"].map((label) => (
                          <MigrationFieldCheck
                            key={label}
                            label={label}
                            available={false}
                            matches
                            sheetText=""
                            wooText=""
                            pending={false}
                            busy={false}
                            disabled
                            onFix={() => undefined}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`status ${statusClass(result)}`}>{statusLabel(result)}</span>
                  </td>
                  <td>
                    {result.status === "not_found" || result.status === "missing_lookup" ? (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={!result.row.liveUrl || creatingRow !== null || reviewedRows.has(result.row.rowNumber)}
                        onClick={() => createProductReview(result.row.rowNumber)}
                        title={result.row.liveUrl ? "Scrape the Live URL and create a product review" : "This row has no Live URL"}
                      >
                        <PlusCircle size={16} />
                        {creatingRow === result.row.rowNumber
                          ? "Creating"
                          : reviewedRows.has(result.row.rowNumber)
                            ? "For review"
                            : "Create review"}
                      </button>
                    ) : (
                      <span className="subtle">No action</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
