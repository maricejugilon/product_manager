"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  LoaderCircle,
  Pause,
  Play,
  PoundSterling,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  SquarePen,
  XCircle
} from "lucide-react";

import type { WooStoreCurrency, WooStoreTaxSettings } from "@/lib/types";
import { loadSharedWorkflow, saveSharedWorkflow } from "@/lib/updated-list-workflow-client";

export type PriceSyncRow = {
  sheetRowNumber: number;
  name: string;
  wooId?: number;
  sourceProductUrl: string;
  sheetPrice: string;
  wooRegularPrice: string;
  wooSalePrice: string;
  wooLivePrice: string;
  wooTaxStatus: string;
  wooTaxClass: string;
  wooSavedPriceIncVat: string;
  wooSavedPriceExVat: string;
  wooSavedVatAmount: string;
  wooSavedVatRate: string;
  wooSavedPriceCurrency: string;
  wooSavedVatTaxClass: string;
  wooSavedVatRateName: string;
  wooDateModified: string;
  priceLastSyncedAt: string;
};

type PriceQueueItem = PriceSyncRow & {
  id: string;
  status: "pending" | "processing" | "queued" | "failed";
  message: string;
  queuedAt?: string;
};

type LivePriceCheck = {
  rowNumber: number;
  sourceUrl: string;
  resolvedUrl?: string;
  price?: string;
  priceExVat?: string;
  vatAmount?: string;
  vatRate?: string;
  currencyCode?: string;
  scrapedAt: string;
  error?: string;
};

type LivePriceProgress = {
  total: number;
  current: number;
  paused: boolean;
  stopped: boolean;
  running: boolean;
};

type PriceListFilter = "all" | "updates" | "current" | "errors" | "unchecked";
type SharedCacheState = "loading" | "upstash" | "local" | "error";

const storageKey = "updated-list-price-sync-v3";
const livePriceStorageKey = "updated-list-live-prices-v2";

function itemId(row: PriceSyncRow) {
  return `price-${row.sheetRowNumber}-${row.wooId ?? "unmatched"}-${row.sheetPrice}`;
}

function normalizedPrice(value: string | undefined) {
  const amount = Number(value);
  return value?.trim() && Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function formatPrice(value: string, currency: WooStoreCurrency) {
  const amount = Number(value);

  if (!value || !Number.isFinite(amount)) {
    return "Not set";
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.code,
      minimumFractionDigits: currency.minorUnit,
      maximumFractionDigits: currency.minorUnit
    }).format(amount);
  } catch {
    return `${currency.prefix}${amount.toFixed(currency.minorUnit)}${currency.suffix}`;
  }
}

function formatDate(value: string) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not recorded"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date);
}

function priceCheckTime(check: LivePriceCheck | undefined) {
  const value = check?.scrapedAt ? Date.parse(check.scrapedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function mergePriceChecks(
  browserChecks: Record<number, LivePriceCheck>,
  sharedChecks: Record<number, LivePriceCheck>
) {
  const merged = { ...browserChecks };

  Object.values(sharedChecks).forEach((check) => {
    if (!merged[check.rowNumber] || priceCheckTime(check) >= priceCheckTime(merged[check.rowNumber])) {
      merged[check.rowNumber] = check;
    }
  });

  return merged;
}

function connectionMessage(status?: number) {
  if (status && [408, 502, 503, 504].includes(status)) {
    return "The product-link page or WooCommerce took too long to respond. This item remains saved and can be retried.";
  }

  return "The price update could not be prepared. This item remains saved and can be retried.";
}

export default function UpdatedListPriceSync({
  rows,
  currency,
  tax,
  updatedAt,
  disabled = false
}: {
  rows: PriceSyncRow[];
  currency: WooStoreCurrency;
  tax: WooStoreTaxSettings;
  updatedAt: string;
  disabled?: boolean;
}) {
  const [items, setItems] = useState<PriceQueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<PriceListFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(75);
  const [livePrices, setLivePrices] = useState<Record<number, LivePriceCheck>>({});
  const [livePriceProgress, setLivePriceProgress] = useState<LivePriceProgress | null>(null);
  const [sharedCacheState, setSharedCacheState] = useState<SharedCacheState>("loading");
  const itemsRef = useRef<PriceQueueItem[]>([]);
  const controlRef = useRef({ paused: false, stopped: false });
  const livePricesRef = useRef<Record<number, LivePriceCheck>>({});
  const livePriceControlRef = useRef({ paused: false, stopped: false });

  function saveItems(next: PriceQueueItem[]) {
    itemsRef.current = next;
    setItems(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    void saveSharedWorkflow("price-updates", next)
      .then((payload) => setSharedCacheState(payload.storage || "local"))
      .catch(() => setSharedCacheState("error"));
  }

  function updateItem(id: string, changes: Partial<PriceQueueItem>) {
    saveItems(itemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  async function persistSharedPrices(updates: LivePriceCheck[]) {
    if (!updates.length) return;

    try {
      const response = await fetch("/api/updated-list/shared-checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "price", checks: updates })
      });
      const payload = await response.json().catch(() => ({})) as { storage?: "upstash" | "local"; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the shared price cache.");
      setSharedCacheState(payload.storage || "local");
    } catch {
      setSharedCacheState("error");
    }
  }

  function saveLivePrices(next: Record<number, LivePriceCheck>) {
    const changed = Object.values(next).filter((check) => {
      const previous = livePricesRef.current[check.rowNumber];
      return JSON.stringify(previous) !== JSON.stringify(check);
    });
    livePricesRef.current = next;
    setLivePrices(next);
    window.localStorage.setItem(livePriceStorageKey, JSON.stringify(next));
    void persistSharedPrices(changed);
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as PriceQueueItem[];
      const unique = new Map<string, PriceQueueItem>();

      parsed.forEach((item) => {
        if (item?.id) {
          unique.set(item.id, item.status === "processing"
            ? { ...item, status: "pending", message: "Ready to resume." }
            : item);
        }
      });

      const restored = [...unique.values()];
      itemsRef.current = restored;
      setItems(restored);
      setStopped(restored.some((item) => item.status === "pending"));
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function hydrateSharedQueue() {
      try {
        const payload = await loadSharedWorkflow<PriceQueueItem>("price-updates");
        if (!active) return;
        setSharedCacheState(payload.storage || "local");

        if (!payload.state) {
          if (itemsRef.current.length) void saveSharedWorkflow("price-updates", itemsRef.current);
          return;
        }

        const isRecent = Date.now() - Date.parse(payload.state.updatedAt) < 2 * 60 * 1000;
        const unique = new Map<string, PriceQueueItem>();
        payload.state.items.forEach((item) => {
          if (!item?.id) return;
          unique.set(item.id, item.status === "processing" && !isRecent
            ? { ...item, status: "pending", message: "Interrupted and ready to resume." }
            : item);
        });
        const restored = [...unique.values()];
        itemsRef.current = restored;
        setItems(restored);
        setStopped(restored.some((item) => item.status === "pending"));
        window.localStorage.setItem(storageKey, JSON.stringify(restored));
      } catch {
        if (active) setSharedCacheState("error");
      }
    }

    void hydrateSharedQueue();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    try {
      const stored = window.localStorage.getItem(livePriceStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<number, LivePriceCheck>;
        const currentSources = new Map(rows.map((row) => [row.sheetRowNumber, row.sourceProductUrl]));
        const restored = Object.fromEntries(
          Object.entries(parsed).filter(([rowNumber, result]) =>
            currentSources.get(Number(rowNumber)) === result.sourceUrl
          )
        ) as Record<number, LivePriceCheck>;

        livePricesRef.current = restored;
        setLivePrices(restored);
      }
    } catch {
      window.localStorage.removeItem(livePriceStorageKey);
    }

    async function loadSharedPrices() {
      try {
        const response = await fetch("/api/updated-list/shared-checks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "price", rowNumbers: rows.map((row) => row.sheetRowNumber) })
        });
        const payload = await response.json().catch(() => ({})) as {
          checks?: Record<number, LivePriceCheck>;
          storage?: "upstash" | "local";
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not load the shared price cache.");
        if (!active) return;

        const currentSources = new Map(rows.map((row) => [row.sheetRowNumber, row.sourceProductUrl]));
        const sharedPrices = Object.fromEntries(
          Object.entries(payload.checks ?? {}).filter(([rowNumber, result]) =>
            currentSources.get(Number(rowNumber)) === result.sourceUrl
          )
        ) as Record<number, LivePriceCheck>;
        const browserPrices = livePricesRef.current;
        const merged = mergePriceChecks(browserPrices, sharedPrices);
        livePricesRef.current = merged;
        setLivePrices(merged);
        window.localStorage.setItem(livePriceStorageKey, JSON.stringify(merged));
        setSharedCacheState(payload.storage || "local");

        const newerBrowserPrices = Object.values(browserPrices).filter((check) =>
          !sharedPrices[check.rowNumber] || priceCheckTime(check) > priceCheckTime(sharedPrices[check.rowNumber])
        );
        if (newerBrowserPrices.length) void persistSharedPrices(newerBrowserPrices);
      } catch {
        if (active) setSharedCacheState("error");
      }
    }

    void loadSharedPrices();

    return () => {
      active = false;
    };
  }, [rows]);

  function wooTargetPrice(result: LivePriceCheck | undefined) {
    return normalizedPrice(
      tax.pricesIncludeTax
        ? result?.price
        : result?.priceExVat || result?.price
    );
  }

  function vatDataMatches(row: PriceSyncRow, result: LivePriceCheck | undefined) {
    if (!result?.price || !result.priceExVat || !result.vatAmount || !result.vatRate) {
      return false;
    }

    const savedWooTaxClass = row.wooSavedVatTaxClass === "standard"
      ? ""
      : row.wooSavedVatTaxClass;

    return row.wooTaxStatus === "taxable" &&
      Boolean(row.wooSavedVatTaxClass) &&
      row.wooTaxClass === savedWooTaxClass &&
      normalizedPrice(row.wooSavedPriceIncVat) === normalizedPrice(result.price) &&
      normalizedPrice(row.wooSavedPriceExVat) === normalizedPrice(result.priceExVat) &&
      normalizedPrice(row.wooSavedVatAmount) === normalizedPrice(result.vatAmount) &&
      normalizedPrice(row.wooSavedVatRate) === normalizedPrice(result.vatRate) &&
      row.wooSavedPriceCurrency.toUpperCase() === (result.currencyCode || currency.code).toUpperCase();
  }

  const counts = useMemo(() => ({
    queued: items.filter((item) => item.status === "queued").length,
    failed: items.filter((item) => item.status === "failed").length,
    finished: items.filter((item) => item.status === "queued" || item.status === "failed").length
  }), [items]);
  const progress = items.length > 0 ? Math.round((counts.finished / items.length) * 100) : 0;
  const activeItem = items.find((item) => item.status === "processing");
  const actionableRows = useMemo(() => rows.filter((row) => {
    const scrapedPrice = wooTargetPrice(livePrices[row.sheetRowNumber]);

    return Boolean(scrapedPrice) && (
      normalizedPrice(row.wooRegularPrice) !== scrapedPrice ||
      Boolean(normalizedPrice(row.wooSalePrice)) ||
      normalizedPrice(row.wooLivePrice) !== scrapedPrice ||
      !vatDataMatches(row, livePrices[row.sheetRowNumber])
    );
  }), [livePrices, rows, tax.pricesIncludeTax]);
  const currentRows = useMemo(() => rows.filter((row) => {
    const scrapedPrice = wooTargetPrice(livePrices[row.sheetRowNumber]);

    return Boolean(scrapedPrice) &&
      normalizedPrice(row.wooRegularPrice) === scrapedPrice &&
      !normalizedPrice(row.wooSalePrice) &&
      normalizedPrice(row.wooLivePrice) === scrapedPrice &&
      vatDataMatches(row, livePrices[row.sheetRowNumber]);
  }), [livePrices, rows, tax.pricesIncludeTax]);
  const upToDateCount = currentRows.length;
  const scrapeErrorRows = useMemo(
    () => rows.filter((row) => Boolean(livePrices[row.sheetRowNumber]?.error)),
    [livePrices, rows]
  );
  const uncheckedRows = useMemo(
    () => rows.filter((row) => !livePrices[row.sheetRowNumber]),
    [livePrices, rows]
  );
  const filteredRows = useMemo(() => {
    if (listFilter === "updates") return actionableRows;
    if (listFilter === "current") return currentRows;
    if (listFilter === "errors") return scrapeErrorRows;
    if (listFilter === "unchecked") return uncheckedRows;
    return rows;
  }, [actionableRows, currentRows, listFilter, rows, scrapeErrorRows, uncheckedRows]);
  const matchingRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return filteredRows;
    }

    return filteredRows.filter((row) =>
      row.name.toLowerCase().includes(query) ||
      String(row.wooId ?? "").includes(query) ||
      String(row.sheetRowNumber).includes(query)
    );
  }, [filteredRows, search]);
  const visibleRows = matchingRows.slice(0, visibleLimit);

  function liveProductUrl(row: PriceSyncRow) {
    return row.sourceProductUrl?.trim() ?? "";
  }

  async function scrapePriceBatch(batch: PriceSyncRow[]) {
    try {
      const response = await fetch("/api/updated-list/live-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumbers: batch.map((row) => row.sheetRowNumber) })
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        results?: LivePriceCheck[];
      };

      if (!response.ok) {
        throw new Error(payload.error || "Could not scrape this batch of product-link prices.");
      }

      const next = { ...livePricesRef.current };
      (payload.results ?? []).forEach((result) => {
        next[result.rowNumber] = result;
      });
      saveLivePrices(next);
    } catch (error) {
      const message = error instanceof TypeError
        ? "The live product site could not be reached. This batch can be retried."
        : error instanceof Error
          ? error.message
          : "Could not scrape this batch of product-link prices.";
      const next = { ...livePricesRef.current };

      batch.forEach((row) => {
        next[row.sheetRowNumber] = {
          rowNumber: row.sheetRowNumber,
          sourceUrl: row.sourceProductUrl,
          scrapedAt: new Date().toISOString(),
          error: message
        };
      });
      saveLivePrices(next);
    }
  }

  async function scanLivePrices(targetRows: PriceSyncRow[]) {
    if (livePriceProgress?.running || targetRows.length === 0 || disabled || running) {
      return;
    }

    livePriceControlRef.current = { paused: false, stopped: false };
    setLivePriceProgress({
      total: targetRows.length,
      current: 0,
      paused: false,
      stopped: false,
      running: true
    });

    let completed = 0;

    for (let index = 0; index < targetRows.length; index += 12) {
      if (livePriceControlRef.current.stopped) {
        break;
      }

      while (livePriceControlRef.current.paused && !livePriceControlRef.current.stopped) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      if (livePriceControlRef.current.stopped) {
        break;
      }

      const batch = targetRows.slice(index, index + 12);
      await scrapePriceBatch(batch);
      completed += batch.length;
      setLivePriceProgress((current) => current ? { ...current, current: completed } : current);
    }

    const wasStopped = livePriceControlRef.current.stopped;
    setLivePriceProgress({
      total: targetRows.length,
      current: completed,
      paused: false,
      stopped: wasStopped,
      running: false
    });
  }

  function resumeLivePriceScan() {
    const unfinished = rows.filter((row) =>
      !livePricesRef.current[row.sheetRowNumber] || livePricesRef.current[row.sheetRowNumber]?.error
    );
    void scanLivePrices(unfinished);
  }

  async function preparePriceReview(item: PriceQueueItem) {
    updateItem(item.id, {
      status: "processing",
      message: "Scraping the spreadsheet product-link and checking WooCommerce..."
    });

    try {
      const response = await fetch("/api/reviews/product-sheet-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: item.sheetRowNumber,
          productId: item.wooId,
          source: "updated-list"
        })
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        alreadyExists?: boolean;
        alreadyMatches?: boolean;
        price?: string;
        priceIncVat?: string;
        priceExVat?: string;
        vatAmount?: string;
        vatRate?: string;
        currencyCode?: string;
        sourceUrl?: string;
        taxClassLabel?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || connectionMessage(response.status));
      }

      if (payload.price && payload.priceIncVat) {
        saveLivePrices({
          ...livePricesRef.current,
          [item.sheetRowNumber]: {
            rowNumber: item.sheetRowNumber,
            sourceUrl: item.sourceProductUrl,
            resolvedUrl: payload.sourceUrl || item.sourceProductUrl,
            price: normalizedPrice(payload.priceIncVat),
            priceExVat: normalizedPrice(payload.priceExVat),
            vatAmount: normalizedPrice(payload.vatAmount),
            vatRate: payload.vatRate,
            currencyCode: payload.currencyCode || currency.code,
            scrapedAt: new Date().toISOString()
          }
        });
      }

      updateItem(item.id, {
        status: "queued",
        queuedAt: new Date().toISOString(),
        message: payload.alreadyMatches
          ? `WooCommerce already matches the scraped ${payload.currencyCode ?? currency.code} ${payload.price ?? ""} ${tax.pricesIncludeTax ? "inc VAT" : "ex VAT"} catalog price with Taxable / ${payload.taxClassLabel ?? "Standard"}.`
          : payload.alreadyExists
            ? `Existing review refreshed with ${payload.currencyCode ?? currency.code} ${payload.price ?? ""} ${tax.pricesIncludeTax ? "inc VAT" : "ex VAT"} and Taxable / ${payload.taxClassLabel ?? "Standard"}.`
            : `${payload.currencyCode ?? currency.code} ${payload.price ?? ""} ${tax.pricesIncludeTax ? "inc VAT" : "ex VAT"} and Taxable / ${payload.taxClassLabel ?? "Standard"} sent to the Review Queue.`
      });
    } catch (error) {
      updateItem(item.id, {
        status: "failed",
        message: error instanceof TypeError
          ? connectionMessage()
          : error instanceof Error
            ? error.message
            : connectionMessage()
      });
    }
  }

  async function runQueue(nextItems?: PriceQueueItem[]) {
    if (running || disabled) {
      return;
    }

    if (nextItems) {
      saveItems(nextItems);
    }

    controlRef.current = { paused: false, stopped: false };
    setPaused(false);
    setStopped(false);
    setRunning(true);

    while (true) {
      if (controlRef.current.stopped) {
        setStopped(true);
        break;
      }

      while (controlRef.current.paused && !controlRef.current.stopped) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      const next = itemsRef.current.find((item) => item.status === "pending");

      if (!next || controlRef.current.stopped) {
        break;
      }

      await preparePriceReview(next);
    }

    setRunning(false);
  }

  function rowItem(row: PriceSyncRow): PriceQueueItem {
    const targetRow = {
      ...row,
      sheetPrice: wooTargetPrice(livePricesRef.current[row.sheetRowNumber]) || row.sheetPrice
    };

    return {
      ...targetRow,
      id: itemId(targetRow),
      status: "pending",
      message: "Waiting to be processed."
    };
  }

  function queueOne(row: PriceSyncRow) {
    const candidate = rowItem(row);
    const next = [
      ...itemsRef.current.filter((item) => item.id !== candidate.id),
      candidate
    ];
    void runQueue(next);
  }

  function queueAll() {
    const existing = new Map(itemsRef.current.map((item) => [item.id, item]));
    const candidates = actionableRows.map((row) => {
      const candidate = rowItem(row);
      const current = existing.get(candidate.id);
      return current?.status === "queued" ? current : candidate;
    });
    const visibleIds = new Set(candidates.map((item) => item.id));
    const history = itemsRef.current.filter((item) => !visibleIds.has(item.id));
    void runQueue([...history, ...candidates]);
  }

  function retryFailed() {
    const next = itemsRef.current.map((item) => item.status === "failed"
      ? { ...item, status: "pending" as const, message: "Waiting to retry." }
      : item);
    void runQueue(next);
  }

  function resume() {
    const next = itemsRef.current.map((item) => item.status === "processing"
      ? { ...item, status: "pending" as const, message: "Ready to resume." }
      : item);
    void runQueue(next);
  }

  const queueBusy = running || disabled;

  return (
    <div className="price-sync-workspace">
      <div className="price-sync-toolbar">
        <div>
          <span className="price-sync-icon"><PoundSterling size={18} /></span>
          <div>
            <h3>Live product price sync</h3>
            <p>Scrape each spreadsheet product-link, then compare its current price with WooCommerce.</p>
          </div>
        </div>
        <div className="price-sync-toolbar-actions">
          <Link className="button secondary compact-button" href="/reviews">
            Review Queue
            <ExternalLink size={14} />
          </Link>
          <button
            className="button secondary compact-button"
            type="button"
            disabled={queueBusy || Boolean(livePriceProgress?.running) || rows.length === 0}
            onClick={() => void scanLivePrices(rows)}
          >
            <RefreshCw className={livePriceProgress?.running ? "spin" : undefined} size={14} />
            {livePriceProgress?.running ? "Scraping prices" : "Refresh live prices"}
          </button>
          <button className="button compact-button" type="button" disabled={queueBusy || Boolean(livePriceProgress?.running) || actionableRows.length === 0} onClick={queueAll}>
            <Play size={14} />
            Queue all {actionableRows.length}
          </button>
        </div>
      </div>

      <div className="price-sync-summary" aria-label="Price sync status">
        <span><strong>{actionableRows.length}</strong> need updates</span>
        <span><strong>{actionableRows.length + upToDateCount}</strong> checked</span>
        <span><strong>{upToDateCount}</strong> already current</span>
        <span><strong>{uncheckedRows.length}</strong> not checked</span>
        <span className={scrapeErrorRows.length ? "has-error" : undefined}><strong>{scrapeErrorRows.length}</strong> scrape errors</span>
        <span>Currency <strong>{currency.code} ({currency.symbol})</strong></span>
        <span>Woo catalog <strong>{tax.pricesIncludeTax ? "inc VAT" : "ex VAT"}</strong></span>
        <span><strong>{counts.queued}</strong> queued for review</span>
        <span className={counts.failed ? "has-error" : undefined}><strong>{counts.failed}</strong> failed</span>
        <span className={sharedCacheState === "error" ? "has-error" : undefined}>Check cache <strong>{sharedCacheState === "upstash" ? "Shared Upstash" : sharedCacheState === "local" ? "Local development" : sharedCacheState === "error" ? "Not shared" : "Connecting"}</strong></span>
        <span>Woo data checked <strong>{formatDate(updatedAt)}</strong></span>
      </div>

      {rows.length > 0 ? (
        <div className="price-sync-list-tools">
          <div className="price-sync-status-filters" role="group" aria-label="Filter price sync status">
            {[
              { id: "all", label: "All", count: rows.length },
              { id: "updates", label: "Needs update", count: actionableRows.length },
              { id: "current", label: "Synced / current", count: upToDateCount },
              { id: "errors", label: "Errors", count: scrapeErrorRows.length },
              { id: "unchecked", label: "Not checked", count: uncheckedRows.length }
            ].map((filter) => (
              <button
                key={filter.id}
                className={listFilter === filter.id ? "is-active" : undefined}
                type="button"
                aria-pressed={listFilter === filter.id}
                onClick={() => {
                  setListFilter(filter.id as PriceListFilter);
                  setVisibleLimit(75);
                }}
              >
                {filter.label} <span>{filter.count}</span>
              </button>
            ))}
          </div>
          <div className="price-sync-filter">
            <Search size={16} />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleLimit(75);
              }}
              placeholder="Find checked products, mismatches, or scrape errors"
              aria-label="Search price updates"
            />
            <span>Showing {visibleRows.length} of {matchingRows.length}</span>
          </div>
        </div>
      ) : null}

      {livePriceProgress ? (
        <div className="price-sync-progress">
          <div className="price-sync-progress-head">
            <div>
              <strong>
                {livePriceProgress.running
                  ? livePriceProgress.stopped
                    ? "Stopping after the current batch"
                    : livePriceProgress.paused
                      ? "Live price scan paused"
                      : "Scraping spreadsheet product-links"
                  : livePriceProgress.stopped
                    ? "Live price scan stopped"
                    : "Live price scan complete"}
              </strong>
              <span>{livePriceProgress.current} of {livePriceProgress.total} pages checked</span>
            </div>
            <div className="price-sync-progress-actions">
              {livePriceProgress.running ? (
                <>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    disabled={livePriceProgress.stopped}
                    onClick={() => {
                      livePriceControlRef.current.paused = !livePriceControlRef.current.paused;
                      setLivePriceProgress((current) => current
                        ? { ...current, paused: livePriceControlRef.current.paused }
                        : current);
                    }}
                  >
                    {livePriceProgress.paused ? <Play size={14} /> : <Pause size={14} />}
                    {livePriceProgress.paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    disabled={livePriceProgress.stopped}
                    onClick={() => {
                      livePriceControlRef.current = { paused: false, stopped: true };
                      setLivePriceProgress((current) => current
                        ? { ...current, paused: false, stopped: true }
                        : current);
                    }}
                  >
                    <Square size={13} />
                    Stop after batch
                  </button>
                </>
              ) : (livePriceProgress.stopped || scrapeErrorRows.length > 0 || uncheckedRows.length > 0) ? (
                <button className="button secondary compact-button" type="button" disabled={disabled || running} onClick={resumeLivePriceScan}>
                  <RotateCcw size={14} />
                  Retry unfinished
                </button>
              ) : null}
            </div>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Live product price scan"
            aria-valuemin={0}
            aria-valuemax={livePriceProgress.total}
            aria-valuenow={livePriceProgress.current}
          >
            <span style={{ width: `${livePriceProgress.total ? (livePriceProgress.current / livePriceProgress.total) * 100 : 0}%` }} />
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="price-sync-progress">
          <div className="price-sync-progress-head">
            <div>
              <strong>{running ? stopped ? "Stopping after the current product" : paused ? "Price queue paused" : "Preparing price updates" : stopped ? "Price queue stopped" : "Price queue status"}</strong>
              <span>{activeItem ? `Processing ${activeItem.name}` : `${counts.finished} of ${items.length} processed`}</span>
            </div>
            <div className="price-sync-progress-actions">
              {running ? (
                <>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    disabled={stopped}
                    onClick={() => {
                      controlRef.current.paused = !controlRef.current.paused;
                      setPaused(controlRef.current.paused);
                    }}
                  >
                    {paused ? <Play size={14} /> : <Pause size={14} />}
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    disabled={stopped}
                    onClick={() => {
                      controlRef.current = { paused: false, stopped: true };
                      setPaused(false);
                      setStopped(true);
                    }}
                  >
                    <Square size={13} />
                    Stop after current
                  </button>
                </>
              ) : (
                <>
                  {items.some((item) => item.status === "pending") ? (
                    <button className="button secondary compact-button" type="button" disabled={disabled} onClick={resume}>
                      <Play size={14} />
                      Resume unfinished
                    </button>
                  ) : null}
                  {counts.failed > 0 ? (
                    <button className="button secondary compact-button" type="button" disabled={disabled} onClick={retryFailed}>
                      <RotateCcw size={14} />
                      Retry failed
                    </button>
                  ) : null}
                  <button
                    className="button secondary compact-button"
                    type="button"
                    onClick={() => saveItems(itemsRef.current.filter((item) => item.status === "pending" || item.status === "processing"))}
                  >
                    Clear results
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="progress-track" role="progressbar" aria-label="Price update queue" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="price-sync-queue">
            {items.map((item) => (
              <div key={item.id}>
                {item.status === "queued" ? <CheckCircle2 size={16} /> : item.status === "failed" ? <XCircle size={16} /> : item.status === "processing" ? <LoaderCircle className="spin" size={16} /> : <Circle size={16} />}
                <div>
                  <strong>{item.name}</strong>
                  <span className={item.status === "failed" ? "has-error" : undefined}>{item.message}</span>
                  {item.status === "queued" ? (
                    <div className="price-sync-queue-links">
                      {liveProductUrl(item) ? (
                        <a href={liveProductUrl(item)} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} />
                          Open product-link
                        </a>
                      ) : null}
                      {item.wooId ? (
                        <Link href={`/products/${item.wooId}`}>
                          <SquarePen size={13} />
                          Product Manager
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <span className={`status ${item.status === "queued" ? "approved" : item.status === "failed" ? "failed" : "neutral"}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="price-sync-empty is-neutral">
          <Circle size={22} />
          <div>
            <strong>No products are ready for a live price check</strong>
            <span>A product needs one clear WooCommerce match and a product-link in the spreadsheet.</span>
          </div>
        </div>
      ) : (
        <>
          {matchingRows.length === 0 ? (
            <div className="price-sync-empty is-neutral">
              <Search size={20} />
              <div>
                <strong>No matching price products</strong>
                <span>Change the status filter or try a product name, sheet row, or WooCommerce ID.</span>
              </div>
            </div>
          ) : (
            <div className="price-sync-list">
              {visibleRows.map((row) => {
                const liveCheck = livePrices[row.sheetRowNumber];
                const scrapedPrice = normalizedPrice(liveCheck?.price);
                const targetPrice = wooTargetPrice(liveCheck);
                const queueRow = { ...row, sheetPrice: targetPrice || row.sheetPrice };
                const id = itemId(queueRow);
                const queueItem = items.find((item) => item.id === id);
                const liveUrl = liveProductUrl(row);
                const lastSync = row.priceLastSyncedAt || row.wooDateModified;
                const needsUpdate = Boolean(targetPrice) && (
                  normalizedPrice(row.wooRegularPrice) !== targetPrice ||
                  Boolean(normalizedPrice(row.wooSalePrice)) ||
                  normalizedPrice(row.wooLivePrice) !== targetPrice ||
                  !vatDataMatches(row, liveCheck)
                );
                const isCurrent = Boolean(targetPrice) && !needsUpdate;
                const rowState = liveCheck?.error
                  ? "Check failed"
                  : needsUpdate
                    ? "Needs update"
                    : isCurrent
                      ? row.priceLastSyncedAt ? "Synced" : "Already current"
                      : "Not checked";
                const rowStateClass = liveCheck?.error
                  ? "is-error"
                  : needsUpdate
                    ? "is-warning"
                    : isCurrent
                      ? "is-success"
                      : "is-neutral";

                return (
                  <article key={id} className="price-sync-row">
                    <div className="price-sync-product">
                      <div className="price-sync-product-title">
                        <strong>{row.name}</strong>
                        <span className={`price-sync-state ${rowStateClass}`}>{rowState}</span>
                      </div>
                      <span>Sheet row {row.sheetRowNumber} | Woo #{row.wooId}</span>
                      <span>{row.priceLastSyncedAt ? "Last price sync" : "Last Woo update"}: {formatDate(lastSync)}</span>
                      {liveCheck ? <span>Product-link checked: {formatDate(liveCheck.scrapedAt)}</span> : null}
                    </div>
                    <div className="price-sync-values">
                      <div>
                        <span>Product-link ({liveCheck?.currencyCode || currency.code})</span>
                        <strong>{scrapedPrice ? formatPrice(scrapedPrice, { ...currency, code: liveCheck?.currencyCode || currency.code }) : liveCheck?.error ? "Scrape failed" : "Not checked"}</strong>
                        {scrapedPrice ? <small className="price-sync-checked"><CheckCircle2 size={12} /> Checked from product-link</small> : null}
                        {liveCheck?.priceExVat ? (
                          <small>
                            {formatPrice(liveCheck.priceExVat, { ...currency, code: liveCheck.currencyCode || currency.code })} ex VAT
                            {liveCheck.vatAmount ? ` + ${formatPrice(liveCheck.vatAmount, { ...currency, code: liveCheck.currencyCode || currency.code })} VAT${liveCheck.vatRate ? ` (${Number(liveCheck.vatRate).toFixed(0)}%)` : ""}` : ""}
                          </small>
                        ) : null}
                        {liveCheck?.error ? <small className="has-error">{liveCheck.error}</small> : row.sheetPrice ? <small>Sheet reference: {formatPrice(row.sheetPrice, currency)}</small> : null}
                      </div>
                      <div>
                        <span>WooCommerce ({currency.code}, {tax.pricesIncludeTax ? "inc VAT" : "ex VAT"})</span>
                        <strong>{formatPrice(row.wooLivePrice || row.wooRegularPrice, currency)}</strong>
                        <small>
                          Tax status: {row.wooTaxStatus === "taxable" ? "Taxable" : row.wooTaxStatus || "Not set"} | Class: {row.wooTaxClass || "Standard"}
                        </small>
                        {row.wooSalePrice ? <small>Sale {formatPrice(row.wooSalePrice, currency)} will be cleared</small> : null}
                        {row.wooSavedVatRate ? (
                          <small className="price-sync-checked">
                            <CheckCircle2 size={12} /> VAT saved separately: {Number(row.wooSavedVatRate).toFixed(2)}% ({row.wooSavedVatRateName || row.wooSavedVatTaxClass})
                          </small>
                        ) : liveCheck?.vatRate ? (
                          <small className="has-error">VAT fields still need to be saved in WooCommerce.</small>
                        ) : null}
                      </div>
                    </div>
                    <div className="price-sync-actions">
                      {needsUpdate ? (
                        <button
                          className="button compact-button"
                          type="button"
                          disabled={queueBusy || Boolean(livePriceProgress?.running) || queueItem?.status === "queued" || !row.wooId}
                          onClick={() => queueOne(row)}
                        >
                          {queueItem?.status === "processing" ? <LoaderCircle className="spin" size={14} /> : queueItem?.status === "queued" ? <CheckCircle2 size={14} /> : <PoundSterling size={14} />}
                          {queueItem?.status === "queued" ? "Queued" : "Queue update"}
                        </button>
                      ) : (
                        <button
                          className="button compact-button"
                          type="button"
                          disabled={queueBusy || Boolean(livePriceProgress?.running)}
                          onClick={() => void scanLivePrices([row])}
                        >
                          <RefreshCw size={14} />
                          {liveCheck?.error ? "Retry price" : "Check live price"}
                        </button>
                      )}
                      {liveUrl ? (
                        <a className="button secondary compact-button" href={liveUrl} target="_blank" rel="noreferrer" title="Open the public product page">
                          <ExternalLink size={14} />
                          Open product-link
                        </a>
                      ) : null}
                      {row.wooId ? (
                        <Link className="button secondary compact-button" href={`/products/${row.wooId}`} title="Open in Product Manager">
                          <SquarePen size={14} />
                          Product Manager
                        </Link>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {visibleRows.length < matchingRows.length ? (
            <button className="button secondary price-sync-more" type="button" onClick={() => setVisibleLimit((current) => current + 75)}>
              Show 75 more
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
