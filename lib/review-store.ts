import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { ReviewRecord } from "@/lib/types";

const reviewFile = path.join(process.cwd(), "data", "reviews.json");

async function ensureStore() {
  await mkdir(path.dirname(reviewFile), { recursive: true });
}

export async function listReviews() {
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
  await ensureStore();
  await writeFile(reviewFile, `${JSON.stringify(reviews, null, 2)}\n`, "utf8");
}

export async function getReview(id: string) {
  return (await listReviews()).find((review) => review.id === id);
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

  const reviews = await listReviews();
  reviews.unshift(review);
  await writeReviews(reviews);
  return review;
}

export async function patchReview(id: string, patch: Partial<ReviewRecord>) {
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
