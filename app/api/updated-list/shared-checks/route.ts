import { NextResponse } from "next/server";

import {
  readUpdatedListChecks,
  updatedListCheckStorageMode,
  writeUpdatedListChecks,
  type StoredUpdatedListCheck,
  type UpdatedListCheckKind
} from "@/lib/updated-list-check-store";

export const maxDuration = 60;

function checkKind(value: unknown): UpdatedListCheckKind | undefined {
  return value === "price" || value === "stock" ? value : undefined;
}

function rowNumbers(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 2000)
    : [];
}

function checks(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is StoredUpdatedListCheck => {
    if (!item || typeof item !== "object") return false;
    const check = item as StoredUpdatedListCheck;
    return Number.isInteger(check.rowNumber) &&
      check.rowNumber > 0 &&
      typeof check.sourceUrl === "string" &&
      check.sourceUrl.length > 0 &&
      JSON.stringify(check).length <= 10000;
  }).slice(0, 2000);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind = checkKind(body.kind);
    const requestedRows = rowNumbers(body.rowNumbers);

    if (!kind || requestedRows.length === 0) {
      return NextResponse.json({ error: "A valid check type and spreadsheet rows are required." }, { status: 400 });
    }

    return NextResponse.json({
      checks: await readUpdatedListChecks(kind, requestedRows),
      storage: updatedListCheckStorageMode()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the shared Updated List cache." },
      { status: 503 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const kind = checkKind(body.kind);
    const updates = checks(body.checks);

    if (!kind || updates.length === 0) {
      return NextResponse.json({ error: "A valid check type and check results are required." }, { status: 400 });
    }

    await writeUpdatedListChecks(kind, updates);
    return NextResponse.json({ saved: updates.length, storage: updatedListCheckStorageMode() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the shared Updated List cache." },
      { status: 503 }
    );
  }
}
