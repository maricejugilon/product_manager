import Link from "next/link";
import { FolderCog, FolderTree, GitMerge, ListTree } from "lucide-react";

import CategoryManager from "@/components/category-manager";
import CategoryMergeTool from "@/components/category-merge-tool";
import PageHelp from "@/components/page-help";
import { getHierarchicalCategoryOptions, normalizeCategoryName } from "@/lib/category-utils";
import { getCategories } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await getCategories();
  const hierarchy = getHierarchicalCategoryOptions(categories);
  const rootCount = categories.filter((category) => category.parent === 0).length;
  const duplicateNames = new Set<string>();
  const namesSeen = new Set<string>();

  for (const category of categories) {
    const name = normalizeCategoryName(category.name);
    if (namesSeen.has(name)) {
      duplicateNames.add(name);
    }
    namesSeen.add(name);
  }

  return (
    <main className="page categories-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-copy">
            Organize how shoppers browse the store. Categories create the parent, subcategory, and
            grandchild structure used to group products.
          </p>
        </div>
        <div className="categories-head-actions">
          <PageHelp
            title="How to manage categories"
            intro="Create, edit, and safely combine WooCommerce categories while keeping the category hierarchy clear."
            steps={[
              {
                title: "Choose the task",
                description: "Edit the category structure for normal changes, or resolve duplicate names when two categories should become one."
              },
              {
                title: "Check the full path",
                description: "A path such as Cases / Lighting / Moving Heads shows exactly where a category appears in the store."
              },
              {
                title: "Prepare the change",
                description: "Set the name, web address, parent, display behavior, description, and image."
              },
              {
                title: "Review before approval",
                description: "Every save or merge becomes a draft. Open Review Queue to check it before WooCommerce changes."
              }
            ]}
            terms={[
              { term: "Parent", description: "The category directly above this category in the store hierarchy." },
              { term: "Slug", description: "The web-address version of the category name." },
              { term: "Root category", description: "A top-level category with no parent." },
              { term: "Merge target", description: "The category that remains after duplicates are combined." }
            ]}
            safety={
              <>
                <strong>Check the full hierarchy before saving.</strong> Changing a parent moves the category and its children to a different part of the store.
              </>
            }
          />
          <Link className="button secondary" href="/categories-cleanup">
            <FolderCog size={16} />
            Open Cleanup
          </Link>
        </div>
      </div>

      <section className="category-purpose" aria-label="Purpose of product categories">
        <div className="category-purpose-icon">
          <FolderTree size={24} />
        </div>
        <div>
          <span className="category-purpose-label">What this page is for</span>
          <h2>Build a clear store navigation</h2>
          <p>
            Use categories to place products in a logical tree. This page manages the category
            structure itself. To assign products to categories, use the Products page or open an
            individual product.
          </p>
        </div>
        <div className="category-purpose-metrics">
          <span><strong>{categories.length}</strong> total categories</span>
          <span><strong>{rootCount}</strong> top-level categories</span>
          <span><strong>{duplicateNames.size}</strong> duplicate names</span>
        </div>
      </section>

      <nav className="category-task-nav" aria-label="Category tasks">
        <a href="#category-editor">
          <ListTree size={18} />
          <span>
            <strong>Create or edit</strong>
            Change the category structure
          </span>
        </a>
        <a href="#category-duplicates">
          <GitMerge size={18} />
          <span>
            <strong>Resolve duplicates</strong>
            Compare matching category names
          </span>
        </a>
      </nav>

      <CategoryManager categories={categories} hierarchy={hierarchy} />
      <CategoryMergeTool categories={categories} />
    </main>
  );
}
