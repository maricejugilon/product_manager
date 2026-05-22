import { NextResponse } from "next/server";

import { getDirectChildren, getCategoryPath } from "@/lib/category-utils";
import { createReview } from "@/lib/review-store";
import { getCategories } from "@/lib/woocommerce";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const categoryId = Number(body.categoryId);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ error: "Category is required." }, { status: 400 });
    }

    const categories = await getCategories();
    const category = categories.find((item) => item.id === categoryId);

    if (!category) {
      return NextResponse.json({ error: "Category was not found." }, { status: 404 });
    }

    const children = getDirectChildren(categories, category.id);

    if ((category.count ?? 0) > 0) {
      return NextResponse.json({ error: "Category still has assigned products." }, { status: 400 });
    }

    if (children.length > 0) {
      return NextResponse.json(
        { error: "Category still has child categories. Clean child categories first." },
        { status: 400 }
      );
    }

    const review = await createReview({
      resource: "category",
      action: "delete",
      resourceId: category.id,
      title: `Delete empty category: ${category.name}`,
      before: {
        ...category,
        path: getCategoryPath(categories, category.id)
      },
      changes: {}
    });

    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create category cleanup review." },
      { status: 500 }
    );
  }
}
