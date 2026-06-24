import { Filter, PackageSearch } from "lucide-react";

import ProductDuplicateTool from "@/components/product-duplicate-tool";
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
        <span className="metric">
          <PackageSearch size={18} />
          <strong>{products.length}</strong>
          Products scanned
        </span>
      </div>

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
