"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, GitMerge, Globe2, Link2, Search } from "lucide-react";

import {
  getCategoryPath,
  getDirectChildren,
  isCategoryAncestor,
  normalizeCategoryName,
  slugFromCategoryName
} from "@/lib/category-utils";
import type { WooCategory } from "@/lib/types";

type SlugAuditGroup = {
  key: string;
  name: string;
  expectedSlug: string;
  categories: WooCategory[];
  needsFix: boolean;
  hasDuplicateName: boolean;
  hasAddressMismatch: boolean;
  canonical?: WooCategory;
  suggestedTarget?: WooCategory;
  slugOwner?: WooCategory;
};

function bestTarget(categories: WooCategory[]) {
  return [...categories].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.id - b.id)[0];
}

function buildSlugAuditGroups(categories: WooCategory[]) {
  const byName = new Map<string, WooCategory[]>();
  const bySlug = new Map(categories.map((category) => [category.slug, category]));

  for (const category of categories) {
    const key = normalizeCategoryName(category.name);

    if (!key) {
      continue;
    }

    byName.set(key, [...(byName.get(key) ?? []), category]);
  }

  return [...byName.entries()]
    .map(([key, groupCategories]): SlugAuditGroup => {
      const name = groupCategories[0].name;
      const expectedSlug = slugFromCategoryName(name);
      const canonical = groupCategories.find((category) => category.slug === expectedSlug);
      const hasAddressMismatch = groupCategories.some((category) => category.slug !== expectedSlug);
      const hasDuplicateName = groupCategories.length > 1;

      return {
        key,
        name,
        expectedSlug,
        categories: [...groupCategories].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.id - b.id),
        needsFix: hasAddressMismatch || hasDuplicateName,
        hasDuplicateName,
        hasAddressMismatch,
        canonical,
        suggestedTarget: canonical ?? bestTarget(groupCategories),
        slugOwner: bySlug.get(expectedSlug)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function CategorySlugAuditTool({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const groups = useMemo(() => buildSlugAuditGroups(categories), [categories]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"incorrect" | "correct" | "duplicates" | "addresses" | "all">("incorrect");
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups.find((group) => group.needsFix) ? [groups.find((group) => group.needsFix)!.key] : [])
  );
  const incorrectGroups = groups.filter((group) => group.needsFix);
  const correctGroups = groups.filter((group) => !group.needsFix);
  const mergeableCount = incorrectGroups.reduce(
    (total, group) =>
      total +
      (group.canonical
        ? group.categories.filter((category) => category.id !== group.canonical?.id).length
        : 0),
    0
  );
  const webAddressFixCount = incorrectGroups.filter(
    (group) =>
      !group.canonical &&
      (!group.slugOwner || group.categories.some((category) => category.id === group.slugOwner?.id))
  ).length;
  const duplicateGroupCount = incorrectGroups.filter((group) => group.hasDuplicateName).length;
  const addressGroupCount = incorrectGroups.filter((group) => !group.hasDuplicateName && group.hasAddressMismatch).length;
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();

    return groups.filter((group) => {
      const matchesView =
        view === "all" ||
        (view === "incorrect" && group.needsFix) ||
        (view === "correct" && !group.needsFix) ||
        (view === "duplicates" && group.needsFix && group.hasDuplicateName) ||
        (view === "addresses" && group.needsFix && !group.hasDuplicateName && group.hasAddressMismatch);
      const matchesSearch =
        !query ||
        [
            group.name,
            group.expectedSlug,
            ...group.categories.flatMap((category) => [
              category.name,
              category.slug,
              getCategoryPath(categories, category.id)
            ])
          ]
            .join(" ")
            .toLowerCase()
            .includes(query);

      return matchesView && matchesSearch;
    });
  }, [categories, groups, search, view]);

  useEffect(() => {
    if (visibleGroups[0]) {
      setOpenGroups((current) => new Set([...current, visibleGroups[0].key]));
    }
  }, [visibleGroups]);

  async function createSlugReview(category: WooCategory, expectedSlug: string) {
    const confirmed = window.confirm(
      `Create a review to change "${category.name}" slug from "${category.slug}" to "${expectedSlug}"?`
    );

    if (!confirmed) {
      return;
    }

    setBusyKey(`slug-${category.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "category",
          action: "update",
          resourceId: category.id,
          changes: {
            slug: expectedSlug
          }
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage(`Slug fix review created for ${category.name}. Approve it in the Review Queue.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create slug fix review.");
    } finally {
      setBusyKey(null);
    }
  }

  async function createMergeReview(source: WooCategory, target: WooCategory) {
    const confirmed = window.confirm(
      `Create a review to merge "${source.name}" #${source.id} into correct-slug category #${target.id}?`
    );

    if (!confirmed) {
      return;
    }

    setBusyKey(`merge-${source.id}-${target.id}`);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/reviews/category-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, targetId: target.id })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      setMessage(`Merge review created for ${source.name} #${source.id}. Approve it in the Review Queue.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create category merge review.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="category-slug-audit-section">
      <div className="category-merge-head">
        <div>
          <h2>Duplicate names and web addresses</h2>
          <p className="page-copy">
            Fix category web addresses that do not match their names. When the same category name
            exists more than once, keep the correct one and merge the duplicate.
          </p>
        </div>
        <div className="metrics">
          <span className="metric">
            <GitMerge size={18} />
            <strong>{mergeableCount}</strong>
            Duplicates to merge
          </span>
          <span className="metric">
            <Globe2 size={18} />
            <strong>{webAddressFixCount}</strong>
            Addresses to correct
          </span>
        </div>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {groups.length === 0 ? (
        <div className="empty panel">No categories found.</div>
      ) : (
        <>
          <div className="cleanup-list-toolbar">
            <label className="cleanup-search">
              <Search size={17} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search category name or web address"
              />
            </label>
            <div className="cleanup-view-tabs" aria-label="Category problem filters">
              {[
                ["incorrect", `Needs fixing (${incorrectGroups.length})`],
                ["correct", `Correct (${correctGroups.length})`],
                ["duplicates", `Duplicate names (${duplicateGroupCount})`],
                ["addresses", `Web addresses (${addressGroupCount})`],
                ["all", `All (${groups.length})`]
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

          {visibleGroups.length === 0 ? (
            <div className="empty panel">No category problems match this search.</div>
          ) : (
          <div className="slug-audit-groups">
          {visibleGroups.map((group) => {
            const slugOwnerIsOutsideGroup =
              group.slugOwner && !group.categories.some((category) => category.id === group.slugOwner?.id);
            const problemLabel =
              !group.needsFix
                ? "Category name and web address are correct"
                : group.categories.length > 1
                ? `${group.categories.length} categories use this name`
                : "Web address does not match the name";

            return (
              <details
                className="slug-audit-card cleanup-problem-card"
                key={group.key}
                open={openGroups.has(group.key)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  setOpenGroups((current) => {
                    const next = new Set(current);
                    if (isOpen) next.add(group.key);
                    else next.delete(group.key);
                    return next;
                  });
                }}
              >
                <summary className="cleanup-problem-summary">
                  <div className="cleanup-problem-title">
                    <ChevronDown className="cleanup-problem-chevron" size={18} />
                    <div>
                      <h3>{group.name}</h3>
                      <span className="subtle">{problemLabel}</span>
                    </div>
                  </div>
                  {!group.needsFix ? (
                    <span className="status approved">
                      <CheckCircle2 size={14} />
                      Correct category
                    </span>
                  ) : group.canonical ? (
                    <span className="status approved">
                      <CheckCircle2 size={14} />
                      Correct category found
                    </span>
                  ) : slugOwnerIsOutsideGroup ? (
                    <span className="status failed">Web address already used</span>
                  ) : (
                    <span className="status pending">Address needs correction</span>
                  )}
                </summary>

                <div className="cleanup-address-guide">
                  <span>Recommended web address</span>
                  <strong>/product-category/{group.expectedSlug || "category"}</strong>
                  <small>
                    {group.canonical
                      ? group.needsFix
                        ? "The category with this address will be kept."
                        : "This category name and web address already match."
                      : "A review can correct the selected category to this address."}
                  </small>
                </div>

                <div className="slug-audit-list">
                  {group.categories.map((category) => {
                    const isCanonical = category.id === group.canonical?.id;
                    const isSuggestedTarget = category.id === group.suggestedTarget?.id;
                    const children = getDirectChildren(categories, category.id);
                    const canMerge =
                      group.canonical &&
                      !isCanonical &&
                      !isCategoryAncestor(categories, category.id, group.canonical.id);
                    const canFixSlug =
                      !group.canonical &&
                      !slugOwnerIsOutsideGroup &&
                      isSuggestedTarget &&
                      category.slug !== group.expectedSlug;
                    const unsafeParentIntoChild =
                      group.canonical && !isCanonical && isCategoryAncestor(categories, category.id, group.canonical.id);
                    const busy =
                      busyKey === `slug-${category.id}` ||
                      (group.canonical ? busyKey === `merge-${category.id}-${group.canonical.id}` : false);

                    return (
                      <div className={`slug-audit-row ${isCanonical ? "target" : ""}`} key={category.id}>
                        <div>
                          <strong>{getCategoryPath(categories, category.id)}</strong>
                          <span className="subtle">{category.count ?? 0} products / {children.length} subcategories</span>
                        </div>
                        <div>
                          <span className="subtle">Current web address</span>
                          <strong>/product-category/{category.slug || "no-address"}</strong>
                        </div>
                        <div>
                          <span className="subtle">What will happen</span>
                          <small>
                            {!group.needsFix
                              ? "This category is correctly set up. No changes are needed."
                              : isCanonical
                                ? "This is the category that will remain."
                              : canMerge
                                ? `Products and subcategories move into "${group.canonical?.name}", then this duplicate is removed.`
                                : canFixSlug
                                  ? "Only the category web address will be corrected."
                                  : unsafeParentIntoChild
                                    ? "Cannot merge a parent into its own subcategory."
                                    : slugOwnerIsOutsideGroup
                                      ? "Another category already owns the recommended address."
                                      : "Choose or create a correct category before merging."}
                          </small>
                        </div>
                        <div className="actions">
                          {!group.needsFix ? (
                            <span className="status approved">No changes needed</span>
                          ) : isCanonical ? (
                            <span className="status approved">Keep this category</span>
                          ) : canMerge && group.canonical ? (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => createMergeReview(category, group.canonical as WooCategory)}
                            >
                              <GitMerge size={17} />
                              {busy ? "Creating review" : "Review merge"}
                            </button>
                          ) : canFixSlug ? (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => createSlugReview(category, group.expectedSlug)}
                            >
                              <Link2 size={17} />
                              {busy ? "Creating review" : "Review address fix"}
                            </button>
                          ) : unsafeParentIntoChild ? (
                            <span className="status failed">Unsafe merge</span>
                          ) : slugOwnerIsOutsideGroup ? (
                            <span className="status failed">Address conflict</span>
                          ) : (
                            <span className="status neutral">No safe action yet</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
          </div>
          )}
        </>
      )}
    </section>
  );
}
