import { NextResponse } from "next/server";

import {
  readUpdatedListWorkflow,
  updatedListCheckStorageMode,
  writeUpdatedListWorkflow,
  type UpdatedListWorkflowKind
} from "@/lib/updated-list-check-store";

const workflows = new Set<UpdatedListWorkflowKind>([
  "field-fixes",
  "qa-checks",
  "specifications",
  "missing-products",
  "price-updates",
  "stock-updates"
]);

function workflowKind(value: unknown): UpdatedListWorkflowKind | undefined {
  return typeof value === "string" && workflows.has(value as UpdatedListWorkflowKind)
    ? value as UpdatedListWorkflowKind
    : undefined;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const workflow = workflowKind(body.workflow);
    if (!workflow) return NextResponse.json({ error: "A valid Updated List workflow is required." }, { status: 400 });

    return NextResponse.json({
      state: await readUpdatedListWorkflow(workflow) ?? null,
      storage: updatedListCheckStorageMode()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the shared workflow status." },
      { status: 503 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const workflow = workflowKind(body.workflow);
    const items = Array.isArray(body.items) ? body.items : undefined;

    if (!workflow || !items || items.length > 2500 || JSON.stringify(items).length > 5_000_000) {
      return NextResponse.json({ error: "A valid workflow queue is required." }, { status: 400 });
    }

    return NextResponse.json({
      state: await writeUpdatedListWorkflow(workflow, items),
      storage: updatedListCheckStorageMode()
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the shared workflow status." },
      { status: 503 }
    );
  }
}
