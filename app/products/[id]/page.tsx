import Link from "next/link";
import { ArrowLeft, ExternalLink, PencilLine, RefreshCw, WifiOff } from "lucide-react";

import ProductEditor from "@/components/product-editor";
import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
import { getCategories, getProduct } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await params;
  let product;
  let categories;

  try {
    [product, categories] = await Promise.all([getProduct(Number(id)), getCategories()]);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The product could not be loaded from WooCommerce. Please try again.";

    return (
      <main className="page">
        <div className="page-head">
          <div>
            <Link className="button secondary" href="/">
              <ArrowLeft size={17} />
              Products
            </Link>
            <h1 className="page-title" style={{ marginTop: 14 }}>Product temporarily unavailable</h1>
            <p className="page-copy">The editor could not connect to WooCommerce.</p>
          </div>
        </div>
        <section className="product-filter-panel" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <WifiOff size={22} />
            <div>
              <h2 style={{ margin: 0 }}>Could not load this product</h2>
              <p className="error" style={{ margin: "8px 0 0" }}>{message}</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="button" href={`/products/${id}`}>
              <RefreshCw size={16} />
              Try again
            </Link>
            <Link className="button secondary" href="/">
              <ArrowLeft size={16} />
              Back to products
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link className="button secondary" href="/">
            <ArrowLeft size={17} />
            Products
          </Link>
          <h1 className="page-title" style={{ marginTop: 14 }}>
            {product.name}
          </h1>
          <p className="page-copy">
            Edit the listing below. Saving creates a review draft, and approval publishes the
            change to WooCommerce.
          </p>
        </div>
        <div className="make-model-head-actions">
          <PageHelp
            title="How to edit a product"
            intro="Update the product listing, relationships, colour options, specifications, and shipping details in one place."
            steps={[
              {
                title: "Check the current product",
                description: "Use View store page to confirm you are editing the correct product and SKU."
              },
              {
                title: "Edit the needed sections",
                description: "Update only the fields you understand. Categories, stock, dimensions, accessories, colour board, and specifications are available."
              },
              {
                title: "Review relationships",
                description: "Accessories are WooCommerce cross-sells. Colour board choices are custom options, not product variations."
              },
              {
                title: "Save and approve",
                description: "Save creates a review draft. Check the proposed differences in Review Queue before approval."
              }
            ]}
            terms={[
              { term: "Accessories", description: "Related products stored as WooCommerce cross-sells." },
              { term: "Colour board", description: "Custom colour choices displayed by the store theme." },
              { term: "Specifications", description: "Grouped product features such as material, weight, and dimensions." },
              { term: "Custom notes", description: "The product-level ACF yes/no setting." }
            ]}
            safety={
              <>
                <strong>Saving does not publish immediately.</strong> The product changes only after the draft is approved in Review Queue.
              </>
            }
          />
          <a className="button secondary" href={product.permalink} target="_blank" rel="noreferrer">
            <ExternalLink size={17} />
            View store page
          </a>
        </div>
      </div>
      <PagePurpose
        icon={<PencilLine size={22} />}
        title="Manage the complete information for one product"
        description="Use this page when a product needs more than a quick bulk change. You can update its listing details, categories, stock, dimensions, accessories, colour board choices, specifications, and other WooCommerce fields."
        note={<><strong>You are editing one product.</strong><span>Confirm its name, SKU, and store page before preparing changes.</span></>}
      />
      <ProductEditor product={product} categories={categories} />
    </main>
  );
}
