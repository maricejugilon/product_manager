import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { runtimeStorageFile } from "@/lib/runtime-storage";

export type UpdatedListCheckKind = "price" | "stock";
export type UpdatedListWorkflowKind =
  | "field-fixes"
  | "qa-checks"
  | "specifications"
  | "missing-products"
  | "price-updates"
  | "stock-updates";

export type StoredUpdatedListCheck = {
  rowNumber: number;
  sourceUrl: string;
  [key: string]: unknown;
};

const localFile = runtimeStorageFile("updated-list-checks.json");
const localDataFile = runtimeStorageFile("updated-list-data-cache.json");
const localWorkflowFile = runtimeStorageFile("updated-list-workflows.json");
const keyPrefix = "fcw-product-manager";
const commandBatchSize = 100;

function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  const normalizedNames = names.map((name) => name.toUpperCase());

  for (const [key, value] of Object.entries(process.env)) {
    const normalizedKey = key.toUpperCase();
    if (value && normalizedNames.some((name) => normalizedKey.endsWith(`_${name}`))) {
      return value;
    }
  }

  return undefined;
}

function kvConfig() {
  const url = envValue("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL");
  const token = envValue("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN");

  return url && token ? { url: url.replace(/\/$/, ""), token } : undefined;
}

function cacheNamespace() {
  return (process.env.UPDATED_LIST_CACHE_NAMESPACE || "shared")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .toLowerCase();
}

function cacheKey(kind: UpdatedListCheckKind, rowNumber: number) {
  return `${keyPrefix}:${cacheNamespace()}:updated-list:${kind}:${rowNumber}`;
}

function dataCacheKey() {
  return `${keyPrefix}:${cacheNamespace()}:updated-list:data:v30`;
}

function workflowKey(workflow: UpdatedListWorkflowKind) {
  return `${keyPrefix}:${cacheNamespace()}:updated-list:workflow:${workflow}`;
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function sharedStoreError() {
  return new Error(
    "Shared Updated List cache is not configured. Add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel."
  );
}

async function kvCommand<T>(command: Array<string | number>) {
  const config = kvConfig();
  if (!config) throw sharedStoreError();

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Shared Updated List cache ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as { result?: T; error?: string };
  if (payload.error) throw new Error(`Shared Updated List cache error: ${payload.error}`);
  return payload.result as T;
}

async function kvPipeline(commands: Array<Array<string | number>>) {
  const config = kvConfig();
  if (!config) throw sharedStoreError();

  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Shared Updated List cache ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as Array<{ error?: string }>;
  const failed = payload.find((item) => item.error);
  if (failed?.error) throw new Error(`Shared Updated List cache error: ${failed.error}`);
}

async function readLocalChecks() {
  try {
    return JSON.parse(await readFile(localFile, "utf8")) as Record<UpdatedListCheckKind, Record<string, StoredUpdatedListCheck>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { price: {}, stock: {} };
    }
    throw error;
  }
}

async function writeLocalChecks(value: Record<UpdatedListCheckKind, Record<string, StoredUpdatedListCheck>>) {
  await mkdir(path.dirname(localFile), { recursive: true });
  await writeFile(localFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseStoredCheck(value: unknown) {
  if (!value) return undefined;

  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return undefined;
    const check = parsed as StoredUpdatedListCheck;
    return Number.isInteger(check.rowNumber) && check.rowNumber > 0 && typeof check.sourceUrl === "string"
      ? check
      : undefined;
  } catch {
    return undefined;
  }
}

export function updatedListCheckStorageMode() {
  return kvConfig() ? "upstash" as const : "local" as const;
}

export async function readUpdatedListChecks(kind: UpdatedListCheckKind, rowNumbers: number[]) {
  const uniqueRows = [...new Set(rowNumbers.filter((rowNumber) => Number.isInteger(rowNumber) && rowNumber > 0))];

  if (kvConfig()) {
    const checks: Record<number, StoredUpdatedListCheck> = {};

    for (const batch of chunks(uniqueRows, commandBatchSize)) {
      const values = await kvCommand<unknown[]>(["MGET", ...batch.map((rowNumber) => cacheKey(kind, rowNumber))]);
      batch.forEach((rowNumber, index) => {
        const check = parseStoredCheck(values?.[index]);
        if (check) checks[rowNumber] = check;
      });
    }

    return checks;
  }

  if (process.env.VERCEL) throw sharedStoreError();

  const stored = await readLocalChecks();
  return Object.fromEntries(
    uniqueRows
      .map((rowNumber) => [rowNumber, stored[kind][String(rowNumber)]])
      .filter((entry): entry is [number, StoredUpdatedListCheck] => Boolean(entry[1]))
  );
}

export async function writeUpdatedListChecks(kind: UpdatedListCheckKind, checks: StoredUpdatedListCheck[]) {
  const validChecks = checks.filter((check) =>
    Number.isInteger(check.rowNumber) && check.rowNumber > 0 && typeof check.sourceUrl === "string" && check.sourceUrl.length > 0
  );

  if (kvConfig()) {
    for (const batch of chunks(validChecks, commandBatchSize)) {
      await kvPipeline(batch.map((check) => ["SET", cacheKey(kind, check.rowNumber), JSON.stringify(check)]));
    }
    return;
  }

  if (process.env.VERCEL) throw sharedStoreError();

  const stored = await readLocalChecks();
  validChecks.forEach((check) => {
    stored[kind][String(check.rowNumber)] = check;
  });
  await writeLocalChecks(stored);
}

type UpdatedListDataCache<T> = {
  cachedAt: string;
  data: T;
};

function parseDataCache<T>(value: unknown) {
  if (!value) return undefined;

  try {
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as UpdatedListDataCache<T>;
    return parsed?.cachedAt && parsed.data ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function readUpdatedListDataCache<T>(maxAgeMs: number) {
  let cached: UpdatedListDataCache<T> | undefined;

  if (kvConfig()) {
    cached = parseDataCache<T>(await kvCommand<unknown>(["GET", dataCacheKey()]));
  } else {
    if (process.env.VERCEL) throw sharedStoreError();

    try {
      cached = parseDataCache<T>(JSON.parse(await readFile(localDataFile, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  if (!cached) return undefined;
  const cachedAt = Date.parse(cached.cachedAt);
  return Number.isFinite(cachedAt) && Date.now() - cachedAt <= maxAgeMs ? cached.data : undefined;
}

export async function writeUpdatedListDataCache<T>(data: T) {
  const cached: UpdatedListDataCache<T> = {
    cachedAt: new Date().toISOString(),
    data
  };

  if (kvConfig()) {
    await kvCommand<"OK">(["SET", dataCacheKey(), JSON.stringify(cached)]);
    return;
  }

  if (process.env.VERCEL) throw sharedStoreError();
  await mkdir(path.dirname(localDataFile), { recursive: true });
  await writeFile(localDataFile, `${JSON.stringify(cached)}\n`, "utf8");
}

export async function deleteUpdatedListDataCache() {
  if (kvConfig()) {
    await kvCommand<number>(["DEL", dataCacheKey()]);
    return;
  }

  if (process.env.VERCEL) throw sharedStoreError();

  try {
    await writeFile(localDataFile, "", "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export type UpdatedListWorkflowState = {
  updatedAt: string;
  items: unknown[];
};

function parseWorkflowState(value: unknown) {
  if (!value) return undefined;

  try {
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as UpdatedListWorkflowState;
    return parsed?.updatedAt && Array.isArray(parsed.items) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readLocalWorkflows() {
  try {
    return JSON.parse(await readFile(localWorkflowFile, "utf8")) as Partial<Record<UpdatedListWorkflowKind, UpdatedListWorkflowState>>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function readUpdatedListWorkflow(workflow: UpdatedListWorkflowKind) {
  if (kvConfig()) {
    return parseWorkflowState(await kvCommand<unknown>(["GET", workflowKey(workflow)]));
  }

  if (process.env.VERCEL) throw sharedStoreError();
  return (await readLocalWorkflows())[workflow];
}

export async function writeUpdatedListWorkflow(workflow: UpdatedListWorkflowKind, items: unknown[]) {
  const state: UpdatedListWorkflowState = {
    updatedAt: new Date().toISOString(),
    items
  };

  if (kvConfig()) {
    await kvCommand<"OK">(["SET", workflowKey(workflow), JSON.stringify(state)]);
    return state;
  }

  if (process.env.VERCEL) throw sharedStoreError();
  const workflows = await readLocalWorkflows();
  workflows[workflow] = state;
  await mkdir(path.dirname(localWorkflowFile), { recursive: true });
  await writeFile(localWorkflowFile, `${JSON.stringify(workflows, null, 2)}\n`, "utf8");
  return state;
}
