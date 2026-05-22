"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationControlsProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
  search: string;
  category: string;
  stockStatus: string;
};

function pageWindow(currentPage: number, totalPages: number) {
  const pages = new Set([1, totalPages]);

  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) {
      pages.add(page);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

export default function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  perPage,
  search,
  category,
  stockStatus
}: PaginationControlsProps) {
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const safeTotalPages = Math.max(totalPages, 1);
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), safeTotalPages);
  const start = totalItems === 0 ? 0 : (safeCurrentPage - 1) * perPage + 1;
  const end = Math.min(safeCurrentPage * perPage, totalItems);
  const pages = pageWindow(safeCurrentPage, safeTotalPages);

  function hrefFor(page: number) {
    const params = new URLSearchParams();

    if (search) {
      params.set("search", search);
    }

    if (category) {
      params.set("category", category);
    }

    if (stockStatus) {
      params.set("stock_status", stockStatus);
    }

    params.set("per_page", String(perPage));
    params.set("page", String(page));

    return `/?${params.toString()}`;
  }

  function startLoading(page: number) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (loadingPage !== null) {
        event.preventDefault();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }

      setLoadingPage(page);
    };
  }

  return (
    <>
      <nav className="pagination" aria-label="Product pagination" aria-busy={loadingPage !== null}>
        <div className="pagination-summary">
          <strong>
            Showing {start}-{end}
          </strong>
          <span className="subtle">of {totalItems} products</span>
        </div>
        <div className="pagination-links">
          {safeCurrentPage > 1 ? (
            <Link
              className={`pagination-link ${loadingPage !== null ? "disabled" : ""}`}
              href={hrefFor(safeCurrentPage - 1)}
              onClick={startLoading(safeCurrentPage - 1)}
            >
              <ChevronLeft size={16} />
              Previous
            </Link>
          ) : (
            <span className="pagination-link disabled">
              <ChevronLeft size={16} />
              Previous
            </span>
          )}

          {pages.map((page, index) => (
            <span className="pagination-group" key={page}>
              {index > 0 && page - pages[index - 1] > 1 ? <span className="pagination-ellipsis">...</span> : null}
              {page === safeCurrentPage ? (
                <span className="pagination-page active">{page}</span>
              ) : (
                <Link
                  className={`pagination-page ${loadingPage !== null ? "disabled" : ""}`}
                  href={hrefFor(page)}
                  onClick={startLoading(page)}
                >
                  {page}
                </Link>
              )}
            </span>
          ))}

          {safeCurrentPage < safeTotalPages ? (
            <Link
              className={`pagination-link ${loadingPage !== null ? "disabled" : ""}`}
              href={hrefFor(safeCurrentPage + 1)}
              onClick={startLoading(safeCurrentPage + 1)}
            >
              Next
              <ChevronRight size={16} />
            </Link>
          ) : (
            <span className="pagination-link disabled">
              Next
              <ChevronRight size={16} />
            </span>
          )}
        </div>
      </nav>
      {loadingPage !== null ? (
        <div className="pagination-loading" role="status" aria-live="polite">
          <div className="progress-head">
            <strong>Loading page {loadingPage}</strong>
            <span>Please wait</span>
          </div>
          <div className="pagination-loading-track" aria-hidden>
            <span />
          </div>
        </div>
      ) : null}
    </>
  );
}
