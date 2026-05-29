"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Edit3, FolderPlus, PackagePlus, StickyNote } from "lucide-react";

import ProgressBar from "@/components/progress-bar";
import { getHierarchicalCategoryOptions } from "@/lib/category-utils";
import type { WooCategory, WooProductCategory } from "@/lib/types";

type ProductListItem = {
  id: number;
  name: string;
  sku: string;
  price: string;
  status: string;
  stock_status: "instock" | "outofstock" | "onbackorder";
  manage_stock: boolean;
  stock_quantity: number | null;
  customNotes: boolean;
  categories: WooProductCategory[];
  image: string;
  reviewCount: number;
};

type BulkStockResponse = {
  created: number;
  skipped: number;
  reviewIds: string[];
};

type BulkCategoryResponse = BulkStockResponse;
type BulkCustomNotesResponse = BulkStockResponse;

export default function ProductBulkTable({
  products,
  categories
}: {
  products: ProductListItem[];
  categories: WooCategory[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; label: string } | null>(null);

  const allVisibleSelected = products.length > 0 && selectedIds.length === products.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const categoryOptions = useMemo(() => getHierarchicalCategoryOptions(categories), [categories]);

  function toggleAll() {
    setSelectedIds(allVisibleSelected ? [] : products.map((product) => product.id));
  }

  function toggleProduct(id: number) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function onBulkStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (selectedIds.length === 0) {
      setError("Select at least one product first.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const quantityRaw = String(form.get("quantity") ?? "").trim();
    const status = String(form.get("stock_status") ?? "keep");
    const manageStock = form.get("manage_stock") === "on";

    if (!quantityRaw && status === "keep" && !manageStock) {
      setError("Choose a stock quantity, stock status, or stock tracking change.");
      return;
    }

    setSubmitting(true);
    const productIds = [...selectedIds];
    setProgress({ current: 0, total: productIds.length, label: "Creating stock review drafts" });

    try {
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const [index, productId] of productIds.entries()) {
        const response = await fetch("/api/reviews/bulk-stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: [productId],
            mode: form.get("mode"),
            quantity: quantityRaw || null,
            stockStatus: status,
            manageStock
          })
        });
        const text = await response.text();
        const result = text ? (JSON.parse(text) as BulkStockResponse & { error?: string }) : undefined;

        if (response.ok && result) {
          created += result.created;
          skipped += result.skipped;
        } else {
          failed += 1;
        }

        setProgress({
          current: index + 1,
          total: productIds.length,
          label: "Creating stock review drafts"
        });
      }

      if (failed === 0) {
        setSelectedIds([]);
      }

      setMessage(
        `Created ${created} stock review draft${created === 1 ? "" : "s"}${
          skipped ? `, skipped ${skipped} unchanged product${skipped === 1 ? "" : "s"}` : ""
        }${failed ? `, ${failed} failed` : ""}.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create bulk stock reviews.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  async function onBulkCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (selectedIds.length === 0) {
      setError("Select at least one product first.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const categoryId = String(form.get("category_id") ?? "");
    const mode = String(form.get("category_mode") ?? "add");

    if (!categoryId) {
      setError("Choose a category first.");
      return;
    }

    setSubmitting(true);
    const productIds = [...selectedIds];
    setProgress({ current: 0, total: productIds.length, label: "Creating category review drafts" });

    try {
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const [index, productId] of productIds.entries()) {
        const response = await fetch("/api/reviews/bulk-category", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: [productId],
            categoryId,
            mode
          })
        });
        const text = await response.text();
        const result = text ? (JSON.parse(text) as BulkCategoryResponse & { error?: string }) : undefined;

        if (response.ok && result) {
          created += result.created;
          skipped += result.skipped;
        } else {
          failed += 1;
        }

        setProgress({
          current: index + 1,
          total: productIds.length,
          label: "Creating category review drafts"
        });
      }

      if (failed === 0) {
        setSelectedIds([]);
      }

      setMessage(
        `Created ${created} category review draft${created === 1 ? "" : "s"}${
          skipped ? `, skipped ${skipped} unchanged product${skipped === 1 ? "" : "s"}` : ""
        }${failed ? `, ${failed} failed` : ""}.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create bulk category reviews.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  async function onBulkCustomNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (selectedIds.length === 0) {
      setError("Select at least one product first.");
      return;
    }

    const form = new FormData(event.currentTarget);
    const customNotes = String(form.get("custom_notes") ?? "") === "yes";

    setSubmitting(true);
    const productIds = [...selectedIds];
    setProgress({ current: 0, total: productIds.length, label: "Creating custom notes review drafts" });

    try {
      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const [index, productId] of productIds.entries()) {
        const response = await fetch("/api/reviews/bulk-custom-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: [productId],
            customNotes
          })
        });
        const text = await response.text();
        const result = text ? (JSON.parse(text) as BulkCustomNotesResponse & { error?: string }) : undefined;

        if (response.ok && result) {
          created += result.created;
          skipped += result.skipped;
        } else {
          failed += 1;
        }

        setProgress({
          current: index + 1,
          total: productIds.length,
          label: "Creating custom notes review drafts"
        });
      }

      if (failed === 0) {
        setSelectedIds([]);
      }

      setMessage(
        `Created ${created} custom notes review draft${created === 1 ? "" : "s"}${
          skipped ? `, skipped ${skipped} unchanged product${skipped === 1 ? "" : "s"}` : ""
        }${failed ? `, ${failed} failed` : ""}.`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create bulk custom notes reviews.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <>
      <form className="bulk-stock-bar" onSubmit={onBulkStock}>
        <div className="bulk-stock-title">
          <Boxes size={18} />
          <div>
            <strong>{selectedIds.length} selected</strong>
            <span className="subtle">Create review drafts for bulk stock changes</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bulk-mode">Quantity mode</label>
          <select id="bulk-mode" name="mode" defaultValue="add">
            <option value="add">Add to current stock</option>
            <option value="set">Set exact stock</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bulk-quantity">Quantity</label>
          <input id="bulk-quantity" name="quantity" min="0" step="1" type="number" placeholder="e.g. 25" />
        </div>
        <div className="field">
          <label htmlFor="bulk-stock-status">Stock status</label>
          <select id="bulk-stock-status" name="stock_status" defaultValue="keep">
            <option value="keep">Keep current</option>
            <option value="instock">In stock</option>
            <option value="outofstock">Out of stock</option>
            <option value="onbackorder">On backorder</option>
          </select>
        </div>
        <label className="checkbox-field compact">
          <input name="manage_stock" type="checkbox" defaultChecked />
          Track stock
        </label>
        <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
          <PackagePlus size={17} />
          {submitting ? "Creating" : "Create Reviews"}
        </button>
      </form>

      <form className="bulk-category-bar" onSubmit={onBulkCategory}>
        <div className="bulk-stock-title">
          <FolderPlus size={18} />
          <div>
            <strong>{selectedIds.length} selected</strong>
            <span className="subtle">Create review drafts for bulk category assignment</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bulk-category-mode">Category mode</label>
          <select id="bulk-category-mode" name="category_mode" defaultValue="add">
            <option value="add">Add selected category</option>
            <option value="set">Replace with category</option>
            <option value="remove">Remove selected category</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="bulk-category-id">Category</label>
          <select id="bulk-category-id" name="category_id" defaultValue="">
            <option value="">Choose category</option>
            {categoryOptions.map((option) => (
              <option key={option.category.id} value={option.category.id}>
                {option.path}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
          <FolderPlus size={17} />
          {submitting ? "Creating" : "Create Category Reviews"}
        </button>
      </form>

      <form className="bulk-custom-notes-bar" onSubmit={onBulkCustomNotes}>
        <div className="bulk-stock-title">
          <StickyNote size={18} />
          <div>
            <strong>{selectedIds.length} selected</strong>
            <span className="subtle">Create review drafts for the ACF custom notes toggle</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bulk-custom-notes">Custom notes</label>
          <select id="bulk-custom-notes" name="custom_notes" defaultValue="yes">
            <option value="yes">Set to Yes</option>
            <option value="no">Set to No</option>
          </select>
        </div>
        <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
          <StickyNote size={17} />
          {submitting ? "Creating" : "Create Custom Notes Reviews"}
        </button>
      </form>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {progress ? <ProgressBar {...progress} /> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="select-col">
                <input
                  aria-label="Select all visible products"
                  checked={allVisibleSelected}
                  disabled={products.length === 0 || submitting}
                  type="checkbox"
                  onChange={toggleAll}
                />
              </th>
              <th>Product</th>
              <th>SKU</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Categories</th>
              <th>Custom notes</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className={selectedSet.has(product.id) ? "selected-row" : undefined}>
                <td className="select-col">
                  <input
                    aria-label={`Select ${product.name}`}
                    checked={selectedSet.has(product.id)}
                    disabled={submitting}
                    type="checkbox"
                    onChange={() => toggleProduct(product.id)}
                  />
                </td>
                <td>
                  <div className="product-cell">
                    {product.image ? (
                      <img className="thumb" src={product.image} alt="" />
                    ) : (
                      <span className="thumb" aria-hidden />
                    )}
                    <div>
                      <span className="name">{product.name}</span>
                      <span className="subtle">ID {product.id}</span>
                    </div>
                  </div>
                </td>
                <td>{product.sku || <span className="subtle">No SKU</span>}</td>
                <td>{product.price ? `GBP ${product.price}` : <span className="subtle">No price</span>}</td>
                <td>
                  <span className={`status ${product.stock_status}`}>{product.stock_status}</span>
                  <div className="subtle">
                    {product.manage_stock ? `${product.stock_quantity ?? 0} units` : "Not tracked"}
                  </div>
                </td>
                <td>
                  {product.categories?.map((item) => item.name).join(", ") || (
                    <span className="subtle">Uncategorized</span>
                  )}
                </td>
                <td>
                  <span className={`status ${product.customNotes ? "approved" : "neutral"}`}>
                    {product.customNotes ? "Yes" : "No"}
                  </span>
                </td>
                <td>
                  <div className="status-stack">
                    <span className="status neutral">{product.status}</span>
                    {product.reviewCount > 0 ? (
                      <span className="status pending" title={`${product.reviewCount} pending or failed review draft`}>
                        For review
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <Link className="icon-button secondary" href={`/products/${product.id}`} title="Edit product">
                    <Edit3 size={17} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 ? <div className="empty">No products found.</div> : null}
      </div>
    </>
  );
}
