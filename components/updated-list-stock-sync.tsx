"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  SquarePen,
  XCircle
} from "lucide-react";
import { loadSharedWorkflow, saveSharedWorkflow } from "@/lib/updated-list-workflow-client";

type StockStatus = "instock" | "outofstock" | "onbackorder";
type Backorders = "no" | "notify" | "yes";
type StockListFilter = "all" | "updates" | "current" | "errors" | "unchecked";

export type StockSyncRow = {
  sheetRowNumber: number;
  name: string;
  wooId?: number;
  wooPermalink?: string;
  sourceProductUrl: string;
  wooStockStatus: StockStatus | "";
  wooBackorders: Backorders | "";
  wooManageStock: boolean;
  wooStockQuantity: number | null;
  wooDateModified: string;
  stockLastSyncedAt: string;
};

type LiveStockCheck = {
  rowNumber: number;
  sourceUrl: string;
  resolvedUrl?: string;
  stockStatus?: StockStatus;
  checkedAt: string;
  error?: string;
};

type StockQueueItem = StockSyncRow & {
  id: string;
  status: "pending" | "processing" | "queued" | "failed";
  message: string;
  queuedAt?: string;
};

type RunProgress = {
  total: number;
  current: number;
  paused: boolean;
  stopped: boolean;
  running: boolean;
  activeLabel?: string;
};

type SharedCacheState = "loading" | "upstash" | "local" | "error";

const queueStorageKey = "updated-list-stock-sync-v1";
const checkStorageKey = "updated-list-live-stocks-v2";

function itemId(row: StockSyncRow) {
  return `stock-${row.sheetRowNumber}-${row.wooId ?? "unmatched"}`;
}

function statusLabel(status: string | undefined) {
  if (status === "instock") return "In stock";
  if (status === "outofstock") return "Out of stock";
  if (status === "onbackorder") return "On backorder";
  return "Not known";
}

function expectedBackorders(status: StockStatus | undefined): Backorders | "" {
  if (!status) return "";
  return status === "onbackorder" ? "notify" : "no";
}

function formatDate(value: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function stockCheckTime(check: LiveStockCheck | undefined) {
  const value = check?.checkedAt ? Date.parse(check.checkedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function mergeStockChecks(
  browserChecks: Record<number, LiveStockCheck>,
  sharedChecks: Record<number, LiveStockCheck>
) {
  const merged = { ...browserChecks };

  Object.values(sharedChecks).forEach((check) => {
    if (!merged[check.rowNumber] || stockCheckTime(check) >= stockCheckTime(merged[check.rowNumber])) {
      merged[check.rowNumber] = check;
    }
  });

  return merged;
}

function connectionMessage(status?: number) {
  return status && [408, 502, 503, 504].includes(status)
    ? "The product-link page or WooCommerce timed out. This item remains saved and can be retried."
    : "The stock update could not be prepared. This item remains saved and can be retried.";
}

function stockMatches(row: StockSyncRow, check: LiveStockCheck | undefined) {
  return Boolean(check?.stockStatus) &&
    row.wooStockStatus === check?.stockStatus &&
    row.wooBackorders === expectedBackorders(check?.stockStatus);
}

export default function UpdatedListStockSync({
  rows,
  updatedAt,
  disabled = false
}: {
  rows: StockSyncRow[];
  updatedAt: string;
  disabled?: boolean;
}) {
  const [checks, setChecks] = useState<Record<number, LiveStockCheck>>({});
  const [items, setItems] = useState<StockQueueItem[]>([]);
  const [checkProgress, setCheckProgress] = useState<RunProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<StockListFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(75);
  const [sharedCacheState, setSharedCacheState] = useState<SharedCacheState>("loading");
  const checksRef = useRef<Record<number, LiveStockCheck>>({});
  const itemsRef = useRef<StockQueueItem[]>([]);
  const checkControlRef = useRef({ paused: false, stopped: false });
  const queueControlRef = useRef({ paused: false, stopped: false });

  async function persistSharedChecks(updates: LiveStockCheck[]) {
    if (!updates.length) return;

    try {
      const response = await fetch("/api/updated-list/shared-checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "stock", checks: updates })
      });
      const payload = await response.json().catch(() => ({})) as { storage?: "upstash" | "local"; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the shared stock cache.");
      setSharedCacheState(payload.storage || "local");
    } catch {
      setSharedCacheState("error");
    }
  }

  function saveChecks(next: Record<number, LiveStockCheck>) {
    const changed = Object.values(next).filter((check) => {
      const previous = checksRef.current[check.rowNumber];
      return JSON.stringify(previous) !== JSON.stringify(check);
    });
    checksRef.current = next;
    setChecks(next);
    window.localStorage.setItem(checkStorageKey, JSON.stringify(next));
    void persistSharedChecks(changed);
  }

  function saveItems(next: StockQueueItem[]) {
    itemsRef.current = next;
    setItems(next);
    window.localStorage.setItem(queueStorageKey, JSON.stringify(next));
    void saveSharedWorkflow("stock-updates", next)
      .then((payload) => setSharedCacheState(payload.storage || "local"))
      .catch(() => setSharedCacheState("error"));
  }

  function updateItem(id: string, changes: Partial<StockQueueItem>) {
    saveItems(itemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  useEffect(() => {
    let active = true;

    try {
      const storedChecks = JSON.parse(window.localStorage.getItem(checkStorageKey) || "{}") as Record<number, LiveStockCheck>;
      const sources = new Map(rows.map((row) => [row.sheetRowNumber, row.sourceProductUrl]));
      const validChecks = Object.fromEntries(
        Object.entries(storedChecks).filter(([rowNumber, check]) => sources.get(Number(rowNumber)) === check.sourceUrl)
      ) as Record<number, LiveStockCheck>;
      checksRef.current = validChecks;
      setChecks(validChecks);
    } catch {
      window.localStorage.removeItem(checkStorageKey);
    }

    async function loadSharedChecks() {
      try {
        const response = await fetch("/api/updated-list/shared-checks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "stock", rowNumbers: rows.map((row) => row.sheetRowNumber) })
        });
        const payload = await response.json().catch(() => ({})) as {
          checks?: Record<number, LiveStockCheck>;
          storage?: "upstash" | "local";
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not load the shared stock cache.");
        if (!active) return;

        const sources = new Map(rows.map((row) => [row.sheetRowNumber, row.sourceProductUrl]));
        const sharedChecks = Object.fromEntries(
          Object.entries(payload.checks ?? {}).filter(([rowNumber, check]) =>
            sources.get(Number(rowNumber)) === check.sourceUrl
          )
        ) as Record<number, LiveStockCheck>;
        const browserChecks = checksRef.current;
        const merged = mergeStockChecks(browserChecks, sharedChecks);
        checksRef.current = merged;
        setChecks(merged);
        window.localStorage.setItem(checkStorageKey, JSON.stringify(merged));
        setSharedCacheState(payload.storage || "local");

        const newerBrowserChecks = Object.values(browserChecks).filter((check) =>
          !sharedChecks[check.rowNumber] || stockCheckTime(check) > stockCheckTime(sharedChecks[check.rowNumber])
        );
        if (newerBrowserChecks.length) void persistSharedChecks(newerBrowserChecks);
      } catch {
        if (active) setSharedCacheState("error");
      }
    }

    void loadSharedChecks();

    try {
      const parsed = JSON.parse(window.localStorage.getItem(queueStorageKey) || "[]") as StockQueueItem[];
      const validIds = new Set(rows.map(itemId));
      const restored = parsed
        .filter((item) => validIds.has(itemId(item)))
        .map((item) => item.status === "processing"
          ? { ...item, status: "pending" as const, message: "Interrupted before completion. Ready to continue." }
          : item);
      itemsRef.current = restored;
      setItems(restored);
      setStopped(restored.some((item) => item.status === "pending"));
    } catch {
      window.localStorage.removeItem(queueStorageKey);
    }

    return () => {
      active = false;
    };
  }, [rows]);

  useEffect(() => {
    let active = true;

    async function hydrateSharedQueue() {
      try {
        const payload = await loadSharedWorkflow<StockQueueItem>("stock-updates");
        if (!active) return;
        setSharedCacheState(payload.storage || "local");

        if (!payload.state) {
          if (itemsRef.current.length) void saveSharedWorkflow("stock-updates", itemsRef.current);
          return;
        }

        const validIds = new Set(rows.map(itemId));
        const isRecent = Date.now() - Date.parse(payload.state.updatedAt) < 2 * 60 * 1000;
        const restored = payload.state.items
          .filter((item) => validIds.has(itemId(item)))
          .map((item) => item.status === "processing" && !isRecent
            ? { ...item, status: "pending" as const, message: "Interrupted before completion. Ready to continue." }
            : item);
        itemsRef.current = restored;
        setItems(restored);
        setStopped(restored.some((item) => item.status === "pending"));
        window.localStorage.setItem(queueStorageKey, JSON.stringify(restored));
      } catch {
        if (active) setSharedCacheState("error");
      }
    }

    void hydrateSharedQueue();
    return () => {
      active = false;
    };
  }, [rows]);

  const actionableRows = useMemo(
    () => rows.filter((row) => checks[row.sheetRowNumber]?.stockStatus && !stockMatches(row, checks[row.sheetRowNumber])),
    [checks, rows]
  );
  const currentCount = useMemo(
    () => rows.filter((row) => stockMatches(row, checks[row.sheetRowNumber])).length,
    [checks, rows]
  );
  const errorRows = useMemo(
    () => rows.filter((row) => Boolean(checks[row.sheetRowNumber]?.error)),
    [checks, rows]
  );
  const uncheckedRows = useMemo(
    () => rows.filter((row) => !checks[row.sheetRowNumber]),
    [checks, rows]
  );
  const filteredRows = useMemo(() => {
    if (listFilter === "updates") return actionableRows;
    if (listFilter === "current") return rows.filter((row) => stockMatches(row, checks[row.sheetRowNumber]));
    if (listFilter === "errors") return errorRows;
    if (listFilter === "unchecked") return uncheckedRows;
    return rows;
  }, [actionableRows, checks, errorRows, listFilter, rows, uncheckedRows]);
  const matchingRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? filteredRows.filter((row) => row.name.toLowerCase().includes(query) || String(row.wooId ?? "").includes(query) || String(row.sheetRowNumber).includes(query))
      : filteredRows;
  }, [filteredRows, search]);
  const visibleRows = matchingRows.slice(0, visibleLimit);
  const queueCounts = useMemo(() => ({
    queued: items.filter((item) => item.status === "queued").length,
    failed: items.filter((item) => item.status === "failed").length,
    finished: items.filter((item) => item.status === "queued" || item.status === "failed").length
  }), [items]);
  const queueProgress = items.length ? Math.round((queueCounts.finished / items.length) * 100) : 0;
  const queueBusy = running || disabled;

  async function waitForResume(control: { current: { paused: boolean; stopped: boolean } }) {
    while (control.current.paused && !control.current.stopped) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }

  async function scanLiveStocks(targetRows: StockSyncRow[]) {
    if (!targetRows.length) return;
    checkControlRef.current = { paused: false, stopped: false };
    setCheckProgress({ total: targetRows.length, current: 0, paused: false, stopped: false, running: true });
    let completed = 0;

    for (let index = 0; index < targetRows.length; index += 4) {
      await waitForResume(checkControlRef);
      if (checkControlRef.current.stopped) break;
      const batch = targetRows.slice(index, index + 4);
      setCheckProgress((current) => current ? {
        ...current,
        activeLabel: `Checking products ${index + 1}-${Math.min(index + batch.length, targetRows.length)}`
      } : current);

      try {
        const response = await fetch("/api/updated-list/live-stocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rows: batch.map((row) => ({
              rowNumber: row.sheetRowNumber,
              sourceUrl: row.sourceProductUrl
            }))
          })
        });
        const payload = await response.json().catch(() => ({})) as { results?: LiveStockCheck[]; error?: string };
        if (!response.ok) throw new Error(payload.error || connectionMessage(response.status));
        const next = { ...checksRef.current };
        (payload.results ?? []).forEach((result) => { next[result.rowNumber] = result; });
        saveChecks(next);
      } catch (error) {
        const checkedAt = new Date().toISOString();
        const next = { ...checksRef.current };
        batch.forEach((row) => {
          next[row.sheetRowNumber] = {
            rowNumber: row.sheetRowNumber,
            sourceUrl: row.sourceProductUrl,
            checkedAt,
            error: error instanceof Error ? error.message : connectionMessage()
          };
        });
        saveChecks(next);
      }

      completed += batch.length;
      setCheckProgress({
        total: targetRows.length,
        current: completed,
        paused: checkControlRef.current.paused,
        stopped: checkControlRef.current.stopped,
        running: !checkControlRef.current.stopped && completed < targetRows.length,
        activeLabel: undefined
      });
    }

    setCheckProgress({
      total: targetRows.length,
      current: completed,
      paused: false,
      stopped: checkControlRef.current.stopped,
      running: false,
      activeLabel: undefined
    });
  }

  function resumeStockScan() {
    const unfinished = rows.filter((row) => !checksRef.current[row.sheetRowNumber] || checksRef.current[row.sheetRowNumber]?.error);
    void scanLiveStocks(unfinished);
  }

  async function prepareReview(item: StockQueueItem) {
    updateItem(item.id, { status: "processing", message: "Rechecking the product-link and WooCommerce..." });

    try {
      const response = await fetch("/api/reviews/product-sheet-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumber: item.sheetRowNumber, productId: item.wooId, source: "updated-list" })
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        alreadyExists?: boolean;
        alreadyMatches?: boolean;
        stockStatus?: StockStatus;
        stockLabel?: string;
        sourceUrl?: string;
      };
      if (!response.ok) throw new Error(payload.error || connectionMessage(response.status));

      if (payload.stockStatus) {
        saveChecks({
          ...checksRef.current,
          [item.sheetRowNumber]: {
            rowNumber: item.sheetRowNumber,
            sourceUrl: item.sourceProductUrl,
            resolvedUrl: payload.sourceUrl || item.sourceProductUrl,
            stockStatus: payload.stockStatus,
            checkedAt: new Date().toISOString()
          }
        });
      }

      updateItem(item.id, {
        status: "queued",
        queuedAt: new Date().toISOString(),
        message: payload.alreadyMatches
          ? `WooCommerce already matches ${payload.stockLabel || statusLabel(payload.stockStatus)}.`
          : payload.alreadyExists
            ? `Existing review refreshed for ${payload.stockLabel || statusLabel(payload.stockStatus)}.`
            : `${payload.stockLabel || statusLabel(payload.stockStatus)} sent to the Review Queue.`
      });
    } catch (error) {
      updateItem(item.id, {
        status: "failed",
        message: error instanceof Error ? error.message : connectionMessage()
      });
    }
  }

  async function runQueue(seed?: StockQueueItem[]) {
    const nextItems = (seed ?? itemsRef.current).map((item) => item.status === "processing"
      ? { ...item, status: "pending" as const, message: "Waiting to continue." }
      : item);
    saveItems(nextItems);
    queueControlRef.current = { paused: false, stopped: false };
    setPaused(false);
    setStopped(false);
    setRunning(true);

    while (true) {
      await waitForResume(queueControlRef);
      if (queueControlRef.current.stopped) break;
      const next = itemsRef.current.find((item) => item.status === "pending");
      if (!next) break;
      await prepareReview(next);
    }

    setRunning(false);
  }

  function rowItem(row: StockSyncRow): StockQueueItem {
    return { ...row, id: itemId(row), status: "pending", message: "Waiting to be processed." };
  }

  function queueOne(row: StockSyncRow) {
    const candidate = rowItem(row);
    void runQueue([...itemsRef.current.filter((item) => item.id !== candidate.id), candidate]);
  }

  function queueAll() {
    const existing = new Map(itemsRef.current.map((item) => [item.id, item]));
    const candidates = actionableRows.map((row) => {
      const candidate = rowItem(row);
      const current = existing.get(candidate.id);
      return current?.status === "queued" ? current : candidate;
    });
    const ids = new Set(candidates.map((item) => item.id));
    void runQueue([...itemsRef.current.filter((item) => !ids.has(item.id)), ...candidates]);
  }

  function retryFailed() {
    void runQueue(itemsRef.current.map((item) => item.status === "failed"
      ? { ...item, status: "pending" as const, message: "Waiting to retry." }
      : item));
  }

  return (
    <div className="price-sync-workspace">
      <div className="price-sync-toolbar">
        <div>
          <span className="price-sync-icon"><PackageCheck size={18} /></span>
          <div>
            <h3>Live product stock sync</h3>
            <p>Check each spreadsheet product-link, then compare its availability with WooCommerce.</p>
          </div>
        </div>
        <div className="price-sync-toolbar-actions">
          <Link className="button secondary compact-button" href="/reviews">
            Review Queue
            <ExternalLink size={14} />
          </Link>
          <button className="button secondary compact-button" type="button" disabled={queueBusy || Boolean(checkProgress?.running) || !rows.length} onClick={() => void scanLiveStocks(rows)}>
            <RefreshCw className={checkProgress?.running ? "spin" : undefined} size={14} />
            {checkProgress?.running ? "Checking stock" : "Refresh live stock"}
          </button>
          <button className="button compact-button" type="button" disabled={queueBusy || Boolean(checkProgress?.running) || !actionableRows.length} onClick={queueAll}>
            <Play size={14} /> Queue all {actionableRows.length}
          </button>
        </div>
      </div>

      <div className="price-sync-summary" aria-label="Live stock sync status">
        <span><strong>{actionableRows.length}</strong> need updates</span>
        <span><strong>{actionableRows.length + currentCount}</strong> checked</span>
        <span><strong>{currentCount}</strong> already current</span>
        <span><strong>{uncheckedRows.length}</strong> not checked</span>
        <span className={errorRows.length ? "has-error" : undefined}><strong>{errorRows.length}</strong> check errors</span>
        <span><strong>{queueCounts.queued}</strong> queued for review</span>
        <span className={queueCounts.failed ? "has-error" : undefined}><strong>{queueCounts.failed}</strong> failed</span>
        <span className={sharedCacheState === "error" ? "has-error" : undefined}>Check cache <strong>{sharedCacheState === "upstash" ? "Shared Upstash" : sharedCacheState === "local" ? "Local development" : sharedCacheState === "error" ? "Not shared" : "Connecting"}</strong></span>
        <span>Woo data checked <strong>{formatDate(updatedAt)}</strong></span>
      </div>

      {checkProgress ? (
        <section className="price-sync-progress">
          <div className="price-sync-progress-head">
            <div>
              <strong>{checkProgress.running ? checkProgress.paused ? "Live stock check paused" : "Checking product-link stock" : checkProgress.stopped ? "Live stock check stopped" : "Live stock check complete"}</strong>
              <span>{checkProgress.activeLabel ? `${checkProgress.activeLabel} | ` : ""}{checkProgress.current} of {checkProgress.total} finished</span>
            </div>
            <div className="price-sync-toolbar-actions">
              {checkProgress.running ? (
                <>
                  <button className="button secondary compact-button" type="button" onClick={() => {
                    const nextPaused = !checkControlRef.current.paused;
                    checkControlRef.current.paused = nextPaused;
                    setCheckProgress((current) => current ? { ...current, paused: nextPaused } : current);
                  }}>{checkProgress.paused ? <Play size={14} /> : <Pause size={14} />}{checkProgress.paused ? "Continue" : "Pause"}</button>
                  <button className="button secondary compact-button" type="button" onClick={() => {
                    checkControlRef.current.stopped = true;
                    checkControlRef.current.paused = false;
                    setCheckProgress((current) => current ? { ...current, stopped: true, paused: false } : current);
                  }}><Square size={14} /> Stop after current batch</button>
                </>
              ) : checkProgress.stopped || errorRows.length ? (
                <button className="button secondary compact-button" type="button" disabled={!uncheckedRows.length && !errorRows.length} onClick={resumeStockScan}><RotateCcw size={14} /> Continue remaining</button>
              ) : null}
            </div>
          </div>
          <div className="price-sync-progress-track"><span style={{ width: `${Math.round((checkProgress.current / Math.max(1, checkProgress.total)) * 100)}%` }} /></div>
        </section>
      ) : null}

      {items.length ? (
        <section className="price-sync-progress">
          <div className="price-sync-progress-head">
            <div>
              <strong>{running ? paused ? "Stock review queue paused" : "Preparing stock reviews" : stopped ? "Stock queue stopped" : "Stock review queue"}</strong>
              <span>{queueCounts.finished} of {items.length} finished</span>
            </div>
            <div className="price-sync-toolbar-actions">
              {running ? (
                <>
                  <button className="button secondary compact-button" type="button" onClick={() => {
                    const nextPaused = !queueControlRef.current.paused;
                    queueControlRef.current.paused = nextPaused;
                    setPaused(nextPaused);
                  }}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Continue" : "Pause"}</button>
                  <button className="button secondary compact-button" type="button" onClick={() => {
                    queueControlRef.current.stopped = true;
                    queueControlRef.current.paused = false;
                    setPaused(false);
                    setStopped(true);
                  }}><Square size={14} /> Stop after current product</button>
                </>
              ) : (
                <>
                  {items.some((item) => item.status === "pending") ? <button className="button secondary compact-button" type="button" onClick={() => void runQueue()}><Play size={14} /> Continue queue</button> : null}
                  {queueCounts.failed ? <button className="button secondary compact-button" type="button" onClick={retryFailed}><RotateCcw size={14} /> Retry failed</button> : null}
                </>
              )}
            </div>
          </div>
          <div className="price-sync-progress-track"><span style={{ width: `${queueProgress}%` }} /></div>
          <div className="price-sync-history">
            {items.slice().reverse().slice(0, 12).map((item) => (
              <div key={item.id} className={`price-sync-history-item is-${item.status}`}>
                {item.status === "processing" ? <LoaderCircle className="spin" size={15} /> : item.status === "failed" ? <XCircle size={15} /> : item.status === "queued" ? <CheckCircle2 size={15} /> : <PackageCheck size={15} />}
                <div><strong>{item.name}</strong><span>{item.message}</span></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {rows.length ? (
        <div className="price-sync-list-tools">
          <div className="price-sync-status-filters" role="group" aria-label="Filter stock sync status">
            {[
              { id: "all", label: "All", count: rows.length },
              { id: "updates", label: "Needs update", count: actionableRows.length },
              { id: "current", label: "Synced / current", count: currentCount },
              { id: "errors", label: "Errors", count: errorRows.length },
              { id: "unchecked", label: "Not checked", count: uncheckedRows.length }
            ].map((filter) => (
              <button
                key={filter.id}
                className={listFilter === filter.id ? "is-active" : undefined}
                type="button"
                aria-pressed={listFilter === filter.id}
                onClick={() => {
                  setListFilter(filter.id as StockListFilter);
                  setVisibleLimit(75);
                }}
              >
                {filter.label} <span>{filter.count}</span>
              </button>
            ))}
          </div>
        <div className="price-sync-filter">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisibleLimit(75);
            }}
            placeholder="Find unchecked products, stock mismatches, or check errors"
            aria-label="Search stock updates"
          />
          <span>Showing {visibleRows.length} of {matchingRows.length}</span>
        </div>
        </div>
      ) : null}

      {!matchingRows.length ? (
        <div className="price-sync-empty is-neutral">
          <CheckCircle2 size={20} />
          <div><strong>{rows.length && !uncheckedRows.length && !errorRows.length ? "All checked stock statuses are current" : "No matching stock rows"}</strong><span>Change the status filter or search, or refresh live stock.</span></div>
        </div>
      ) : (
        <div className="price-sync-list">
          {visibleRows.map((row) => {
            const check = checks[row.sheetRowNumber];
            const needsUpdate = Boolean(check?.stockStatus) && !stockMatches(row, check);
            const isCurrent = stockMatches(row, check);
            const queueItem = items.find((item) => item.id === itemId(row));
            const lastSync = row.stockLastSyncedAt || row.wooDateModified;
            const rowState = check?.error
              ? "Check failed"
              : needsUpdate
                ? "Needs update"
                : isCurrent
                  ? row.stockLastSyncedAt ? "Synced" : "Already current"
                  : "Not checked";
            const rowStateClass = check?.error
              ? "is-error"
              : needsUpdate
                ? "is-warning"
                : isCurrent
                  ? "is-success"
                  : "is-neutral";

            return (
              <article key={itemId(row)} className="price-sync-row">
                <div className="price-sync-product">
                  <div className="price-sync-product-title">
                    <strong>{row.name}</strong>
                    <span className={`price-sync-state ${rowStateClass}`}>{rowState}</span>
                  </div>
                  <span>Sheet row {row.sheetRowNumber} | Woo #{row.wooId}</span>
                  <span>{row.stockLastSyncedAt ? "Last stock sync" : "Last Woo update"}: {formatDate(lastSync)}</span>
                  {check ? <span>Product-link checked: {formatDate(check.checkedAt)}</span> : null}
                </div>
                <div className="price-sync-values">
                  <div>
                    <span>Product-link availability</span>
                    <strong>{check?.error ? "Check failed" : check?.stockStatus ? statusLabel(check.stockStatus) : "Not checked"}</strong>
                    {check?.stockStatus ? <small className="price-sync-checked"><CheckCircle2 size={12} /> Checked from product-link</small> : null}
                    {check?.error ? <small className="has-error">{check.error}</small> : null}
                  </div>
                  <div>
                    <span>WooCommerce availability</span>
                    <strong>{statusLabel(row.wooStockStatus)}</strong>
                    <small>Backorders: {row.wooBackorders === "notify" ? "Allow and notify" : row.wooBackorders === "yes" ? "Allow" : "Not allowed"}</small>
                    {row.wooManageStock ? <small>Quantity tracked: {row.wooStockQuantity ?? 0}</small> : <small>Quantity not tracked</small>}
                  </div>
                </div>
                <div className="price-sync-actions">
                  {needsUpdate ? (
                    <button className="button compact-button" type="button" disabled={queueBusy || Boolean(checkProgress?.running) || queueItem?.status === "queued" || !row.wooId} onClick={() => queueOne(row)}>
                      {queueItem?.status === "processing" ? <LoaderCircle className="spin" size={14} /> : queueItem?.status === "queued" ? <CheckCircle2 size={14} /> : <PackageCheck size={14} />}
                      {queueItem?.status === "queued" ? "Queued" : "Queue update"}
                    </button>
                  ) : (
                    <button className="button secondary compact-button" type="button" disabled={queueBusy || Boolean(checkProgress?.running)} onClick={() => void scanLiveStocks([row])}>
                      <RefreshCw size={14} /> {check?.error ? "Retry stock" : "Check live stock"}
                    </button>
                  )}
                  <a className="button secondary compact-button" href={check?.resolvedUrl || row.sourceProductUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open product-link</a>
                  {row.wooPermalink ? <a className="button secondary compact-button" href={row.wooPermalink} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Woo product</a> : null}
                  {row.wooId ? <Link className="button secondary compact-button" href={`/products/${row.wooId}`}><SquarePen size={14} /> Product Manager</Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {visibleRows.length < matchingRows.length ? <button className="button secondary price-sync-more" type="button" onClick={() => setVisibleLimit((current) => current + 75)}>Show 75 more</button> : null}
    </div>
  );
}
