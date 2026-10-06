"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, Files, GitMerge, LoaderCircle, Pause, Play, RotateCcw, Square, SquarePen, Wrench, XCircle } from "lucide-react";

import { productSheetQaCheckNeedsFix, type ProductSheetQaCheck, type ProductSheetQaField } from "@/lib/product-sheet-qa";
import { loadSharedWorkflow, saveSharedWorkflow } from "@/lib/updated-list-workflow-client";

export type UpdatedListQaRow = {
  sheetRowNumber: number;
  name: string;
  sku: string;
  wooId?: number;
  wooPermalink?: string;
  wooMatch: boolean;
  ambiguousMatch: boolean;
  wooMatches?: Array<{
    id: number;
    name: string;
    sku: string;
    status: string;
    permalink?: string;
  }>;
  qaCustomNotes: ProductSheetQaCheck;
  qaAccessories: ProductSheetQaCheck;
  qaColour: ProductSheetQaCheck;
  sheetDuplicateMatches: Array<{
    rowNumber: number;
    name: string;
    sku: string;
    matchedBy: Array<"sku" | "name">;
  }>;
};

type QueueItem = {
  id: string;
  rowNumber: number;
  name: string;
  productId?: number;
  wooUrl?: string;
  fields: ProductSheetQaField[];
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
};

type Progress = {
  progress: number;
  state: "running" | "success" | "error";
  message: string;
};

const storageKey = "updated-list-qa-checks-v1";

function checksForRow(row: UpdatedListQaRow) {
  return [row.qaCustomNotes, row.qaAccessories, row.qaColour].filter(productSheetQaCheckNeedsFix);
}

function checkForField(row: UpdatedListQaRow, field: ProductSheetQaField) {
  if (field === "qa_custom_notes") return row.qaCustomNotes;
  if (field === "qa_accessories") return row.qaAccessories;
  return row.qaColour;
}

function requestError(response: Response) {
  return [408, 502, 503, 504].includes(response.status)
    ? "The WooCommerce connection timed out. This item is still saved and can be retried."
    : "Could not create the QA fix review.";
}

function warningSummary(warnings: string[] | undefined) {
  if (!warnings?.length) return "";
  return warnings.length > 2
    ? `${warnings.slice(0, 2).join("; ")}; plus ${warnings.length - 2} more`
    : warnings.join("; ");
}

export default function UpdatedListQaChecks({ rows }: { rows: UpdatedListQaRow[] }) {
  const failedRows = useMemo(() => rows.filter((row) => checksForRow(row).length > 0), [rows]);
  const [duplicateLimit, setDuplicateLimit] = useState(50);
  const duplicateRows = useMemo(
    () => rows
      .filter((row) => row.sheetDuplicateMatches.length > 0)
      .sort((first, second) => first.sheetRowNumber - second.sheetRowNumber),
    [rows]
  );
  const visibleDuplicateRows = duplicateRows.slice(0, duplicateLimit);
  const [filter, setFilter] = useState<"all" | ProductSheetQaField>("all");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [progress, setProgress] = useState<Record<number, Progress>>({});
  const [mergeTargetByRow, setMergeTargetByRow] = useState<Record<number, number>>({});
  const [mergeProgress, setMergeProgress] = useState<Record<number, Progress & { sourceId?: number }>>({});
  const [mergeCandidatesByRow, setMergeCandidatesByRow] = useState<Record<number, NonNullable<UpdatedListQaRow["wooMatches"]>>>({});
  const [loadingMergeCandidates, setLoadingMergeCandidates] = useState<Set<number>>(new Set());
  const [batch, setBatch] = useState<{ total: number; current: number; paused: boolean; stopped: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const queueRef = useRef<QueueItem[]>([]);
  const controlRef = useRef({ paused: false, stopped: false });

  const visibleRows = useMemo(
    () => filter === "all"
      ? failedRows
      : failedRows.filter((row) => checksForRow(row).some((check) => check.field === filter)),
    [failedRows, filter]
  );
  const fixableVisibleRows = useMemo(
    () => visibleRows.filter((row) => row.wooMatch && !row.ambiguousMatch),
    [visibleRows]
  );
  const counts = useMemo(() => ({
    all: failedRows.length,
    qa_custom_notes: failedRows.filter((row) => row.qaCustomNotes.failed).length,
    qa_accessories: failedRows.filter((row) => row.qaAccessories.failed).length,
    qa_colour: failedRows.filter((row) => row.qaColour.failed).length
  }), [failedRows]);
  const resolvedCount = useMemo(
    () => rows.filter((row) =>
      [row.qaCustomNotes, row.qaAccessories, row.qaColour].some((check) => check.failed && check.resolved)
    ).length,
    [rows]
  );

  function saveQueue(items: QueueItem[]) {
    queueRef.current = items;
    setQueue(items);
    window.localStorage.setItem(storageKey, JSON.stringify(items));
    void saveSharedWorkflow("qa-checks", items).catch(() => undefined);
  }

  function updateQueueItem(id: string, changes: Partial<QueueItem>) {
    saveQueue(queueRef.current.map((item) => item.id === id ? { ...item, ...changes } : item));
  }

  useEffect(() => {
    let active = true;
    let local: QueueItem[] = [];

    try {
      local = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as QueueItem[];
    } catch {
      window.localStorage.removeItem(storageKey);
    }

    const restore = (items: QueueItem[]) => items.map((item) => item.status === "processing"
      ? { ...item, status: "pending" as const, message: "Interrupted and ready to resume." }
      : item
    );
    const restoredLocal = restore(local);
    queueRef.current = restoredLocal;
    setQueue(restoredLocal);

    void loadSharedWorkflow<QueueItem>("qa-checks")
      .then((payload) => {
        if (!active) return;
        const items = payload.state?.items?.length ? restore(payload.state.items) : restoredLocal;
        queueRef.current = items;
        setQueue(items);
        window.localStorage.setItem(storageKey, JSON.stringify(items));
        const current = items.filter((item) => item.status === "completed" || item.status === "failed").length;
        if (items.some((item) => item.status === "pending")) {
          controlRef.current = { paused: false, stopped: true };
          setBatch({ total: items.length, current, paused: false, stopped: true });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || queueRef.current.length === 0) return;
    const rowByNumber = new Map(rows.map((row) => [row.sheetRowNumber, row]));
    let changed = false;
    const items = queueRef.current.map((item) => {
      const row = rowByNumber.get(item.rowNumber);
      const applied = row && item.fields.every((field) => checkForField(row, field).resolved);
      const nextMessage = applied
        ? "Applied in WooCommerce. QA now matches after refresh."
        : item.message;

      if (nextMessage !== item.message) changed = true;
      return nextMessage === item.message ? item : { ...item, message: nextMessage };
    });

    if (changed) saveQueue(items);
  }, [hydrated, rows]);

  async function createQaReview(row: UpdatedListQaRow, fields: ProductSheetQaField[]) {
    let timer: ReturnType<typeof setInterval> | undefined;
    setError("");
    setMessage("");
    setProgress((current) => ({
      ...current,
      [row.sheetRowNumber]: { progress: 6, state: "running", message: "Reading QA instructions..." }
    }));

    try {
      timer = setInterval(() => {
        setProgress((current) => {
          const item = current[row.sheetRowNumber];
          if (!item || item.state !== "running") return current;
          const next = Math.min(92, item.progress + Math.max(1, Math.round((92 - item.progress) * 0.1)));
          return {
            ...current,
            [row.sheetRowNumber]: {
              progress: next,
              state: "running",
              message: next < 50 ? "Reading QA instructions..." : next < 80 ? "Building exact WooCommerce values..." : "Creating review draft..."
            }
          };
        });
      }, 350);

      const response = await fetch("/api/reviews/product-sheet-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: row.sheetRowNumber,
          productId: row.wooId,
          fields,
          source: "updated-list"
        })
      });
      const payload = await response.json().catch(() => ({})) as {
        alreadyExists?: boolean;
        alreadyMatches?: boolean;
        error?: string;
        warnings?: string[];
      };

      if (!response.ok || payload.error) throw new Error(payload.error || requestError(response));
      const resultMessage = payload.alreadyExists
        ? "Already in the Review Queue."
        : payload.alreadyMatches
          ? "The spreadsheet no longer reports this QA failure."
          : payload.warnings?.length
            ? `Review created with warnings: ${warningSummary(payload.warnings)}`
            : "QA fix sent to the Review Queue.";
      setProgress((current) => ({
        ...current,
        [row.sheetRowNumber]: { progress: 100, state: "success", message: resultMessage }
      }));
      setMessage(resultMessage);
      return { success: true, message: resultMessage };
    } catch (caught) {
      const resultMessage = caught instanceof Error ? caught.message : "Could not create the QA fix review.";
      setProgress((current) => ({
        ...current,
        [row.sheetRowNumber]: { progress: 0, state: "error", message: resultMessage }
      }));
      setError(resultMessage);
      return { success: false, message: resultMessage };
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  async function createMergeReview(
    row: UpdatedListQaRow,
    source: NonNullable<UpdatedListQaRow["wooMatches"]>[number]
  ) {
    const candidates = mergeCandidatesByRow[row.sheetRowNumber] ?? row.wooMatches ?? [];
    const targetId = mergeTargetByRow[row.sheetRowNumber] ?? row.wooId ?? candidates[0]?.id;
    const target = candidates.find((candidate) => candidate.id === targetId);

    if (!target || source.id === target.id) {
      setError("Choose a different WooCommerce product to keep before merging.");
      return;
    }

    if (!window.confirm(
      `Create a review to merge product #${source.id} into #${target.id}? The duplicate will only be hidden after you approve the review.`
    )) {
      return;
    }

    setError("");
    setMessage("");
    setMergeProgress((current) => ({
      ...current,
      [row.sheetRowNumber]: {
        progress: 20,
        state: "running",
        message: `Comparing #${source.id} with #${target.id}...`,
        sourceId: source.id
      }
    }));

    try {
      const response = await fetch("/api/reviews/product-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, targetId: target.id, mode: "duplicate" })
      });
      const payload = await response.json().catch(() => ({})) as { alreadyExists?: boolean; error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || requestError(response));
      }

      const resultMessage = payload.alreadyExists
        ? `The merge from #${source.id} into #${target.id} is already in Review Queue.`
        : `Merge review created for #${source.id} into #${target.id}. Approve it, then refresh Updated List.`;
      setMergeProgress((current) => ({
        ...current,
        [row.sheetRowNumber]: {
          progress: 100,
          state: "success",
          message: resultMessage,
          sourceId: source.id
        }
      }));
      setMessage(resultMessage);
    } catch (caught) {
      const resultMessage = caught instanceof Error ? caught.message : "Could not create the merge review.";
      setMergeProgress((current) => ({
        ...current,
        [row.sheetRowNumber]: {
          progress: 0,
          state: "error",
          message: resultMessage,
          sourceId: source.id
        }
      }));
      setError(resultMessage);
    }
  }

  async function loadMergeCandidates(row: UpdatedListQaRow) {
    setLoadingMergeCandidates((current) => new Set(current).add(row.sheetRowNumber));
    setError("");

    try {
      const response = await fetch("/api/updated-list/merge-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowNumber: row.sheetRowNumber })
      });
      const payload = await response.json().catch(() => ({})) as {
        candidates?: NonNullable<UpdatedListQaRow["wooMatches"]>;
        error?: string;
      };

      if (!response.ok || payload.error) throw new Error(payload.error || requestError(response));
      if (!payload.candidates || payload.candidates.length < 2) {
        throw new Error("WooCommerce no longer returns multiple exact matches. Refresh Updated List to update this row.");
      }

      setMergeCandidatesByRow((current) => ({ ...current, [row.sheetRowNumber]: payload.candidates! }));
      setMergeTargetByRow((current) => ({
        ...current,
        [row.sheetRowNumber]: payload.candidates!.some((candidate) => candidate.id === row.wooId)
          ? row.wooId!
          : payload.candidates![0].id
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load matching WooCommerce products.");
    } finally {
      setLoadingMergeCandidates((current) => {
        const next = new Set(current);
        next.delete(row.sheetRowNumber);
        return next;
      });
    }
  }

  async function waitWhilePaused() {
    while (controlRef.current.paused && !controlRef.current.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return !controlRef.current.stopped;
  }

  async function runBatch(rowsToQueue?: UpdatedListQaRow[], onlyField?: ProductSheetQaField) {
    if (rowsToQueue) {
      const items = rowsToQueue.map((row) => ({
        id: `qa-${row.sheetRowNumber}-${row.wooId ?? "missing"}`,
        rowNumber: row.sheetRowNumber,
        name: row.name,
        productId: row.wooId,
        wooUrl: row.wooPermalink,
        fields: checksForRow(row)
          .filter((check) => !onlyField || check.field === onlyField)
          .map((check) => check.field),
        status: "pending" as const,
        message: "Waiting to be processed."
      }));
      saveQueue(items);
    }

    if (queueRef.current.length === 0) {
      setMessage("No failed QA checks are waiting to be processed.");
      return;
    }

    controlRef.current = { paused: false, stopped: false };
    setBatch({
      total: queueRef.current.length,
      current: queueRef.current.filter((item) => item.status === "completed" || item.status === "failed").length,
      paused: false,
      stopped: false
    });
    setMessage("");
    setError("");

    for (const queued of [...queueRef.current]) {
      const current = queueRef.current.find((item) => item.id === queued.id);
      if (!current || current.status !== "pending") continue;
      if (!(await waitWhilePaused())) {
        setBatch((value) => value ? { ...value, stopped: true } : value);
        setMessage("QA update stopped. Unfinished products are saved and ready to continue.");
        return;
      }

      const row = failedRows.find((candidate) => candidate.sheetRowNumber === current.rowNumber);
      if (!row) {
        updateQueueItem(current.id, { status: "failed", message: "This spreadsheet row is no longer in the QA list." });
        continue;
      }

      updateQueueItem(current.id, { status: "processing", message: "Preparing QA fix review..." });
      const result = await createQaReview(row, current.fields);
      updateQueueItem(current.id, {
        status: result.success ? "completed" : "failed",
        message: result.message
      });
      setBatch((value) => value ? {
        ...value,
        current: queueRef.current.filter((item) => item.status === "completed" || item.status === "failed").length
      } : value);
    }

    const failed = queueRef.current.filter((item) => item.status === "failed").length;
    const completed = queueRef.current.filter((item) => item.status === "completed").length;
    setBatch(null);
    setMessage(`QA update finished: ${completed} sent to Review Queue${failed ? `, ${failed} failed` : ""}.`);
  }

  function retryFailed() {
    saveQueue(queueRef.current.map((item) => item.status === "failed"
      ? { ...item, status: "pending", message: "Waiting to retry." }
      : item
    ));
    void runBatch();
  }

  const activeItem = queue.find((item) => item.status === "processing");
  const percent = batch && batch.total > 0 ? Math.round(batch.current / batch.total * 100) : 0;
  const failedCount = queue.filter((item) => item.status === "failed").length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#52607a" }}>
            Failed QA results come directly from the Product list spreadsheet. Fixes are sent to Review Queue before WooCommerce changes.
          </p>
          {resolvedCount > 0 ? (
            <p style={{ margin: "5px 0 0", color: "#15803d", fontSize: 12 }}>
              {resolvedCount} spreadsheet QA row{resolvedCount === 1 ? "" : "s"} now match WooCommerce after refresh.
            </p>
          ) : null}
          <div className="tab-list" style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {([
              ["all", `All (${counts.all})`],
              ["qa_custom_notes", `Custom notes (${counts.qa_custom_notes})`],
              ["qa_accessories", `Accessories (${counts.qa_accessories})`],
              ["qa_colour", `Colour (${counts.qa_colour})`]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className="button secondary compact-button"
                type="button"
                onClick={() => setFilter(value)}
                style={{ borderColor: filter === value ? "#2563eb" : undefined, fontWeight: filter === value ? 700 : 500 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <button
          className="button"
          type="button"
          disabled={!hydrated || fixableVisibleRows.length === 0 || Boolean(batch && !batch.stopped)}
          onClick={() => void runBatch(fixableVisibleRows, filter === "all" ? undefined : filter)}
        >
          <Wrench size={16} />
          Fix all ready ({fixableVisibleRows.length})
        </button>
      </div>

      <section style={{ borderTop: "1px solid #dbe2ea", borderBottom: "1px solid #dbe2ea", padding: "14px 0", display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <Files size={18} />
            <div>
              <strong>Spreadsheet duplicates ({duplicateRows.length})</strong>
              <div style={{ color: "#52607a", fontSize: 12, marginTop: 2 }}>
                Exact Product list matches by SKU or normalized product name.
              </div>
            </div>
          </div>
          <a
            className="button secondary compact-button"
            href="https://docs.google.com/spreadsheets/d/1fWu2mxc0LWDUtd_YZQColdkQxwcbsXuihCZ-HcAvlPA/edit"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} /> Open Product list
          </a>
        </div>

        {duplicateRows.length === 0 ? (
          <p className="subtle" style={{ margin: 0 }}>No duplicate SKU or product-name rows were detected.</p>
        ) : (
          <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
            {visibleDuplicateRows.map((row) => (
              <div
                key={`sheet-duplicate-${row.sheetRowNumber}`}
                style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "11px 12px", background: "#f9fafb", display: "grid", gap: 7 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ overflowWrap: "anywhere" }}>{row.name}</strong>
                    <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>
                      Sheet row {row.sheetRowNumber} | SKU: {row.sku || "No SKU"}
                    </div>
                  </div>
                  <span className="status failed">Duplicate row</span>
                </div>
                <div style={{ display: "grid", gap: 5 }}>
                  {row.sheetDuplicateMatches.map((match) => (
                    <div key={`${row.sheetRowNumber}-${match.rowNumber}`} style={{ color: "#52607a", fontSize: 12, overflowWrap: "anywhere" }}>
                      <strong>Matches row {match.rowNumber}</strong>: {match.name}
                      {match.sku ? ` | SKU: ${match.sku}` : ""}
                      {` | Same ${match.matchedBy.map((reason) => reason === "sku" ? "SKU" : "product name").join(" and ")}`}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {visibleDuplicateRows.length < duplicateRows.length ? (
              <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingTop: 4, flexWrap: "wrap" }}>
                <button
                  className="button secondary compact-button"
                  type="button"
                  onClick={() => setDuplicateLimit((current) => Math.min(current + 50, duplicateRows.length))}
                >
                  Show 50 more
                </button>
                <button
                  className="button secondary compact-button"
                  type="button"
                  onClick={() => setDuplicateLimit(duplicateRows.length)}
                >
                  Show all {duplicateRows.length}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {(batch || queue.length > 0) ? (
        <div style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <strong>{batch ? `QA update ${batch.current}/${batch.total}` : "QA update results"}</strong>
              {activeItem ? <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>Processing {activeItem.name}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {batch ? (
                <>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    onClick={() => {
                      if (batch.stopped) { void runBatch(); return; }
                      controlRef.current.paused = !controlRef.current.paused;
                      setBatch((value) => value ? { ...value, paused: !value.paused } : value);
                    }}
                  >
                    {batch.stopped ? <Play size={14} /> : batch.paused ? <Play size={14} /> : <Pause size={14} />}
                    {batch.stopped ? "Continue" : batch.paused ? "Resume" : "Pause"}
                  </button>
                  {!batch.stopped ? (
                    <button
                      className="button secondary compact-button"
                      type="button"
                      onClick={() => { controlRef.current.stopped = true; controlRef.current.paused = false; }}
                    >
                      <Square size={13} /> Stop
                    </button>
                  ) : null}
                </>
              ) : null}
              {failedCount > 0 && !batch ? (
                <button className="button secondary compact-button" type="button" onClick={retryFailed}>
                  <RotateCcw size={14} /> Retry failed ({failedCount})
                </button>
              ) : null}
              {!batch ? (
                <button className="button secondary compact-button" type="button" onClick={() => saveQueue([])}>
                  Clear list
                </button>
              ) : null}
            </div>
          </div>
          <div style={{ width: "100%", height: 9, background: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginTop: 10 }}>
            <div style={{ width: `${batch ? percent : 100}%`, height: "100%", background: failedCount && !batch ? "#b91c1c" : "#2563eb", transition: "width .2s ease" }} />
          </div>
          <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
            {queue.map((item) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #e5e7eb" }}>
                {item.status === "completed" ? <CheckCircle2 size={16} color="#15803d" /> : item.status === "failed" ? <XCircle size={16} color="#b91c1c" /> : item.status === "processing" ? <LoaderCircle size={16} color="#2563eb" /> : <Circle size={16} color="#64748b" />}
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>{item.name}</strong>
                  <div style={{ fontSize: 12, color: item.status === "failed" ? "#b91c1c" : "#52607a" }}>{item.message}</div>
                  {item.status === "completed" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                      {item.wooUrl ? <a className="button secondary compact-button" href={item.wooUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> WooCommerce</a> : null}
                      {item.productId ? <Link className="button secondary compact-button" href={`/products/${item.productId}`}><SquarePen size={12} /> Product Manager</Link> : null}
                    </div>
                  ) : null}
                </div>
                <span className={`status ${item.status === "completed" ? "approved" : item.status === "failed" ? "failed" : "neutral"}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? <p className="success" style={{ margin: 0 }}>{message}</p> : null}
      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}

      {visibleRows.length === 0 ? (
        <p className="subtle">No failed QA checks in this view.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visibleRows.map((row) => {
            const checks = checksForRow(row).filter((check) => filter === "all" || check.field === filter);
            const rowProgress = progress[row.sheetRowNumber];
            const queuedFields = new Set(
              queue
                .filter((item) => item.rowNumber === row.sheetRowNumber && item.status === "completed")
                .flatMap((item) => item.fields)
            );
            const cannotFix = !row.wooMatch || row.ambiguousMatch;
            const mergeCandidates = mergeCandidatesByRow[row.sheetRowNumber] ?? row.wooMatches ?? [];
            const selectedMergeTarget = mergeTargetByRow[row.sheetRowNumber] ?? row.wooId ?? mergeCandidates[0]?.id;
            const rowMergeProgress = mergeProgress[row.sheetRowNumber];

            return (
              <div key={`qa-${row.sheetRowNumber}`} style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "12px 14px", background: "#f9fafb", display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <strong>{row.name}</strong>
                    <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>Sheet row {row.sheetRowNumber}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {row.wooPermalink ? <a className="button secondary compact-button" href={row.wooPermalink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> WooCommerce</a> : null}
                    {row.wooId ? <Link className="button secondary compact-button" href={`/products/${row.wooId}`}><SquarePen size={13} /> Product Manager</Link> : null}
                  </div>
                </div>
                {!row.wooMatch ? <p className="error" style={{ margin: 0 }}>No WooCommerce product matches this row.</p> : null}
                {row.ambiguousMatch ? (
                  <div style={{ borderTop: "1px solid #dbe2ea", borderBottom: "1px solid #dbe2ea", padding: "10px 0", display: "grid", gap: 9 }}>
                    <div>
                      <strong style={{ fontSize: 13 }}>Resolve multiple WooCommerce matches</strong>
                      <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>
                        Select the product to keep, then send one duplicate merge to Review Queue. Approve it and refresh this page before fixing QA fields.
                      </div>
                    </div>
                    {mergeCandidates.length < 2 ? (
                      <div>
                        <button
                          className="button secondary compact-button"
                          type="button"
                          disabled={loadingMergeCandidates.has(row.sheetRowNumber)}
                          onClick={() => void loadMergeCandidates(row)}
                        >
                          {loadingMergeCandidates.has(row.sheetRowNumber) ? <LoaderCircle size={13} /> : <RotateCcw size={13} />}
                          {loadingMergeCandidates.has(row.sheetRowNumber) ? "Loading matches..." : "Load merge options"}
                        </button>
                      </div>
                    ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {mergeCandidates.map((candidate) => {
                        const isTarget = candidate.id === selectedMergeTarget;
                        const isBusy = rowMergeProgress?.state === "running" && rowMergeProgress.sourceId === candidate.id;
                        const mergeQueued = rowMergeProgress?.state === "success";

                        return (
                          <div key={candidate.id} style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", padding: "7px 0", borderTop: "1px solid #e5e7eb" }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 7, flex: "1 1 280px", minWidth: 0 }}>
                              <input
                                type="radio"
                                name={`qa-merge-target-${row.sheetRowNumber}`}
                                value={candidate.id}
                                checked={isTarget}
                                disabled={rowMergeProgress?.state === "running" || mergeQueued}
                                onChange={() => setMergeTargetByRow((current) => ({ ...current, [row.sheetRowNumber]: candidate.id }))}
                              />
                              <span style={{ minWidth: 0 }}>
                                <strong>#{candidate.id} {candidate.name}</strong>
                                <span style={{ display: "block", color: "#52607a", fontSize: 12 }}>
                                  {candidate.status} | SKU: {candidate.sku || "No SKU"}{isTarget ? " | Product to keep" : ""}
                                </span>
                              </span>
                            </label>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {candidate.permalink ? <a className="button secondary compact-button" href={candidate.permalink} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Woo</a> : null}
                              <Link className="button secondary compact-button" href={`/products/${candidate.id}`}><SquarePen size={12} /> Edit</Link>
                              {!isTarget ? (
                                <button
                                  className="button compact-button"
                                  type="button"
                                  disabled={rowMergeProgress?.state === "running" || mergeQueued}
                                  onClick={() => void createMergeReview(row, candidate)}
                                >
                                  <GitMerge size={13} />
                                  {isBusy ? "Creating review..." : `Merge into #${selectedMergeTarget}`}
                                </button>
                              ) : <span className="status approved">Keep</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                    {rowMergeProgress ? (
                      <div style={{ color: rowMergeProgress.state === "error" ? "#b91c1c" : rowMergeProgress.state === "success" ? "#15803d" : "#52607a", fontSize: 12 }}>
                        {rowMergeProgress.message}
                        {rowMergeProgress.state === "success" ? (
                          <Link className="button secondary compact-button" href="/reviews" style={{ marginLeft: 8 }}>
                            <SquarePen size={12} /> Review Queue
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div style={{ display: "grid", gap: 7 }}>
                  {checks.map((check) => (
                    <div key={check.field} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                      <strong style={{ fontSize: 13, flex: "0 1 150px" }}>{check.label}</strong>
                      <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                        <span className="status failed">Failed</span>
                        <div style={{ color: "#52607a", fontSize: 12, marginTop: 4, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{check.reason || check.raw}</div>
                      </div>
                      <button
                        className="button secondary compact-button"
                        type="button"
                        disabled={cannotFix || rowProgress?.state === "running" || Boolean(batch && !batch.stopped) || queuedFields.has(check.field)}
                        onClick={() => void createQaReview(row, [check.field])}
                      >
                        <Wrench size={13} /> {queuedFields.has(check.field) ? "In Review Queue" : `Fix ${check.label}`}
                      </button>
                    </div>
                  ))}
                </div>
                {rowProgress ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: rowProgress.state === "error" ? "#b91c1c" : "#52607a" }}>
                      <span>{rowProgress.message}</span><strong>{rowProgress.progress}%</strong>
                    </div>
                    <div style={{ height: 7, background: "#e5e7eb", borderRadius: 4, overflow: "hidden", marginTop: 5 }}>
                      <div style={{ width: `${rowProgress.progress}%`, height: "100%", background: rowProgress.state === "success" ? "#15803d" : rowProgress.state === "error" ? "#b91c1c" : "#2563eb" }} />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
