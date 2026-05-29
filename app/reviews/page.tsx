import ReviewQueue from "@/components/review-queue";
import { isReviewStorageMissing, listReviews, reviewStorageSetupMessage } from "@/lib/review-store";

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
      {isReviewStorageMissing() ? <p className="error">{reviewStorageSetupMessage()}</p> : null}
      <ReviewQueue reviews={reviews} />
    </main>
  );
}
