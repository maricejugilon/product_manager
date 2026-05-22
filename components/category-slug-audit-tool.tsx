"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Link2, ShieldAlert } from "lucide-react";

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

      return {
        key,
        name,
        expectedSlug,
        categories: [...groupCategories].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.id - b.id),
        canonical,
        suggestedTarget: canonical ?? bestTarget(groupCategories),
        slugOwner: bySlug.get(expectedSlug)
      };
    })
    .filter((group) => {
      const hasSlugMismatch = group.categories.some((category) => category.slug !== group.expectedSlug);
      const hasDuplicateName = group.categories.length > 1;

      return hasSlugMismatch || hasDuplicateName;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function CategorySlugAuditTool({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const groups = useMemo(() => buildSlugAuditGroups(categories), [categories]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const mergeableCount = groups.reduce(
    (total, group) =>
      total +
      (group.canonical
        ? group.categories.filter((category) => category.id !== group.canonical?.id).length
        : 0),
    0
  );

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
          <h2>Category Slug Audit</h2>
          <p className="page-copy">
            Find categories whose slug does not match the category name. If duplicates exist, merge
            into the category that already uses the expected slug.
          </p>
        </div>
        <span className="metric">
          <ShieldAlert size={18} />
          <strong>{mergeableCount}</strong>
          Merge candidates
        </span>
      </div>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {groups.length === 0 ? (
        <div className="empty panel">All category slugs match their category names.</div>
      ) : (
        <div className="slug-audit-groups">
          {groups.map((group) => {
            const slugOwnerIsOutsideGroup =
              group.slugOwner && !group.categories.some((category) => category.id === group.slugOwner?.id);

            return (
              <article className="slug-audit-card" key={group.key}>
                <div className="slug-audit-card-head">
                  <div>
                    <h3>{group.name}</h3>
                    <span className="subtle">
                      Expected slug: <strong>{group.expectedSlug || "empty-slug"}</strong>
                    </span>
                  </div>
                  {group.canonical ? (
                    <span className="status approved">Correct slug target #{group.canonical.id}</span>
                  ) : slugOwnerIsOutsideGroup ? (
                    <span className="status failed">Slug used by #{group.slugOwner?.id}</span>
                  ) : (
                    <span className="status pending">Needs slug target</span>
                  )}
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
                          <span className="subtle">#{category.id}</span>
                        </div>
                        <div>
                          <span className="subtle">Current slug</span>
                          <strong>{category.slug || "No slug"}</strong>
                        </div>
                        <div>
                          <span className="subtle">Products / children</span>
                          <strong>
                            {category.count ?? 0} / {children.length}
                          </strong>
                        </div>
                        <div className="actions">
                          {isCanonical ? (
                            <span className="status approved">Keep</span>
                          ) : canMerge && group.canonical ? (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => createMergeReview(category, group.canonical as WooCategory)}
                            >
                              <GitMerge size={17} />
                              {busy ? "Creating" : "Merge Review"}
                            </button>
                          ) : canFixSlug ? (
                            <button
                              className="button secondary"
                              type="button"
                              disabled={busyKey !== null}
                              onClick={() => createSlugReview(category, group.expectedSlug)}
                            >
                              <Link2 size={17} />
                              {busy ? "Creating" : "Fix Slug Review"}
                            </button>
                          ) : unsafeParentIntoChild ? (
                            <span className="status failed">Parent of target</span>
                          ) : slugOwnerIsOutsideGroup ? (
                            <span className="status failed">Slug conflict</span>
                          ) : (
                            <span className="status neutral">Waiting target</span>
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
      )}
    </section>
  );
}
