import CategoryManager from "@/components/category-manager";
import CategoryMergeTool from "@/components/category-merge-tool";
import { getCategories } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-copy">
            Create or update WooCommerce categories as review drafts. Product category assignment
            is handled from each product editor.
          </p>
        </div>
      </div>
      <CategoryMergeTool categories={categories} />
      <CategoryManager categories={categories} />
    </main>
  );
}
