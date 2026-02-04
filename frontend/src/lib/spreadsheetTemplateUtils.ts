/**
 * Spreadsheet Template API Utilities
 * Frontend functions to interact with the spreadsheet templates backend
 * 
 * Supports:
 * - PER_PRODUCT mode: One row = one product
 * - PER_IMAGE mode: Multiple rows per product (aggregated by SKU/Product ID)
 * - Multi-value columns for image URLs
 * - Auto-mapping based on header names and platform patterns
 * 
 * IMPORTANT: Existing field roles must NOT be renamed or removed
 */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

// ============ Status Types ============
export type SpreadsheetStatus = "uploaded" | "mapped" | "partial";

// ============ Row Mode Types ============
export type RowMode = "PER_PRODUCT" | "PER_IMAGE";

// ============ Image Entry Type ============
/** Image entry with metadata for the unified image_url format */
export interface ImageEntry {
  url: string;
  label: string;      // Original column name (e.g., "Silver Image URL")
  colIndex: number;   // Column position in spreadsheet
}

// ============ FieldRole Schema ============
// DO NOT rename or remove existing roles - only ADD new ones
export type FieldRole =
  // === EXISTING ROLES (DO NOT MODIFY) ===
  // Identity / keys
  | "product_id"          // internal product id, handle, or main identifier
  | "sku"                 // store-level SKU / variant SKU

  // Basic product info
  | "product_title"       // main product name / title
  | "description"         // long description (HTML or plain)
  | "category"            // product category / type
  | "tags"                // comma-separated tags

  // Vendor / brand / sourcing
  | "vendor_name"         // brand or vendor name
  | "vendor_link"         // supplier / source URL (e.g. 1688 product link)
  | "vendor_sku"          // supplier SKU / product code
  | "vendor_price"        // supplier cost if explicitly provided

  // Pricing
  | "price"               // main selling price
  | "compare_at_price"    // Compare At Price for promotions
  | "cost"                // Cost per item

  // Inventory
  | "quantity"            // inventory quantity or on-hand stock

  // Shipping weight
  | "shipping_weight_grams" // e.g. Variant Grams in Shopify
  | "shipping_weight_unit"  // e.g. Variant Weight Unit

  // Attributes / options
  | "attr_color"          // color
  | "attr_size"           // size
  | "attr_material"       // material (e.g. 18K gold, sterling silver)
  | "attr_style"          // style / collection / general design attribute

  // Images
  | "image_url"           // image URL column (can be used multiple times, identified by original column name)
  | "image_position"      // image position number (for PER_IMAGE mode)

  // SEO / Descriptions (existing)
  | "seo_title"
  | "seo_description"
  | "geo_description"     // GEO description for AI search
  | "gso_description"     // GSO description for AI recommendations

  // Fallback
  | "ignore"              // column not used at all

  // === NEW ROLES (Stage 5 Extension) ===
  
  // AI-generated description outputs
  | "ai_seo_description"  // AI-generated SEO long copy
  | "ai_geo_description"  // AI-generated GEO (localized) copy
  | "ai_gso_description"  // AI-generated GSO (shopping ads) copy

  // Google Shopping / GSO structured attributes
  | "gso_category"        // Google product category taxonomy
  | "gso_gender"          // male/female/unisex
  | "gso_age_group"       // adult/teen/kids/infant/toddler/newborn
  | "gso_mpn"             // Manufacturer Part Number
  | "gso_condition"       // new/used/refurbished
  | "gso_is_custom"       // yes/no - custom product flag
  | "gso_gtin"            // GTIN / UPC / EAN / ISBN
  | "gso_brand"           // Brand name for Google Shopping

  // Additional SEO fields
  | "meta_title"          // Page meta title (if different from seo_title)
  | "meta_description"    // Page meta description
  | "url_handle";         // URL slug / handle

// ============ Field Role Option Interface ============
export interface FieldRoleOption {
  role: FieldRole;
  label: string;
  description?: string;
  tags: string[];  // Search keywords (Chinese + English + platform aliases)
}

// ============ Field Role Group Interface ============
export interface FieldRoleGroup {
  id: string;
  label: string;
  labelCn?: string;  // Chinese label for bilingual support
  options: FieldRoleOption[];
}

// ============ Complete Field Role Groups with Search Tags ============
export const FIELD_ROLE_GROUPS: FieldRoleGroup[] = [
  {
    id: "identity",
    label: "Identity",
    labelCn: "标识信息",
    options: [
      { 
        role: "sku", 
        label: "SKU", 
        description: "Store-level SKU or Variant SKU",
        tags: ["sku", "货号", "商品编码", "variant sku", "item sku", "产品编号", "artikelnummer"] 
      },
      { 
        role: "product_id", 
        label: "Product ID / Handle", 
        description: "Internal product identifier or URL handle",
        tags: ["product id", "商品id", "handle", "product_id", "item id", "asin", "产品标识", "id"] 
      },
    ],
  },
  {
    id: "basic",
    label: "Basic Info",
    labelCn: "基础信息",
    options: [
      { 
        role: "product_title", 
        label: "Product Title", 
        description: "Main product name displayed to customers",
        tags: ["title", "标题", "商品标题", "product title", "name", "product name", "商品名称", "名称", "titel"] 
      },
      { 
        role: "description", 
        label: "Description (Long)", 
        description: "Full product description (HTML or plain text)",
        tags: ["description", "描述", "详情", "body", "body_html", "body html", "product description", "详细描述", "beschreibung", "long description"] 
      },
      { 
        role: "category", 
        label: "Category / Type", 
        description: "Product category or type classification",
        tags: ["category", "类目", "分类", "type", "product type", "产品类型", "kategorie", "商品类目"] 
      },
      { 
        role: "tags", 
        label: "Tags / Keywords", 
        description: "Comma-separated tags for filtering",
        tags: ["tags", "标签", "关键字", "keywords", "search terms", "关键词", "标记"] 
      },
    ],
  },
  {
    id: "images",
    label: "Images & Media",
    labelCn: "图片媒体",
    options: [
      { 
        role: "image_url", 
        label: "Image URL", 
        description: "Product image URL column (can be mapped multiple times)",
        tags: ["image", "图片", "主图", "image src", "image url", "图片链接", "main image", "primary image", "featured image", "首图", "bild", "additional image", "附图", "extra images", "gallery", "more images", "other images", "副图", "gallery images", "附加图片", "image1", "image2", "image3", "主图1", "主图2", "图片1", "图片2", "img1", "img2", "pic1", "pic2", "variant image"] 
      },
      { 
        role: "image_position", 
        label: "Image Position", 
        description: "Sort order for images (1, 2, 3...)",
        tags: ["position", "图片顺序", "image position", "sort order", "image order", "排序", "顺序"] 
      },
    ],
  },
  {
    id: "seo",
    label: "SEO & Meta",
    labelCn: "SEO优化",
    options: [
      { 
        role: "seo_title", 
        label: "SEO Title", 
        description: "Search-optimized title for product pages",
        tags: ["seo title", "seo 标题", "meta title", "page title", "搜索标题"] 
      },
      { 
        role: "seo_description", 
        label: "SEO Description", 
        description: "Search-optimized meta description",
        tags: ["seo description", "seo 描述", "meta description", "搜索描述", "元描述"] 
      },
      { 
        role: "meta_title", 
        label: "Meta Title", 
        description: "HTML meta title tag content",
        tags: ["meta title", "页面标题", "html title", "browser title"] 
      },
      { 
        role: "meta_description", 
        label: "Meta Description", 
        description: "HTML meta description tag content",
        tags: ["meta description", "元描述", "page description"] 
      },
      { 
        role: "url_handle", 
        label: "URL Handle / Slug", 
        description: "URL-friendly identifier",
        tags: ["handle", "url handle", "slug", "链接", "url", "permalink", "网址"] 
      },
    ],
  },
  {
    id: "ai_descriptions",
    label: "AI Descriptions",
    labelCn: "AI文案",
    options: [
      { 
        role: "geo_description", 
        label: "GEO Description", 
        description: "AI search optimization description",
        tags: ["geo", "geo description", "geo 描述", "ai search", "搜索优化文案"] 
      },
      { 
        role: "gso_description", 
        label: "GSO Description", 
        description: "AI recommendation system description",
        tags: ["gso", "gso description", "gso 描述", "ai recommendation", "推荐系统文案", "shopping description"] 
      },
      { 
        role: "ai_seo_description", 
        label: "AI SEO Description", 
        description: "AI-generated SEO long copy output",
        tags: ["ai seo", "ai seo description", "ai文案", "generated seo", "自动生成seo"] 
      },
      { 
        role: "ai_geo_description", 
        label: "AI GEO Description", 
        description: "AI-generated localized description output",
        tags: ["ai geo", "ai geo description", "本地化文案", "generated geo", "自动生成geo"] 
      },
      { 
        role: "ai_gso_description", 
        label: "AI GSO Description", 
        description: "AI-generated shopping ads description output",
        tags: ["ai gso", "ai gso description", "购物广告文案", "generated gso", "自动生成gso"] 
      },
    ],
  },
  {
    id: "gso_attributes",
    label: "Google Shopping",
    labelCn: "Google Shopping属性",
    options: [
      { 
        role: "gso_category", 
        label: "Google Product Category", 
        description: "Google taxonomy category path",
        tags: ["google category", "google product category", "google 类目", "taxonomy", "product category id", "谷歌分类"] 
      },
      { 
        role: "gso_brand", 
        label: "Brand (GSO)", 
        description: "Brand name for Google Shopping",
        tags: ["brand", "品牌", "manufacturer", "gso brand", "google brand"] 
      },
      { 
        role: "gso_gtin", 
        label: "GTIN / UPC / EAN", 
        description: "Global Trade Item Number",
        tags: ["gtin", "upc", "ean", "isbn", "barcode", "条形码", "国际商品编码"] 
      },
      { 
        role: "gso_mpn", 
        label: "MPN", 
        description: "Manufacturer Part Number",
        tags: ["mpn", "manufacturer part number", "制造商零件号", "part number", "型号"] 
      },
      { 
        role: "gso_gender", 
        label: "Gender", 
        description: "Target gender (male/female/unisex)",
        tags: ["gender", "性别", "target gender", "男女", "geschlecht"] 
      },
      { 
        role: "gso_age_group", 
        label: "Age Group", 
        description: "Target age group (adult/teen/kids...)",
        tags: ["age group", "年龄段", "age", "target age", "altersgruppe", "年龄组"] 
      },
      { 
        role: "gso_condition", 
        label: "Condition", 
        description: "Product condition (new/used/refurbished)",
        tags: ["condition", "新旧", "product condition", "used", "new", "refurbished", "商品状态", "zustand"] 
      },
      { 
        role: "gso_is_custom", 
        label: "Custom Product", 
        description: "Whether product is customizable (yes/no)",
        tags: ["custom", "custom product", "定制", "is custom", "customizable", "可定制"] 
      },
    ],
  },
  {
    id: "pricing",
    label: "Pricing",
    labelCn: "价格",
    options: [
      { 
        role: "price", 
        label: "Price", 
        description: "Main selling price",
        tags: ["price", "价格", "售价", "variant price", "selling price", "preis", "销售价"] 
      },
      { 
        role: "compare_at_price", 
        label: "Compare-at Price", 
        description: "Original price for showing discounts",
        tags: ["compare at price", "原价", "compare price", "was price", "original price", "划线价", "比较价"] 
      },
      { 
        role: "cost", 
        label: "Cost per Item", 
        description: "Cost/COGS for profit calculation",
        tags: ["cost", "成本", "cost per item", "cogs", "unit cost", "进价", "采购成本"] 
      },
    ],
  },
  {
    id: "vendor",
    label: "Vendor / Sourcing",
    labelCn: "供应商信息",
    options: [
      { 
        role: "vendor_name", 
        label: "Vendor / Brand", 
        description: "Supplier or brand name",
        tags: ["vendor", "供应商", "brand", "品牌", "supplier", "manufacturer", "厂商", "lieferant"] 
      },
      { 
        role: "vendor_link", 
        label: "Source Link", 
        description: "Supplier product URL (e.g., 1688 link)",
        tags: ["vendor link", "货源链接", "source url", "supplier link", "1688", "alibaba", "采购链接", "供货链接"] 
      },
      { 
        role: "vendor_sku", 
        label: "Vendor SKU", 
        description: "Supplier's product code",
        tags: ["vendor sku", "供应商货号", "supplier sku", "厂商SKU", "source sku"] 
      },
      { 
        role: "vendor_price", 
        label: "Vendor Price", 
        description: "Supplier's cost/wholesale price",
        tags: ["vendor price", "进货价", "supplier price", "wholesale price", "采购价", "供货价"] 
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    labelCn: "库存",
    options: [
      { 
        role: "quantity", 
        label: "Quantity / Stock", 
        description: "Available inventory quantity",
        tags: ["quantity", "库存", "stock", "inventory", "on hand", "available", "数量", "bestand"] 
      },
    ],
  },
  {
    id: "shipping",
    label: "Shipping",
    labelCn: "物流",
    options: [
      { 
        role: "shipping_weight_grams", 
        label: "Weight (grams)", 
        description: "Product weight in grams",
        tags: ["weight", "重量", "grams", "variant grams", "shipping weight", "克重", "gewicht"] 
      },
      { 
        role: "shipping_weight_unit", 
        label: "Weight Unit", 
        description: "Weight unit (kg, lb, g, oz)",
        tags: ["weight unit", "重量单位", "variant weight unit", "unit"] 
      },
    ],
  },
  {
    id: "attributes",
    label: "Attributes",
    labelCn: "产品属性",
    options: [
      { 
        role: "attr_color", 
        label: "Color", 
        description: "Product color attribute",
        tags: ["color", "颜色", "colour", "farbe", "option1", "variant option"] 
      },
      { 
        role: "attr_size", 
        label: "Size", 
        description: "Product size attribute",
        tags: ["size", "尺寸", "尺码", "größe", "option2", "dimensions"] 
      },
      { 
        role: "attr_material", 
        label: "Material", 
        description: "Product material (e.g., 18K gold)",
        tags: ["material", "材质", "材料", "fabric", "composition", "stoffzusammensetzung"] 
      },
      { 
        role: "attr_style", 
        label: "Style", 
        description: "Design style or collection",
        tags: ["style", "风格", "款式", "design", "collection", "系列"] 
      },
    ],
  },
  {
    id: "other",
    label: "Other",
    labelCn: "其他",
    options: [
      { 
        role: "ignore", 
        label: "Ignore this column", 
        description: "Column will not be imported",
        tags: ["ignore", "忽略", "skip", "不导入", "überspringen"] 
      },
    ],
  },
];

// ============ Flat Field Role Options (for backward compatibility) ============
export const FIELD_ROLE_OPTIONS: { value: FieldRole; label: string; group: string }[] = 
  FIELD_ROLE_GROUPS.flatMap(group => 
    group.options.map(opt => ({
      value: opt.role,
      label: opt.label,
      group: group.label,
    }))
  );

// ============ Image-related roles (for multi-value toggle display) ============
export const IMAGE_ROLES: FieldRole[] = ["image_url"];

// ============ Types ============
export interface SpreadsheetColumn {
  name: string;
  sampleValues: string[];
  role: FieldRole | null;
  multiValue?: boolean;      // Whether this column contains multiple values in a single cell
  separator?: string | null; // Separator for multi-value columns (default: ",")
  enableGeneration?: boolean; // Whether AI should generate content for this field
}

export interface SpreadsheetTemplate {
  id: string;
  templateName: string;
  platform: "Shopify" | "Amazon" | "ERP" | "Generic";
  fileType: "CSV" | "Excel";
  originalFileName: string;
  storagePath: string;
  rowCount: number;
  headers: string[];
  columns: SpreadsheetColumn[];
  status: SpreadsheetStatus;
  rowMode: RowMode;           // Row structure mode
  groupByField?: "sku" | "product_id";  // Field to group by for PER_IMAGE mode
  createdAt: number;
  updatedAt: number;
}

// ============ Normalized Row Fields (returned by /rows API) ============
// DO NOT remove existing fields - only ADD new ones
export interface NormalizedRowFields {
  // === EXISTING FIELDS (DO NOT MODIFY) ===
  product_id?: string;
  sku?: string;               // First-class SKU field
  product_title?: string;
  description?: string;
  category?: string;
  tags?: string;
  vendor_name?: string;
  vendor_link?: string;
  vendor_sku?: string;
  vendor_price?: number | null;
  price?: number | null;
  compare_at_price?: number | null;
  cost?: number | null;
  quantity?: number | null;
  shipping_weight_grams?: number | null;
  shipping_weight_unit?: string;
  attr_color?: string;
  attr_size?: string;
  attr_material?: string;
  attr_style?: string;
  
  // Unified image structure
  images?: ImageEntry[];
  
  image_position?: number | null;
  seo_title?: string;
  seo_description?: string;
  geo_description?: string;
  gso_description?: string;
  attributes?: Record<string, string>;
  sourceRowIndex: number;

  // === NEW FIELDS (Stage 5 Extension) ===
  // AI-generated description outputs
  ai_seo_description?: string;
  ai_geo_description?: string;
  ai_gso_description?: string;

  // Google Shopping / GSO structured attributes
  gso_category?: string;
  gso_gender?: string;
  gso_age_group?: string;
  gso_mpn?: string;
  gso_condition?: string;
  gso_is_custom?: string | boolean;  // Stored as string in CSV, can be boolean
  gso_gtin?: string;
  gso_brand?: string;

  // Additional SEO fields
  meta_title?: string;
  meta_description?: string;
  url_handle?: string;
}

// ============ Row Item (for PER_PRODUCT mode) ============
export interface SpreadsheetRowItem {
  rowIndex: number;
  fields: NormalizedRowFields;
}

// ============ Aggregated Product (for PER_IMAGE mode) ============
export interface AggregatedProduct {
  key: string;                // SKU or product_id
  rowIndices: number[];       // All underlying sheet rows
  fields: NormalizedRowFields;
}

// ============ /rows API Response ============
export interface SpreadsheetRowsResponse {
  success: boolean;
  spreadsheetId: string;
  rowMode: RowMode;
  page: number;
  pageSize: number;
  total: number;
  items: SpreadsheetRowItem[] | AggregatedProduct[];
  error?: string;
}

// ============ Auto-Mapping Types ============
export interface AutoMapResult {
  role: FieldRole | null;
  confidence: "high" | "medium" | "low";
  matchedTag?: string;
}

// ============ Auto-Mapping: Header Aliases ============
// Maps normalized header names to roles with high confidence
const HEADER_ALIAS_MAP: Record<string, FieldRole> = {
  // Identity
  "sku": "sku",
  "variant sku": "sku",
  "item sku": "sku",
  "product sku": "sku",
  "货号": "sku",
  "商品编码": "sku",
  "product id": "product_id",
  "handle": "product_id",
  "item id": "product_id",
  "asin": "product_id",
  "商品id": "product_id",

  // Basic info
  "title": "product_title",
  "product title": "product_title",
  "name": "product_title",
  "product name": "product_title",
  "标题": "product_title",
  "商品标题": "product_title",
  "description": "description",
  "body": "description",
  "body html": "description",
  "body_html": "description",
  "product description": "description",
  "描述": "description",
  "详情": "description",
  "category": "category",
  "type": "category",
  "product type": "category",
  "类目": "category",
  "分类": "category",
  "tags": "tags",
  "标签": "tags",
  "keywords": "tags",

  // Images - all image-related headers map to image_url
  "image src": "image_url",
  "image url": "image_url",
  "image": "image_url",
  "main image": "image_url",
  "主图": "image_url",
  "图片": "image_url",
  "variant image": "image_url",
  "additional image": "image_url",
  "gallery": "image_url",
  "附图": "image_url",
  "image position": "image_position",

  // Pricing
  "price": "price",
  "variant price": "price",
  "售价": "price",
  "价格": "price",
  "compare at price": "compare_at_price",
  "compare price": "compare_at_price",
  "原价": "compare_at_price",
  "cost": "cost",
  "cost per item": "cost",
  "成本": "cost",

  // Vendor
  "vendor": "vendor_name",
  "brand": "vendor_name",
  "供应商": "vendor_name",
  "品牌": "vendor_name",

  // SEO
  "seo title": "seo_title",
  "meta title": "meta_title",
  "seo description": "seo_description",
  "meta description": "meta_description",
  "url handle": "url_handle",

  // Inventory
  "quantity": "quantity",
  "stock": "quantity",
  "inventory": "quantity",
  "库存": "quantity",

  // Shipping
  "weight": "shipping_weight_grams",
  "variant grams": "shipping_weight_grams",
  "grams": "shipping_weight_grams",
  "重量": "shipping_weight_grams",

  // Attributes
  "color": "attr_color",
  "colour": "attr_color",
  "颜色": "attr_color",
  "size": "attr_size",
  "尺寸": "attr_size",
  "尺码": "attr_size",
  "material": "attr_material",
  "材质": "attr_material",
  "style": "attr_style",
  "风格": "attr_style",

  // Google Shopping
  "google product category": "gso_category",
  "google category": "gso_category",
  "gtin": "gso_gtin",
  "upc": "gso_gtin",
  "ean": "gso_gtin",
  "mpn": "gso_mpn",
  "gender": "gso_gender",
  "age group": "gso_age_group",
  "condition": "gso_condition",
};

/**
 * Normalize a header name for matching
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[_\-\.]+/g, " ")  // Replace separators with spaces
    .replace(/['"()[\]{}]/g, "") // Remove quotes and brackets
    .replace(/\s+/g, " ")        // Collapse multiple spaces
    .trim();
}

/**
 * Auto-detect role for a single header using heuristics
 */
export function autoDetectRoleForHeader(
  headerName: string,
  platform?: string
): AutoMapResult {
  const normalized = normalizeHeader(headerName);
  
  // 1. Exact match in alias map (high confidence)
  if (HEADER_ALIAS_MAP[normalized]) {
    return {
      role: HEADER_ALIAS_MAP[normalized],
      confidence: "high",
      matchedTag: normalized,
    };
  }

  // 2. Search in all role options' tags (medium confidence)
  for (const group of FIELD_ROLE_GROUPS) {
    for (const option of group.options) {
      for (const tag of option.tags) {
        const normalizedTag = normalizeHeader(tag);
        
        // Exact tag match
        if (normalized === normalizedTag) {
          return {
            role: option.role,
            confidence: "medium",
            matchedTag: tag,
          };
        }
        
        // Header contains tag (for compound headers like "Product Title (EN)")
        if (normalized.includes(normalizedTag) && normalizedTag.length >= 3) {
          return {
            role: option.role,
            confidence: "low",
            matchedTag: tag,
          };
        }
      }
    }
  }

  // 3. Platform-specific patterns (medium confidence)
  if (platform === "Shopify") {
    if (normalized.includes("option1") || normalized.includes("option 1")) {
      return { role: "attr_color", confidence: "low", matchedTag: "option1" };
    }
    if (normalized.includes("option2") || normalized.includes("option 2")) {
      return { role: "attr_size", confidence: "low", matchedTag: "option2" };
    }
    if (normalized.includes("option3") || normalized.includes("option 3")) {
      return { role: "attr_material", confidence: "low", matchedTag: "option3" };
    }
  }

  // No match found
  return { role: null, confidence: "low" };
}

/**
 * Auto-map all columns for a template
 * Uses existing mapped templates from same platform as reference
 * Selects the most recently updated template with the same platform
 */
export function autoMapColumns(
  columns: SpreadsheetColumn[],
  platform: string,
  existingTemplates: SpreadsheetTemplate[] = []
): SpreadsheetColumn[] {
  // Find the most recently updated reference template from the same platform that's already mapped
  const samePlatformTemplates = existingTemplates.filter(
    t => t.platform === platform && t.status === "mapped"
  );
  
  // Sort by updatedAt descending (most recent first)
  samePlatformTemplates.sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
  });
  
  // Get the most recently updated template
  const referenceTemplate = samePlatformTemplates[0] || null;
  
  if (referenceTemplate) {
    console.log(`[AutoMap] Using reference template: "${referenceTemplate.templateName}" (updated: ${referenceTemplate.updatedAt})`);
  }

  // Build a map from normalized header -> column config from reference
  const referenceMap = new Map<string, SpreadsheetColumn>();
  if (referenceTemplate) {
    for (const col of referenceTemplate.columns) {
      if (col.role && col.role !== "ignore") {
        const normalizedName = normalizeHeader(col.name);
        referenceMap.set(normalizedName, col);
      }
    }
  }

  return columns.map(col => {
    // Skip if already has a role
    if (col.role) return col;

    const normalizedName = normalizeHeader(col.name);

    // 1. Try to match from reference template (highest priority)
    if (referenceMap.has(normalizedName)) {
      const ref = referenceMap.get(normalizedName)!;
      console.log(`[AutoMap] Platform match: "${col.name}" -> ${ref.role} (from reference)`);
      return {
        ...col,
        role: ref.role,
        multiValue: ref.multiValue,
        separator: ref.separator,
      };
    }

    // 2. Use heuristic detection
    const detected = autoDetectRoleForHeader(col.name, platform);
    if (detected.role && detected.confidence !== "low") {
      console.log(`[AutoMap] Heuristic match: "${col.name}" -> ${detected.role} (${detected.confidence}, tag: ${detected.matchedTag})`);
      return {
        ...col,
        role: detected.role,
        // Auto-enable multiValue for image columns
        multiValue: IMAGE_ROLES.includes(detected.role) ? col.multiValue ?? false : false,
      };
    }

    // No match - leave unmapped
    return col;
  });
}

/**
 * Search field role options by query
 * Returns matching options with their group info
 */
export function searchFieldRoles(query: string): Array<{
  group: FieldRoleGroup;
  option: FieldRoleOption;
  matchType: "label" | "tag";
}> {
  if (!query.trim()) return [];
  
  const normalizedQuery = query.toLowerCase().trim();
  const results: Array<{
    group: FieldRoleGroup;
    option: FieldRoleOption;
    matchType: "label" | "tag";
  }> = [];

  for (const group of FIELD_ROLE_GROUPS) {
    for (const option of group.options) {
      // Check label match
      if (option.label.toLowerCase().includes(normalizedQuery)) {
        results.push({ group, option, matchType: "label" });
        continue;
      }
      
      // Check tag match
      const matchedTag = option.tags.find(tag => 
        tag.toLowerCase().includes(normalizedQuery)
      );
      if (matchedTag) {
        results.push({ group, option, matchType: "tag" });
      }
    }
  }

  return results;
}

// ============ API Functions ============

/**
 * Get all spreadsheet templates for a user
 */
export async function getUserSpreadsheets(
  userId: string
): Promise<SpreadsheetTemplate[]> {
  try {
    const response = await fetch(
      `${API_BASE}/api/spreadsheets?uid=${encodeURIComponent(userId)}`
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch spreadsheets");
    }

    return data.spreadsheets || [];
  } catch (error) {
    console.error("Error fetching spreadsheets:", error);
    throw error;
  }
}

/**
 * Get a single spreadsheet template
 */
export async function getSpreadsheetById(
  userId: string,
  spreadsheetId: string
): Promise<SpreadsheetTemplate | null> {
  try {
    const response = await fetch(
      `${API_BASE}/api/spreadsheets/${spreadsheetId}?uid=${encodeURIComponent(userId)}`
    );

    const data = await response.json();

    if (!data.success) {
      if (response.status === 404) return null;
      throw new Error(data.error || "Failed to fetch spreadsheet");
    }

    return data.spreadsheet;
  } catch (error) {
    console.error("Error fetching spreadsheet:", error);
    throw error;
  }
}

/**
 * Custom error class for API errors with code
 */
export class SpreadsheetApiError extends Error {
  code?: string;
  
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SpreadsheetApiError";
    this.code = code;
  }
}

/**
 * Upload a spreadsheet file and create a template
 */
export async function uploadSpreadsheet(
  userId: string,
  file: File,
  templateName: string,
  platform: string
): Promise<SpreadsheetTemplate> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("uid", userId);
    formData.append("templateName", templateName);
    formData.append("platform", platform);

    const response = await fetch(`${API_BASE}/api/spreadsheets/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!data.success) {
      // Throw error with code so frontend can handle specific cases
      throw new SpreadsheetApiError(
        data.error || "Failed to upload spreadsheet",
        data.code
      );
    }

    console.log(`Spreadsheet uploaded: ${templateName}`);
    return data.spreadsheet;
  } catch (error) {
    console.error("Error uploading spreadsheet:", error);
    throw error;
  }
}

/**
 * Update field mappings for a spreadsheet (including rowMode and multiValue settings)
 */
export async function updateSpreadsheetMappings(
  userId: string,
  spreadsheetId: string,
  columns: SpreadsheetColumn[],
  rowMode: RowMode = "PER_PRODUCT",
  groupByField: "sku" | "product_id" = "product_id"
): Promise<SpreadsheetTemplate> {
  try {
    const response = await fetch(
      `${API_BASE}/api/spreadsheets/${spreadsheetId}/mappings`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uid: userId,
          columns,
          rowMode,
          groupByField,
        }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to update mappings");
    }

    console.log(`Spreadsheet mappings updated: ${spreadsheetId} (groupByField: ${groupByField})`);
    return data.spreadsheet;
  } catch (error) {
    console.error("Error updating mappings:", error);
    throw error;
  }
}

/**
 * Update spreadsheet metadata
 */
export async function updateSpreadsheet(
  userId: string,
  spreadsheetId: string,
  updates: {
    templateName?: string;
    platform?: string;
    columns?: SpreadsheetColumn[];
    rowMode?: RowMode;
  }
): Promise<SpreadsheetTemplate> {
  try {
    const response = await fetch(
      `${API_BASE}/api/spreadsheets/${spreadsheetId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uid: userId,
          ...updates,
        }),
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to update spreadsheet");
    }

    console.log(`Spreadsheet updated: ${spreadsheetId}`);
    return data.spreadsheet;
  } catch (error) {
    console.error("Error updating spreadsheet:", error);
    throw error;
  }
}

/**
 * Delete a spreadsheet template
 */
export async function deleteSpreadsheet(
  userId: string,
  spreadsheetId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${API_BASE}/api/spreadsheets/${spreadsheetId}?uid=${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
      }
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to delete spreadsheet");
    }

    console.log(`Spreadsheet deleted: ${spreadsheetId}`);
    return true;
  } catch (error) {
    console.error("Error deleting spreadsheet:", error);
    throw error;
  }
}

/**
 * Get rows from a spreadsheet with normalization and pagination
 */
export async function getSpreadsheetRows(
  userId: string,
  spreadsheetId: string,
  options: {
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
): Promise<SpreadsheetRowsResponse> {
  try {
    const params = new URLSearchParams({
      uid: userId,
      page: String(options.page || 1),
      pageSize: String(options.pageSize || 20),
    });

    if (options.search) {
      params.append("search", options.search);
    }

    const response = await fetch(
      `${API_BASE}/api/spreadsheets/${spreadsheetId}/rows?${params}`
    );

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch rows");
    }

    return data;
  } catch (error) {
    console.error("Error fetching spreadsheet rows:", error);
    throw error;
  }
}

// ============ Validation Helpers ============

/**
 * Check if PER_IMAGE mode has required key field mapped
 */
export function validatePerImageMode(columns: SpreadsheetColumn[]): {
  valid: boolean;
  error?: string;
} {
  const hasSkuMapped = columns.some((c) => c.role === "sku");
  const hasProductIdMapped = columns.some((c) => c.role === "product_id");

  if (!hasSkuMapped && !hasProductIdMapped) {
    return {
      valid: false,
      error: "PER_IMAGE mode requires either SKU or Product ID to be mapped for grouping rows.",
    };
  }

  return { valid: true };
}

/**
 * Check if column should show multi-value options
 */
export function isImageColumn(role: FieldRole | null): boolean {
  return role !== null && IMAGE_ROLES.includes(role);
}

/**
 * Get display label for a row mode
 */
export function getRowModeDisplayLabel(mode: RowMode): string {
  return mode === "PER_IMAGE" ? "Per-Image (multiple rows per product)" : "Per-Product (one row per product)";
}

/**
 * Get short label for a row mode
 */
export function getRowModeShortLabel(mode: RowMode): string {
  return mode === "PER_IMAGE" ? "Per-Image" : "Per-Product";
}

/**
 * Check if a template has a specific field role mapped
 */
export function hasFieldRole(template: SpreadsheetTemplate, role: FieldRole): boolean {
  return (template.columns || []).some(c => c.role === role);
}

/**
 * Get all mapped roles from a template
 */
export function getMappedRoles(template: SpreadsheetTemplate): FieldRole[] {
  return (template.columns || [])
    .map(c => c.role)
    .filter((role): role is FieldRole => role !== null && role !== "ignore");
}