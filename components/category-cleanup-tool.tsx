"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, FolderTree, Search, ShieldCheck, Trash2 } from "lucide-react";

import { getDirectChildren, getHierarchicalCategoryOptions } from "@/lib/category-utils";
import type { WooCategory } from "@/lib/types";

export default function CategoryCleanupTool({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"ready" | "parents" | "all">("ready");
  const [page, setPage] = useState(1);
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
  const parentCount = emptyCategories.length - safeDeleteCount;
  const visibleCategories = useMemo(() => {
    const query = search.trim().toLowerCase();

    return emptyCategories.filter((item) => {
      const matchesSearch =
        !query ||
        item.path.toLowerCase().includes(query) ||
        item.category.slug.toLowerCase().includes(query);
      const matchesView =
        view === "all" ||
        (view === "ready" && item.children.length === 0) ||
        (view === "parents" && item.children.length > 0);

      return matchesSearch && matchesView;
    });
  }, [emptyCategories, search, view]);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(visibleCategories.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedCategories = visibleCategories.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, view]);

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
          <h2>Unused categories</h2>
          <p className="page-copy">
            These categories contain no products. Categories without subcategories can be safely
            sent for removal. Parent categories must wait until their subcategories are handled.
          </p>
        </div>
        <div className="metrics">
          <span className="metric">
            <ShieldCheck size={18} />
            <strong>{safeDeleteCount}</strong>
            Ready to remove
          </span>
          <span className="metric">
            <FolderTree size={18} />
            <strong>{parentCount}</strong>
            Need subcategories first
          </span>
        </div>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {emptyCategories.length === 0 ? (
        <div className="empty panel">No empty categories found.</div>
      ) : (
        <>
          <div className="cleanup-list-toolbar">
            <label className="cleanup-search">
              <Search size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search unused categories"
              />
            </label>
            <div className="cleanup-view-tabs" aria-label="Unused category filters">
              {[
                ["ready", `Ready to remove (${safeDeleteCount})`],
                ["parents", `Has subcategories (${parentCount})`],
                ["all", `All (${emptyCategories.length})`]
              ].map(([value, label]) => (
                <button
                  className={view === value ? "active" : ""}
                  key={value}
                  type="button"
                  onClick={() => setView(value as typeof view)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visibleCategories.length === 0 ? (
            <div className="empty panel">No unused categories match this view.</div>
          ) : (
          <>
          <div className="category-cleanup-list">
          {pagedCategories.map((item) => {
            const canDelete = item.children.length === 0;
            const busy = busyId === item.category.id;

            return (
              <article className="category-cleanup-row" key={item.category.id}>
                <div>
                  <strong>{item.path}</strong>
                  <span className="subtle">Web address: /product-category/{item.category.slug || "no-address"}</span>
                </div>
                <div>
                  <span className="subtle">Why it is listed</span>
                  <strong>No products assigned</strong>
                </div>
                <div>
                  <span className="subtle">What happens next</span>
                  {canDelete ? (
                    <small>This category can be removed after review approval.</small>
                  ) : (
                    <>
                      <strong>{item.children.length} subcategories</strong>
                      <small>{item.children.map((child) => child.name).join(", ")}</small>
                    </>
                  )}
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
                      {busy ? "Creating review" : "Review removal"}
                    </button>
                  ) : (
                    <span className="cleanup-blocked">
                      <AlertCircle size={16} />
                      Handle subcategories first
                    </span>
                  )}
                </div>
              </article>
            );
          })}
          </div>
          {totalPages > 1 ? (
            <div className="cleanup-pager">
              <span className="subtle">
                Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, visibleCategories.length)} of{" "}
                {visibleCategories.length}
              </span>
              <div>
                <button
                  className="icon-button secondary"
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  title="Previous page"
                >
                  <ChevronLeft size={17} />
                </button>
                <strong>{safePage} / {totalPages}</strong>
                <button
                  className="icon-button secondary"
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  title="Next page"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          ) : null}
          </>
          )}
        </>
      )}
    </section>
  );
}
