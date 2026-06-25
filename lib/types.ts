export type WooCategory = {
  id: number;
  name: string;
  slug: string;
  parent: number;
  description: string;
  display: string;
  count?: number;
  image?: {
    id?: number;
    src?: string;
    alt?: string;
  } | null;
};

export type WooProductImage = {
  id?: number;
  src: string;
  alt?: string;
  name?: string;
};

export type WooProductCategory = {
  id: number;
  name?: string;
  slug?: string;
};

export type WooProductAttribute = {
  id?: number;
  name?: string;
  position?: number;
  visible?: boolean;
  variation?: boolean;
  options?: string[];
};

export type WooGlobalAttribute = {
  id: number;
  name: string;
  slug: string;
  type: string;
  order_by: string;
  has_archives: boolean;
};

export type WooAttributeTerm = {
  id: number;
  name: string;
  slug: string;
  menu_order: number;
  count: number;
};

export type WooProduct = {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  date_modified?: string;
  type: string;
  status: string;
  featured: boolean;
  catalog_visibility: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: "instock" | "outofstock" | "onbackorder";
  manage_stock: boolean;
  stock_quantity: number | null;
  categories: WooProductCategory[];
  cross_sell_ids?: number[];
  tags?: Array<{ id: number; name?: string; slug?: string }>;
  images: WooProductImage[];
  short_description: string;
  description: string;
  attributes?: WooProductAttribute[];
  meta_data?: Array<{ id?: number; key: string; value: unknown }>;
  dimensions?: {
    length?: string;
    width?: string;
    height?: string;
  };
  weight?: string;
  shipping_class?: string;
  purchase_note?: string;
  menu_order?: number;
};

export type ProductChanges = Partial<{
  type: string;
  name: string;
  sku: string;
  regular_price: string;
  sale_price: string;
  status: string;
  featured: boolean;
  catalog_visibility: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  stock_status: "instock" | "outofstock" | "onbackorder";
  categories: Array<{ id: number }>;
  cross_sell_ids: number[];
  images: Array<{ id?: number; src?: string; alt?: string }>;
  short_description: string;
  description: string;
  attributes: WooProductAttribute[];
  meta_data: Array<{ id?: number; key: string; value: unknown }>;
  dimensions: WooProduct["dimensions"];
  weight: string;
  shipping_class: string;
  tags: Array<{ id: number }>;
  purchase_note: string;
  menu_order: number;
}>;

export type ProductVariationChanges = Partial<{
  sku: string;
  regular_price: string;
  sale_price: string;
  stock_status: "instock" | "outofstock" | "onbackorder";
  manage_stock: boolean;
  stock_quantity: number | null;
  description: string;
  image: { id?: number; src?: string; alt?: string };
  attributes: Array<{ id?: number; name?: string; option: string }>;
  dimensions: WooProduct["dimensions"];
  weight: string;
  shipping_class: string;
  menu_order: number;
}>;

export type WooProductVariation = ProductVariationChanges & {
  id: number;
  permalink?: string;
  price?: string;
};

export type CategoryChanges = Partial<{
  name: string;
  slug: string;
  parent: number;
  description: string;
  display: string;
  image: { id?: number; src?: string; alt?: string } | null;
}>;

export type CategoryMergeChanges = {
  sourceId: number;
  targetId: number;
  sourceName: string;
  targetName: string;
  sourceParentId: number;
  targetParentId: number;
};

export type ProductMergeChanges = {
  mode: "duplicate" | "variation";
  sourceId: number;
  targetId: number;
  sourceName: string;
  targetName: string;
  matchReasons: string[];
  targetChanges: ProductChanges;
  sourceChanges: ProductChanges;
  variationAttributeName?: string;
  targetVariationOption?: string;
  sourceVariationOption?: string;
  parentChanges?: ProductChanges;
  targetVariation?: ProductVariationChanges;
  sourceVariation?: ProductVariationChanges;
};

export type ReviewStatus = "pending" | "approved" | "rejected" | "failed";

export type ReviewRecord = {
  id: string;
  resource: "product" | "category" | "category_merge" | "product_merge";
  action: "update" | "create" | "merge" | "delete";
  resourceId?: number;
  title: string;
  status: ReviewStatus;
  before: unknown;
  changes: ProductChanges | CategoryChanges | CategoryMergeChanges | ProductMergeChanges;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};
