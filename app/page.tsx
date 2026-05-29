import Link from "next/link";
import { Filter, PackageCheck } from "lucide-react";

import PaginationControls from "@/components/pagination-controls";
import ProductBulkTable from "@/components/product-bulk-table";
import { getHierarchicalCategoryOptions } from "@/lib/category-utils";
import { getCategories, getProductsByCustomNotes, productHasCustomNotes } from "@/lib/woocommerce";
import { isReviewStorageMissing, listReviews, reviewStorageSetupMessage } from "@/lib/review-store";
import type { ProductMergeChanges, ReviewRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageSize(value: string | undefined) {
  const parsed = positiveNumber(value, 100);
  return [25, 50, 100].includes(parsed) ? parsed : 100;
}

function customNotesFilter(value: string | undefined) {
  return value === "yes" || value === "no" ? value : "";
}

function isActionableReview(review: ReviewRecord) {
  return review.status === "pending" || review.status === "failed";
}

function productReviewIds(review: ReviewRecord) {
  if (review.resource === "product" && review.resourceId) {
    return [review.resourceId];
  }

  if (review.resource === "product_merge") {
    const changes = review.changes as ProductMergeChanges;
    return [changes.sourceId, changes.targetId].filter((id) => Number.isInteger(id) && id > 0);
  }

  return [];
}

export default async function Dashboard({
  searchParams
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const page = positiveNumber(first(params.page), 1);
  const perPage = pageSize(first(params.per_page));
  const search = first(params.search) ?? "";
  const category = first(params.category) ?? "";
  const stockStatus = first(params.stock_status) ?? "";
  const customNotes = customNotesFilter(first(params.custom_notes));
  const [productResult, categories, reviews] = await Promise.all([
    getProductsByCustomNotes({ page, perPage, search, category, stockStatus, customNotes }),
    getCategories(),
    listReviews()
  ]);
  const pendingCount = reviews.filter((review) => review.status === "pending").length;
  const productReviewCounts = new Map<number, number>();
  const categoryOptions = getHierarchicalCategoryOptions(categories);

  for (const review of reviews.filter(isActionableReview)) {
    for (const productId of productReviewIds(review)) {
      productReviewCounts.set(productId, (productReviewCounts.get(productId) ?? 0) + 1);
    }
  }

  const products = productResult.data.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: product.price,
    status: product.status,
    stock_status: product.stock_status,
    manage_stock: product.manage_stock,
    stock_quantity: product.stock_quantity,
    customNotes: productHasCustomNotes(product),
    categories: product.categories,
    image: product.images?.[0]?.src ?? "",
    reviewCount: productReviewCounts.get(product.id) ?? 0
  }));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">WooCommerce Products</h1>
          <p className="page-copy">
            Sync products from FCW, fix listing details, adjust categories and stock, then send
            every change through approval before it touches WooCommerce.
          </p>
        </div>
        <div className="metrics">
          <span className="metric">
            <PackageCheck size={18} />
            <strong>{productResult.total ?? productResult.data.length}</strong>
            Products
          </span>
          <Link className="metric" href="/reviews">
            <strong>{pendingCount}</strong>
            Pending reviews
          </Link>
        </div>
      </div>

      {isReviewStorageMissing() ? <p className="error">{reviewStorageSetupMessage()}</p> : null}

      <form className="toolbar">
        <div className="field">
          <label htmlFor="search">Search</label>
          <input id="search" name="search" defaultValue={search} placeholder="Name, SKU, detail" />
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category}>
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.category.id} value={option.category.id}>
                {option.path}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="stock_status">Stock</label>
          <select id="stock_status" name="stock_status" defaultValue={stockStatus}>
            <option value="">Any stock state</option>
            <option value="instock">In stock</option>
            <option value="outofstock">Out of stock</option>
            <option value="onbackorder">On backorder</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="custom_notes">Custom notes</label>
          <select id="custom_notes" name="custom_notes" defaultValue={customNotes}>
            <option value="">Any custom notes</option>
            <option value="yes">Custom notes: Yes</option>
            <option value="no">Custom notes: No</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="per_page">Page size</label>
          <select id="per_page" name="per_page" defaultValue={perPage}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <button className="button" type="submit">
          <Filter size={17} />
          Filter
        </button>
      </form>

      <ProductBulkTable categories={categories} products={products} />
      <PaginationControls
        category={category}
        currentPage={page}
        perPage={perPage}
        search={search}
        stockStatus={stockStatus}
        customNotes={customNotes}
        totalItems={productResult.total ?? products.length}
        totalPages={productResult.totalPages ?? 1}
      />
    </main>
  );
}
