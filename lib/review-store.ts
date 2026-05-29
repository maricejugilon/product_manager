import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { runtimeStorageFile } from "@/lib/runtime-storage";
import type { ReviewRecord } from "@/lib/types";

const reviewFile = runtimeStorageFile("reviews.json");
const reviewIndexKey = "fcw-product-manager:reviews:index";
const reviewKeyPrefix = "fcw-product-manager:reviews:";
const reviewLockPrefix = "fcw-product-manager:review-lock:";

function kvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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

async function ensureStore() {
  await mkdir(path.dirname(reviewFile), { recursive: true });
}

export async function listReviews() {
  if (kvConfig()) {
    const ids = await kvCommand<string[]>(["ZREVRANGE", reviewIndexKey, 0, -1]);

    if (!ids || ids.length === 0) {
      return [];
    }

    const values = await kvCommand<unknown[]>(["MGET", ...ids.map(reviewKey)]);

    return values
      .map(parseReview)
      .filter((review): review is ReviewRecord => Boolean(review))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (isReviewStorageMissing()) {
    return [];
  }

  try {
    const raw = await readFile(reviewFile, "utf8");
    const reviews = JSON.parse(raw) as ReviewRecord[];
    return reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  await writeFile(reviewFile, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
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
  const review: ReviewRecord = {
    ...input,
    id: randomUUID(),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

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

    const updated: ReviewRecord = {
      ...review,
      ...patch,
      updatedAt: new Date().toISOString()
    };

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

  const updated: ReviewRecord = {
    ...reviews[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };

  reviews[index] = updated;
  await writeReviews(reviews);
  return updated;
}
