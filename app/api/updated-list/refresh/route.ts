import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import {
  getUpdatedListData,
  updatedListCacheTag,
  updatedListRowIsDraft,
  updatedListRowIsMissing,
  updatedListRowNeedsSpecifications,
  updatedListRowNeedsUpdate
} from "@/lib/updated-list";

export const maxDuration = 300;

export async function POST() {
  try {
    revalidateTag(updatedListCacheTag, { expire: 0 });
    const data = await getUpdatedListData();

    return NextResponse.json({
      refreshed: true,
      updatedAt: data.updatedAt,
      source: "Product list",
      totalRows: data.rows.length,
      missingProducts: data.rows.filter(updatedListRowIsMissing).length,
      draftProducts: data.rows.filter(updatedListRowIsDraft).length,
      specificationsMissing: data.rows.filter(updatedListRowNeedsSpecifications).length,
      fieldFixes: data.rows.filter(updatedListRowNeedsUpdate).length
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not refresh the updated list." },
      { status: 500 }
    );
  }
}
