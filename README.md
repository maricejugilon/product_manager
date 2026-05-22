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
- Saves every edit as a pending review in `data/reviews.json`.
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
Do not set `NODE_OPTIONS=--use-system-ca` in Vercel; the build wrapper clears `NODE_OPTIONS`
before running Next.js because Vercel workers do not allow that flag.

## Security

Set `APP_ADMIN_USERNAME` and `APP_ADMIN_PASSWORD` in `.env.local` before deploying the app anywhere public. When `APP_ADMIN_PASSWORD` is set, the app shows a login screen and requires both values. `APP_ADMIN_USERNAME` defaults to `admin` when omitted. You can also set `APP_AUTH_SECRET` to a long random value to make the session cookie independent from the admin password.

Because WooCommerce API keys can update store data, rotate the keys if they have been shared outside your private workspace.
