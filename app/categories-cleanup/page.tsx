import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import CategoryCleanupTool from "@/components/category-cleanup-tool";
import CategorySlugAuditTool from "@/components/category-slug-audit-tool";
import { getCategories } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export default async function CategoriesCleanupPage() {
  const categories = await getCategories();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link className="button secondary" href="/categories">
            <ArrowLeft size={17} />
            Categories
          </Link>
          <h1 className="page-title" style={{ marginTop: 14 }}>
            Categories Cleanup
          </h1>
          <p className="page-copy">
            Review empty categories, slug mismatches, and duplicate category names before creating
            cleanup or merge review drafts.
          </p>
        </div>
      </div>
      <CategorySlugAuditTool categories={categories} />
      <CategoryCleanupTool categories={categories} />
    </main>
  );
}
