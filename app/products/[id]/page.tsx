import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import ProductEditor from "@/components/product-editor";
import { getCategories, getProduct } from "@/lib/woocommerce";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = await params;
  const [product, categories] = await Promise.all([getProduct(Number(id)), getCategories()]);

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
        <a className="button secondary" href={product.permalink} target="_blank" rel="noreferrer">
          <ExternalLink size={17} />
          View store page
        </a>
      </div>
      <ProductEditor product={product} categories={categories} />
    </main>
  );
}
