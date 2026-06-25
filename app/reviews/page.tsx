import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
import ReviewQueue from "@/components/review-queue";
import { ClipboardCheck } from "lucide-react";
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
        <PageHelp
          title="How to use Review Queue"
          intro="This is the final checkpoint for every product and category change prepared in the manager."
          steps={[
            {
              title: "Read the review summary",
              description: "Confirm the product or category, the action type, and who or what created the draft."
            },
            {
              title: "Compare before and after",
              description: "Open the details and check the current WooCommerce value against the proposed value."
            },
            {
              title: "Approve or reject",
              description: "Approve correct changes. Reject anything unclear or no longer needed."
            },
            {
              title: "Check the result",
              description: "A successful approval updates WooCommerce. Failed reviews keep their error so they can be investigated."
            }
          ]}
          terms={[
            { term: "Pending", description: "Waiting for a person to approve or reject it." },
            { term: "Approved", description: "The change was successfully sent to WooCommerce." },
            { term: "Rejected", description: "The draft was closed without changing WooCommerce." },
            { term: "Failed", description: "WooCommerce could not complete the approved action." }
          ]}
          safety={
            <>
              <strong>Approval is the publishing action.</strong> Review the product, values, and merge direction before clicking Approve.
            </>
          }
        />
      </div>
      <PagePurpose
        icon={<ClipboardCheck size={22} />}
        title="Check and approve changes before they reach the store"
        description="Every product update, category change, merge, or imported fix arrives here as a draft. Use this page as the final human checkpoint before WooCommerce is changed."
        note={<><strong>Approve publishes the action.</strong><span>Reject closes the draft without changing the store.</span></>}
      />
      {isReviewStorageMissing() ? <p className="error">{reviewStorageSetupMessage()}</p> : null}
      <ReviewQueue reviews={reviews} />
    </main>
  );
}
