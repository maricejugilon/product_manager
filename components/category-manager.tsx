"use client";

import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { FolderPlus, FolderTree, Image, Link2, Plus, Save, Search } from "lucide-react";

import type { HierarchicalCategoryOption } from "@/lib/category-utils";
import type { CategoryChanges, WooCategory } from "@/lib/types";

function imageSrc(category?: WooCategory) {
  return category?.image?.src ?? "";
}

export default function CategoryManager({
  categories,
  hierarchy
}: {
  categories: WooCategory[];
  hierarchy: HierarchicalCategoryOption[];
}) {
  const [selectedId, setSelectedId] = useState<number | "new">("new");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId),
    [categories, selectedId]
  );
  const selectedOption = useMemo(
    () => hierarchy.find((option) => option.category.id === selectedId),
    [hierarchy, selectedId]
  );
  const visibleCategories = useMemo(() => {
    const query = search.trim().toLowerCase();

    return query
      ? hierarchy.filter((option) =>
          [option.path, option.category.name, option.category.slug, String(option.category.id)]
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      : hierarchy;
  }, [hierarchy, search]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const changes: CategoryChanges = {
      name: String(form.get("name") ?? ""),
      slug: String(form.get("slug") ?? ""),
      description: String(form.get("description") ?? ""),
      display: String(form.get("display") ?? "default"),
      parent: Number(form.get("parent") ?? 0)
    };
    const src = String(form.get("image_src") ?? "").trim();
    if (src) {
      changes.image = { src };
    }

    if (!changes.name?.trim()) {
      setError("Category name is required.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "category",
          action: selectedCategory ? "update" : "create",
          resourceId: selectedCategory?.id,
          changes
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      window.location.assign("/reviews");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create review draft.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="category-editor-section" id="category-editor">
      <div className="category-section-head">
        <div>
          <span className="category-step-label">Main task</span>
          <h2>Create or edit a category</h2>
          <p>Choose a category from the directory, or start a new one. Full paths help distinguish categories with the same name.</p>
        </div>
        <button className="button" type="button" onClick={() => setSelectedId("new")}>
          <FolderPlus size={17} />
          Create category
        </button>
      </div>

      <div className="category-editor-layout">
        <aside className="panel category-directory">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">Category directory</h3>
              <span className="subtle">{visibleCategories.length} of {categories.length} categories</span>
            </div>
            <FolderTree size={18} />
          </div>
          <div className="category-directory-search">
            <Search size={16} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, path, slug, or ID"
              aria-label="Search categories"
            />
          </div>
          <div className="category-directory-list">
            <button
              className={`category-directory-item new ${selectedId === "new" ? "active" : ""}`}
              type="button"
              onClick={() => setSelectedId("new")}
            >
              <span className="category-directory-icon"><Plus size={16} /></span>
              <span>
                <strong>New category</strong>
                <small>Create a new place in the store tree</small>
              </span>
            </button>
            {visibleCategories.map((option) => (
              <button
                key={option.category.id}
                className={`category-directory-item ${selectedId === option.category.id ? "active" : ""}`}
                type="button"
                onClick={() => setSelectedId(option.category.id)}
              >
                <span
                  className="category-directory-depth"
                  style={{ "--category-depth": option.depth } as CSSProperties}
                />
                <span>
                  <strong>{option.category.name}</strong>
                  <small>{option.path}</small>
                </span>
                <span className="category-directory-count">{option.category.count ?? 0}</span>
              </button>
            ))}
            {visibleCategories.length === 0 ? (
              <p className="category-directory-empty">No categories match that search.</p>
            ) : null}
          </div>
        </aside>

        <section className="panel category-edit-panel">
          <div className="panel-head category-edit-head">
            <div>
              <span className="category-step-label">{selectedCategory ? "Editing category" : "Creating category"}</span>
              <h3 className="panel-title">{selectedCategory?.name ?? "New category"}</h3>
              <span className="subtle">
                {selectedOption?.path ?? "Choose where this category belongs in the store."}
              </span>
            </div>
            {selectedCategory ? <span className="status">ID #{selectedCategory.id}</span> : null}
          </div>
          <div className="panel-body">
            {error ? <p className="error">{error}</p> : null}
            <form className="form-grid category-form" key={selectedId} onSubmit={onSubmit}>
              <div className="field wide">
                <label htmlFor="name">Category name</label>
                <input id="name" name="name" defaultValue={selectedCategory?.name ?? ""} placeholder="For example, Lighting Flight Cases" />
                <small>The label shoppers see in menus and category pages.</small>
              </div>
              <div className="field">
                <label htmlFor="slug"><Link2 size={14} /> Web address (slug)</label>
                <input id="slug" name="slug" defaultValue={selectedCategory?.slug ?? ""} placeholder="lighting-flight-cases" />
                <small>Use lowercase words separated by hyphens. Leave blank to let WordPress create it.</small>
              </div>
              <div className="field">
                <label htmlFor="parent">Location in the category tree</label>
                <select id="parent" name="parent" defaultValue={selectedCategory?.parent ?? 0}>
                  <option value="0">Top level - no parent</option>
                  {hierarchy
                    .filter((option) => option.category.id !== selectedCategory?.id)
                    .map((option) => (
                      <option key={option.category.id} value={option.category.id}>
                        {option.path}
                      </option>
                    ))}
                </select>
                <small>Select the category that should appear directly above this one.</small>
              </div>
              <div className="field">
                <label htmlFor="display">Category page shows</label>
                <select id="display" name="display" defaultValue={selectedCategory?.display ?? "default"}>
                  <option value="default">Use store default</option>
                  <option value="products">Products only</option>
                  <option value="subcategories">Subcategories only</option>
                  <option value="both">Products and subcategories</option>
                </select>
                <small>Controls what shoppers see when they open this category.</small>
              </div>
              <div className="field">
                <label htmlFor="image_src"><Image size={14} /> Category image URL</label>
                <input id="image_src" name="image_src" defaultValue={imageSrc(selectedCategory)} placeholder="https://..." />
                <small>Optional image used by supported category layouts.</small>
              </div>
              <div className="field wide">
                <label htmlFor="description">Description</label>
                <textarea id="description" name="description" defaultValue={selectedCategory?.description ?? ""} placeholder="Explain what products belong in this category." />
              </div>
              <div className="category-review-note wide">
                <strong>Next step: Review Queue</strong>
                <span>Saving creates a draft. The category will not change in WooCommerce until the review is approved.</span>
              </div>
              <div className="actions wide">
                <button className="button" type="submit" disabled={submitting}>
                  <Save size={17} />
                  {submitting ? "Creating review" : selectedCategory ? "Review category changes" : "Review new category"}
                </button>
                {selectedCategory ? (
                  <button className="button secondary" type="button" onClick={() => setSelectedId("new")}>
                    <Plus size={17} />
                    Start a new category
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      </div>
    </section>
  );
}
