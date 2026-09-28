"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, ExternalLink, FileSpreadsheet, LoaderCircle, PackagePlus, RefreshCw, SquarePen, XCircle, Wrench } from "lucide-react";

type FieldFix = "custom_notes" | "colour_board" | "accessories" | "specifications";

type FieldFixProgress = {
  progress: number;
  status: string;
  state: "running" | "success" | "error";
};

type MismatchBatchItem = {
  id: string;
  name: string;
  listRowNumber?: number;
  rowNumber: number;
  productId?: number;
  wooUrl?: string;
  fields: FieldFix[];
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
};

type MissingProductBatchItem = {
  id: string;
  name: string;
  listRowNumber: number;
  rowNumber: number;
  status: "pending" | "processing" | "completed" | "failed";
  message: string;
};

const mismatchBatchStorageKey = "updated-list-mismatch-batch-v3";
const specificationBatchStorageKey = "updated-list-specification-batch-v1";
const missingProductBatchStorageKey = "updated-list-missing-products-v3";
const staleUpdatedListStorageKeys = [
  "updated-list-mismatch-batch-v1",
  "updated-list-mismatch-batch-v2",
  "updated-list-missing-products-v1",
  "updated-list-missing-products-v2"
];
const fieldFixLabels: Record<FieldFix, string> = {
  custom_notes: "Custom notes",
  colour_board: "Colour board",
  accessories: "Accessories",
  specifications: "Specifications"
};

function warningSummary(warnings: string[] | undefined) {
  if (!warnings?.length) {
    return "";
  }

  const visible = warnings.slice(0, 2).join("; ");
  const remaining = warnings.length - 2;
  return remaining > 0 ? `${visible}; plus ${remaining} more` : visible;
}

async function readJsonResponse<T extends object>(response: Response) {
  try {
    return await response.json() as T;
  } catch {
    return {} as T;
  }
}

function requestErrorMessage(response: Response, fallback: string) {
  if ([408, 502, 503, 504].includes(response.status)) {
    return "The WooCommerce connection timed out. Your saved queue is safe. Please wait a moment, then retry this item or refresh the data.";
  }

  return fallback;
}

type UpdatedListRow = {
  rowNumber: number;
  sheetRowNumber: number;
  name: string;
  sourceName: string;
  wooId?: number;
  wooPermalink?: string;
  wooMatch: boolean;
  wooStatus: string;
  ambiguousMatch: boolean;
  customNotesExpected: boolean;
  colourBoardExpected: boolean;
  accessoriesExpected: boolean;
  accessoriesExpectedCount: number;
  specificationsExpected: boolean;
  specificationsFeature: string;
  customNotesPresent: boolean;
  colourBoardPresent: boolean;
  accessoriesPresent: boolean;
  accessoriesPresentCount: number;
  specificationsPresent: boolean;
};

export default function UpdatedListActions({
  rows,
  updatedAt,
  draftCount,
  wooStoreUrl
}: {
  rows: UpdatedListRow[];
  updatedAt: string;
  draftCount: number;
  wooStoreUrl: string;
}) {
  const [activeTab, setActiveTab] = useState<"list" | "missing" | "drafts" | "mismatches" | "specifications">("list");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [messaging, setMessaging] = useState("");
  const [error, setError] = useState("");
  const [statusTab, setStatusTab] = useState<"list" | "missing" | "drafts" | "mismatches" | "specifications">("list");
  const [busyRows, setBusyRows] = useState<Set<number>>(new Set());
  const [busyFixes, setBusyFixes] = useState<Record<string, boolean>>({});
  const [fieldFixProgress, setFieldFixProgress] = useState<Record<number, FieldFixProgress>>({});
  const [productCreateProgress, setProductCreateProgress] = useState<Record<number, FieldFixProgress>>({});
  const [queuedProductCreateRows, setQueuedProductCreateRows] = useState<Set<number>>(new Set());
  const [mismatchBatchItems, setMismatchBatchItems] = useState<MismatchBatchItem[]>([]);
  const [specificationBatchItems, setSpecificationBatchItems] = useState<MismatchBatchItem[]>([]);
  const [missingProductBatchItems, setMissingProductBatchItems] = useState<MissingProductBatchItem[]>([]);
  const [batchProgress, setBatchProgress] = useState<{
    mode: "draft";
    total: number;
    current: number;
    paused: boolean;
    stopped: boolean;
  } | null>(null);
  const [missingProductBatchProgress, setMissingProductBatchProgress] = useState<{
    total: number;
    current: number;
    paused: boolean;
    stopped: boolean;
  } | null>(null);
  const [mismatchBatchProgress, setMismatchBatchProgress] = useState<{
    total: number;
    current: number;
    paused: boolean;
    stopped: boolean;
  } | null>(null);
  const [specificationBatchProgress, setSpecificationBatchProgress] = useState<{
    total: number;
    current: number;
    paused: boolean;
    stopped: boolean;
  } | null>(null);
  const batchStateRef = useRef({ paused: false, stopped: false });
  const mismatchBatchItemsRef = useRef<MismatchBatchItem[]>([]);
  const specificationBatchItemsRef = useRef<MismatchBatchItem[]>([]);
  const missingProductBatchItemsRef = useRef<MissingProductBatchItem[]>([]);

  function wooProductUrl(productId?: number, permalink?: string) {
    if (permalink) {
      return permalink;
    }

    if (!productId || !wooStoreUrl) {
      return "";
    }

    try {
      const url = new URL("/wp-admin/post.php", wooStoreUrl);
      url.searchParams.set("post", String(productId));
      url.searchParams.set("action", "edit");
      return url.toString();
    } catch {
      return "";
    }
  }

  function saveMismatchBatchItems(items: MismatchBatchItem[]) {
    mismatchBatchItemsRef.current = items;
    setMismatchBatchItems(items);
    window.localStorage.setItem(mismatchBatchStorageKey, JSON.stringify(items));
  }

  function updateMismatchBatchItem(id: string, changes: Partial<MismatchBatchItem>) {
    saveMismatchBatchItems(
      mismatchBatchItemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item)
    );
  }

  function saveSpecificationBatchItems(items: MismatchBatchItem[]) {
    specificationBatchItemsRef.current = items;
    setSpecificationBatchItems(items);
    window.localStorage.setItem(specificationBatchStorageKey, JSON.stringify(items));
  }

  function updateSpecificationBatchItem(id: string, changes: Partial<MismatchBatchItem>) {
    saveSpecificationBatchItems(
      specificationBatchItemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item)
    );
  }

  function saveMissingProductBatchItems(items: MissingProductBatchItem[]) {
    missingProductBatchItemsRef.current = items;
    setMissingProductBatchItems(items);
    window.localStorage.setItem(missingProductBatchStorageKey, JSON.stringify(items));
  }

  function updateMissingProductBatchItem(id: string, changes: Partial<MissingProductBatchItem>) {
    saveMissingProductBatchItems(
      missingProductBatchItemsRef.current.map((item) => item.id === id ? { ...item, ...changes } : item)
    );
  }

  useEffect(() => {
    try {
      staleUpdatedListStorageKeys.forEach((key) => window.localStorage.removeItem(key));
      const stored = window.localStorage.getItem(mismatchBatchStorageKey);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as MismatchBatchItem[];
      const usedIds = new Set<string>();
      const items = parsed.map((item, index) => {
        let id = item.id || `restored-${index}`;

        if (usedIds.has(id)) {
          id = `${id}-duplicate-${index}`;
        }

        usedIds.add(id);

        return item.status === "processing"
          ? { ...item, id, status: "pending" as const, message: "Interrupted and ready to resume." }
          : { ...item, id };
      });
      const processed = items.filter((item) => item.status === "completed" || item.status === "failed").length;
      const hasPending = items.some((item) => item.status === "pending");

      mismatchBatchItemsRef.current = items;
      setMismatchBatchItems(items);
      window.localStorage.setItem(mismatchBatchStorageKey, JSON.stringify(items));

      if (hasPending) {
        batchStateRef.current = { paused: false, stopped: true };
        setMismatchBatchProgress({
          total: items.length,
          current: processed,
          paused: false,
          stopped: true
        });
      }
    } catch {
      window.localStorage.removeItem(mismatchBatchStorageKey);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(specificationBatchStorageKey);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as MismatchBatchItem[];
      const items = parsed.map((item, index) => ({
        ...item,
        id: item.id || `specification-${item.rowNumber}-${index}`,
        fields: ["specifications" as const],
        ...(item.status === "processing"
          ? { status: "pending" as const, message: "Interrupted and ready to resume." }
          : {})
      }));
      const processed = items.filter((item) => item.status === "completed" || item.status === "failed").length;
      const hasPending = items.some((item) => item.status === "pending");

      specificationBatchItemsRef.current = items;
      setSpecificationBatchItems(items);
      window.localStorage.setItem(specificationBatchStorageKey, JSON.stringify(items));

      if (hasPending) {
        batchStateRef.current = { paused: false, stopped: true };
        setSpecificationBatchProgress({
          total: items.length,
          current: processed,
          paused: false,
          stopped: true
        });
      }
    } catch {
      window.localStorage.removeItem(specificationBatchStorageKey);
    }
  }, []);

  useEffect(() => {
    try {
      staleUpdatedListStorageKeys.forEach((key) => window.localStorage.removeItem(key));
      const stored = window.localStorage.getItem(missingProductBatchStorageKey);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as MissingProductBatchItem[];
      const itemsByRow = new Map<number, MissingProductBatchItem>();

      for (const item of parsed) {
        const restored = item.status === "processing"
          ? { ...item, id: `missing-${item.rowNumber}`, status: "pending" as const, message: "Interrupted and ready to resume." }
          : { ...item, id: `missing-${item.rowNumber}` };
        const existing = itemsByRow.get(item.rowNumber);

        if (!existing || restored.status === "completed" || existing.status !== "completed") {
          itemsByRow.set(item.rowNumber, restored);
        }
      }

      const items = [...itemsByRow.values()];
      const processed = items.filter((item) => item.status === "completed" || item.status === "failed").length;
      const hasPending = items.some((item) => item.status === "pending");

      missingProductBatchItemsRef.current = items;
      setMissingProductBatchItems(items);
      window.localStorage.setItem(missingProductBatchStorageKey, JSON.stringify(items));

      if (hasPending) {
        setMissingProductBatchProgress({
          total: items.length,
          current: processed,
          paused: false,
          stopped: true
        });
      }
    } catch {
      window.localStorage.removeItem(missingProductBatchStorageKey);
    }
  }, []);

  const missingRows = useMemo(
    () => rows.filter((row) => !row.wooMatch),
    [rows]
  );

  const eligibleMissingRows = useMemo(
    () => [
      ...new Map(
        missingRows
          .map((row) => [row.sheetRowNumber, row])
      ).values()
    ],
    [missingRows]
  );

  const creatableMissingRows = useMemo(
    () => eligibleMissingRows.filter(
      (row) => !queuedProductCreateRows.has(row.sheetRowNumber)
    ),
    [eligibleMissingRows, queuedProductCreateRows]
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrateQueuedProducts() {
      try {
        const response = await fetch("/api/reviews/product-sheet-create/rows?source=updated-list", { cache: "no-store" });
        const payload = await readJsonResponse<{ rowNumbers?: number[] }>(response);

        if (!response.ok || cancelled) {
          return;
        }

        const queuedRows = new Set(payload.rowNumbers ?? []);
        const eligibleRowNumbers = new Set(
          eligibleMissingRows.map((row) => row.sheetRowNumber)
        );
        setQueuedProductCreateRows(queuedRows);
        const visibleQueuedItems = eligibleMissingRows
          .filter((row) => queuedRows.has(row.sheetRowNumber))
          .map((row) => ({
            ...missingProductBatchItem(row)!,
            status: "completed" as const,
            message: "Already sent to the Review Queue."
          }));
        const preservedItems = missingProductBatchItemsRef.current.filter(
          (item) =>
            eligibleRowNumbers.has(item.rowNumber) &&
            item.status !== "completed" &&
            !queuedRows.has(item.rowNumber)
        );

        saveMissingProductBatchItems([...preservedItems, ...visibleQueuedItems]);
      } catch {
        // The create buttons still verify against the server when clicked.
      }
    }

    void hydrateQueuedProducts();

    return () => {
      cancelled = true;
    };
  }, [eligibleMissingRows]);

  const draftRows = useMemo(
    () => rows.filter((row) => row.wooMatch && !row.ambiguousMatch && row.wooStatus === "draft"),
    [rows]
  );
  const publishableDraftRows = useMemo(
    () => draftRows.filter(
      (row) => !queuedProductCreateRows.has(row.sheetRowNumber)
    ),
    [draftRows, queuedProductCreateRows]
  );

  const mismatchRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.wooMatch &&
          !row.ambiguousMatch &&
          ((row.customNotesExpected && !row.customNotesPresent) ||
            (row.colourBoardExpected && !row.colourBoardPresent) ||
            (row.accessoriesExpected && !row.accessoriesPresent))
      ),
    [rows]
  );
  const missingFieldCounts = useMemo(() => ({
    customNotes: mismatchRows.filter((row) => row.customNotesExpected && !row.customNotesPresent).length,
    colourBoard: mismatchRows.filter((row) => row.colourBoardExpected && !row.colourBoardPresent).length,
    accessories: mismatchRows.filter((row) => row.accessoriesExpected && !row.accessoriesPresent).length
  }), [mismatchRows]);
  const specificationRows = useMemo(
    () => rows.filter(
      (row) =>
        row.wooMatch &&
        !row.ambiguousMatch &&
        row.specificationsExpected &&
        !row.specificationsPresent
    ),
    [rows]
  );

  function getMismatchFields(row: UpdatedListRow) {
    return [
      { key: "custom_notes" as const, label: "Custom notes", mismatch: row.customNotesExpected && !row.customNotesPresent },
      { key: "colour_board" as const, label: "Colour board", mismatch: row.colourBoardExpected && !row.colourBoardPresent },
      { key: "accessories" as const, label: "Accessories", mismatch: row.accessoriesExpected && !row.accessoriesPresent }
    ].filter((field) => field.mismatch);
  }

  async function refreshData() {
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    let reloadStarted = false;

    setIsRefreshing(true);
    setStatusTab("list");
    setRefreshProgress(5);
    setError("");
    setMessaging("");

    try {
      progressTimer = setInterval(() => {
        setRefreshProgress((current) =>
          current >= 92 ? current : Math.min(92, current + Math.max(1, Math.round((92 - current) * 0.08)))
        );
      }, 400);

      const response = await fetch("/api/updated-list/refresh", {
        method: "POST",
        cache: "no-store"
      });
      const payload = await readJsonResponse<{ error?: string }>(response);

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? requestErrorMessage(response, "Could not refresh the updated list."));
      }

      setRefreshProgress(100);
      await new Promise((resolve) => setTimeout(resolve, 350));
      reloadStarted = true;
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh the updated list.");
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      if (!reloadStarted) {
        setIsRefreshing(false);
        setRefreshProgress(0);
      }
    }
  }

  async function pauseForResume() {
    while (batchStateRef.current.paused && !batchStateRef.current.stopped) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (batchStateRef.current.stopped) {
      return false;
    }

    return true;
  }

  async function createProductReview(rowNumber: number) {
    let progressTimer: ReturnType<typeof setInterval> | undefined;

    setStatusTab("missing");
    setBusyRows((current) => new Set(current).add(rowNumber));
    setProductCreateProgress((current) => ({
      ...current,
      [rowNumber]: {
        progress: 5,
        status: "Checking the spreadsheet and WooCommerce...",
        state: "running"
      }
    }));
    setError("");
    setMessaging("");

    try {
      progressTimer = setInterval(() => {
        setProductCreateProgress((current) => {
          const active = current[rowNumber];

          if (!active || active.state !== "running") {
            return current;
          }

          const progress = active.progress >= 92
            ? active.progress
            : Math.min(92, active.progress + Math.max(1, Math.round((92 - active.progress) * 0.08)));
          const status = progress < 35
            ? "Checking the spreadsheet and WooCommerce..."
            : progress < 70
              ? "Preparing product data and images..."
              : "Creating the product review...";

          return {
            ...current,
            [rowNumber]: { progress, status, state: "running" }
          };
        });
      }, 400);

      const response = await fetch("/api/reviews/product-sheet-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rowNumber, source: "updated-list" })
      });
      const payload = await readJsonResponse<{
        alreadyExists?: boolean;
        convertedFromCreate?: boolean;
        error?: string;
        mode?: "create" | "update_draft";
        warnings?: string[];
      }>(response);

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? requestErrorMessage(response, "Could not create product review."));
      }

      const warnings = warningSummary(payload.warnings);
      const message = payload.mode === "update_draft"
        ? payload.alreadyExists
          ? "Draft update and publication are already in the Review Queue."
          : payload.convertedFromCreate
            ? "Existing create review changed to update and publish the WooCommerce draft."
            : "Draft update and publication sent to the Review Queue."
        : payload.alreadyExists
          ? "Already sent to the Review Queue."
        : payload.warnings?.length
          ? `Review created with warnings: ${warnings}`
          : "Review created and sent to the Review Queue.";

      setProductCreateProgress((current) => ({
        ...current,
        [rowNumber]: {
          progress: 100,
          status: message,
          state: "success"
        }
      }));
      setQueuedProductCreateRows((current) => new Set(current).add(rowNumber));
      setMessaging(message);
      return { success: true, message };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create product review.";
      setProductCreateProgress((current) => ({
        ...current,
        [rowNumber]: { progress: 0, status: message, state: "error" }
      }));
      setError(message);
      return { success: false, message };
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      setBusyRows((current) => {
        const next = new Set(current);
        next.delete(rowNumber);
        return next;
      });
    }
  }

  function missingProductBatchItem(row: UpdatedListRow): MissingProductBatchItem | undefined {
    return {
      id: `missing-${row.sheetRowNumber}`,
      name: row.name,
      listRowNumber: row.rowNumber,
      rowNumber: row.sheetRowNumber,
      status: "pending",
      message: "Waiting to be processed."
    };
  }

  async function createMissingProduct(row: UpdatedListRow) {
    const candidate = missingProductBatchItem(row);

    if (!candidate) {
      return;
    }

    const existing = missingProductBatchItemsRef.current.find((item) => item.id === candidate.id);

    if (!existing) {
      saveMissingProductBatchItems([...missingProductBatchItemsRef.current, candidate]);
    }

    updateMissingProductBatchItem(candidate.id, {
      status: "processing",
      message: "Preparing the product review..."
    });
    const result = await createProductReview(candidate.rowNumber);
    updateMissingProductBatchItem(candidate.id, {
      status: result.success ? "completed" : "failed",
      message: result.message
    });
    const processed = missingProductBatchItemsRef.current.filter(
      (item) => item.status === "completed" || item.status === "failed"
    ).length;
    const hasPending = missingProductBatchItemsRef.current.some(
      (item) => item.status === "pending" || item.status === "processing"
    );

    setMissingProductBatchProgress((current) => current
      ? hasPending
        ? { ...current, current: processed }
        : null
      : current);
  }

  async function createFieldFixReview(
    rowNumber: number,
    field: FieldFix | FieldFix[],
    productId?: number
  ) {
    const fields = Array.isArray(field) ? field : [field];
    setStatusTab(fields.every((item) => item === "specifications") ? "specifications" : "mismatches");
    const keys = fields.map((item) => `${rowNumber}-${item}`);
    let progressTimer: ReturnType<typeof setInterval> | undefined;

    setBusyFixes((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, true]))
    }));
    setFieldFixProgress((current) => ({
      ...current,
      [rowNumber]: {
        progress: 5,
        status: "Checking Product list and WooCommerce...",
        state: "running"
      }
    }));
    setError("");
    setMessaging("");

    try {
      progressTimer = setInterval(() => {
        setFieldFixProgress((current) => {
          const active = current[rowNumber];

          if (!active || active.state !== "running") {
            return current;
          }

          const progress = active.progress >= 92
            ? active.progress
            : Math.min(92, active.progress + Math.max(1, Math.round((92 - active.progress) * 0.1)));
          const status = progress < 45
            ? "Checking Product list and WooCommerce..."
            : progress < 78
              ? "Comparing field values..."
              : "Creating the review draft...";

          return {
            ...current,
            [rowNumber]: { progress, status, state: "running" }
          };
        });
      }, 350);

      const response = await fetch("/api/reviews/product-sheet-fix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rowNumber, fields, productId, source: "updated-list" })
      });

      const payload = await readJsonResponse<{
        alreadyExists?: boolean;
        alreadyMatches?: boolean;
        error?: string;
        fields?: FieldFix[];
        skippedFields?: FieldFix[];
        warnings?: string[];
      }>(response);

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? requestErrorMessage(response, "Could not create product field fix review."));
      }

      const warnings = warningSummary(payload.warnings);

      setFieldFixProgress((current) => ({
        ...current,
        [rowNumber]: {
          progress: 100,
          status: payload.alreadyExists
            ? "The selected fields are already in the Review Queue."
            : payload.alreadyMatches
              ? "No required fields are missing from WooCommerce."
            : payload.warnings?.length
            ? `Review created with warnings: ${warnings}`
            : payload.skippedFields?.length
              ? `Review created; ${payload.skippedFields.length} field${payload.skippedFields.length === 1 ? " was" : "s were"} already queued.`
              : "Review created. Ready for approval in the Review Queue.",
          state: "success"
        }
      }));

      setMessaging(
        payload.alreadyExists
          ? "The selected field fixes are already in the Review Queue."
          : payload.alreadyMatches
            ? "No required fields are missing from WooCommerce."
          : payload.warnings?.length
          ? `Bulk fix review created with warnings: ${warnings}`
          : payload.skippedFields?.length
            ? "The remaining field fixes were created; previously queued fields were skipped."
            : "Bulk fix review created. Approve it in the Review Queue."
      );
      return {
        success: true,
        message: payload.alreadyExists
          ? "Already sent to the Review Queue."
          : payload.alreadyMatches
            ? "No required fields are missing."
          : payload.warnings?.length
          ? `Review created with warnings: ${warnings}`
          : payload.skippedFields?.length
            ? "Remaining fixes sent; previously queued fields skipped."
            : "Review created and sent to the Review Queue."
      };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not create product field fix review.";
      setFieldFixProgress((current) => ({
        ...current,
        [rowNumber]: { progress: 0, status: message, state: "error" }
      }));
      setError(message);
      return { success: false, message };
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
      }

      setBusyFixes((current) => ({
        ...current,
        ...Object.fromEntries(keys.map((key) => [key, false]))
      }));
    }
  }

  async function publishDraftReview(rowNumber: number) {
    setStatusTab("drafts");
    setBusyRows((current) => new Set(current).add(rowNumber));
    setError("");
    setMessaging("");

    try {
      const response = await fetch("/api/reviews/product-sheet-publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ rowNumber, source: "updated-list" })
      });

      const payload = (await response.json()) as { alreadyExists?: boolean; error?: string; warnings?: string[] };

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Could not publish this draft product.");
      }

      setQueuedProductCreateRows((current) => new Set(current).add(rowNumber));
      setMessaging(
        payload.alreadyExists
          ? "The draft update and publication are already in the Review Queue."
          : payload.warnings?.length
          ? `Draft publication review created with ${payload.warnings.length} warning${payload.warnings.length === 1 ? "" : "s"}.`
          : "Full draft update and publication review created. Approve it in the Review Queue to publish the product."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not publish this draft product.");
    } finally {
      setBusyRows((current) => {
        const next = new Set(current);
        next.delete(rowNumber);
        return next;
      });
    }
  }

  async function runMismatchBatch(rowsToProcess?: UpdatedListRow[], onlyField?: FieldFix) {
    if (rowsToProcess) {
      const items = rowsToProcess
        .map((row) => {
          const fields: FieldFix[] = onlyField === "specifications"
            ? ["specifications"]
            : getMismatchFields(row)
                .map((field) => field.key)
                .filter((field) => !onlyField || field === onlyField);

          return {
            id: `${row.rowNumber}-${row.sheetRowNumber}-${row.wooId ?? "missing"}`,
            name: row.name,
            listRowNumber: row.rowNumber,
            rowNumber: row.sheetRowNumber,
            productId: row.wooId,
            wooUrl: wooProductUrl(row.wooId, row.wooPermalink),
            fields,
            status: "pending" as const,
            message: "Waiting to be processed."
          };
        })
        .filter((item) => item.fields.length > 0);

      saveMismatchBatchItems(items);
    }

    const queue = mismatchBatchItemsRef.current;
    const specificationRun = queue.length > 0 && queue.every(
      (item) => item.fields.length > 0 && item.fields.every((field) => field === "specifications")
    );
    setStatusTab(specificationRun ? "specifications" : "mismatches");

    if (queue.length === 0) {
      setMessaging(
        onlyField === "specifications"
          ? "No specification updates are waiting to be processed."
          : "No field mismatch rows are waiting to be processed."
      );
      return;
    }

    batchStateRef.current = { paused: false, stopped: false };
    const processedBeforeStart = queue.filter(
      (item) => item.status === "completed" || item.status === "failed"
    ).length;
    setMismatchBatchProgress({
      total: queue.length,
      current: processedBeforeStart,
      paused: false,
      stopped: false
    });
    setMessaging("");
    setError("");

    for (const queuedItem of queue) {
      const currentItem = mismatchBatchItemsRef.current.find((item) => item.id === queuedItem.id);

      if (!currentItem || currentItem.status !== "pending") {
        continue;
      }

      if (batchStateRef.current.stopped) {
        setMismatchBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Bulk update stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      const canContinue = await pauseForResume();

      if (!canContinue) {
        setMismatchBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Bulk update stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      updateMismatchBatchItem(currentItem.id, {
        status: "processing",
        message: `Sending ${currentItem.fields.length} field fix${currentItem.fields.length === 1 ? "" : "es"}...`
      });
      const result = await createFieldFixReview(
        currentItem.rowNumber,
        currentItem.fields,
        currentItem.productId
      );
      updateMismatchBatchItem(currentItem.id, {
        status: result.success ? "completed" : "failed",
        message: result.message
      });

      const processed = mismatchBatchItemsRef.current.filter(
        (item) => item.status === "completed" || item.status === "failed"
      ).length;
      setMismatchBatchProgress((current) => current ? { ...current, current: processed } : current);
    }

    const failed = mismatchBatchItemsRef.current.filter((item) => item.status === "failed").length;
    const completed = mismatchBatchItemsRef.current.filter((item) => item.status === "completed").length;
    setMismatchBatchProgress(null);
    setMessaging(
      failed > 0
        ? `Bulk update finished: ${completed} sent to the Review Queue and ${failed} failed.`
        : `Bulk update finished: ${completed} product${completed === 1 ? "" : "s"} sent to the Review Queue.`
    );
  }

  function retryFailedMismatchItems() {
    saveMismatchBatchItems(
      mismatchBatchItemsRef.current.map((item) => item.status === "failed"
        ? { ...item, status: "pending", message: "Waiting to retry." }
        : item
      )
    );
    void runMismatchBatch();
  }

  async function runSpecificationBatch(rowsToProcess?: UpdatedListRow[]) {
    setStatusTab("specifications");

    if (rowsToProcess) {
      const existingById = new Map(
        specificationBatchItemsRef.current.map((item) => [item.id, item])
      );
      const items = rowsToProcess.map((row) => {
        const id = `specification-${row.rowNumber}-${row.wooId ?? "missing"}`;
        const existing = existingById.get(id);

        return existing?.status === "completed"
          ? existing
          : {
              id,
              name: row.name,
              listRowNumber: row.rowNumber,
              rowNumber: row.sheetRowNumber,
              productId: row.wooId,
              wooUrl: wooProductUrl(row.wooId, row.wooPermalink),
              fields: ["specifications" as const],
              status: "pending" as const,
              message: "Waiting to be processed."
            };
      });

      saveSpecificationBatchItems(items);
    }

    const queue = specificationBatchItemsRef.current;

    if (queue.length === 0) {
      setMessaging("No specification updates are waiting to be processed.");
      return;
    }

    batchStateRef.current = { paused: false, stopped: false };
    const processedBeforeStart = queue.filter(
      (item) => item.status === "completed" || item.status === "failed"
    ).length;
    setSpecificationBatchProgress({
      total: queue.length,
      current: processedBeforeStart,
      paused: false,
      stopped: false
    });
    setMessaging("");
    setError("");

    for (const queuedItem of queue) {
      const currentItem = specificationBatchItemsRef.current.find((item) => item.id === queuedItem.id);

      if (!currentItem || currentItem.status !== "pending") {
        continue;
      }

      if (batchStateRef.current.stopped) {
        setSpecificationBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Specification update stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      const canContinue = await pauseForResume();

      if (!canContinue) {
        setSpecificationBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Specification update stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      updateSpecificationBatchItem(currentItem.id, {
        status: "processing",
        message: "Preparing the specifications review..."
      });
      const result = await createFieldFixReview(
        currentItem.rowNumber,
        "specifications",
        currentItem.productId
      );
      updateSpecificationBatchItem(currentItem.id, {
        status: result.success ? "completed" : "failed",
        message: result.message
      });

      const processed = specificationBatchItemsRef.current.filter(
        (item) => item.status === "completed" || item.status === "failed"
      ).length;
      setSpecificationBatchProgress((current) => current ? { ...current, current: processed } : current);
    }

    const failed = specificationBatchItemsRef.current.filter((item) => item.status === "failed").length;
    const completed = specificationBatchItemsRef.current.filter((item) => item.status === "completed").length;
    setSpecificationBatchProgress(null);
    setMessaging(
      failed > 0
        ? `Specification update finished: ${completed} sent to the Review Queue and ${failed} failed.`
        : `Specification update finished: ${completed} product${completed === 1 ? "" : "s"} sent to the Review Queue.`
    );
  }

  function retryFailedSpecificationItems() {
    saveSpecificationBatchItems(
      specificationBatchItemsRef.current.map((item) => item.status === "failed"
        ? { ...item, status: "pending", message: "Waiting to retry." }
        : item
      )
    );
    void runSpecificationBatch();
  }

  async function runMissingProductBatch(rowsToProcess?: UpdatedListRow[]) {
    setStatusTab("missing");

    if (rowsToProcess) {
      const existingById = new Map(
        missingProductBatchItemsRef.current.map((item) => [item.id, item])
      );
      const items = rowsToProcess
        .map(missingProductBatchItem)
        .filter((item): item is MissingProductBatchItem => Boolean(item))
        .map((item) => {
          const existing = existingById.get(item.id);

          return existing?.status === "completed"
            ? existing
            : { ...item, status: "pending" as const, message: "Waiting to be processed." };
        });

      saveMissingProductBatchItems(items);
    }

    const queue = missingProductBatchItemsRef.current;

    if (queue.length === 0) {
      setMessaging("No missing products are waiting to be processed.");
      return;
    }

    batchStateRef.current = { paused: false, stopped: false };
    const processedBeforeStart = queue.filter(
      (item) => item.status === "completed" || item.status === "failed"
    ).length;
    setMissingProductBatchProgress({
      total: queue.length,
      current: processedBeforeStart,
      paused: false,
      stopped: false
    });
    setMessaging("");
    setError("");

    for (const queuedItem of queue) {
      const currentItem = missingProductBatchItemsRef.current.find((item) => item.id === queuedItem.id);

      if (!currentItem || currentItem.status !== "pending") {
        continue;
      }

      if (batchStateRef.current.stopped) {
        setMissingProductBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Missing-product creation stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      const canContinue = await pauseForResume();

      if (!canContinue) {
        setMissingProductBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging("Missing-product creation stopped. Unfinished products are saved and ready to resume.");
        return;
      }

      updateMissingProductBatchItem(currentItem.id, {
        status: "processing",
        message: "Preparing the product review..."
      });
      const result = await createProductReview(currentItem.rowNumber);
      updateMissingProductBatchItem(currentItem.id, {
        status: result.success ? "completed" : "failed",
        message: result.message
      });

      const processed = missingProductBatchItemsRef.current.filter(
        (item) => item.status === "completed" || item.status === "failed"
      ).length;
      setMissingProductBatchProgress((current) => current ? { ...current, current: processed } : current);
    }

    const failed = missingProductBatchItemsRef.current.filter((item) => item.status === "failed").length;
    const completed = missingProductBatchItemsRef.current.filter((item) => item.status === "completed").length;
    setMissingProductBatchProgress(null);
    setMessaging(
      failed > 0
        ? `Missing-product run finished: ${completed} sent to the Review Queue and ${failed} failed.`
        : `Missing-product run finished: ${completed} product${completed === 1 ? "" : "s"} sent to the Review Queue.`
    );
  }

  function retryFailedMissingProducts() {
    saveMissingProductBatchItems(
      missingProductBatchItemsRef.current.map((item) => item.status === "failed"
        ? { ...item, status: "pending", message: "Waiting to retry." }
        : item
      )
    );
    void runMissingProductBatch();
  }

  async function startBatch(
    mode: "missing" | "draft" | "mismatch",
    rowsToProcess: UpdatedListRow[],
    onlyField?: FieldFix
  ) {
    if (mode === "mismatch") {
      await runMismatchBatch(rowsToProcess, onlyField);
      return;
    }

    if (mode === "missing") {
      await runMissingProductBatch(rowsToProcess);
      return;
    }

    setStatusTab("drafts");

    const queue = rowsToProcess.filter((row) => {
      if (mode === "draft") {
        return row.wooMatch && !row.ambiguousMatch && row.wooStatus === "draft";
      }

      const fields = getMismatchFields(row);
      return fields.length > 0;
    });

    batchStateRef.current = { paused: false, stopped: false };
    setBatchProgress({ mode, total: queue.length, current: 0, paused: false, stopped: false });
    setMessaging("");
    setError("");

    for (let index = 0; index < queue.length; index += 1) {
      const row = queue[index];

      if (batchStateRef.current.stopped) {
        setBatchProgress((current) => current ? { ...current, stopped: true } : current);
        setMessaging(`Batch stopped after ${index} of ${queue.length} item${queue.length === 1 ? "" : "s"}.`);
        return;
      }

      const canContinue = await pauseForResume();

      if (!canContinue) {
        setMessaging(`Batch stopped before continuing to the next product.`);
        return;
      }

      if (mode === "draft") {
        await publishDraftReview(row.sheetRowNumber);
      } else {
        const fields = getMismatchFields(row).map((field) => field.key);
        if (fields.length > 0) {
          await createFieldFixReview(row.sheetRowNumber, fields, row.wooId);
        }
      }

      setBatchProgress((current) => current ? { ...current, current: index + 1 } : current);
    }

    setBatchProgress(null);
    setMessaging(
      mode === "draft"
          ? `Finished publishing ${queue.length} draft product${queue.length === 1 ? "" : "s"}.`
          : `Finished bulk updating ${queue.length} mismatch row${queue.length === 1 ? "" : "s"}.`
    );
  }

  const activeMismatchBatchItem = mismatchBatchItems.find((item) => item.status === "processing");
  const activeMismatchProgress = activeMismatchBatchItem
    ? fieldFixProgress[activeMismatchBatchItem.rowNumber]?.progress ?? 0
    : 0;
  const mismatchBatchPercent = mismatchBatchProgress && mismatchBatchProgress.total > 0
    ? Math.min(100, ((mismatchBatchProgress.current + activeMismatchProgress / 100) / mismatchBatchProgress.total) * 100)
    : mismatchBatchItems.length > 0
      ? 100
      : 0;
  const activeSpecificationBatchItem = specificationBatchItems.find((item) => item.status === "processing");
  const activeSpecificationProgress = activeSpecificationBatchItem
    ? fieldFixProgress[activeSpecificationBatchItem.rowNumber]?.progress ?? 0
    : 0;
  const specificationBatchPercent = specificationBatchProgress && specificationBatchProgress.total > 0
    ? Math.min(
        100,
        ((specificationBatchProgress.current + activeSpecificationProgress / 100) /
          specificationBatchProgress.total) * 100
      )
    : specificationBatchItems.length > 0
      ? Math.min(
          100,
          ((specificationBatchItems.filter((item) => item.status === "completed" || item.status === "failed").length +
            activeSpecificationProgress / 100) /
            specificationBatchItems.length) * 100
        )
      : 0;
  const activeMissingProductBatchItem = missingProductBatchItems.find((item) => item.status === "processing");
  const activeMissingProductProgress = activeMissingProductBatchItem
    ? productCreateProgress[activeMissingProductBatchItem.rowNumber]?.progress ?? 0
    : 0;
  const missingProductBatchPercent = missingProductBatchProgress && missingProductBatchProgress.total > 0
    ? Math.min(
        100,
        ((missingProductBatchProgress.current + activeMissingProductProgress / 100) / missingProductBatchProgress.total) * 100
      )
    : missingProductBatchItems.length > 0
      ? Math.min(
          100,
          ((missingProductBatchItems.filter((item) => item.status === "completed" || item.status === "failed").length +
            activeMissingProductProgress / 100) /
            missingProductBatchItems.length) * 100
        )
      : 0;
  const genericBatchPercent = batchProgress && batchProgress.total > 0
    ? Math.min(100, (batchProgress.current / batchProgress.total) * 100)
    : 0;
  const failedMismatchItems = mismatchBatchItems.filter((item) => item.status === "failed").length;
  const failedSpecificationItems = specificationBatchItems.filter((item) => item.status === "failed").length;
  const failedMissingProductItems = missingProductBatchItems.filter((item) => item.status === "failed").length;
  const mismatchBatchRunning = Boolean(mismatchBatchProgress && !mismatchBatchProgress.stopped);
  const specificationBatchRunning = Boolean(
    specificationBatchProgress && !specificationBatchProgress.stopped
  );
  const missingProductBatchRunning = Boolean(
    missingProductBatchProgress && !missingProductBatchProgress.stopped
  );
  const visibleBatchProgress = activeTab === "mismatches"
    ? mismatchBatchProgress
      ? { ...mismatchBatchProgress, mode: "mismatch" as const }
      : null
    : activeTab === "specifications"
      ? specificationBatchProgress
        ? { ...specificationBatchProgress, mode: "specification" as const }
        : null
    : activeTab === "missing"
      ? missingProductBatchProgress
        ? { ...missingProductBatchProgress, mode: "missing" as const }
        : null
      : batchProgress && activeTab === "drafts" && batchProgress.mode === "draft"
      ? batchProgress
      : null;
  const showBatchPanel = activeTab === "mismatches"
    ? Boolean(mismatchBatchProgress || mismatchBatchItems.length > 0)
    : activeTab === "specifications"
      ? Boolean(specificationBatchProgress || specificationBatchItems.length > 0)
    : activeTab === "missing"
      ? Boolean(missingProductBatchProgress || missingProductBatchItems.length > 0)
      : Boolean(visibleBatchProgress);
  const visibleBatchPercent = activeTab === "mismatches"
    ? mismatchBatchPercent
    : activeTab === "specifications"
      ? specificationBatchPercent
    : activeTab === "missing"
      ? missingProductBatchPercent
      : genericBatchPercent;

  return (
    <section className="product-filter-panel" style={{ padding: "20px 18px" }}>
      <div className="product-filter-head" style={{ alignItems: "center", gap: 12 }}>
        <div>
          <FileSpreadsheet size={18} />
          <div>
            <h2 style={{ margin: 0 }}>Review & create actions</h2>
            <span>
              {missingRows.length} missing products | {draftCount} drafts | {mismatchRows.length} field fixes | {specificationRows.length} specifications missing
            </span>
          </div>
        </div>
        <button
          className="button secondary compact-button"
          type="button"
          disabled={
            isRefreshing ||
            Boolean(batchProgress) ||
            mismatchBatchRunning ||
            specificationBatchRunning ||
            missingProductBatchRunning
          }
          onClick={() => void refreshData()}
          title={`Refresh cached data from ${updatedAt}`}
        >
          <RefreshCw size={15} />
          {isRefreshing ? "Refreshing" : "Refresh data"}
        </button>
      </div>

      {isRefreshing ? (
        <div style={{ display: "grid", gap: 7, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
            <span>Refreshing live product data...</span>
            <strong>{refreshProgress}%</strong>
          </div>
          <div
            role="progressbar"
            aria-label="Refreshing updated list data"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={refreshProgress}
            style={{ width: "100%", height: 10, background: "#e5e7eb", borderRadius: 5, overflow: "hidden" }}
          >
            <div
              style={{
                width: `${refreshProgress}%`,
                height: "100%",
                background: "#2563eb",
                transition: "width 0.35s ease"
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="tab-list" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { id: "list", label: "Overview" },
          {
            id: "missing",
            label: `Missing products (${missingRows.length})${missingProductBatchProgress?.stopped ? " - stopped" : missingProductBatchProgress ? ` ${missingProductBatchProgress.current}/${missingProductBatchProgress.total}` : ""}`
          },
          {
            id: "drafts",
            label: `Draft products (${draftRows.length})${batchProgress?.mode === "draft" ? ` ${batchProgress.current}/${batchProgress.total}` : ""}`
          },
          {
            id: "mismatches",
            label: `Field fixes (${mismatchRows.length})${mismatchBatchProgress?.stopped ? " - stopped" : mismatchBatchProgress ? ` ${mismatchBatchProgress.current}/${mismatchBatchProgress.total}` : ""}`
          },
          {
            id: "specifications",
            label: `Specifications missing (${specificationRows.length})${specificationBatchProgress ? ` ${specificationBatchProgress.current}/${specificationBatchProgress.total}` : ""}`
          }
        ].map((tab) => (
          <button
            key={tab.id}
            className="button secondary compact-button"
            type="button"
            onClick={() => setActiveTab(tab.id as "list" | "missing" | "drafts" | "mismatches" | "specifications")}
            style={{
              opacity: activeTab === tab.id ? 1 : 0.8,
              borderColor: activeTab === tab.id ? "#2563eb" : undefined,
              fontWeight: activeTab === tab.id ? 700 : 500
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {showBatchPanel ? (
        <div style={{ marginBottom: 16, border: "1px solid #dbe2ea", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <strong>
              {!visibleBatchProgress
                ? activeTab === "missing"
                  ? "Missing product results"
                  : activeTab === "specifications"
                    ? "Specification update results"
                  : "Bulk field update results"
                : visibleBatchProgress.mode === "missing"
                ? "Creating missing products"
                : visibleBatchProgress.mode === "draft"
                  ? "Publishing draft products"
                  : activeTab === "specifications"
                    ? "Updating specifications"
                    : "Bulk updating mismatches"}
              {visibleBatchProgress ? ` - ${visibleBatchProgress.current}/${visibleBatchProgress.total}` : ""}
            </strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="button secondary compact-button"
                type="button"
                disabled={
                  isRefreshing ||
                  Boolean(visibleBatchProgress && !visibleBatchProgress.stopped) ||
                  Boolean(batchProgress && activeTab !== "drafts") ||
                  (activeTab === "mismatches" && (missingProductBatchRunning || specificationBatchRunning)) ||
                  (activeTab === "specifications" && (missingProductBatchRunning || mismatchBatchRunning)) ||
                  (activeTab === "missing" && (mismatchBatchRunning || specificationBatchRunning))
                }
                onClick={() => void refreshData()}
                title="Refresh spreadsheet and WooCommerce data without clearing the saved bulk queue"
              >
                <RefreshCw size={14} />
                {isRefreshing ? "Refreshing" : "Refresh bulk data"}
              </button>
              {visibleBatchProgress ? (
                <>
                  <button
                    className="button secondary compact-button"
                    disabled={
                      Boolean(batchProgress && visibleBatchProgress.mode !== "draft") ||
                      (visibleBatchProgress.mode === "mismatch" && (missingProductBatchRunning || specificationBatchRunning)) ||
                      (visibleBatchProgress.mode === "specification" && (missingProductBatchRunning || mismatchBatchRunning)) ||
                      (visibleBatchProgress.mode === "missing" && (mismatchBatchRunning || specificationBatchRunning))
                    }
                    type="button"
                    onClick={() => {
                      if (visibleBatchProgress.mode === "mismatch" && visibleBatchProgress.stopped) {
                        void runMismatchBatch();
                        return;
                      }

                      if (visibleBatchProgress.mode === "missing" && visibleBatchProgress.stopped) {
                        void runMissingProductBatch();
                        return;
                      }

                      if (visibleBatchProgress.mode === "specification" && visibleBatchProgress.stopped) {
                        void runSpecificationBatch();
                        return;
                      }

                      batchStateRef.current.paused = !batchStateRef.current.paused;
                      if (visibleBatchProgress.mode === "mismatch") {
                        setMismatchBatchProgress((current) => current ? { ...current, paused: !current.paused } : current);
                      } else if (visibleBatchProgress.mode === "specification") {
                        setSpecificationBatchProgress((current) => current ? { ...current, paused: !current.paused } : current);
                      } else if (visibleBatchProgress.mode === "missing") {
                        setMissingProductBatchProgress((current) => current ? { ...current, paused: !current.paused } : current);
                      } else {
                        setBatchProgress((current) => current ? { ...current, paused: !current.paused } : current);
                      }
                    }}
                  >
                    {visibleBatchProgress.stopped ? "Resume unfinished" : visibleBatchProgress.paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    className="button secondary compact-button"
                    type="button"
                    disabled={
                      visibleBatchProgress.stopped ||
                      Boolean(batchProgress && visibleBatchProgress.mode !== "draft") ||
                      (visibleBatchProgress.mode === "mismatch" && (missingProductBatchRunning || specificationBatchRunning)) ||
                      (visibleBatchProgress.mode === "specification" && (missingProductBatchRunning || mismatchBatchRunning)) ||
                      (visibleBatchProgress.mode === "missing" && (mismatchBatchRunning || specificationBatchRunning))
                    }
                    onClick={() => {
                      batchStateRef.current.stopped = true;
                      if (visibleBatchProgress.mode === "mismatch") {
                        setMismatchBatchProgress((current) => current ? { ...current, stopped: true } : current);
                      } else if (visibleBatchProgress.mode === "specification") {
                        setSpecificationBatchProgress((current) => current ? { ...current, stopped: true } : current);
                      } else if (visibleBatchProgress.mode === "missing") {
                        setMissingProductBatchProgress((current) => current ? { ...current, stopped: true } : current);
                      } else {
                        setBatchProgress((current) => current ? { ...current, stopped: true } : current);
                      }
                    }}
                  >
                    Stop after current
                  </button>
                </>
              ) : (
                <>
                  {activeTab === "missing" && failedMissingProductItems > 0 ? (
                    <button className="button secondary compact-button" type="button" onClick={retryFailedMissingProducts}>
                      Retry failed ({failedMissingProductItems})
                    </button>
                  ) : activeTab === "specifications" && failedSpecificationItems > 0 ? (
                    <button className="button secondary compact-button" type="button" onClick={retryFailedSpecificationItems}>
                      Retry failed ({failedSpecificationItems})
                    </button>
                  ) : activeTab === "mismatches" && failedMismatchItems > 0 ? (
                    <button className="button secondary compact-button" type="button" onClick={retryFailedMismatchItems}>
                      Retry failed ({failedMismatchItems})
                    </button>
                  ) : null}
                  <button
                    className="button secondary compact-button"
                    type="button"
                    onClick={() => activeTab === "missing"
                      ? saveMissingProductBatchItems([])
                      : activeTab === "specifications"
                        ? saveSpecificationBatchItems([])
                        : saveMismatchBatchItems([])}
                  >
                    Clear list
                  </button>
                </>
              )}
            </div>
          </div>
          {visibleBatchProgress ? (
            <p style={{ margin: "0 0 8px", color: "#52607a", fontSize: 12 }}>
              {visibleBatchProgress.stopped
                ? "Stopped. The unfinished queue is saved in this browser."
                : visibleBatchProgress.paused
                  ? "Paused. The current product will finish, then the queue will wait."
                  : visibleBatchProgress.mode === "mismatch" && activeMismatchBatchItem
                    ? `Processing ${activeMismatchBatchItem.name}`
                    : visibleBatchProgress.mode === "specification" && activeSpecificationBatchItem
                      ? `Processing ${activeSpecificationBatchItem.name}`
                    : visibleBatchProgress.mode === "missing" && activeMissingProductBatchItem
                      ? `Processing ${activeMissingProductBatchItem.name}`
                      : "Preparing the next product..."}
            </p>
          ) : null}
          <div style={{ width: "100%", height: 10, background: "#e5e7eb", borderRadius: 5, overflow: "hidden" }}>
            <div
              style={{
                width: `${visibleBatchPercent}%`,
                height: "100%",
                background:
                  (((activeTab === "mismatches" && failedMismatchItems > 0) ||
                    (activeTab === "specifications" && failedSpecificationItems > 0)) ||
                    (activeTab === "missing" && failedMissingProductItems > 0)) &&
                  !visibleBatchProgress
                    ? "#b91c1c"
                    : "#2563eb",
                transition: "width 0.2s ease"
              }}
            />
          </div>
          {(activeTab === "mismatches" ? mismatchBatchItems : activeTab === "specifications" ? specificationBatchItems : []).length > 0 ? (
            <div style={{ marginTop: 12, borderTop: "1px solid #dbe2ea", maxHeight: 320, overflowY: "auto" }}>
              {(activeTab === "specifications" ? specificationBatchItems : mismatchBatchItems).map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 2px",
                    borderBottom: "1px solid #e5e7eb"
                  }}
                >
                  {item.status === "completed" ? (
                    <CheckCircle2 size={17} color="#15803d" />
                  ) : item.status === "failed" ? (
                    <XCircle size={17} color="#b91c1c" />
                  ) : item.status === "processing" ? (
                    <LoaderCircle size={17} color="#2563eb" />
                  ) : (
                    <Circle size={17} color="#64748b" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{item.name}</div>
                    <div style={{ color: "#52607a", fontSize: 12 }}>
                      Fields: {item.fields.map((field) => fieldFixLabels[field]).join(", ")}
                    </div>
                    <div style={{ color: item.status === "failed" ? "#b91c1c" : "#52607a", fontSize: 12 }}>
                      {item.message}
                    </div>
                    {item.status === "completed" && item.productId ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                        {item.wooUrl || wooProductUrl(item.productId) ? (
                          <a
                            className="button secondary compact-button"
                            href={item.wooUrl || wooProductUrl(item.productId)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={13} />
                            WooCommerce
                          </a>
                        ) : null}
                        <Link className="button secondary compact-button" href={`/products/${item.productId}`}>
                          <SquarePen size={13} />
                          Product Manager
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <span className={`status ${item.status === "completed" ? "approved" : item.status === "failed" ? "failed" : "neutral"}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {activeTab === "missing" && missingProductBatchItems.length > 0 ? (
            <div style={{ marginTop: 12, borderTop: "1px solid #dbe2ea", maxHeight: 320, overflowY: "auto" }}>
              {missingProductBatchItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "24px minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 2px",
                    borderBottom: "1px solid #e5e7eb"
                  }}
                >
                  {item.status === "completed" ? (
                    <CheckCircle2 size={17} color="#15803d" />
                  ) : item.status === "failed" ? (
                    <XCircle size={17} color="#b91c1c" />
                  ) : item.status === "processing" ? (
                    <LoaderCircle size={17} color="#2563eb" />
                  ) : (
                    <Circle size={17} color="#64748b" />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{item.name}</div>
                    <div style={{ color: item.status === "failed" ? "#b91c1c" : "#52607a", fontSize: 12 }}>
                      {item.message}
                    </div>
                    {item.status === "completed" ? (
                      <div style={{ marginTop: 7 }}>
                        <Link className="button secondary compact-button" href="/reviews">
                          <SquarePen size={13} />
                          Review Queue
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <span className={`status ${item.status === "completed" ? "approved" : item.status === "failed" ? "failed" : "neutral"}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {messaging && statusTab === activeTab ? <p className="success">{messaging}</p> : null}
      {error && statusTab === activeTab ? <p className="error">{error}</p> : null}

      {activeTab === "list" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <p className="page-copy" style={{ margin: 0 }}>
            Use the tabs below to either create products that are missing from WooCommerce or update field data for products already matched.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div style={{ border: "1px solid #dbe2ea", borderRadius: 10, padding: 12 }}>
              <strong>{missingRows.length}</strong>
              <p style={{ margin: "6px 0 0", color: "#52607a" }}>Missing products</p>
            </div>
            <div style={{ border: "1px solid #dbe2ea", borderRadius: 10, padding: 12 }}>
              <strong>{draftCount}</strong>
              <p style={{ margin: "6px 0 0", color: "#52607a" }}>Drafts in WooCommerce</p>
            </div>
            <div style={{ border: "1px solid #dbe2ea", borderRadius: 10, padding: 12 }}>
              <strong>{mismatchRows.length}</strong>
              <p style={{ margin: "6px 0 0", color: "#52607a" }}>Products with missing required fields</p>
              <p style={{ margin: "4px 0 0", color: "#52607a", fontSize: 12 }}>
                Notes {missingFieldCounts.customNotes}, Colour {missingFieldCounts.colourBoard}, Accessories {missingFieldCounts.accessories}
              </p>
            </div>
            <div style={{ border: "1px solid #dbe2ea", borderRadius: 10, padding: 12 }}>
              <strong>{specificationRows.length}</strong>
              <p style={{ margin: "6px 0 0", color: "#52607a" }}>Products missing specifications</p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "missing" ? (
        <div>
          {missingRows.length === 0 ? (
            <p className="subtle">No products are missing from WooCommerce in the current filtered view.</p>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <p style={{ margin: 0, color: "#52607a" }}>Create a review for each product that is not yet in WooCommerce.</p>
                <button
                  className="button"
                  type="button"
                  onClick={() => void startBatch("missing", creatableMissingRows)}
                  disabled={
                    creatableMissingRows.length === 0 ||
                    busyRows.size > 0 ||
                    Boolean(batchProgress) ||
                    mismatchBatchRunning ||
                    specificationBatchRunning ||
                    Boolean(missingProductBatchProgress)
                  }
                >
                  <PackagePlus size={16} />
                  {missingProductBatchProgress
                    ? "In progress..."
                    : creatableMissingRows.length > 0
                      ? `Create all ${creatableMissingRows.length} unique product${creatableMissingRows.length === 1 ? "" : "s"}`
                      : "All eligible products queued"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {missingRows.map((row) => {
                  const sourceRowNumber = row.sheetRowNumber;
                  const progress = productCreateProgress[sourceRowNumber];
                  const queueItem = missingProductBatchItems.find((item) => item.rowNumber === sourceRowNumber);
                  const isBusy = busyRows.has(sourceRowNumber);

                  return (
                    <div
                      key={row.rowNumber}
                      style={{
                        display: "grid",
                        gap: 10,
                        border: "1px solid #dbe2ea",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: "#f9fafb"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{row.name}</div>
                          <div style={{ fontSize: 12, color: "#52607a" }}>
                            {queueItem?.status === "completed"
                              ? "Product review is waiting for approval"
                              : "Missing from WooCommerce"}
                          </div>
                        </div>
                        <button
                          className="button secondary compact-button"
                          type="button"
                          disabled={
                            isBusy ||
                            mismatchBatchRunning ||
                            specificationBatchRunning ||
                            queuedProductCreateRows.has(sourceRowNumber) ||
                            queueItem?.status === "completed"
                          }
                          onClick={() => void createMissingProduct(row)}
                        >
                          <PackagePlus size={14} />
                          {isBusy
                            ? "Creating..."
                            : queueItem?.status === "completed" || queuedProductCreateRows.has(sourceRowNumber)
                              ? "In Review Queue"
                              : queueItem?.status === "failed"
                                ? "Retry product"
                                : "Create product"}
                        </button>
                      </div>
                      {progress ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                            <span style={{ color: progress.state === "error" ? "#b91c1c" : "#52607a" }}>
                              {progress.status}
                            </span>
                            <strong>{progress.progress}%</strong>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`Creating product review for ${row.name}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress.progress}
                            style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}
                          >
                            <div
                              style={{
                                width: `${progress.progress}%`,
                                height: "100%",
                                background: progress.state === "success"
                                  ? "#15803d"
                                  : progress.state === "error"
                                    ? "#b91c1c"
                                    : "#2563eb",
                                transition: "width 0.3s ease"
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "drafts" ? (
        <div>
          {draftRows.length === 0 ? (
            <p className="subtle">No product in the current filtered view is currently saved as a draft in WooCommerce.</p>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <p style={{ margin: 0, color: "#52607a" }}>Publish each product that already exists as a draft in WooCommerce.</p>
                <button
                  className="button"
                  type="button"
                  onClick={() => void startBatch("draft", publishableDraftRows)}
                  disabled={
                    publishableDraftRows.length === 0 ||
                    busyRows.size > 0 ||
                    Boolean(batchProgress) ||
                    mismatchBatchRunning ||
                    specificationBatchRunning ||
                    missingProductBatchRunning
                  }
                >
                  <PackagePlus size={16} />
                  {batchProgress?.mode === "draft"
                    ? "In progress..."
                    : publishableDraftRows.length > 0
                      ? `Update and publish all ${publishableDraftRows.length}`
                      : "All drafts queued"}
                </button>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {draftRows.map((row) => (
                  <div
                    key={row.rowNumber}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      border: "1px solid #dbe2ea",
                      borderRadius: 10,
                      padding: "12px 14px",
                      background: "#f9fafb"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: "#52607a" }}>Found in WooCommerce as draft</div>
                    </div>
                    <button
                      className="button secondary compact-button"
                      type="button"
                      disabled={
                        busyRows.has(row.sheetRowNumber) ||
                        mismatchBatchRunning ||
                        specificationBatchRunning ||
                        missingProductBatchRunning ||
                        queuedProductCreateRows.has(row.sheetRowNumber)
                      }
                      onClick={() => publishDraftReview(row.sheetRowNumber)}
                    >
                      <PackagePlus size={14} />
                      {busyRows.has(row.sheetRowNumber)
                        ? "Preparing update..."
                        : queuedProductCreateRows.has(row.sheetRowNumber)
                          ? "In Review Queue"
                          : "Update and publish"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "mismatches" ? (
        <div>
          {mismatchRows.length === 0 ? (
            <p className="subtle">No matched products in this view need field updates.</p>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, color: "#52607a" }}>Create reviews only for required spreadsheet fields missing from WooCommerce.</p>
                  <p style={{ margin: "4px 0 0", color: "#52607a", fontSize: 12 }}>
                    Custom notes: {missingFieldCounts.customNotes}, Colour board: {missingFieldCounts.colourBoard}, Accessories: {missingFieldCounts.accessories}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={
                      missingFieldCounts.accessories === 0 ||
                      Boolean(batchProgress) ||
                      Boolean(mismatchBatchProgress) ||
                      specificationBatchRunning ||
                      missingProductBatchRunning
                    }
                    onClick={() => void startBatch("mismatch", mismatchRows, "accessories")}
                  >
                    <Wrench size={16} />
                    {mismatchBatchProgress ? "In progress..." : `Fix missing accessories (${missingFieldCounts.accessories})`}
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={mismatchRows.some((row) => {
                      const fields = getMismatchFields(row);
                      return fields.some((field) => Boolean(busyFixes[`${row.sheetRowNumber}-${field.key}`]));
                    }) || Boolean(batchProgress) || Boolean(mismatchBatchProgress) || specificationBatchRunning || missingProductBatchRunning}
                    onClick={() => void startBatch("mismatch", mismatchRows)}
                  >
                    <Wrench size={16} />
                    {mismatchBatchProgress ? "In progress..." : "Bulk update all mismatch rows"}
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {mismatchRows.map((row) => {
                  const fields = getMismatchFields(row);
                  const sourceRowNumber = row.sheetRowNumber;
                  const rowIsBusy = fields.some((field) => Boolean(busyFixes[`${sourceRowNumber}-${field.key}`]));
                  const progress = fieldFixProgress[sourceRowNumber];

                  return (
                    <div
                      key={row.rowNumber}
                      style={{
                        display: "grid",
                        gap: 10,
                        border: "1px solid #dbe2ea",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: "#f9fafb"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{row.name}</div>
                          <div style={{ fontSize: 12, color: "#52607a" }}>{fields.map((field) => field.label).join(" • ")} missing</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {fields.map((field) => (
                          <button
                            key={`${sourceRowNumber}-${field.key}`}
                            className="button secondary compact-button"
                            type="button"
                            disabled={rowIsBusy || missingProductBatchRunning || specificationBatchRunning}
                            onClick={() => createFieldFixReview(sourceRowNumber, field.key, row.wooId)}
                          >
                            <Wrench size={14} />
                            {busyFixes[`${sourceRowNumber}-${field.key}`] ? `Creating ${field.label} fix...` : `Fix ${field.label}`}
                          </button>
                        ))}
                      </div>
                      {progress ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                            <span style={{ color: progress.state === "error" ? "#b91c1c" : "#52607a" }}>
                              {progress.status}
                            </span>
                            <strong>{progress.progress}%</strong>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`Creating field fix review for ${row.name}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress.progress}
                            style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}
                          >
                            <div
                              style={{
                                width: `${progress.progress}%`,
                                height: "100%",
                                background: progress.state === "success"
                                  ? "#15803d"
                                  : progress.state === "error"
                                    ? "#b91c1c"
                                    : "#2563eb",
                                transition: "width 0.3s ease"
                              }}
                            />
                          </div>
                          {progress.state === "success" && row.wooId ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {wooProductUrl(row.wooId, row.wooPermalink) ? (
                                <a
                                  className="button secondary compact-button"
                                  href={wooProductUrl(row.wooId, row.wooPermalink)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink size={13} />
                                  WooCommerce
                                </a>
                              ) : null}
                              <Link className="button secondary compact-button" href={`/products/${row.wooId}`}>
                                <SquarePen size={13} />
                                Product Manager
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "specifications" ? (
        <div>
          {specificationRows.length === 0 ? (
            <p className="subtle">No matched products are missing required specifications.</p>
          ) : (
            <>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <p style={{ margin: 0, color: "#52607a" }}>
                  These spreadsheet products have a Feature value but no WooCommerce Specifications data.
                </p>
                <button
                  className="button"
                  type="button"
                  onClick={() => void runSpecificationBatch(specificationRows)}
                  disabled={
                    specificationRows.length === 0 ||
                    busyRows.size > 0 ||
                    Boolean(batchProgress) ||
                    mismatchBatchRunning ||
                    missingProductBatchRunning ||
                    Boolean(specificationBatchProgress)
                  }
                >
                  <Wrench size={16} />
                  {specificationBatchProgress
                    ? "In progress..."
                    : `Update all ${specificationRows.length}`}
                </button>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {specificationRows.map((row) => {
                  const wooUrl = wooProductUrl(row.wooId, row.wooPermalink);
                  const progress = fieldFixProgress[row.sheetRowNumber];
                  const queueItem = specificationBatchItems.find((item) => item.rowNumber === row.sheetRowNumber);
                  const isBusy = Boolean(busyFixes[`${row.sheetRowNumber}-specifications`]);

                  return (
                    <div
                      key={row.rowNumber}
                      style={{
                        display: "grid",
                        gap: 10,
                        border: "1px solid #dbe2ea",
                        borderRadius: 8,
                        padding: "12px 14px",
                        background: "#f9fafb"
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{row.name}</div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "#52607a", overflowWrap: "anywhere" }}>
                          Feature: {row.specificationsFeature}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="button compact-button"
                          type="button"
                          disabled={
                            isBusy ||
                            queueItem?.status === "completed" ||
                            progress?.state === "success" ||
                            mismatchBatchRunning ||
                            missingProductBatchRunning ||
                            specificationBatchRunning
                          }
                          onClick={() => void createFieldFixReview(row.sheetRowNumber, "specifications", row.wooId)}
                        >
                          <Wrench size={13} />
                          {isBusy
                            ? "Preparing..."
                            : queueItem?.status === "completed" || progress?.state === "success"
                              ? "In Review Queue"
                              : queueItem?.status === "failed" || progress?.state === "error"
                                ? "Retry update"
                                : "Update specifications"}
                        </button>
                        {wooUrl ? (
                          <a className="button secondary compact-button" href={wooUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} />
                            WooCommerce
                          </a>
                        ) : null}
                        {row.wooId ? (
                          <Link className="button secondary compact-button" href={`/products/${row.wooId}`}>
                            <SquarePen size={13} />
                            Product Manager
                          </Link>
                        ) : null}
                      </div>
                      {progress ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                            <span style={{ color: progress.state === "error" ? "#b91c1c" : "#52607a" }}>
                              {progress.status}
                            </span>
                            <strong>{progress.progress}%</strong>
                          </div>
                          <div style={{ width: "100%", height: 8, background: "#e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${progress.progress}%`,
                                height: "100%",
                                background: progress.state === "success"
                                  ? "#15803d"
                                  : progress.state === "error"
                                    ? "#b91c1c"
                                    : "#2563eb",
                                transition: "width 0.3s ease"
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
