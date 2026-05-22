import ReviewQueue from "@/components/review-queue";
import { listReviews } from "@/lib/review-store";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const reviews = await listReviews();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Review Queue</h1>
          <p className="page-copy">
            Approve a draft to publish it to WooCommerce, or reject it to keep the store unchanged.
          </p>
        </div>
      </div>
      <ReviewQueue reviews={reviews} />
    </main>
  );
}
