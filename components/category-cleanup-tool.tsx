"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Trash2 } from "lucide-react";

import { getDirectChildren, getHierarchicalCategoryOptions } from "@/lib/category-utils";
import type { WooCategory } from "@/lib/types";

export default function CategoryCleanupTool({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const emptyCategories = useMemo(
    () =>
      getHierarchicalCategoryOptions(categories)
        .filter((option) => (option.category.count ?? 0) === 0)
        .map((option) => ({
          ...option,
          children: getDirectChildren(categories, option.category.id)
        })),
    [categories]
  );
  const safeDeleteCount = emptyCategories.filter((item) => item.children.length === 0).length;

  async function createDeleteReview(category: WooCategory) {
    const confirmed = window.confirm(
      `Create a review to delete empty category "${category.name}"? WooCommerce will only be changed after approval.`
    );

    if (!confirmed) {
      return;
    }

    setBusyId(category.id);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/reviews/category-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: category.id })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage(`Delete review created for ${category.name}. Approve it in the Review Queue.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create category delete review.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="category-cleanup-section">
      <div className="category-merge-head">
        <div>
          <h2>Category Cleanup</h2>
          <p className="page-copy">
            List categories with no assigned products. Empty leaf categories can be sent to review
            for deletion; parent categories should be cleaned after their children.
          </p>
        </div>
        <span className="metric">
          <ShieldCheck size={18} />
          <strong>{safeDeleteCount}</strong>
          Safe cleanup
        </span>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {emptyCategories.length === 0 ? (
        <div className="empty panel">No empty categories found.</div>
      ) : (
        <div className="category-cleanup-list">
          {emptyCategories.map((item) => {
            const canDelete = item.children.length === 0;
            const busy = busyId === item.category.id;

            return (
              <article className="category-cleanup-row" key={item.category.id}>
                <div>
                  <strong>{item.path}</strong>
                  <span className="subtle">
                    #{item.category.id} / Parent #{item.category.parent || "none"}
                  </span>
                </div>
                <div>
                  <span className="subtle">Products</span>
                  <strong>{item.category.count ?? 0}</strong>
                </div>
                <div>
                  <span className="subtle">Children</span>
                  <strong>{item.children.length}</strong>
                  <small>{item.children.map((child) => child.name).join(", ") || "None"}</small>
                </div>
                <div className="actions">
                  {canDelete ? (
                    <button
                      className="button danger"
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => createDeleteReview(item.category)}
                    >
                      <Trash2 size={17} />
                      {busy ? "Creating" : "Delete Review"}
                    </button>
                  ) : (
                    <span className="status neutral">Has children</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
