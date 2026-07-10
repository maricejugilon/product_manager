# FCW Product Manager Walkthrough Script

Use this script when introducing the Product Manager to a client, store admin, or internal team member. The goal is to explain what each page does, how the review-first workflow protects the WooCommerce store, and where users should go for common tasks.

## Opening

Hello, today I am going to walk through the FCW Product Manager.

This tool is built to manage WooCommerce products and categories in a safer way. Instead of changing the live store immediately, most actions create a review draft first. The team can check the change in the Review Queue, then approve it when everything looks correct.

The main idea is simple:

1. Find the product, category, or sheet issue.
2. Prepare the change.
3. Review the proposed update.
4. Approve it before WooCommerce is changed.

## Login Page

Start on the Admin Login page.

This protects the product manager from public access. A user signs in before they can view products, categories, sheet reports, or review actions.

What to mention:

- Only authorized users should access this tool.
- After login, users land in the main product manager.
- Logout is available from the top navigation when admin login is enabled.

## Products Page

The Products page is the main daily work area.

Use this page when you want to find products, check stock, filter products, and prepare bulk updates.

What to show:

- Search by product name or SKU.
- Filter by category, availability, custom notes, and dimensions.
- Use the category dropdown to see the category hierarchy, not just a flat list.
- Use the dimensions filter to find products with missing WooCommerce dimensions.
- Select multiple products to prepare bulk actions.

What users can do here:

- Bulk update stock.
- Bulk assign selected products to a category.
- Bulk update custom notes.
- Bulk sync dimensions from the Google Sheet source data.
- Open an individual product for full editing.

Important message:

Bulk actions do not publish immediately. They create review drafts, and the final change happens in the Review Queue.

Suggested wording:

"This page is for everyday product maintenance. If I need to find all products missing dimensions, assign products to a category, or update stock in bulk, I start here. I select the products, choose the action, then send the change for review."

## Product Detail Page

The Product Detail page is for editing one product more carefully.

Use this when a product needs detailed changes, not just a quick bulk update.

What to show:

- Product name, SKU, and store page link.
- Standard product details.
- Categories.
- Stock and status.
- WooCommerce dimensions.
- Custom notes.
- Accessories.
- Colour board options.
- Full description.
- Specifications.

Important explanations:

- Accessories are saved as WooCommerce cross-sells.
- Colour board options are custom product options, not WooCommerce variations.
- Specifications are structured product details, such as material, weight, and feature values.
- Saving creates a review draft.

Suggested wording:

"This page lets us manage the complete information for one product. Before saving, I check the product name, SKU, and live store page to make sure I am editing the correct item. When I save, the store is still protected because the update goes to the Review Queue first."

## Categories Page

The Categories page manages the WooCommerce category structure.

Use this page to create, edit, or merge categories.

What to show:

- Total categories.
- Top-level categories.
- Duplicate category names.
- Category directory with full hierarchy paths.
- Create or edit category section.
- Duplicate category merge section.

Important explanations:

- A category can have the same name as another category but belong to a different parent.
- Always check the full category path before editing or merging.
- Changing a parent category changes where that category appears in the store navigation.

Suggested wording:

"This page controls how shoppers browse the store. Categories are arranged as parent, child, and grandchild levels. The full path helps us avoid mistakes, especially when two categories have the same name."

## Categories Cleanup Page

The Categories Cleanup page is for finding category problems.

Use this page when cleaning up old, unused, duplicated, or incorrectly named categories.

What to show:

- Incorrect slug checks.
- Duplicate or similar category checks.
- Empty categories with no products and no child categories.
- Cleanup actions that can be sent to Review Queue.

Important explanations:

- A slug is the web-address version of the category name.
- Example: "Flight Case Accessories" should use a slug like `flight-case-accessories`.
- Empty parent categories should be reviewed carefully because child categories may still exist.
- Cleanup actions should be approved only after checking the category path and product count.

Suggested wording:

"This page separates cleanup work from normal category editing. It helps us find categories that may be unused, have incorrect web addresses, or may need merging. The safest process is to review the issue first, create a cleanup review, then approve only the changes we trust."

## Duplicate Products Page

The Duplicate Products page helps identify products that may be repeated.

Use this page to compare products with matching names, SKUs, images, categories, or similar details.

What to show:

- Filter by category branch.
- Product groups flagged as possible duplicates.
- Product images and store links.
- SKU and detail comparison.
- Option to treat items as a true duplicate or as a product variation.

Important explanations:

- The page finds possible duplicates, not guaranteed duplicates.
- Similar names may be different products.
- Some products should become variable products instead of being deleted or merged.
- Always open and compare the products before sending a merge to review.

Suggested wording:

"This page helps us investigate repeated products. If two products are truly the same, we can merge them. If they are really options of one product, we can choose the variable product path instead. Nothing should be approved until the product images, SKUs, and store pages are checked."

## Product Sheet Validator Page

The Product Sheet Validator compares the Google Sheet Product List with WooCommerce.

Use this page to check whether sheet data and WooCommerce data match.

What to show:

- Default view shows products from the sheet that are not found in WooCommerce.
- Category issue filter.
- Custom notes filter.
- Colour board filter.
- Accessories filter.
- Woo only filter for products in WooCommerce but not in the sheet.
- All rows view.
- For review view.
- Sync button.
- Refresh Woo button.

Important explanations:

- Matching uses SKU first, then product name fallback.
- Sheet category hierarchy is compared with WooCommerce category hierarchy.
- The page uses cached data so it loads faster.
- Sync rebuilds the report from the Google Sheet.
- Refresh Woo checks the latest WooCommerce data against the cached sheet rows.
- Creating a missing product or fixing a field still requires Review Queue approval.

Suggested wording:

"This is our validation dashboard between the spreadsheet and WooCommerce. I can see what is missing, what has category issues, and whether custom notes, colour board, or accessories match. It is a reporting tool first, and any fix still goes through review."

## Make and Model Page

The Make and Model page compares the Make and Model sheet tab with WooCommerce product attributes.

Use this page to check whether products have the correct Make and Model attribute values.

What to show:

- Needs update tab.
- Correct tab.
- SKU problems tab.
- Unresolved links tab.
- Search by product, SKU, make, or model.
- Product comparison between sheet values and WooCommerce values.
- Send one product or selected products to Review Queue.

Important explanations:

- Products are verified by SKU.
- Only SKU-verified products can be sent to review.
- SKU problems and unresolved links need investigation before updates.
- The Make and Model values are WooCommerce attributes.

Suggested wording:

"This page checks whether the Make and Model spreadsheet values match WooCommerce. The safe path is to start with Needs update, open the comparison, select the products we trust, and send those changes to the Review Queue."

## Review Queue Page

The Review Queue is the final checkpoint.

Use this page to approve or reject product and category changes.

What to show:

- Pending reviews.
- Approved reviews.
- Rejected reviews.
- Failed reviews.
- Individual approve or reject.
- Approve all when the listed changes have been checked.
- Loading and progress feedback during approvals.

Important explanations:

- Approval is the publishing action.
- Reject closes the draft without changing WooCommerce.
- Failed reviews keep the error so the team can investigate.
- Multiple users can create and approve reviews when production review storage is configured.

Suggested wording:

"Everything important comes here before it touches WooCommerce. This is where we compare the current value with the proposed value. If it is correct, we approve it. If it is unclear or no longer needed, we reject it."

## Recommended Demo Flow

Use this order for a smooth demonstration:

1. Login.
2. Open Products and search for a SKU.
3. Filter products by missing dimensions or category.
4. Open one Product Detail page and show accessories, colour board, custom notes, dimensions, and specifications.
5. Open Categories and explain the hierarchy.
6. Open Categories Cleanup and show slug/category cleanup.
7. Open Product Sheet Validator and explain No match, Category issues, and Woo only.
8. Open Make and Model and show Needs update.
9. Open Review Queue and explain that approval is the final publishing step.

## Closing

The most important thing to remember is that this product manager is review-first.

Users can work faster with bulk updates, sheet validation, duplicate checks, and category cleanup, but WooCommerce is protected because changes are reviewed before they are published.

The best practice is:

1. Use filters to find the right records.
2. Check the product, category, or sheet comparison.
3. Send the change to review.
4. Approve only after confirming the details.

