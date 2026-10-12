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
  RotateCcw,
  Search,
  Square,
  SquarePen,
  Wrench,
  XCircle
} from "lucide-react";

import { loadSharedWorkflow, saveSharedWorkflow } from "@/lib/updated-list-workflow-client";

export type SkuFixRow = {
  sheetRowNumber: number;
  name: string;
  wooId: number;
  wooPermalink?: string;
  currentSku: string;
  newSku: string;
};

type QueueItem = SkuFixRow & {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
};

type Batch = {
  total: number;
  current: number;
  paused: boolean;
  stopped: boolean;
};

const storageKey = "updated-list-sku-fixes-v2";

function itemId(row: SkuFixRow) {
  return `${row.sheetRowNumber}-${row.wooId}`;
}

function queueItem(row: SkuFixRow): QueueItem {
  return {
    ...row,
    id: itemId(row),
    status: "pending",
    message: "Waiting to send to Review Queue."
  };
}

function responseError(response: Response, fallback: string) {
  return [408, 502, 503, 504].includes(response.status)
    ? "The WooCommerce connection timed out. This SKU fix is saved and can be retried."
    : fallback;
}

export default function UpdatedListSkuFixes({
  rows,
  disabled = false,
  onRunningChange
}: {
  rows: SkuFixRow[];
  disabled?: boolean;
  onRunningChange?: (running: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);
  const controlRef = useRef({ paused: false, stopped: false });

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      row.name.toLowerCase().includes(needle) ||
      row.currentSku.toLowerCase().includes(needle) ||
      row.newSku.toLowerCase().includes(needle)
    );
  }, [rows, search]);
  const queueById = useMemo(() => new Map(queue.map((item) => [item.id, item])), [queue]);
  const activeItem = queue.find((item) => item.status === "processing");
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const percent = batch && batch.total > 0 ? Math.round(batch.current / batch.total * 100) : 0;

  useEffect(() => {
    onRunningChange?.(Boolean(batch && !batch.stopped));
  }, [batch, onRunningChange]);

  function saveQueue(items: QueueItem[]) {
    queueRef.current = items;
    setQueue(items);
    window.localStorage.setItem(storageKey, JSON.stringify(items));
    void saveSharedWorkflow("sku-fixes", items).catch(() => undefined);
  }

  function updateItem(id: string, changes: Partial<QueueItem>) {
    saveQueue(queueRef.current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  useEffect(() => {
    let active = true;
    let localItems: QueueItem[] = [];

    try {
      localItems = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as QueueItem[];
    } catch {
      window.localStorage.removeItem(storageKey);
    }

    const currentRows = new Map(rows.map((row) => [itemId(row), row]));
    const restore = (items: QueueItem[]) => items.flatMap((item) => {
      const current = currentRows.get(item.id);
      if (!current) return [];
      if (item.newSku !== current.newSku) {
        return [{
          ...queueItem(current),
          message: "Product code changed in the spreadsheet and is ready to queue again."
        }];
      }
      return [{
        ...item,
        ...current,
        status: item.status === "processing" ? "pending" as const : item.status,
        message: item.status === "processing" ? "Interrupted and ready to continue." : item.message
      }];
    });
    const restoredLocal = restore(localItems);
    queueRef.current = restoredLocal;
    setQueue(restoredLocal);

    void loadSharedWorkflow<QueueItem>("sku-fixes")
      .then((payload) => {
        if (!active) return;
        const items = payload.state?.items?.length ? restore(payload.state.items) : restoredLocal;
        queueRef.current = items;
        setQueue(items);
        window.localStorage.setItem(storageKey, JSON.stringify(items));
        if (items.some((item) => item.status === "pending")) {
          setBatch({
            total: items.filter((item) => item.status !== "completed").length,
            current: items.filter((item) => item.status === "failed").length,
            paused: false,
            stopped: true
          });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, [rows]);

  async function processRows(selectedRows?: SkuFixRow[], replace = false) {
    if (batch && !batch.stopped) return;

    let items = queueRef.current;
    if (selectedRows) {
      const existing = new Map(items.map((item) => [item.id, item]));
      const incoming = selectedRows.map((row) => {
        const saved = existing.get(itemId(row));
        return saved?.status === "completed"
          ? saved
          : { ...(saved ?? {}), ...queueItem(row), status: "pending" as const, message: "Waiting to send to Review Queue." };
      });
      items = replace
        ? incoming
        : [...items.filter((item) => !incoming.some((candidate) => candidate.id === item.id)), ...incoming];
      saveQueue(items);
    }

    const work = items.filter((item) => item.status === "pending");
    if (work.length === 0) {
      setBatch(null);
      setMessage("No SKU fixes are waiting to be processed.");
      return;
    }

    setMessage("");
    setError("");
    controlRef.current = { paused: false, stopped: false };
    setBatch({ total: work.length, current: 0, paused: false, stopped: false });

    for (let index = 0; index < work.length; index += 1) {
      while (controlRef.current.paused && !controlRef.current.stopped) {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
      if (controlRef.current.stopped) {
        setBatch({ total: work.length, current: index, paused: false, stopped: true });
        setMessage("SKU update stopped. Pending products are saved and ready to continue.");
        return;
      }

      const item = work[index];
      updateItem(item.id, { status: "processing", message: "Creating SKU fix review..." });

      try {
        const response = await fetch("/api/reviews/product-sheet-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowNumber: item.sheetRowNumber, productId: item.wooId })
        });
        const payload = await response.json().catch(() => ({})) as {
          alreadyExists?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(responseError(response, payload.error || "Could not create the SKU fix review."));
        }
        updateItem(item.id, {
          status: "completed",
          message: payload.alreadyExists ? "Already waiting in Review Queue." : "Sent to Review Queue."
        });
      } catch (caught) {
        updateItem(item.id, {
          status: "failed",
          message: caught instanceof Error ? caught.message : "Could not create the SKU fix review."
        });
      }

      setBatch({ total: work.length, current: index + 1, paused: false, stopped: false });
    }

    const failed = queueRef.current.filter((item) => item.status === "failed").length;
    const completed = queueRef.current.filter((item) => item.status === "completed").length;
    setBatch(null);
    setMessage(`SKU update finished: ${completed} sent to Review Queue${failed ? `, ${failed} failed` : ""}.`);
  }

  function retryFailed() {
    saveQueue(queueRef.current.map((item) => item.status === "failed"
      ? { ...item, status: "pending", message: "Waiting to retry." }
      : item
    ));
    window.setTimeout(() => void processRows(), 0);
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>Product Code updates</strong>
          <p style={{ margin: "4px 0 0", color: "#52607a", fontSize: 13 }}>
            Replace legacy WooCommerce SKUs with the exact Product code cell from the spreadsheet. Every change goes to Review Queue first.
          </p>
        </div>
        <button
          className="button"
          type="button"
          disabled={disabled || !hydrated || visibleRows.length === 0 || Boolean(batch && !batch.stopped)}
          onClick={() => void processRows(visibleRows, true)}
        >
          <Wrench size={15} />
          Fix all ready ({visibleRows.length})
        </button>
      </div>

      <label style={{ position: "relative", display: "block", maxWidth: 520 }}>
        <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product name, old SKU, or new Product Code"
          style={{ width: "100%", paddingLeft: 38 }}
        />
      </label>

      {(batch || queue.length > 0) ? (
        <section style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong>{batch ? `SKU updates ${batch.current}/${batch.total}` : "SKU update results"}</strong>
              {activeItem ? <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>Processing {activeItem.name}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {batch ? (
                <>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    onClick={() => {
                      if (batch.stopped) {
                        void processRows();
                        return;
                      }
                      controlRef.current.paused = !controlRef.current.paused;
                      setBatch((current) => current ? { ...current, paused: !current.paused } : current);
                    }}
                  >
                    {batch.stopped || batch.paused ? <Play size={14} /> : <Pause size={14} />}
                    {batch.stopped ? "Continue" : batch.paused ? "Resume" : "Pause"}
                  </button>
                  {!batch.stopped ? (
                    <button
                      className="button secondary compact-button"
                      type="button"
                      onClick={() => {
                        controlRef.current.stopped = true;
                        controlRef.current.paused = false;
                      }}
                    >
                      <Square size={13} /> Stop
                    </button>
                  ) : null}
                </>
              ) : null}
              {!batch && failedCount > 0 ? (
                <button className="button secondary compact-button" type="button" onClick={retryFailed}>
                  <RotateCcw size={14} /> Retry failed ({failedCount})
                </button>
              ) : null}
              {!batch ? (
                <button className="button secondary compact-button" type="button" onClick={() => saveQueue([])}>
                  Clear list
                </button>
              ) : null}
              <Link className="button secondary compact-button" href="/reviews">Review Queue</Link>
            </div>
          </div>
          <div style={{ height: 9, background: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginTop: 10 }}>
            <div style={{ width: `${batch ? percent : 100}%`, height: "100%", background: failedCount && !batch ? "#b91c1c" : "#2563eb", transition: "width .2s ease" }} />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 8 }}>
            {queue.map((item) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #e5e7eb" }}>
                {item.status === "completed" ? <CheckCircle2 size={16} color="#15803d" /> : item.status === "failed" ? <XCircle size={16} color="#b91c1c" /> : item.status === "processing" ? <LoaderCircle size={16} color="#2563eb" /> : <Circle size={16} color="#64748b" />}
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>{item.name}</strong>
                  <div style={{ color: item.status === "failed" ? "#b91c1c" : "#52607a", fontSize: 12 }}>{item.message}</div>
                </div>
                <span className={`status ${item.status === "completed" ? "approved" : item.status === "failed" ? "failed" : "neutral"}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {message ? <p className="success" style={{ margin: 0 }}>{message}</p> : null}
      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}

      {visibleRows.length === 0 ? (
        <p className="subtle">No legacy SKUs need updating in this view.</p>
      ) : (
        <div style={{ borderTop: "1px solid #dbe2ea" }}>
          {visibleRows.map((row) => {
            const queued = queueById.get(itemId(row));
            const busy = Boolean(batch && !batch.stopped);
            return (
              <div key={itemId(row)} style={{ display: "flex", gap: 14, alignItems: "center", padding: "13px 0", borderBottom: "1px solid #dbe2ea", flexWrap: "wrap" }}>
                <div style={{ minWidth: 220, flex: "1.5 1 260px" }}>
                  <strong>{row.name}</strong>
                  <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>Sheet row {row.sheetRowNumber} | Woo #{row.wooId}</div>
                </div>
                <div style={{ minWidth: 150, flex: "1 1 180px" }}>
                  <span style={{ display: "block", color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>Current Woo SKU</span>
                  <code style={{ overflowWrap: "anywhere" }}>{row.currentSku || "No SKU"}</code>
                </div>
                <div style={{ minWidth: 150, flex: "1 1 180px" }}>
                  <span style={{ display: "block", color: "#64748b", fontSize: 11, textTransform: "uppercase" }}>New SKU (Product code)</span>
                  <code style={{ overflowWrap: "anywhere" }}>{row.newSku}</code>
                </div>
                <div style={{ display: "flex", gap: 6, flex: "0 1 auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {row.wooPermalink ? <a className="button secondary compact-button" href={row.wooPermalink} target="_blank" rel="noreferrer" title="Open WooCommerce product"><ExternalLink size={13} /></a> : null}
                  <Link className="button secondary compact-button" href={`/products/${row.wooId}`} title="Open in Product Manager"><SquarePen size={13} /></Link>
                  <button
                    className="button compact-button"
                    type="button"
                    disabled={disabled || busy || queued?.status === "completed" || queued?.status === "processing"}
                    onClick={() => void processRows([row])}
                  >
                    <Wrench size={13} />
                    {queued?.status === "completed" ? "Queued" : queued?.status === "failed" ? "Retry" : "Fix SKU"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
