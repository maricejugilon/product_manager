import { isLikelySiblingProductAccessory } from "@/lib/accessory-name-filter";
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
  currentNames?: string[];
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

function explicitBooleanField(row: SheetProductRow, acceptedHeader: string) {
  const entry = Object.entries(row.values).find(
    ([header, value]) => normalizeHeader(header) === acceptedHeader && value.trim()
  );
  const value = entry?.[1]?.trim() ?? "";

  if (/^(?:yes|true|1)$/i.test(value)) return true;
  if (/^(?:no|false|0)$/i.test(value)) return false;
  return undefined;
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
        .filter((name) => !isLikelySiblingProductAccessory(row.name, name));
    }
  } catch {
    // Plain spreadsheet lists are handled below.
  }

  return value
    .split(/\s*\|\s*|\r?\n+/g)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => !isLikelySiblingProductAccessory(row.name, name));
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
  const expectedBooleanMatch = reason.match(/\bexpected\s*:?\s*(yes|no)\b/i);
  const countMatch = reason.match(
    /\bcount\s+expected\s*:?\s*(\d+)\s*(?:[,;]|\r?\n)\s*found\s*:?\s*(\d+)\b/i
  );

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
    const sourceExpected = explicitBooleanField(row, "accessories option");

    if (sourceExpected === false) {
      return {
        ...check,
        expectedBoolean: false,
        expectedCount: 0,
        expectedNames: [],
        missing: [],
        extra: [],
        reason: "The spreadsheet Accessories field expects no accessories."
      };
    }

    if (expectedNames.length > 0) {
      return {
        ...check,
        expectedBoolean: undefined,
        expectedCount: expectedNames.length,
        expectedNames,
        missing: [],
        extra: [],
        reason: `Using ${expectedNames.length} expected items from the spreadsheet Accessories field.`
      };
    }

    if (sourceExpected === true) {
      return {
        ...check,
        expectedBoolean: true,
        expectedCount: undefined,
        expectedNames: undefined,
        missing: [],
        extra: [],
        reason: "The spreadsheet accessories_option field expects accessories, but the Accessories list is empty."
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

  if (check.expectedBoolean !== undefined && check.expectedNames === undefined) {
    return {
      ...check,
      foundCount: current.count,
      resolved: current.present === check.expectedBoolean,
      currentCount: current.count,
      currentNames: current.names ?? []
    };
  }

  const currentNameByKey = new Map(
    (current.names ?? []).map((name) => [normalizeValue(name), name] as const).filter(([key]) => key)
  );
  const currentNames = new Set(currentNameByKey.keys());
  const countMatches = check.expectedCount === undefined || current.count === check.expectedCount;
  const requiredNames = check.expectedNames ?? check.missing;
  const actualMissing = requiredNames.filter((name) => !currentNames.has(normalizeValue(name)));
  const requiredNameSet = new Set(requiredNames.map(normalizeValue));
  const actualExtra = check.expectedNames
    ? [...currentNameByKey.entries()]
        .filter(([key]) => !requiredNameSet.has(key))
        .map(([, name]) => name)
    : check.extra.filter((name) => currentNames.has(normalizeValue(name)));
  const hasComparison = check.expectedCount !== undefined || requiredNames.length > 0 || check.extra.length > 0;

  return {
    ...check,
    foundCount: current.count,
    missing: actualMissing,
    extra: actualExtra,
    resolved: hasComparison && countMatches && actualMissing.length === 0 && actualExtra.length === 0,
    currentCount: current.count,
    currentNames: [...currentNameByKey.values()]
  };
}

export function productSheetQaCheckNeedsFix(check: ProductSheetQaCheck) {
  return check.failed && !check.resolved;
}
