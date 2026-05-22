import "server-only";

import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { runtimeStorageFile } from "@/lib/runtime-storage";
import type { ProductSheetValidationResult } from "@/lib/product-sheet-validator";

export type ProductSheetValidatorCache = {
  version: 1;
  updatedAt: string;
  total: number;
  results: ProductSheetValidationResult[];
};

const cacheFile = runtimeStorageFile("product-sheet-validator-cache.json");
const syncCacheFile = runtimeStorageFile("product-sheet-validator-cache-sync.json");

async function ensureStore() {
  await mkdir(path.dirname(cacheFile), { recursive: true });
}

function sortedResults(results: ProductSheetValidationResult[]) {
  return [...results].sort((a, b) => a.row.rowNumber - b.row.rowNumber);
}

async function readCache(file: string) {
  try {
    const raw = await readFile(file, "utf8");
    const cache = JSON.parse(raw) as ProductSheetValidatorCache;

    return {
      ...cache,
      results: sortedResults(cache.results ?? [])
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeCache(file: string, cache: ProductSheetValidatorCache) {
  await ensureStore();
  await writeFile(file, `${JSON.stringify({ ...cache, results: sortedResults(cache.results) }, null, 2)}\n`, "utf8");
}

export async function readProductSheetValidatorCache() {
  return readCache(cacheFile);
}

export async function writeProductSheetValidatorCache(cache: ProductSheetValidatorCache) {
  await writeCache(cacheFile, cache);
}

export async function resetProductSheetValidatorSyncCache() {
  const cache: ProductSheetValidatorCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: 0,
    results: []
  };

  await writeCache(syncCacheFile, cache);
  return cache;
}

export async function mergeProductSheetValidatorSyncCache(input: {
  total: number;
  results: ProductSheetValidationResult[];
}) {
  const existing = await readCache(syncCacheFile);
  const byRow = new Map<number, ProductSheetValidationResult>();

  for (const result of existing?.results ?? []) {
    byRow.set(result.row.rowNumber, result);
  }

  for (const result of input.results) {
    byRow.set(result.row.rowNumber, result);
  }

  const cache: ProductSheetValidatorCache = {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: input.total,
    results: sortedResults([...byRow.values()])
  };

  await writeCache(syncCacheFile, cache);
  return cache;
}

export async function promoteProductSheetValidatorSyncCache() {
  await ensureStore();
  await copyFile(syncCacheFile, cacheFile);
  return readProductSheetValidatorCache();
}
