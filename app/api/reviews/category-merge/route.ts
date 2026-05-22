import { NextResponse } from "next/server";

import {
  getCategoryLabel,
  getDirectChildren,
  isCategoryAncestor,
  normalizeCategoryName
} from "@/lib/category-utils";
import { createReview } from "@/lib/review-store";
import { getCategories } from "@/lib/woocommerce";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sourceId = Number(body.sourceId);
    const targetId = Number(body.targetId);

    if (!Number.isInteger(sourceId) || !Number.isInteger(targetId) || sourceId <= 0 || targetId <= 0) {
      return NextResponse.json({ error: "Source and target categories are required." }, { status: 400 });
    }

    if (sourceId === targetId) {
      return NextResponse.json({ error: "Source and target categories must be different." }, { status: 400 });
    }

    const categories = await getCategories();
    const source = categories.find((category) => category.id === sourceId);
    const target = categories.find((category) => category.id === targetId);

    if (!source || !target) {
      return NextResponse.json({ error: "Source or target category was not found." }, { status: 404 });
    }

    if (normalizeCategoryName(source.name) !== normalizeCategoryName(target.name)) {
      return NextResponse.json(
        { error: "Only categories with the same normalized name can be merged from this tool." },
        { status: 400 }
      );
    }

    if (isCategoryAncestor(categories, source.id, target.id)) {
      return NextResponse.json(
        { error: "Cannot merge a parent category into its own child category. Choose the parent as the target." },
        { status: 400 }
      );
    }

    const sourceChildren = getDirectChildren(categories, source.id);
    const targetChildren = getDirectChildren(categories, target.id);
    const review = await createReview({
      resource: "category_merge",
      action: "merge",
      resourceId: source.id,
      title: `Merge category: ${source.name} #${source.id} into #${target.id}`,
      before: {
        source: {
          id: source.id,
          name: source.name,
          parentId: source.parent,
          parentName: getCategoryLabel(categories, source.parent),
          productCount: source.count ?? 0,
          children: sourceChildren.map((child) => ({ id: child.id, name: child.name }))
        },
        target: {
          id: target.id,
          name: target.name,
          parentId: target.parent,
          parentName: getCategoryLabel(categories, target.parent),
          productCount: target.count ?? 0,
          children: targetChildren.map((child) => ({ id: child.id, name: child.name }))
        }
      },
      changes: {
        sourceId: source.id,
        targetId: target.id,
        sourceName: source.name,
        targetName: target.name,
        sourceParentId: source.parent,
        targetParentId: target.parent
      }
    });

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create category merge review." },
      { status: 500 }
    );
  }
}
