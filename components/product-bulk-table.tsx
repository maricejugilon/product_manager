"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Edit3, FolderPlus, PackagePlus, Ruler, StickyNote, X } from "lucide-react";

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
  dimensions: {
    length?: string;
    width?: string;
    height?: string;
  };
};

type BulkStockResponse = {
  created: number;
  skipped: number;
  reviewIds: string[];
};

type BulkCategoryResponse = BulkStockResponse;
type BulkCustomNotesResponse = BulkStockResponse;
type BulkDimensionsResponse = BulkStockResponse & {
  failed: number;
  warnings: Array<{ productId: number; productName?: string; message: string }>;
};
type BulkAction = "stock" | "category" | "custom_notes" | "dimensions";

function dimensionsText(product: ProductListItem) {
  const values = [
    product.dimensions.length?.trim() ?? "",
    product.dimensions.width?.trim() ?? "",
    product.dimensions.height?.trim() ?? ""
  ];

  return values.every(Boolean) ? values.join(" x ") : "Missing";
}

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
  const [activeAction, setActiveAction] = useState<BulkAction>("stock");

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

  async function onBulkDimensions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (selectedIds.length === 0) {
      setError("Select at least one product first.");
      return;
    }

    setSubmitting(true);
    const productIds = [...selectedIds];
    setProgress({ current: 0, total: productIds.length, label: "Reading Ext Dims from product links" });

    try {
      let created = 0;
      let skipped = 0;
      const warnings: BulkDimensionsResponse["warnings"] = [];

      for (let offset = 0; offset < productIds.length; offset += 10) {
        const batch = productIds.slice(offset, offset + 10);
        const response = await fetch("/api/reviews/bulk-dimensions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: batch })
        });
        const text = await response.text();
        const result = text
          ? (JSON.parse(text) as BulkDimensionsResponse & { error?: string })
          : undefined;

        if (!response.ok || !result) {
          throw new Error(result?.error ?? "Could not sync dimensions from the Google Sheet.");
        }

        created += result.created;
        skipped += result.skipped;
        warnings.push(...result.warnings);
        setProgress({
          current: Math.min(offset + batch.length, productIds.length),
          total: productIds.length,
          label: "Reading Ext Dims from product links"
        });
      }

      setSelectedIds([]);
      setMessage(
        `Created ${created} dimension review draft${created === 1 ? "" : "s"}${
          skipped ? `, skipped ${skipped} unchanged product${skipped === 1 ? "" : "s"}` : ""
        }${warnings.length ? `, ${warnings.length} could not be matched or parsed` : ""}.`
      );

      if (warnings.length > 0) {
        setError(
          warnings
            .slice(0, 5)
            .map((warning) => `${warning.productName ?? `Product ${warning.productId}`}: ${warning.message}`)
            .join(" ")
        );
      }

      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sync dimensions from the Google Sheet.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <>
      <section className={`product-selection-workspace ${selectedIds.length > 0 ? "has-selection" : ""}`}>
        <div className="product-selection-head">
          <div>
            <span className="selection-count">{selectedIds.length}</span>
            <div>
              <strong>{selectedIds.length === 1 ? "product selected" : "products selected"}</strong>
              <span>Changes are sent to the Review Queue before WooCommerce is updated.</span>
            </div>
          </div>
          {selectedIds.length > 0 ? (
            <button
              className="icon-button secondary"
              type="button"
              disabled={submitting}
              onClick={() => setSelectedIds([])}
              title="Clear selection"
            >
              <X size={17} />
            </button>
          ) : null}
        </div>

        <div className="product-action-tabs" aria-label="Bulk product action">
          {[
            ["stock", "Stock", Boxes],
            ["category", "Categories", FolderPlus],
            ["custom_notes", "Custom notes", StickyNote],
            ["dimensions", "Dimensions", Ruler]
          ].map(([value, label, Icon]) => (
            <button
              key={String(value)}
              className={activeAction === value ? "active" : ""}
              type="button"
              onClick={() => setActiveAction(value as BulkAction)}
            >
              <Icon size={16} />
              {String(label)}
            </button>
          ))}
        </div>

        <div className="product-action-body">
          {activeAction === "stock" ? (
            <form className="product-action-form stock-action" onSubmit={onBulkStock}>
              <div className="field">
                <label htmlFor="bulk-mode">Stock change</label>
                <select id="bulk-mode" name="mode" defaultValue="add">
                  <option value="add">Add to existing quantity</option>
                  <option value="set">Replace with exact quantity</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="bulk-quantity">Quantity</label>
                <input id="bulk-quantity" name="quantity" min="0" step="1" type="number" placeholder="Enter quantity" />
              </div>
              <div className="field">
                <label htmlFor="bulk-stock-status">Availability</label>
                <select id="bulk-stock-status" name="stock_status" defaultValue="keep">
                  <option value="keep">Keep current availability</option>
                  <option value="instock">In stock</option>
                  <option value="outofstock">Out of stock</option>
                  <option value="onbackorder">On backorder</option>
                </select>
              </div>
              <label className="checkbox-field compact">
                <input name="manage_stock" type="checkbox" defaultChecked />
                Track quantity
              </label>
              <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
                <PackagePlus size={17} />
                {submitting ? "Preparing" : "Send stock to review"}
              </button>
            </form>
          ) : null}

          {activeAction === "category" ? (
            <form className="product-action-form category-action" onSubmit={onBulkCategory}>
              <div className="field">
                <label htmlFor="bulk-category-mode">Category change</label>
                <select id="bulk-category-mode" name="category_mode" defaultValue="add">
                  <option value="add">Add a category</option>
                  <option value="set">Replace all categories</option>
                  <option value="remove">Remove a category</option>
                </select>
              </div>
              <div className="field category-action-select">
                <label htmlFor="bulk-category-id">Choose category</label>
                <select id="bulk-category-id" name="category_id" defaultValue="">
                  <option value="">Select a category</option>
                  {categoryOptions.map((option) => (
                    <option key={option.category.id} value={option.category.id}>
                      {option.path}
                    </option>
                  ))}
                </select>
              </div>
              <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
                <FolderPlus size={17} />
                {submitting ? "Preparing" : "Send categories to review"}
              </button>
            </form>
          ) : null}

          {activeAction === "custom_notes" ? (
            <form className="product-action-form notes-action" onSubmit={onBulkCustomNotes}>
              <div className="field">
                <label htmlFor="bulk-custom-notes">Custom notes</label>
                <select id="bulk-custom-notes" name="custom_notes" defaultValue="yes">
                  <option value="yes">Turn on</option>
                  <option value="no">Turn off</option>
                </select>
              </div>
              <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
                <StickyNote size={17} />
                {submitting ? "Preparing" : "Send custom notes to review"}
              </button>
            </form>
          ) : null}

          {activeAction === "dimensions" ? (
            <form className="product-action-form dimensions-action" onSubmit={onBulkDimensions}>
              <div>
                <strong>Get dimensions from the product source</strong>
                <span>Uses the matching Google Sheet link and its Ext Dims value.</span>
              </div>
              <button className="button" type="submit" disabled={submitting || selectedIds.length === 0}>
                <Ruler size={17} />
                {submitting ? "Reading product links" : "Get dimensions for review"}
              </button>
            </form>
          ) : null}
        </div>
      </section>

      {message ? <p className="notice">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {progress ? <ProgressBar {...progress} /> : null}

      <div className="table-wrap product-list-table">
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
              <th>Inventory</th>
              <th>Category</th>
              <th>Product details</th>
              <th>Review status</th>
              <th aria-label="Edit product" />
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
                      <span className="subtle">
                        SKU {product.sku || "not set"} · ID {product.id}
                      </span>
                      <strong className="product-list-price">
                        {product.price ? `GBP ${product.price}` : "Price not set"}
                      </strong>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="product-list-stack">
                    <span className={`status ${product.stock_status}`}>
                      {product.stock_status === "instock"
                        ? "In stock"
                        : product.stock_status === "outofstock"
                          ? "Out of stock"
                          : "On backorder"}
                    </span>
                    <span className="subtle">
                      {product.manage_stock ? `${product.stock_quantity ?? 0} available` : "Quantity not tracked"}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="product-list-categories">
                    {product.categories?.length ? (
                      <>
                        {product.categories.slice(0, 2).map((item) => (
                          <span key={item.id}>{item.name}</span>
                        ))}
                        {product.categories.length > 2 ? (
                          <small>+{product.categories.length - 2} more</small>
                        ) : null}
                      </>
                    ) : (
                      <span className="empty-value">No category</span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="product-list-detail-checks">
                    <span>
                      <StickyNote size={14} />
                      Custom notes
                      <strong>{product.customNotes ? "On" : "Off"}</strong>
                    </span>
                    <span>
                      <Ruler size={14} />
                      Dimensions
                      <strong className={dimensionsText(product) === "Missing" ? "missing" : ""}>
                        {dimensionsText(product)}
                      </strong>
                    </span>
                  </div>
                </td>
                <td>
                  <div className="status-stack">
                    <span className={`status ${product.status === "publish" ? "approved" : "neutral"}`}>
                      {product.status === "publish" ? "Published" : product.status}
                    </span>
                    {product.reviewCount > 0 ? (
                      <span className="status pending" title={`${product.reviewCount} pending or failed review draft`}>
                        {product.reviewCount} for review
                      </span>
                    ) : <span className="subtle">No pending changes</span>}
                  </div>
                </td>
                <td>
                  <Link className="icon-button secondary" href={`/products/${product.id}`} title={`Edit ${product.name}`}>
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
