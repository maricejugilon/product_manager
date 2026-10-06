export type UpdatedListWorkflowKind =
  | "field-fixes"
  | "qa-checks"
  | "specifications"
  | "missing-products"
  | "price-updates"
  | "stock-updates";

export type SharedWorkflowState<T> = {
  updatedAt: string;
  items: T[];
};

export async function loadSharedWorkflow<T>(workflow: UpdatedListWorkflowKind) {
  const response = await fetch("/api/updated-list/workflow-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow })
  });
  const payload = await response.json().catch(() => ({})) as {
    state?: SharedWorkflowState<T> | null;
    storage?: "upstash" | "local";
    error?: string;
  };

  if (!response.ok) throw new Error(payload.error || "Could not load the shared workflow status.");
  return payload;
}

export async function saveSharedWorkflow<T>(workflow: UpdatedListWorkflowKind, items: T[]) {
  const response = await fetch("/api/updated-list/workflow-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workflow, items })
  });
  const payload = await response.json().catch(() => ({})) as {
    state?: SharedWorkflowState<T>;
    storage?: "upstash" | "local";
    error?: string;
  };

  if (!response.ok) throw new Error(payload.error || "Could not save the shared workflow status.");
  return payload;
}
