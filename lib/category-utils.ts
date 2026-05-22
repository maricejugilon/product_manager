import type { WooCategory } from "@/lib/types";

export type HierarchicalCategoryOption = {
  category: WooCategory;
  depth: number;
  path: string;
};

export function normalizeCategoryName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function slugFromCategoryName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getDirectChildren(categories: WooCategory[], parentId: number) {
  return categories.filter((category) => category.parent === parentId);
}

export function getDescendantCategoryIds(categories: WooCategory[], parentId: number): number[] {
  const childIds = categories
    .filter((category) => category.parent === parentId)
    .map((category) => category.id);

  return childIds.flatMap((id) => [id, ...getDescendantCategoryIds(categories, id)]);
}

export function getCategoryLabel(categories: WooCategory[], categoryId: number) {
  if (categoryId === 0) {
    return "No parent";
  }

  return categories.find((category) => category.id === categoryId)?.name ?? `Category #${categoryId}`;
}

export function getCategoryPath(categories: WooCategory[], categoryId: number) {
  if (categoryId === 0) {
    return "No parent";
  }

  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: string[] = [];
  const visited = new Set<number>();
  let current = byId.get(categoryId);

  while (current && !visited.has(current.id)) {
    path.unshift(current.name || `Category #${current.id}`);
    visited.add(current.id);

    if (current.parent === 0) {
      break;
    }

    current = byId.get(current.parent);
  }

  if (path.length === 0) {
    return `Category #${categoryId}`;
  }

  return path.join(" / ");
}

export function getHierarchicalCategoryOptions(categories: WooCategory[]) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const childrenByParent = new Map<number, WooCategory[]>();

  for (const category of categories) {
    const parentId = byId.has(category.parent) ? category.parent : 0;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), category]);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }

  const options: HierarchicalCategoryOption[] = [];
  const visited = new Set<number>();

  function walk(category: WooCategory, depth: number, ancestors: Set<number>, parentPath: string) {
    if (visited.has(category.id) || ancestors.has(category.id)) {
      return;
    }

    const path = parentPath ? `${parentPath} / ${category.name}` : category.name;
    visited.add(category.id);
    options.push({ category, depth, path });

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(category.id);

    for (const child of childrenByParent.get(category.id) ?? []) {
      walk(child, depth + 1, nextAncestors, path);
    }
  }

  for (const root of childrenByParent.get(0) ?? []) {
    walk(root, 0, new Set<number>(), "");
  }

  for (const category of [...categories].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)) {
    if (!visited.has(category.id)) {
      walk(category, 0, new Set<number>(), "");
    }
  }

  return options;
}

export function isCategoryAncestor(categories: WooCategory[], ancestorId: number, childId: number) {
  let current = categories.find((category) => category.id === childId);
  const visited = new Set<number>();

  while (current && current.parent !== 0 && !visited.has(current.id)) {
    if (current.parent === ancestorId) {
      return true;
    }

    visited.add(current.id);
    current = categories.find((category) => category.id === current?.parent);
  }

  return false;
}
