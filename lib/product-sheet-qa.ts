import type { SheetProductRow } from "@/lib/product-sheet";

export type ProductSheetQaField = "qa_custom_notes" | "qa_accessories" | "qa_colour";

export type ProductSheetQaCheck = {
  field: ProductSheetQaField;
  label: string;
  failed: boolean;
  raw: string;
  reason: string;
  expectedBoolean?: boolean;
  expectedCount?: number;
  expectedNames?: string[];
  foundCount?: number;
  missing: string[];
  extra: string[];
  resolved?: boolean;
  currentCount?: number;
};

export type ProductSheetQaChecks = {
  customNotes: ProductSheetQaCheck;
  accessories: ProductSheetQaCheck;
  colour: ProductSheetQaCheck;
};

const fieldHeaders: Record<ProductSheetQaField, string[]> = {
  qa_custom_notes: ["qa custom notes"],
  qa_accessories: ["qa accessories"],
  qa_colour: ["qa colour", "qa color"]
};

const fieldLabels: Record<ProductSheetQaField, string> = {
  qa_custom_notes: "Custom notes",
  qa_accessories: "Accessories",
  qa_colour: "Colour board"
};

function normalizeHeader(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function fieldValue(row: SheetProductRow, field: ProductSheetQaField) {
  const accepted = new Set(fieldHeaders[field]);
  const entry = Object.entries(row.values).find(([header]) => accepted.has(normalizeHeader(header)));
  return entry?.[1]?.trim() ?? "";
}

function sourceColourNames(row: SheetProductRow) {
  const acceptedHeaders = new Set([
    "meta: legacy colour board options",
    "legacy colour board options",
    "meta: color options",
    "color options",
    "color",
    "colour"
  ]);
  const value = Object.entries(row.values).find(
    ([header, cell]) => acceptedHeaders.has(normalizeHeader(header)) && cell.trim()
  )?.[1]?.trim() ?? "";

  if (!value || /^(?:yes|no|true|false|error|no colou?r option)$/i.test(value)) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .map((option) => String(option?.color_name ?? option?.name ?? "").trim())
        .filter(Boolean);
    }
  } catch {
    // Plain spreadsheet lists are handled below.
  }

  return value
    .split(/\s*\|\s*|\r?\n+/g)
    .map((name) => name.trim())
    .filter(Boolean);
}

function sourceAccessoryNames(row: SheetProductRow) {
  const acceptedHeaders = [
    "meta: product accessories",
    "product accessories",
    "meta: fcw accessory cross sell names",
    "fcw accessory cross sell names",
    "accessories"
  ];
  let value = "";

  for (const acceptedHeader of acceptedHeaders) {
    const entry = Object.entries(row.values).find(
      ([header, cell]) => normalizeHeader(header) === acceptedHeader && cell.trim()
    );

    if (entry) {
      value = entry[1].trim();
      break;
    }
  }

  if (!value || /^(?:yes|no|true|false|error|no accessories)$/i.test(value)) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .map((accessory) => String(accessory?.name ?? accessory ?? "").trim())
        .filter(Boolean)
        .filter((name) => normalizeValue(name) !== normalizeValue(row.name));
    }
  } catch {
    // Plain spreadsheet lists are handled below.
  }

  return value
    .split(/\s*\|\s*|\r?\n+/g)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => normalizeValue(name) !== normalizeValue(row.name));
}

function listFromSection(value: string) {
  return [...new Set(
    value
      .split(/\s*\|\s*|\r?\n+/g)
      .map((item) => item.trim().replace(/[.;]+$/, "").trim())
      .filter(Boolean)
  )];
}

function namedSection(reason: string, name: "Missing" | "Extra") {
  const expression = new RegExp(
    `(?:^|[;\\n])\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=(?:[;\\n]\\s*(?:Missing|Extra)\\s*:)|$)`,
    "i"
  );
  const match = reason.match(expression);
  return match ? listFromSection(match[1]) : [];
}

export function parseProductSheetQaCheck(
  row: SheetProductRow,
  field: ProductSheetQaField
): ProductSheetQaCheck {
  const raw = fieldValue(row, field);
  const failed = /^\s*\[?\s*fail(?:ed)?\s*\]?\b/i.test(raw);
  const reason = failed
    ? raw.replace(/^\s*\[?\s*fail(?:ed)?\s*\]?\s*(?:[-:]\s*)?/i, "").trim()
    : raw;
  const expectedBooleanMatch = reason.match(/\bexpected\s+(yes|no)\b/i);
  const countMatch = reason.match(/\bcount\s+expected\s+(\d+)\s*,\s*found\s+(\d+)\b/i);

  const check: ProductSheetQaCheck = {
    field,
    label: fieldLabels[field],
    failed,
    raw,
    reason,
    ...(expectedBooleanMatch
      ? { expectedBoolean: expectedBooleanMatch[1].toLowerCase() === "yes" }
      : {}),
    ...(countMatch
      ? {
          expectedCount: Number(countMatch[1]),
          foundCount: Number(countMatch[2])
        }
      : {}),
    missing: namedSection(reason, "Missing"),
    extra: namedSection(reason, "Extra")
  };

  if (!failed) {
    return check;
  }

  if (field === "qa_accessories") {
    const expectedNames = [...new Set(sourceAccessoryNames(row))];
    const sourceMatchesReportedCount = check.expectedCount !== undefined &&
      expectedNames.length === check.expectedCount;

    if (expectedNames.length > 0 && sourceMatchesReportedCount) {
      const expectedNameSet = new Set(expectedNames.map(normalizeValue));
      const referencesOutsideSource = check.missing.some(
        (name) => !expectedNameSet.has(normalizeValue(name))
      );

      return {
        ...check,
        expectedCount: check.expectedCount ?? expectedNames.length,
        expectedNames,
        missing: check.missing.filter((name) => expectedNameSet.has(normalizeValue(name))),
        extra: check.extra.filter((name) => !expectedNameSet.has(normalizeValue(name))),
        ...(referencesOutsideSource
          ? {
              reason: `Accessories list contains ${expectedNames.length} expected items; the QA result references names outside that list. Using the spreadsheet Accessories list as the source of truth.`
            }
          : {})
      };
    }

    return check;
  }

  if (field !== "qa_colour") {
    return check;
  }

  const expectedNames = [...new Set(
    sourceColourNames(row)
  )];

  if (expectedNames.length === 0) {
    return check;
  }

  const expectedNameSet = new Set(expectedNames.map(normalizeValue));
  const reportedCount = check.expectedCount;

  return {
    ...check,
    expectedCount: expectedNames.length,
    expectedNames,
    missing: check.missing.filter((name) => expectedNameSet.has(normalizeValue(name))),
    extra: check.extra.filter((name) => !expectedNameSet.has(normalizeValue(name))),
    ...(reportedCount !== undefined && reportedCount !== expectedNames.length
      ? {
          reason: `Colour list contains ${expectedNames.length} options; the QA result reported ${reportedCount}. Using the spreadsheet Color list as the source of truth.`
        }
      : {})
  };
}

export function productSheetQaChecks(row: SheetProductRow): ProductSheetQaChecks {
  return {
    customNotes: parseProductSheetQaCheck(row, "qa_custom_notes"),
    accessories: parseProductSheetQaCheck(row, "qa_accessories"),
    colour: parseProductSheetQaCheck(row, "qa_colour")
  };
}

export function failedProductSheetQaChecks(row: SheetProductRow) {
  const checks = productSheetQaChecks(row);
  return [checks.customNotes, checks.accessories, checks.colour].filter((check) => check.failed);
}

function normalizeValue(value: string) {
  return value
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/\u00e2(?:\u0080\u0093|\u20ac\u201c)|\ufffd/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function resolveProductSheetQaCheck(
  check: ProductSheetQaCheck,
  current: { present: boolean; count?: number; names?: string[] }
): ProductSheetQaCheck {
  if (!check.failed) return check;

  if (check.expectedBoolean !== undefined) {
    return { ...check, resolved: current.present === check.expectedBoolean, currentCount: current.count };
  }

  const currentNames = new Set((current.names ?? []).map(normalizeValue));
  const countMatches = check.expectedCount === undefined || current.count === check.expectedCount;
  const requiredNames = check.expectedNames ?? check.missing;
  const missingResolved = requiredNames.every((name) => currentNames.has(normalizeValue(name)));
  const requiredNameSet = new Set(requiredNames.map(normalizeValue));
  const effectiveExtras = check.extra.filter((name) => !requiredNameSet.has(normalizeValue(name)));
  const extrasRemoved = effectiveExtras.every((name) => !currentNames.has(normalizeValue(name)));
  const hasComparison = check.expectedCount !== undefined || check.missing.length > 0 || check.extra.length > 0;

  return {
    ...check,
    resolved: hasComparison && countMatches && missingResolved && extrasRemoved,
    currentCount: current.count
  };
}

export function productSheetQaCheckNeedsFix(check: ProductSheetQaCheck) {
  return check.failed && !check.resolved;
}
