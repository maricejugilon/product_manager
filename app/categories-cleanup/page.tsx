import Link from "next/link";
import { ArrowLeft, CheckCircle2, GitMerge, ListChecks } from "lucide-react";

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
            Find category problems, understand what each action will do, and send safe changes to
            the Review Queue before WooCommerce is updated.
          </p>
        </div>
      </div>
      <section className="cleanup-guide" aria-label="How category cleanup works">
        <div>
          <span className="cleanup-guide-icon"><ListChecks size={19} /></span>
          <strong>1. Review the problem</strong>
          <span>See duplicate names, incorrect web addresses, and unused categories.</span>
        </div>
        <div>
          <span className="cleanup-guide-icon"><GitMerge size={19} /></span>
          <strong>2. Choose an action</strong>
          <span>Merge duplicates, correct a web address, or remove an unused category.</span>
        </div>
        <div>
          <span className="cleanup-guide-icon"><CheckCircle2 size={19} /></span>
          <strong>3. Approve the review</strong>
          <span>No store data changes until the review is approved.</span>
        </div>
      </section>
      <CategorySlugAuditTool categories={categories} />
      <CategoryCleanupTool categories={categories} />
    </main>
  );
}
