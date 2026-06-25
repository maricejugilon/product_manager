import Link from "next/link";
import { Filter, PackageCheck, RotateCcw, Search } from "lucide-react";

import PaginationControls from "@/components/pagination-controls";
import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
import ProductBulkTable from "@/components/product-bulk-table";
import { getHierarchicalCategoryOptions } from "@/lib/category-utils";
import { getCategories, getProductsByCustomNotes, productHasCustomNotes } from "@/lib/woocommerce";
import { isReviewStorageMissing, listReviews, reviewStorageSetupMessage } from "@/lib/review-store";
import type { ProductMergeChanges, ReviewRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function dimensionsFilter(value: string | undefined) {
  return value === "missing" || value === "complete" ? value : "";
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
  const dimensions = dimensionsFilter(first(params.dimensions));
  const [productResult, categories, reviews] = await Promise.all([
    getProductsByCustomNotes({ page, perPage, search, category, stockStatus, customNotes, dimensions }),
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
    reviewCount: productReviewCounts.get(product.id) ?? 0,
    dimensions: product.dimensions ?? {}
  }));
  const hasFilters = Boolean(search || category || stockStatus || customNotes || dimensions || perPage !== 100);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">WooCommerce Products</h1>
          <p className="page-copy">
            Find products, select the ones you need, and prepare changes for approval.
          </p>
        </div>
        <div className="metrics">
          <PageHelp
            title="How to manage products"
            intro="Find the products you need, prepare individual or bulk changes, and review them before publishing."
            steps={[
              {
                title: "Find products",
                description: "Search by product name or SKU, then narrow the list using category, availability, custom notes, or dimensions."
              },
              {
                title: "Select products",
                description: "Tick one or more products in the list. The action area shows the bulk tools available for your selection."
              },
              {
                title: "Prepare a change",
                description: "Update stock, category, custom notes, or dimensions. Open a product to edit its complete details."
              },
              {
                title: "Approve the review",
                description: "Open Review Queue, check the proposed change, then approve or reject it."
              }
            ]}
            termsTitle="Useful filters"
            terms={[
              { term: "Custom notes", description: "Show products where the custom notes option is on or off." },
              { term: "Dimensions", description: "Find products with complete or missing WooCommerce dimensions." },
              { term: "Pending reviews", description: "Products already waiting for approval are clearly marked." },
              { term: "Rows", description: "Choose how many products appear on each page." }
            ]}
            safety={
              <>
                <strong>Bulk actions create review drafts.</strong> Check the selected products and values before approving them in Review Queue.
              </>
            }
          />
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

      <PagePurpose
        icon={<PackageCheck size={22} />}
        title="Find and maintain your WooCommerce products"
        description="Use this page for everyday product work: search the catalogue, check stock and category information, open full product details, or prepare bulk updates for several products at once."
        note={<><strong>Product assignment happens here.</strong><span>Select products before choosing a bulk action.</span></>}
      />

      {isReviewStorageMissing() ? <p className="error">{reviewStorageSetupMessage()}</p> : null}

      <section className="product-filter-panel">
        <div className="product-filter-head">
          <div>
            <Search size={18} />
            <div>
              <h2>Find products</h2>
              <span>{productResult.total ?? products.length} results</span>
            </div>
          </div>
          {hasFilters ? (
            <Link className="button secondary compact-button" href="/">
              <RotateCcw size={15} />
              Clear filters
            </Link>
          ) : null}
        </div>
        <form className="product-filter-form">
          <div className="field product-search-field">
            <label htmlFor="search">Product name or SKU</label>
            <input id="search" name="search" defaultValue={search} placeholder="Search products" />
          </div>
          <div className="field product-category-filter">
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
            <label htmlFor="stock_status">Availability</label>
            <select id="stock_status" name="stock_status" defaultValue={stockStatus}>
              <option value="">All availability</option>
              <option value="instock">In stock</option>
              <option value="outofstock">Out of stock</option>
              <option value="onbackorder">On backorder</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="custom_notes">Custom notes</label>
            <select id="custom_notes" name="custom_notes" defaultValue={customNotes}>
              <option value="">On or off</option>
              <option value="yes">On</option>
              <option value="no">Off</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="dimensions">Dimensions</label>
            <select id="dimensions" name="dimensions" defaultValue={dimensions}>
              <option value="">Complete or missing</option>
              <option value="missing">Missing</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div className="field product-page-size">
            <label htmlFor="per_page">Rows</label>
            <select id="per_page" name="per_page" defaultValue={perPage}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          <button className="button" type="submit">
            <Filter size={17} />
            Show products
          </button>
        </form>
      </section>

      <ProductBulkTable categories={categories} products={products} />
      <PaginationControls
        category={category}
        currentPage={page}
        perPage={perPage}
        search={search}
        stockStatus={stockStatus}
        customNotes={customNotes}
        dimensions={dimensions}
        totalItems={productResult.total ?? products.length}
        totalPages={productResult.totalPages ?? 1}
      />
    </main>
  );
}
