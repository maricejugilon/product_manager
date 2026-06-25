import { Filter, PackageSearch } from "lucide-react";

import ProductDuplicateTool from "@/components/product-duplicate-tool";
import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
import { getDescendantCategoryIds, getHierarchicalCategoryOptions } from "@/lib/category-utils";
import { buildDuplicateProductGroups } from "@/lib/product-duplicates";
import { getCategories, getProductsByCategoryIds, getProductsForDuplicateScan } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function DuplicateProductsPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedCategoryId = positiveNumber(first(params.category));
  const categories = await getCategories();
  const categoryIds = selectedCategoryId
    ? [selectedCategoryId, ...getDescendantCategoryIds(categories, selectedCategoryId)]
    : [];
  const products =
    categoryIds.length > 0
      ? await getProductsByCategoryIds(categoryIds)
      : await getProductsForDuplicateScan({ status: "any" });
  const duplicateGroups = buildDuplicateProductGroups(products);
  const categoryOptions = getHierarchicalCategoryOptions(categories);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Duplicate Products</h1>
          <p className="page-copy">
            Review products flagged by matching names or SKU values. Every merge remains pending
            until it is approved in the Review Queue.
          </p>
        </div>
        <div className="metrics">
          <PageHelp
            title="How to review duplicate products"
            intro="Compare flagged products and decide whether they are true duplicates or product variations."
            steps={[
              {
                title: "Choose a category branch",
                description: "Limit the scan to one category and its children when you want a smaller, easier list."
              },
              {
                title: "Open a match group",
                description: "Compare product images, names, SKUs, prices, categories, and other details."
              },
              {
                title: "Choose duplicate or variation",
                description: "Merge a true duplicate, or create a variable product when the items are legitimate options of one product."
              },
              {
                title: "Select the product to keep",
                description: "Confirm the target product and send the proposed action to Review Queue."
              }
            ]}
            terms={[
              { term: "Duplicate", description: "One repeated product should be merged into the product you keep." },
              { term: "Variation", description: "Separate products represent selectable options of one variable product." },
              { term: "Target", description: "The main product that remains after approval." },
              { term: "Match reason", description: "The name, SKU, or details that caused the products to be flagged." }
            ]}
            safety={
              <>
                <strong>Always open both store pages before merging.</strong> A similar name alone does not prove that products are duplicates.
              </>
            }
          />
          <span className="metric">
            <PackageSearch size={18} />
            <strong>{products.length}</strong>
            Products scanned
          </span>
        </div>
      </div>

      <PagePurpose
        icon={<PackageSearch size={22} />}
        title="Investigate products that may represent the same item"
        description="Use this page to compare products with matching names, SKUs, or details. You can decide whether they are true duplicates to merge or legitimate options that should become product variations."
        note={<><strong>This page finds possibilities, not certainties.</strong><span>Open and compare each product before choosing an action.</span></>}
      />

      <form className="toolbar duplicate-filter">
        <div className="field">
          <label htmlFor="category">Category branch</label>
          <select id="category" name="category" defaultValue={selectedCategoryId ?? ""}>
            <option value="">All categories</option>
            {categoryOptions.map((option) => (
              <option key={option.category.id} value={option.category.id}>
                {option.path}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="submit">
          <Filter size={17} />
          Filter
        </button>
      </form>

      <ProductDuplicateTool groups={duplicateGroups} productsScanned={products.length} />
    </main>
  );
}
