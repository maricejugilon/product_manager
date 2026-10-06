# FCW WooCommerce Product Manager

Review-first Next.js admin app for managing WooCommerce product listings.

## What It Does

- Lists WooCommerce products from `https://fcw.fluiddev.co.uk`.
- Loads products with pagination, up to 100 products per page.
- Lets you edit product details, category assignments, stock status, and stock quantity.
- Lets you select products and create bulk stock review drafts by adding to current stock or setting an exact quantity.
- Lets you select products and create bulk category review drafts to add, replace, or remove a category assignment.
- Provides a Product Sheet Validator page that compares Google Sheet rows with WooCommerce matches by SKU/name, highlights category hierarchy mismatches, and creates review-first product drafts from unmatched sheet rows by scraping the sheet Live URL with migration meta for accessories, colour-board options, and feature specifications.
- Scans for duplicate products by matching names and overlapping SKU values, with category-branch filtering and review drafts for either duplicate merges or variable-product variation creation.
- Lets you create and update product categories.
- Detects duplicate category names and lets you compare parent/child category structure before creating a merge review.
- Provides a dedicated Categories Cleanup page that lists empty categories, finds category slug mismatches, and creates review drafts to fix slugs, merge duplicates, or delete empty leaf categories.
- Saves every edit as a pending review. Local development uses `data/reviews.json`; production should use shared KV storage.
- Publishes to WooCommerce only when a review is approved.
- Supports approving individual reviews or approving all pending/failed reviews together.
- Shows progress percentages while creating bulk stock review drafts or approving reviews in bulk.

## Local Setup

The WooCommerce credentials are stored in `.env.local`, which is ignored by git.

```bash
npm.cmd install
npm.cmd run check:woocommerce
npm.cmd run dev
```

Then open the local URL printed by Next.js, usually `http://localhost:3000`.

The WooCommerce diagnostic script runs Node with `--use-system-ca` for local certificate validation.
Do not set `NODE_OPTIONS=--use-system-ca` in Vercel; Vercel workers do not allow that flag.
The repository includes `vercel.json` and a build wrapper that remove `NODE_OPTIONS` before
running Next.js, but the Vercel project setting should still be deleted if present.

## Security

Set `APP_ADMIN_USERNAME` and `APP_ADMIN_PASSWORD` in `.env.local` before deploying the app anywhere public. When `APP_ADMIN_PASSWORD` is set, the app shows a login screen and requires both values. `APP_ADMIN_USERNAME` defaults to `admin` when omitted. You can also set `APP_AUTH_SECRET` to a long random value to make the session cookie independent from the admin password.

Because WooCommerce API keys can update store data, rotate the keys if they have been shared outside your private workspace.

## Runtime Storage

Local development stores review and validator cache JSON in `data/` when Redis credentials are not configured.

Production review storage and all durable Updated List state must be shared because Vercel functions can run in different instances or regions for different users. Configure Vercel KV or Upstash Redis REST with:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

The app also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Redis stores the Review Queue, the cached spreadsheet/WooCommerce comparison, Live price and stock checks, and the field-fix, specification, missing-product, price-update, and stock-update workflow histories. Without shared storage in Vercel, these results cannot be kept consistent between browsers. Approval requests use a short Redis lock so two users cannot publish the same review at the same time.

Live price and stock checks are stored per spreadsheet row. The cache defaults to the `shared` namespace, so local, staging, and production use the same results when they point to the same Upstash database. `UPDATED_LIST_CACHE_NAMESPACE` is optional; set different values only when you want to isolate environments later.

## WooCommerce Rate Limits

WooCommerce requests are paced and retried on temporary 429/5xx responses. The product sheet validator intentionally syncs in small batches to avoid triggering store rate limits in production. You can tune the request gap with `WOOCOMMERCE_REQUEST_DELAY_MS`; the Vercel default is `500`.
