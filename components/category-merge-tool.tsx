"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, GitMerge, ShieldCheck } from "lucide-react";

import {
  getCategoryLabel,
  getCategoryPath,
  getDirectChildren,
  getHierarchicalCategoryOptions,
  isCategoryAncestor,
  normalizeCategoryName
} from "@/lib/category-utils";
import type { WooCategory } from "@/lib/types";

type DuplicateGroup = {
  key: string;
  name: string;
  categories: WooCategory[];
};

function duplicateGroups(categories: WooCategory[]) {
  const groups = new Map<string, WooCategory[]>();

  for (const category of categories) {
    const key = normalizeCategoryName(category.name);

    if (!key) {
      continue;
    }

    groups.set(key, [...(groups.get(key) ?? []), category]);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]): DuplicateGroup => ({
      key,
      name: items[0].name,
      categories: [...items].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.id - b.id)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultTargetId(categories: WooCategory[]) {
  return [...categories].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.parent - b.parent || a.id - b.id)[0].id;
}

export default function CategoryMergeTool({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const groups = useMemo(() => duplicateGroups(categories), [categories]);
  const hierarchyOptions = useMemo(() => getHierarchicalCategoryOptions(categories), [categories]);
  const hierarchyById = useMemo(
    () => new Map(hierarchyOptions.map((option) => [option.category.id, option])),
    [hierarchyOptions]
  );
  const duplicateCategoryOptions = useMemo(
    () =>
      hierarchyOptions.filter((option) =>
        groups.some((group) => group.key === normalizeCategoryName(option.category.name))
      ),
    [groups, hierarchyOptions]
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | "all">("all");
  const [targetByGroup, setTargetByGroup] = useState<Record<string, number>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const selectedGroupKey =
    selectedCategoryId === "all"
      ? null
      : normalizeCategoryName(categories.find((category) => category.id === selectedCategoryId)?.name ?? "");
  const visibleGroups = selectedGroupKey ? groups.filter((group) => group.key === selectedGroupKey) : groups;
  const pageSize = 10;
  const totalPages = selectedGroupKey ? 1 : Math.max(1, Math.ceil(visibleGroups.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedGroups = selectedGroupKey
    ? visibleGroups
    : visibleGroups.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [selectedCategoryId]);

  function hierarchyLabel(category: WooCategory) {
    return hierarchyById.get(category.id)?.path ?? getCategoryPath(categories, category.id);
  }

  async function createMergeReview(group: DuplicateGroup, sourceId: number) {
    const targetId = targetByGroup[group.key] ?? defaultTargetId(group.categories);
    const source = group.categories.find((category) => category.id === sourceId);
    const target = group.categories.find((category) => category.id === targetId);

    if (!source || !target) {
      setError("Source or target category was not found.");
      return;
    }

    const confirmed = window.confirm(
      `Create a review to merge category #${source.id} into #${target.id}? Approval will move products and child categories before deleting the duplicate.`
    );

    if (!confirmed) {
      return;
    }

    setBusyKey(`${group.key}-${sourceId}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/reviews/category-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage(`Merge review created for ${source.name} #${source.id}. Approve it in the Review Queue.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create merge review.");
    } finally {
      setBusyKey(null);
    }
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="category-merge-section" id="category-duplicates">
      <div className="category-section-head">
        <div>
          <span className="category-step-label">Maintenance task</span>
          <h2>Resolve duplicate category names</h2>
          <p>Compare the full paths before choosing which category stays. Products and child categories move to the kept category after approval.</p>
        </div>
        <div className="category-merge-actions">
          <div className="field category-merge-select">
            <label htmlFor="duplicate-category">Find a duplicate group</label>
            <select
              id="duplicate-category"
              value={String(selectedCategoryId)}
              onChange={(event) =>
                setSelectedCategoryId(event.target.value === "all" ? "all" : Number(event.target.value))
              }
            >
              <option value="all">All duplicate categories</option>
              {duplicateCategoryOptions.map((option) => (
                <option key={option.category.id} value={option.category.id}>
                  {option.path} (#{option.category.id})
                </option>
              ))}
            </select>
          </div>
          <span className="metric">
            <ShieldCheck size={18} />
            <strong>{groups.length}</strong>
            Duplicate names
          </span>
        </div>
      </div>

      <div className="category-merge-warning">
        <AlertTriangle size={18} />
        <span><strong>Names can match without being duplicates.</strong> Check the hierarchy, products, and child categories before creating a merge review.</span>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="duplicate-groups">
        {pagedGroups.map((group) => {
          const targetId = targetByGroup[group.key] ?? defaultTargetId(group.categories);

          return (
            <article className="duplicate-card" key={group.key}>
              <div className="duplicate-card-head">
                <div>
                  <h3>{group.name}</h3>
                  <span className="subtle">{group.categories.length} categories share this name</span>
                </div>
                <div className="field">
                  <label htmlFor={`target-${group.key}`}>Category to keep</label>
                  <select
                    id={`target-${group.key}`}
                    value={targetId}
                    onChange={(event) =>
                      setTargetByGroup((current) => ({
                        ...current,
                        [group.key]: Number(event.target.value)
                      }))
                    }
                  >
                    {group.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {hierarchyLabel(category)} (#{category.id}, {category.count ?? 0} products)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="duplicate-compare">
                {group.categories.map((category) => {
                  const children = getDirectChildren(categories, category.id);
                  const isTarget = category.id === targetId;
                  const unsafeParentIntoChild = isCategoryAncestor(categories, category.id, targetId);
                  const busy = busyKey === `${group.key}-${category.id}`;

                  return (
                    <div className={`duplicate-row ${isTarget ? "target" : ""}`} key={category.id}>
                      <div>
                        <strong>
                          #{category.id} {category.name}
                        </strong>
                        <span className="subtle">Hierarchy: {hierarchyLabel(category)}</span>
                        <span className="subtle">Parent: {getCategoryLabel(categories, category.parent)}</span>
                      </div>
                      <div>
                        <span className="subtle">Products</span>
                        <strong>{category.count ?? 0}</strong>
                      </div>
                      <div>
                        <span className="subtle">Children</span>
                        <strong>{children.length}</strong>
                        <small>{children.map((child) => hierarchyLabel(child)).join(", ") || "None"}</small>
                      </div>
                      <div className="actions">
                        {isTarget ? (
                          <span className="status approved">Will be kept</span>
                        ) : (
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busyKey !== null || unsafeParentIntoChild}
                            title={
                              unsafeParentIntoChild
                                ? "Choose the parent category as the target before merging this pair."
                                : "Create merge review"
                            }
                            onClick={() => createMergeReview(group, category.id)}
                          >
                            <GitMerge size={17} />
                            {busy ? "Creating review" : "Merge into kept category"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>

      {!selectedGroupKey && visibleGroups.length > pageSize ? (
        <div className="category-merge-pagination">
          <span>
            Showing {(safePage - 1) * pageSize + 1}-{Math.min(safePage * pageSize, visibleGroups.length)} of {visibleGroups.length} duplicate names
          </span>
          <button
            className="icon-button secondary"
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            aria-label="Previous duplicate categories page"
          >
            <ChevronLeft size={17} />
          </button>
          <strong>{safePage} / {totalPages}</strong>
          <button
            className="icon-button secondary"
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            aria-label="Next duplicate categories page"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
