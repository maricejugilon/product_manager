import Link from "next/link";
import { ArrowLeft, CheckCircle2, GitMerge, ListChecks } from "lucide-react";

import CategoryCleanupTool from "@/components/category-cleanup-tool";
import CategorySlugAuditTool from "@/components/category-slug-audit-tool";
import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
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
        <PageHelp
          title="How to clean up categories"
          intro="Work through category problems in a safe order without changing the store until you approve a review."
          steps={[
            {
              title: "Review incorrect slugs",
              description: "Start with categories whose web address does not match the category name."
            },
            {
              title: "Compare possible duplicates",
              description: "Check the category paths, product counts, and children before selecting the category to keep."
            },
            {
              title: "Handle unused categories",
              description: "Categories with no products and no child categories can be prepared for removal."
            },
            {
              title: "Approve one safe action",
              description: "Open Review Queue and confirm the exact merge, slug correction, or deletion."
            }
          ]}
          terms={[
            { term: "Ready to remove", description: "No products and no child categories." },
            { term: "Parent category", description: "Empty itself, but still contains child categories." },
            { term: "Incorrect slug", description: "The category web address does not match its current name." },
            { term: "Preferred category", description: "The correctly named and correctly slugged category to keep." }
          ]}
          safety={
            <>
              <strong>Do not remove parent categories first.</strong> Resolve their child categories before creating a deletion review.
            </>
          }
        />
      </div>
      <PagePurpose
        icon={<ListChecks size={22} />}
        title="Find and safely resolve category problems"
        description="Use this maintenance page to identify incorrect web addresses, duplicate categories, and empty categories that may be removed. It is separate from normal category editing so cleanup work stays focused."
        note={<><strong>Start with the safest items.</strong><span>Correct slugs and child categories before deleting parent categories.</span></>}
      />
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
