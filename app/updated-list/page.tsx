import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  ClipboardList,
  ExternalLink,
  FileClock,
  FileSpreadsheet,
  Filter,
  PackageCheck,
  RotateCcw,
  Search,
  SquarePen
} from "lucide-react";

import PageHelp from "@/components/page-help";
import PagePurpose from "@/components/page-purpose";
import PaginationControls from "@/components/pagination-controls";
import UpdatedListActions from "@/components/updated-list-actions";
import {
  getUpdatedListData,
  normalizeUpdatedListProductName,
  normalizeUpdatedListSku,
  updatedListRowIsDraft,
  updatedListRowIsMissing,
  updatedListRowNeedsSpecifications,
  updatedListRowNeedsUpdate
} from "@/lib/updated-list";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageSize(value: string | undefined) {
  const parsed = positiveNumber(value, 25);
  return [25, 50, 100].includes(parsed) ? parsed : 25;
}

function statusFilter(value: string | undefined) {
  return value === "present" ||
    value === "missing" ||
    value === "draft" ||
    value === "needs-update" ||
    value === "specifications-missing"
    ? value
    : "all";
}

function FieldStatus({
  ambiguous,
  expected,
  present,
  detail
}: {
  ambiguous: boolean;
  expected: boolean;
  present: boolean;
  detail?: string;
}) {
  if (ambiguous) {
    return (
      <div className="updated-list-field-status">
        <span className="status neutral"><CircleAlert size={13} /> Check match</span>
      </div>
    );
  }

  if (expected && present) {
    return (
      <div className="updated-list-field-status">
        <span className="status approved"><CircleCheck size={13} /> Present</span>
        {detail ? <span>{detail}</span> : null}
      </div>
    );
  }

  if (expected) {
    return (
      <div className="updated-list-field-status">
        <span className="status failed"><CircleAlert size={13} /> Missing</span>
        {detail ? <span>{detail}</span> : null}
      </div>
    );
  }

  if (present) {
    return (
      <div className="updated-list-field-status">
        <span className="status neutral"><CircleCheck size={13} /> In Woo</span>
      </div>
    );
  }

  return (
    <div className="updated-list-field-status is-empty">
      <CircleMinus size={14} />
      <span>Not required</span>
    </div>
  );
}

export default async function UpdatedListPage({
  searchParams
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const page = positiveNumber(first(params.page), 1);
  const perPage = pageSize(first(params.per_page));
  const search = first(params.search) ?? "";
  const presenceStatus = statusFilter(first(params.status));

  const data = await getUpdatedListData();
  const normalizedSearch = normalizeUpdatedListProductName(search);
  const normalizedSkuSearch = normalizeUpdatedListSku(search);
  const rows = data.rows
    .filter((row) => {
      if (!search) {
        return true;
      }

      return (
        row.normalizedName.includes(normalizedSearch) ||
        normalizeUpdatedListProductName(row.sourceName).includes(normalizedSearch) ||
        (normalizedSkuSearch && normalizeUpdatedListSku(row.sku).includes(normalizedSkuSearch))
      );
    })
    .filter((row) => {
      if (presenceStatus === "all") {
        return true;
      }

      if (presenceStatus === "missing") {
        return updatedListRowIsMissing(row);
      }

      if (presenceStatus === "draft") {
        return updatedListRowIsDraft(row);
      }

      if (presenceStatus === "needs-update") {
        return updatedListRowNeedsUpdate(row);
      }

      if (presenceStatus === "specifications-missing") {
        return updatedListRowNeedsSpecifications(row);
      }

      return row.wooMatch;
    });

  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice((safePage - 1) * perPage, safePage * perPage);
  const actionRows = rows.filter(
    (row) =>
      updatedListRowIsMissing(row) ||
      updatedListRowIsDraft(row) ||
      updatedListRowNeedsUpdate(row) ||
      updatedListRowNeedsSpecifications(row)
  );
  const draftCount = rows.filter(updatedListRowIsDraft).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Updated List</h1>
          <p className="page-copy">
            Compare the Product list spreadsheet against WooCommerce by SKU and product name.
          </p>
        </div>
        <div className="metrics">
          <PageHelp
            title="Cross-check spreadsheet items"
            intro="Use the Google Sheet Product list tab to review which products exist in WooCommerce and which still need attention."
            steps={[
              {
                title: "Search by product name",
                description: "Filter the list using any part of the product name to focus on the items you are checking."
              },
              {
                title: "Check the WooCommerce match",
                description: "Products match by SKU first, then by an exact normalized product name, and link directly to the WooCommerce record."
              },
              {
                title: "Review the results",
                description: "The page keeps the same pagination model as the main product screen so it is easy to scan the full list."
              }
            ]}
            termsTitle="Useful checks"
            terms={[
              { term: "Missing from Woo", description: "The product exists in the Product list spreadsheet but has no WooCommerce match." },
              { term: "Matched product", description: "The SKU or normalized product name exists in WooCommerce and can be opened for verification." },
              { term: "Rows", description: "Choose how many products appear on each page." }
            ]}
            safety={
              <>
                <strong>Read-only comparison.</strong> This page only checks product names against WooCommerce and does not change records.
              </>
            }
          />
          <span className="metric">
            <PackageCheck size={18} />
            <strong>{data.rows.length}</strong>
            Sheet rows
          </span>
          <span className="metric">
            <FileSpreadsheet size={18} />
            <strong>{data.rows.filter((row) => row.wooMatch).length}</strong>
            In Woo
          </span>
          <span className="metric">
            <FileSpreadsheet size={18} />
            <strong>{data.rows.filter(updatedListRowIsMissing).length}</strong>
            Missing
          </span>
          <Link className="metric" href="/updated-list?status=draft">
            <FileClock size={18} />
            <strong>{data.rows.filter(updatedListRowIsDraft).length}</strong>
            Drafts
          </Link>
          <Link className="metric" href="/updated-list?status=specifications-missing">
            <ClipboardList size={18} />
            <strong>{data.rows.filter(updatedListRowNeedsSpecifications).length}</strong>
            Specifications missing
          </Link>
        </div>
      </div>

      <PagePurpose
        icon={<FileSpreadsheet size={22} />}
        title="Cross-check the Product list spreadsheet against WooCommerce"
        description="This list reads from the Product list tab and checks each row against WooCommerce so missing products and field updates are easy to find."
        note={
          <>
            <strong>SKU first, then product name.</strong>
            <span>Multiple matches are flagged for review instead of being marked missing.</span>
          </>
        }
      />

      <section className="product-filter-panel">
        <div className="product-filter-head">
          <div>
            <Search size={18} />
            <div>
              <h2>Find products</h2>
              <span>{totalItems} results</span>
            </div>
          </div>
          {(search || presenceStatus !== "all") ? (
            <Link className="button secondary compact-button" href="/updated-list">
              <RotateCcw size={15} />
              Clear filters
            </Link>
          ) : null}
        </div>

        <form className="product-filter-form updated-list-filter-form" action="/updated-list" method="get">
          <div className="field product-search-field">
            <label htmlFor="search">Product name or SKU</label>
            <input id="search" name="search" defaultValue={search} placeholder="Search sheet products" />
          </div>

          <div className="field">
            <label htmlFor="status">WooCommerce status</label>
            <select id="status" name="status" defaultValue={presenceStatus}>
              <option value="all">All</option>
              <option value="missing">Missing</option>
              <option value="present">Present</option>
              <option value="draft">Draft</option>
              <option value="needs-update">Needs field update</option>
              <option value="specifications-missing">Specifications missing</option>
            </select>
          </div>

          <div className="field product-page-size">
            <label htmlFor="per_page">Rows</label>
            <select id="per_page" name="per_page" defaultValue={perPage}>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <button className="button" type="submit">
            <Filter size={17} />
            Show products
          </button>
        </form>
      </section>

      <UpdatedListActions
        rows={actionRows}
        updatedAt={data.updatedAt}
        draftCount={draftCount}
        wooStoreUrl={process.env.WOOCOMMERCE_STORE_URL ?? ""}
      />

      <section className="product-list-table updated-list-table-shell">
        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>WooCommerce</th>
              <th>Colour board</th>
              <th>Accessories</th>
              <th>Custom notes</th>
              <th>Specifications</th>
              <th>SKU</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-value">
                  No products found for this search.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.rowNumber}>
                  <td>
                    <strong className="updated-list-product-name">{row.name}</strong>
                    <span className="updated-list-row-number">Sheet row {row.sheetRowNumber}</span>
                  </td>
                  <td>
                    {row.ambiguousMatch ? (
                      <span className="status neutral">Multiple matches</span>
                    ) : row.wooMatch ? (
                      row.wooStatus === "draft" ? (
                        <span className="status neutral">Draft</span>
                      ) : (
                        <span className="status approved">Present</span>
                      )
                    ) : (
                      <span className="status failed">Missing</span>
                    )}
                  </td>
                  <td>
                    <FieldStatus
                      ambiguous={row.ambiguousMatch}
                      expected={row.colourBoardExpected}
                      present={row.colourBoardPresent}
                    />
                  </td>
                  <td>
                    <FieldStatus
                      ambiguous={row.ambiguousMatch}
                      expected={row.accessoriesExpected}
                      present={row.accessoriesPresent}
                      detail={row.accessoriesExpectedCount > 0
                        ? `${row.accessoriesPresentCount}/${row.accessoriesExpectedCount} linked`
                        : undefined}
                    />
                  </td>
                  <td>
                    <FieldStatus
                      ambiguous={row.ambiguousMatch}
                      expected={row.customNotesExpected}
                      present={row.customNotesPresent}
                    />
                  </td>
                  <td>
                    <FieldStatus
                      ambiguous={row.ambiguousMatch}
                      expected={row.specificationsExpected}
                      present={row.specificationsPresent}
                    />
                  </td>
                  <td>{row.sku || "-"}</td>
                  <td>
                    {row.wooId ? (
                      <div className="updated-list-link-actions">
                        {row.wooPermalink ? (
                          <a
                            className="button secondary compact-button"
                            href={row.wooPermalink}
                            target="_blank"
                            rel="noreferrer"
                            title="Open the WooCommerce product"
                          >
                            <ExternalLink size={13} />
                            Woo
                          </a>
                        ) : null}
                        <Link
                          className="button secondary compact-button"
                          href={`/products/${row.wooId}`}
                          title="Edit in Product Manager"
                        >
                          <SquarePen size={13} />
                          Edit
                        </Link>
                      </div>
                    ) : (
                      <span className="subtle">No Woo match</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <PaginationControls
        basePath="/updated-list"
        currentPage={safePage}
        itemLabel="products"
        perPage={perPage}
        search={search}
        status={presenceStatus === "all" ? "" : presenceStatus}
        totalItems={totalItems}
        totalPages={totalPages}
      />
    </main>
  );
}
