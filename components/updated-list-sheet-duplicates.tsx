"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Files } from "lucide-react";

export type UpdatedListSheetDuplicateRow = {
  sheetRowNumber: number;
  name: string;
  sku: string;
  sheetDuplicateMatches: Array<{
    rowNumber: number;
    name: string;
    sku: string;
    matchedBy: Array<"sku" | "name">;
  }>;
};

export default function UpdatedListSheetDuplicates({ rows }: { rows: UpdatedListSheetDuplicateRow[] }) {
  const [visibleLimit, setVisibleLimit] = useState(50);
  const duplicateRows = useMemo(
    () => rows
      .filter((row) => row.sheetDuplicateMatches.length > 0)
      .sort((first, second) => first.sheetRowNumber - second.sheetRowNumber),
    [rows]
  );
  const visibleRows = duplicateRows.slice(0, visibleLimit);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
          <Files size={18} />
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>Spreadsheet duplicates</h2>
            <div style={{ color: "#52607a", fontSize: 12, marginTop: 2 }}>
              {duplicateRows.length} Product list rows match another row by exact SKU or normalized product name.
            </div>
          </div>
        </div>
        <a
          className="button secondary compact-button"
          href="https://docs.google.com/spreadsheets/d/1fWu2mxc0LWDUtd_YZQColdkQxwcbsXuihCZ-HcAvlPA/edit"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> Open Product list
        </a>
      </div>

      {duplicateRows.length === 0 ? (
        <p className="subtle" style={{ margin: 0 }}>No duplicate SKU or product-name rows were detected.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {visibleRows.map((row) => (
            <div
              key={`sheet-duplicate-${row.sheetRowNumber}`}
              style={{ border: "1px solid #dbe2ea", borderRadius: 8, padding: "11px 12px", background: "#f9fafb", display: "grid", gap: 7 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{row.name}</strong>
                  <div style={{ color: "#52607a", fontSize: 12, marginTop: 3 }}>
                    Sheet row {row.sheetRowNumber} | SKU: {row.sku || "No SKU"}
                  </div>
                </div>
                <span className="status failed">Duplicate row</span>
              </div>
              <div style={{ display: "grid", gap: 5 }}>
                {row.sheetDuplicateMatches.map((match) => (
                  <div key={`${row.sheetRowNumber}-${match.rowNumber}`} style={{ color: "#52607a", fontSize: 12, overflowWrap: "anywhere" }}>
                    <strong>Matches row {match.rowNumber}</strong>: {match.name}
                    {match.sku ? ` | SKU: ${match.sku}` : ""}
                    {` | Same ${match.matchedBy.map((reason) => reason === "sku" ? "SKU" : "product name").join(" and ")}`}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {visibleRows.length < duplicateRows.length ? (
            <div style={{ display: "flex", justifyContent: "center", gap: 8, paddingTop: 4, flexWrap: "wrap" }}>
              <button
                className="button secondary compact-button"
                type="button"
                onClick={() => setVisibleLimit((current) => Math.min(current + 50, duplicateRows.length))}
              >
                Show 50 more
              </button>
              <button
                className="button secondary compact-button"
                type="button"
                onClick={() => setVisibleLimit(duplicateRows.length)}
              >
                Show all {duplicateRows.length}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
