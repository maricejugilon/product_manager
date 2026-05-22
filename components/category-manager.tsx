"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Layers3, Plus, Save } from "lucide-react";

import type { CategoryChanges, WooCategory } from "@/lib/types";

function imageSrc(category?: WooCategory) {
  return category?.image?.src ?? "";
}

export default function CategoryManager({ categories }: { categories: WooCategory[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<number | "new">("new");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId),
    [categories, selectedId]
  );

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

      router.push("/reviews");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create review draft.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="editor-shell">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{selectedCategory ? "Edit Category" : "New Category"}</h2>
          <Layers3 size={18} />
        </div>
        <div className="panel-body">
          {error ? <p className="error">{error}</p> : null}
          <form className="form-grid" key={selectedId} onSubmit={onSubmit}>
            <div className="field wide">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" defaultValue={selectedCategory?.name ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="slug">Slug</label>
              <input id="slug" name="slug" defaultValue={selectedCategory?.slug ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="parent">Parent</label>
              <select id="parent" name="parent" defaultValue={selectedCategory?.parent ?? 0}>
                <option value="0">No parent</option>
                {categories
                  .filter((category) => category.id !== selectedCategory?.id)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="display">Display</label>
              <select id="display" name="display" defaultValue={selectedCategory?.display ?? "default"}>
                <option value="default">Default</option>
                <option value="products">Products</option>
                <option value="subcategories">Subcategories</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="image_src">Image URL</label>
              <input id="image_src" name="image_src" defaultValue={imageSrc(selectedCategory)} />
            </div>
            <div className="field wide">
              <label htmlFor="description">Description</label>
              <textarea id="description" name="description" defaultValue={selectedCategory?.description ?? ""} />
            </div>
            <div className="actions wide">
              <button className="button" type="submit" disabled={submitting}>
                <Save size={17} />
                {submitting ? "Saving" : "Send to Review"}
              </button>
              <button className="button secondary" type="button" onClick={() => setSelectedId("new")}>
                <Plus size={17} />
                New category
              </button>
            </div>
          </form>
        </div>
      </section>

      <aside className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Existing Categories</h2>
        </div>
        <div className="panel-body sidebar-list">
          {categories.map((category) => (
            <button
              key={category.id}
              className="button secondary"
              type="button"
              onClick={() => setSelectedId(category.id)}
            >
              {category.name}
              <span className="subtle">({category.count ?? 0})</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
