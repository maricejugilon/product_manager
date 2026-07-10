import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { runtimeStorageFile } from "@/lib/runtime-storage";
import { compactReviewRecord } from "@/lib/sanitize";
import type { ReviewRecord } from "@/lib/types";

const reviewFile = runtimeStorageFile("reviews.json");
const reviewIndexKey = "fcw-product-manager:reviews:index";
const reviewKeyPrefix = "fcw-product-manager:reviews:";
const reviewLockPrefix = "fcw-product-manager:review-lock:";
const reviewReadBatchSize = 50;

function envValue(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];

    if (value) {
      return value;
    }
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

  if (!url || !token) {
    return undefined;
  }

  return {
    url: url.replace(/\/$/, ""),
    token
  };
}

function shouldRequireSharedStore() {
  return Boolean(process.env.VERCEL);
}

export function isReviewStorageMissing() {
  return shouldRequireSharedStore() && !kvConfig();
}

export function reviewStorageSetupMessage() {
  return "Production review storage is not configured. Add Vercel KV or Upstash Redis env vars: KV_REST_API_URL and KV_REST_API_TOKEN.";
}

function sharedStoreError() {
  return new Error(
    reviewStorageSetupMessage()
  );
}

function reviewKey(id: string) {
  return `${reviewKeyPrefix}${id}`;
}

function reviewLockKey(id: string) {
  return `${reviewLockPrefix}${id}`;
}

async function kvCommand<T>(command: Array<string | number>) {
  const config = kvConfig();

  if (!config) {
    throw sharedStoreError();
  }

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
    throw new Error(`Review storage ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as { result?: T; error?: string };

  if (payload.error) {
    throw new Error(`Review storage error: ${payload.error}`);
  }

  return payload.result as T;
}

function parseReview(value: unknown) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as ReviewRecord;
  }

  return value as ReviewRecord;
}

function chunks<T>(items: T[], size: number) {
  const grouped: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    grouped.push(items.slice(index, index + size));
  }

  return grouped;
}

function isCompletedReview(review: ReviewRecord) {
  return review.status === "approved" || review.status === "rejected";
}

function isMaxRequestSizeError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("max request size exceeded");
}

async function ensureStore() {
  await mkdir(path.dirname(reviewFile), { recursive: true });
}

export async function listReviews() {
  if (kvConfig()) {
    const reviews: ReviewRecord[] = [];
    const staleIds: string[] = [];
    let offset = 0;

    while (true) {
      const ids = await kvCommand<string[]>([
        "ZREVRANGE",
        reviewIndexKey,
        offset,
        offset + reviewReadBatchSize - 1
      ]);

      if (!ids || ids.length === 0) {
        break;
      }

      for (const idChunk of chunks(ids, reviewReadBatchSize)) {
        let values: unknown[];

        try {
          values = await kvCommand<unknown[]>(["MGET", ...idChunk.map(reviewKey)]);
        } catch (error) {
          if (!isMaxRequestSizeError(error)) {
            throw error;
          }

          values = [];

          for (const id of idChunk) {
            try {
              values.push(await kvCommand<unknown>(["GET", reviewKey(id)]));
            } catch (innerError) {
              if (!isMaxRequestSizeError(innerError)) {
                throw innerError;
              }

              values.push(undefined);
              staleIds.push(id);
            }
          }
        }

        values.forEach((value, index) => {
          const review = parseReview(value);
          const id = idChunk[index];

          if (!review) {
            staleIds.push(id);
            return;
          }

          if (isCompletedReview(review)) {
            staleIds.push(id);
            return;
          }

          reviews.push(compactReviewRecord(review));
        });
      }

      if (ids.length < reviewReadBatchSize) {
        break;
      }

      offset += reviewReadBatchSize;
    }

    for (const id of [...new Set(staleIds)]) {
      await kvCommand<number>(["DEL", reviewKey(id)]);
      await kvCommand<number>(["ZREM", reviewIndexKey, id]);
    }

    return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (isReviewStorageMissing()) {
    return [];
  }

  try {
    const raw = await readFile(reviewFile, "utf8");
    const reviews = JSON.parse(raw) as ReviewRecord[];
    const activeReviews = reviews.filter((review) => !isCompletedReview(review)).map(compactReviewRecord);

    if (activeReviews.length !== reviews.length) {
      await writeReviews(activeReviews);
    }

    return activeReviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeReviews(reviews: ReviewRecord[]) {
  if (shouldRequireSharedStore()) {
    throw sharedStoreError();
  }

  await ensureStore();
  await writeFile(reviewFile, `${JSON.stringify(reviews.map(compactReviewRecord), null, 2)}\n`, "utf8");
}

export async function getReview(id: string) {
  if (kvConfig()) {
    return parseReview(await kvCommand<unknown>(["GET", reviewKey(id)]));
  }

  if (shouldRequireSharedStore()) {
    throw sharedStoreError();
  }

  return (await listReviews()).find((review) => review.id === id);
}

export async function acquireReviewLock(id: string) {
  if (!kvConfig()) {
    return randomUUID();
  }

  const token = randomUUID();
  const result = await kvCommand<"OK" | null>(["SET", reviewLockKey(id), token, "PX", 120000, "NX"]);

  return result === "OK" ? token : undefined;
}

export async function releaseReviewLock(id: string, token: string) {
  if (!kvConfig()) {
    return;
  }

  const currentToken = await kvCommand<string | null>(["GET", reviewLockKey(id)]);

  if (currentToken === token) {
    await kvCommand<number>(["DEL", reviewLockKey(id)]);
  }
}

export async function createReview(
  input: Pick<ReviewRecord, "resource" | "action" | "resourceId" | "title" | "before" | "changes">
) {
  const now = new Date().toISOString();
  const review = compactReviewRecord({
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: now,
    updatedAt: now
  });

  if (kvConfig()) {
    await kvCommand<"OK">(["SET", reviewKey(review.id), JSON.stringify(review)]);
    await kvCommand<number>(["ZADD", reviewIndexKey, Date.parse(review.createdAt), review.id]);
    return review;
  }

  if (shouldRequireSharedStore()) {
    throw sharedStoreError();
  }

  const reviews = await listReviews();
  reviews.unshift(review);
  await writeReviews(reviews);
  return review;
}

export async function patchReview(id: string, patch: Partial<ReviewRecord>) {
  if (kvConfig()) {
    const review = parseReview(await kvCommand<unknown>(["GET", reviewKey(id)]));

    if (!review) {
      return undefined;
    }

    const updated = compactReviewRecord({
      ...review,
      ...patch,
      updatedAt: new Date().toISOString()
    });

    await kvCommand<"OK">(["SET", reviewKey(id), JSON.stringify(updated)]);
    await kvCommand<number>(["ZADD", reviewIndexKey, Date.parse(updated.createdAt), id]);
    return updated;
  }

  if (shouldRequireSharedStore()) {
    throw sharedStoreError();
  }

  const reviews = await listReviews();
  const index = reviews.findIndex((review) => review.id === id);

  if (index === -1) {
    return undefined;
  }

  const updated = compactReviewRecord({
    ...reviews[index],
    ...patch,
    updatedAt: new Date().toISOString()
  });

  reviews[index] = updated;
  await writeReviews(reviews);
  return updated;
}

export async function deleteReview(id: string) {
  if (kvConfig()) {
    await kvCommand<number>(["DEL", reviewKey(id)]);
    await kvCommand<number>(["ZREM", reviewIndexKey, id]);
    return;
  }

  if (shouldRequireSharedStore()) {
    throw sharedStoreError();
  }

  const reviews = await listReviews();
  await writeReviews(reviews.filter((review) => review.id !== id));
}
