import { getAuth } from "firebase/auth";

const BACKEND_URL = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export type WorkMode = "import" | "create";
export type GenStrategy = "auto" | "manual";

// Platform types for SEO/GEO/GSO descriptions
export type PlatformType = 
  | "shopify"
  | "amazon"
  | "ebay"
  | "etsy"
  | "walmart"
  | "aliexpress"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "google_shopping"
  | "pinterest"
  | "generic";

// Platform display names mapping
export const PLATFORM_OPTIONS: { value: PlatformType; label: string }[] = [
  { value: "shopify", label: "Shopify" },
  { value: "amazon", label: "Amazon" },
  { value: "ebay", label: "eBay" },
  { value: "etsy", label: "Etsy" },
  { value: "walmart", label: "Walmart" },
  { value: "aliexpress", label: "AliExpress" },
  { value: "tiktok", label: "TikTok Shop" },
  { value: "instagram", label: "Instagram Shop" },
  { value: "facebook", label: "Facebook Marketplace" },
  { value: "google_shopping", label: "Google Shopping" },
  { value: "pinterest", label: "Pinterest" },
  { value: "generic", label: "Generic" },
];

// Product information from spreadsheet for description generation
export interface ProductInfo {
  title?: string;
  category?: string;
  sku?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  vendor?: string;
  attributes?: {
    color?: string;
    size?: string;
    material?: string;
    style?: string;
  };
}

// P1a: SpreadsheetContext for tracking generation source
export interface SpreadsheetContext {
  templateId: string;
  rowMode: "PER_PRODUCT" | "PER_IMAGE";
  productKey: string;          // sku or product_id
  sourceRowIndices: number[];  // spreadsheet row indices
  selectedImageUrls: string[]; // original URLs of images used in generation
  // P1b: Add productInfo for description generation
  productInfo?: ProductInfo;
}

export interface GenerateRequest {
  uid?: string;
  workMode?: WorkMode;
  productCategory: string;
  mainPrompt: string;
  variations: string[];
  mainPhotosB64: string[];
  refImagesB64?: string[];
  genStrategy?: GenStrategy;
  genCount?: number;
  seoEnabled?: boolean;
  geoEnabled?: boolean;
  gsoEnabled?: boolean;
  // Phase 2: Extended description fields
  tagsEnabled?: boolean;
  metaTitleEnabled?: boolean;
  metaDescriptionEnabled?: boolean;
  seoTitleEnabled?: boolean;
  // Custom fields with enableGeneration (non-standard fields)
  customFieldsEnabled?: Record<string, boolean>;
  // P1b: Platform selection for descriptions (also used for custom fields)
  seoPlatform?: PlatformType;
  geoPlatform?: PlatformType;
  gsoPlatform?: PlatformType;
  contentPlatform?: PlatformType;  // Platform for custom field generation
  skuEnabled?: boolean;
  skuMode?: "rule" | "direct";
  skuName?: string;
  seqDigits?: number;
  // P1a: Add spreadsheetContext
  spreadsheetContext?: SpreadsheetContext;
  // Output settings (Gemini 3 image generation)
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
}

export interface GenerateResultItem {
  ok: boolean;
  variant?: string;
  prompt?: string;
  images?: Array<{
    dataUrl: string;
    cdnUrl?: string;           // CDN URL
    storagePath?: string;      // Storage 路径
    filename?: string;
    skuName?: string;
    seqDigits?: number;
  }>;
  error?: string;
  index?: number;
}

export interface GenerateResponse {
  success: boolean;
  results?: GenerateResultItem[];
  descriptions?: {
    seo?: string | null;
    geo?: string | null;
    gso?: string | null;
  };
  generationId?: string;       // 生成记录 ID
  error?: string;
  code?: string;
  httpStatus?: number;
}

// Spreadsheet-related types
export type RowMode = "PER_PRODUCT" | "PER_IMAGE";

/** Image entry with metadata for the unified image_url format */
export interface ImageEntry {
  url: string;
  label: string;      // Original column name (e.g., "Silver Image URL")
  colIndex: number;   // Column position in spreadsheet
}

export interface NormalizedRowFields {
  product_id?: string;
  sku?: string;
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
  
  // === Unified image structure ===
  images?: ImageEntry[];
  
  image_position?: number | null;  // Image position for PER_IMAGE mode
  seo_title?: string;
  seo_description?: string;
  // Phase 2: Additional description fields
  geo_description?: string;
  gso_description?: string;
  meta_title?: string;
  meta_description?: string;
  attributes?: Record<string, string>;
  sourceRowIndex: number;
  // Allow dynamic field access - includes all possible field types
  [key: string]: string | number | null | string[] | Record<string, string> | ImageEntry[] | undefined;
}

export interface SpreadsheetRowItem {
  rowIndex?: number;
  key?: string;
  rowIndices?: number[];
  fields: NormalizedRowFields;
}

export interface SpreadsheetRowsResponse {
  success: boolean;
  spreadsheetId: string;
  templateName: string;
  rowMode: RowMode;
  page: number;
  pageSize: number;
  total: number;
  items: SpreadsheetRowItem[];
  error?: string;
}

export interface SpreadsheetTemplateColumn {
  name: string;
  role: string | null;
  sampleValues?: string[];
  multiValue?: boolean;
  separator?: string | null;  // Match spreadsheetTemplateUtils.ts type
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
  columns?: SpreadsheetTemplateColumn[];
  status: "uploaded" | "mapped" | "partial";
  rowMode: RowMode;
  groupByField?: string;  // Phase 2: Field used to group rows (sku or product_id)
  createdAt: number;
  updatedAt: number;
}

// Helper function to build ProductInfo from NormalizedRowFields
export function buildProductInfoFromFields(fields: NormalizedRowFields): ProductInfo {
  // Helper to strip HTML tags
  const stripHtml = (html: string = ""): string => {
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  };
  
  // Helper to clip text
  const clip = (text: string = "", max: number = 400): string => {
    const t = String(text).trim();
    return t.length > max ? `${t.slice(0, max)}...` : t;
  };
  
  // Parse tags string to array
  const parseTags = (tagsStr: string = ""): string[] => {
    if (!tagsStr) return [];
    return tagsStr.split(/[,;]/).map(t => t.trim()).filter(Boolean);
  };
  
  const productInfo: ProductInfo = {};
  
  if (fields.product_title) {
    productInfo.title = clip(fields.product_title, 200);
  }
  
  if (fields.category) {
    productInfo.category = clip(fields.category, 100);
  }
  
  if (fields.sku) {
    productInfo.sku = fields.sku;
  }
  
  if (fields.description) {
    productInfo.description = clip(stripHtml(fields.description), 400);
  }
  
  if (fields.seo_title) {
    productInfo.seoTitle = clip(fields.seo_title, 150);
  }
  
  if (fields.seo_description) {
    productInfo.seoDescription = clip(stripHtml(fields.seo_description), 300);
  }
  
  if (fields.tags) {
    const tagsArray = parseTags(fields.tags);
    if (tagsArray.length > 0) {
      productInfo.tags = tagsArray.slice(0, 20); // Max 20 tags
    }
  }
  
  if (fields.vendor_name) {
    productInfo.vendor = clip(fields.vendor_name, 100);
  }
  
  // Build attributes
  const attributes: ProductInfo["attributes"] = {};
  if (fields.attr_color) attributes.color = fields.attr_color;
  if (fields.attr_size) attributes.size = fields.attr_size;
  if (fields.attr_material) attributes.material = fields.attr_material;
  if (fields.attr_style) attributes.style = fields.attr_style;
  
  if (Object.keys(attributes).length > 0) {
    productInfo.attributes = attributes;
  }
  
  return productInfo;
}

export async function generateImages(
  req: GenerateRequest
): Promise<GenerateResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid || null;
  const email = user?.email || null;

  const payload: Record<string, unknown> = {
    uid,
    email,
    workMode: req.workMode ?? "import",
    productCategory: (req.productCategory || "").trim(),
    mainPrompt: (req.mainPrompt || "").trim(),
    variations: Array.isArray(req.variations)
      ? req.variations.map((v) => (v || "").trim()).filter(Boolean)
      : [],
    mainPhotosB64: Array.isArray(req.mainPhotosB64)
      ? req.mainPhotosB64
      : [],
    refImagesB64: Array.isArray(req.refImagesB64)
      ? req.refImagesB64
      : [],
    genStrategy: req.genStrategy ?? "auto",
    genCount: req.genCount ?? 1,
    seoEnabled: req.seoEnabled ?? false,
    geoEnabled: req.geoEnabled ?? false,
    gsoEnabled: req.gsoEnabled ?? false,
    // Phase 2: Extended description fields
    tagsEnabled: req.tagsEnabled ?? false,
    metaTitleEnabled: req.metaTitleEnabled ?? false,
    metaDescriptionEnabled: req.metaDescriptionEnabled ?? false,
    seoTitleEnabled: req.seoTitleEnabled ?? false,
    // Custom fields with enableGeneration
    customFieldsEnabled: req.customFieldsEnabled ?? {},
    // P1b: Include platform selections
    seoPlatform: req.seoPlatform ?? "generic",
    geoPlatform: req.geoPlatform ?? "generic",
    gsoPlatform: req.gsoPlatform ?? "generic",
    contentPlatform: req.contentPlatform ?? req.seoPlatform ?? "generic",  // Platform for custom fields
    skuEnabled: req.skuEnabled ?? false,
    skuMode: req.skuMode ?? "rule",
    skuName: (req.skuName || "").trim(),
    seqDigits: req.seqDigits ?? 3,
    // Output settings (Gemini 3 image generation)
    aspectRatio: req.aspectRatio ?? "1:1",
    resolution: req.resolution ?? "1024",
    width: req.width,
    height: req.height,
  };

  // P1a: Include spreadsheetContext if provided
  if (req.spreadsheetContext) {
    payload.spreadsheetContext = req.spreadsheetContext;
  }

  console.log("[API] Sending payload:", {
    uid,
    workMode: payload.workMode,
    productCategory: payload.productCategory,
    mainPromptLen: (payload.mainPrompt as string).length,
    variations: (payload.variations as string[]).length,
    mainPhotos: (payload.mainPhotosB64 as string[]).length,
    refImages: (payload.refImagesB64 as string[]).length,
    genStrategy: payload.genStrategy,
    genCount: payload.genCount,
    seoEnabled: payload.seoEnabled,
    geoEnabled: payload.geoEnabled,
    gsoEnabled: payload.gsoEnabled,
    tagsEnabled: payload.tagsEnabled,
    metaTitleEnabled: payload.metaTitleEnabled,
    metaDescriptionEnabled: payload.metaDescriptionEnabled,
    seoTitleEnabled: payload.seoTitleEnabled,
    customFieldsEnabled: payload.customFieldsEnabled,
    contentPlatform: payload.contentPlatform,
    skuEnabled: payload.skuEnabled,
    hasSpreadsheetContext: !!req.spreadsheetContext,
  });

  let httpStatus = 0;

  try {
    const response = await fetch(`${BACKEND_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    httpStatus = response.status;

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!data) {
      return {
        success: false,
        httpStatus,
        error: `Empty response (HTTP ${httpStatus})`,
      };
    }

    const code = data.code || null;
    const error = data.error || data.message || "";

    if (data.success === false) {
      return {
        success: false,
        httpStatus,
        code,
        error: error || `Request failed (HTTP ${httpStatus})`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        httpStatus,
        code,
        error: error || `HTTP ${httpStatus}: ${response.statusText}`,
      };
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const descriptions = data.descriptions || {};
    
    console.log(
      "[API] Received results:",
      results.map((r: any) => ({
        ok: r.ok,
        count: r.images?.length || 0,
        hasSkuNames: r.images?.some((img: any) => img.skuName) || false,
      }))
    );
    
    console.log("[API] Received descriptions:", {
      seo: descriptions.seo ? `${descriptions.seo.substring(0, 50)}...` : 'none',
      geo: descriptions.geo ? `${descriptions.geo.substring(0, 50)}...` : 'none',
      gso: descriptions.gso ? `${descriptions.gso.substring(0, 50)}...` : 'none',
    });

    return { success: true, httpStatus, results, descriptions };
  } catch (err: any) {
    console.error("[API] Network error:", err);
    return {
      success: false,
      httpStatus: 0,
      error: err?.message || "Network error or CORS issue",
    };
  }
}

/**
 * Get all spreadsheet templates for a user (only mapped ones)
 */
export async function getUserSpreadsheetTemplates(
  uid: string
): Promise<SpreadsheetTemplate[]> {
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/spreadsheets?uid=${encodeURIComponent(uid)}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch spreadsheets: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch spreadsheets");
    }

    // Filter only mapped templates
    const templates = (data.spreadsheets || []).filter(
      (t: SpreadsheetTemplate) => t.status === "mapped"
    );

    return templates;
  } catch (err: any) {
    console.error("[API] Error fetching spreadsheet templates:", err);
    throw err;
  }
}

/**
 * Get rows from a spreadsheet with normalization and pagination
 */
export async function fetchSpreadsheetRows(
  uid: string,
  spreadsheetId: string,
  options: { page?: number; pageSize?: number; search?: string } = {}
): Promise<SpreadsheetRowsResponse> {
  try {
    const params = new URLSearchParams({ uid });
    if (options.page) params.set("page", String(options.page));
    if (options.pageSize) params.set("pageSize", String(options.pageSize));
    if (options.search) params.set("search", options.search);

    const response = await fetch(
      `${BACKEND_URL}/api/spreadsheets/${spreadsheetId}/rows?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch spreadsheet rows: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to fetch spreadsheet rows");
    }

    return data;
  } catch (err: any) {
    console.error("[API] Error fetching spreadsheet rows:", err);
    throw err;
  }
}

// ============================================================
// Stage 1: Spreadsheet Results Overlay Types & API
// ============================================================

/**
 * Mode for saving generated images back to spreadsheet
 */
export type SpreadsheetResultMode =
  | "REPLACE_ALL_IMAGES_PER_PRODUCT"   // rowMode=PER_PRODUCT: replace all image columns
  | "APPEND_IMAGES_PER_PRODUCT"        // rowMode=PER_PRODUCT: append after existing
  | "REPLACE_ALL_ROWS_PER_IMAGE"       // rowMode=PER_IMAGE: delete old rows, rebuild with new images
  | "APPEND_ROWS_PER_IMAGE";           // rowMode=PER_IMAGE: append new rows after existing

/**
 * A saved result scenario for a product in a spreadsheet
 */
export interface SpreadsheetResultScenario {
  id: string;
  templateId: string;
  userId: string;
  rowMode: RowMode;
  productKey: string;      // sku or product_id
  mode: SpreadsheetResultMode;
  imageUrls: string[];     // CDN URLs
  createdAt: number;
  generationId?: string;
  rowIndices?: number[];
}

/**
 * Payload for saving spreadsheet results
 */
export interface SaveSpreadsheetResultsPayload {
  templateId: string;
  productKey: string;
  rowMode: RowMode;
  mode: SpreadsheetResultMode;
  imageUrls: string[];     // CDN URLs from generation
  rowIndices?: number[];
  generationId?: string;
  // Phase 2: Cross-spreadsheet save support
  targetTemplateId?: string;  // Optional: save to different spreadsheet
  writeMode?: "add" | "override";  // Optional: write mode for cross-save
}

/**
 * Save generated images to spreadsheet overlay
 */
export async function saveSpreadsheetResults(
  userId: string,
  payload: SaveSpreadsheetResultsPayload
): Promise<{ id: string }> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${payload.templateId}/results`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to save spreadsheet results");
  }

  return response.json();
}

/**
 * Fetch all result scenarios for a spreadsheet template
 */
export async function fetchSpreadsheetResults(
  userId: string,
  templateId: string
): Promise<SpreadsheetResultScenario[]> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/results`,
    {
      headers: { "X-User-Id": userId },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch spreadsheet results");
  }

  const data = await response.json();
  return data.scenarios || [];
}

// ============================================================
// Stage 4: Full Export API
// ============================================================

/**
 * Options for exporting spreadsheet with full structure
 */
export interface ExportSpreadsheetPayload {
  onlyUpdated?: boolean;      // Only export products with updates
  dedupeImages?: boolean;     // Remove duplicate image URLs
  exportOverrides?: Record<string, string[]>;  // Frontend-specified image overrides
}

/**
 * Export spreadsheet with results as CSV (full structure)
 * Uses POST to send export options in body
 */
export async function exportSpreadsheetWithResults(
  userId: string,
  templateId: string,
  options?: ExportSpreadsheetPayload
): Promise<Blob> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/export`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body: JSON.stringify(options || {}),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to export spreadsheet");
  }

  return await response.blob();
}

/**
 * Trigger download from blob
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Delete a specific result scenario
 */
export async function deleteSpreadsheetScenario(
  userId: string,
  templateId: string,
  scenarioId: string
): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/results/${scenarioId}`,
    {
      method: "DELETE",
      headers: { "X-User-Id": userId },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to delete scenario");
  }
}

/**
 * Delete all scenarios for a specific product (restore to original)
 */
export async function restoreProductToOriginal(
  userId: string,
  templateId: string,
  productKey: string
): Promise<{ deleted: number }> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/results?productKey=${encodeURIComponent(productKey)}`,
    {
      method: "DELETE",
      headers: { "X-User-Id": userId },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to restore product to original");
  }

  return response.json();
}

// ============ Export Overrides (Persistent Storage) ============

/**
 * Get saved export overrides for a template
 */

// Stage 20: Add position type for new products
export type AddPosition = "last" | "before";

// Export override format - extended to support new products
export interface ExportOverrideNewProduct {
  images: string[];
  categories: string[];
  updatedAt?: number;
  sourceTemplateId?: string;
  // New product fields
  isNewProduct: true;
  productId: string;
  sku: string;
  addPosition: AddPosition;
  insertBeforeProductKey?: string;  // Required when addPosition === "before"
}

export interface ExportOverrideExisting {
  images: string[];
  categories: string[];
  updatedAt?: number;
  sourceTemplateId?: string;
  isNewProduct?: false;
}

export type ExportOverrideValue = ExportOverrideNewProduct | ExportOverrideExisting | string[];

// Helper to check if override is a new product
export function isNewProductOverride(override: ExportOverrideValue): override is ExportOverrideNewProduct {
  return (
    typeof override === 'object' &&
    !Array.isArray(override) &&
    'isNewProduct' in override &&
    override.isNewProduct === true
  );
}

export async function getExportOverrides(
  userId: string,
  templateId: string
): Promise<Record<string, ExportOverrideValue>> {
  console.log(`[API] getExportOverrides called for template ${templateId}`);
  
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/spreadsheets/${templateId}/export-overrides`,
      {
        headers: { "X-User-Id": userId },
      }
    );

    console.log(`[API] getExportOverrides response status: ${response.status}`);

    if (!response.ok) {
      console.warn(`[API] Failed to fetch export overrides: ${response.status}`);
      return {};
    }

    const data = await response.json();
    console.log(`[API] getExportOverrides result:`, Object.keys(data.overrides || {}));
    return data.overrides || {};
  } catch (err) {
    console.error("[API] getExportOverrides error:", err);
    return {};
  }
}

/**
 * Save export override for a specific product
 * Supports both existing product overrides and new product creation
 */
export async function saveExportOverride(
  userId: string,
  templateId: string,
  productKey: string,
  imageUrls: string[],
  categories?: string[],  // Optional: category labels for cross-category drag support
  targetTemplateId?: string,  // Phase 2: Optional target template for cross-spreadsheet save
  // Stage 20: New product options
  newProductOptions?: {
    isNewProduct: true;
    productId: string;
    sku: string;
    addPosition: AddPosition;
    insertBeforeProductKey?: string;
  }
): Promise<void> {
  // Use targetTemplateId if provided, otherwise use templateId
  const effectiveTemplateId = targetTemplateId || templateId;
  
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${effectiveTemplateId}/export-overrides`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body: JSON.stringify({ 
        productKey, 
        imageUrls, 
        categories,
        // Include source info for audit/debugging
        ...(targetTemplateId && { sourceTemplateId: templateId }),
        // Stage 20: New product options
        ...(newProductOptions && {
          isNewProduct: newProductOptions.isNewProduct,
          productId: newProductOptions.productId,
          sku: newProductOptions.sku,
          addPosition: newProductOptions.addPosition,
          ...(newProductOptions.insertBeforeProductKey && {
            insertBeforeProductKey: newProductOptions.insertBeforeProductKey,
          }),
        }),
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to save export override");
  }
}

/**
 * Delete export override for a specific product
 */
export async function deleteExportOverride(
  userId: string,
  templateId: string,
  productKey: string
): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/export-overrides/${encodeURIComponent(productKey)}`,
    {
      method: "DELETE",
      headers: { "X-User-Id": userId },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to delete export override");
  }
}

// ============ Subscription & Spreadsheet Limits ============

export interface SubscriptionInfo {
  active: boolean;
  status: string;
  planName: string;
  planPrice: number;
  credits: number;
  cycle: string;
}

/**
 * Get user's subscription status
 */
export async function getSubscriptionStatus(
  userId: string
): Promise<SubscriptionInfo[]> {
  const response = await fetch(
    `${BACKEND_URL}/api/subscription-status?uid=${userId}`
  );

  if (!response.ok) {
    console.warn("Failed to fetch subscription status");
    return [];
  }

  return response.json();
}

/**
 * Get spreadsheet limit based on subscription
 */
export function getSpreadsheetLimit(subscriptions: SubscriptionInfo[]): number {
  // Find active subscription with highest tier
  const activeSub = subscriptions.find(s => s.active);
  
  if (!activeSub) {
    // No active subscription - free/credit pack user
    return 3;
  }

  const planName = activeSub.planName.toLowerCase();
  
  if (planName.includes("studio")) {
    return 30;
  } else if (planName.includes("creator")) {
    return 10;
  } else if (planName.includes("starter")) {
    return 5;
  }
  
  // Default for unknown plans
  return 3;
}

/**
 * Check if user can create more spreadsheets
 */
export async function checkSpreadsheetLimit(
  userId: string
): Promise<{ canCreate: boolean; current: number; limit: number; planName: string }> {
  const [templates, subscriptions] = await Promise.all([
    getUserSpreadsheetTemplates(userId),
    getSubscriptionStatus(userId),
  ]);

  const current = templates.length;
  const limit = getSpreadsheetLimit(subscriptions);
  const activeSub = subscriptions.find(s => s.active);
  const planName = activeSub?.planName || "Free";

  return {
    canCreate: current < limit,
    current,
    limit,
    planName,
  };
}

// ============ Description Overrides ============

// Phase 2: Extended description types (seo/geo/gso + tags/meta)
// Also allow string for custom fields with enableGeneration
export type DescriptionType = "seo" | "geo" | "gso" | "seo_title" | "tags" | "meta_title" | "meta_description" | string;

/**
 * Convert short description type names to full role names
 * This normalizes the naming convention between API calls and template column roles
 * 
 * @param type - Short type name (e.g., 'seo') or full role name (e.g., 'category')
 * @returns Full role name (e.g., 'seo_description' or 'category')
 */
export function normalizeDescriptionType(type: DescriptionType): string {
  const typeToRole: Record<string, string> = {
    seo: 'seo_description',
    geo: 'geo_description',
    gso: 'gso_description',
  };
  return typeToRole[type] || type;
}

// Phase 2: All generatable field types (for selectedFields)
export type GeneratableField = 
  | "seo_description"
  | "geo_description" 
  | "gso_description"
  | "seo_title"
  | "tags"
  | "meta_title"
  | "meta_description";

// Phase 2: Map template platform to PlatformType
export function templatePlatformToPlatformType(templatePlatform?: string): PlatformType {
  if (!templatePlatform) return "generic";
  
  const mapping: Record<string, PlatformType> = {
    "Shopify": "shopify",
    "Amazon": "amazon",
    "ERP": "generic",
    "Generic": "generic",
    // Also handle already-lowercase values
    "shopify": "shopify",
    "amazon": "amazon",
    "ebay": "ebay",
    "etsy": "etsy",
    "walmart": "walmart",
    "aliexpress": "aliexpress",
    "tiktok": "tiktok",
    "instagram": "instagram",
    "facebook": "facebook",
    "google_shopping": "google_shopping",
    "pinterest": "pinterest",
    "generic": "generic",
  };
  
  return mapping[templatePlatform] || "generic";
}

// Phase 2: Field generation config
export interface GeneratableFieldConfig {
  field: GeneratableField;
  label: string;
  description: string;
  cost: number;
  requiredRoles: string[];  // At least one of these roles must be mapped
}

export const GENERATABLE_FIELDS: GeneratableFieldConfig[] = [
  // Descriptions & SEO
  { field: "seo_title", label: "SEO Title", description: "Keyword-optimized title for search", cost: 5, requiredRoles: ["seo_title"] },
  { field: "seo_description", label: "SEO Description", description: "Keyword-optimized for Google search", cost: 20, requiredRoles: ["seo_description", "ai_seo_description"] },
  { field: "geo_description", label: "GEO Description", description: "Semantic descriptions for AI search", cost: 40, requiredRoles: ["geo_description", "ai_geo_description"] },
  { field: "gso_description", label: "GSO Description", description: "Encyclopedia-style for AI recommendations", cost: 30, requiredRoles: ["gso_description", "ai_gso_description"] },
  // Meta
  { field: "meta_title", label: "Meta Title", description: "Page meta title (≤60 chars)", cost: 5, requiredRoles: ["meta_title"] },
  { field: "meta_description", label: "Meta Description", description: "Page meta description (≤155 chars)", cost: 5, requiredRoles: ["meta_description"] },
  // Tags
  { field: "tags", label: "Tags", description: "Comma-separated product tags", cost: 10, requiredRoles: ["tags"] },
];

export interface DescriptionOverrides {
  seo?: string;
  geo?: string;
  gso?: string;
  // Phase 2: Additional fields
  tags?: string;
  meta_title?: string;
  meta_description?: string;
  seo_title?: string;
  // Support custom fields with enableGeneration
  [key: string]: string | undefined;
}

/**
 * Get saved description overrides for a template
 */
export async function getDescriptionOverrides(
  userId: string,
  templateId: string
): Promise<Record<string, DescriptionOverrides>> {
  // Short type names to full role names mapping
  const shortToFullRole: Record<string, string> = {
    seo: "seo_description",
    geo: "geo_description",
    gso: "gso_description",
  };
  
  try {
    const response = await fetch(
      `${BACKEND_URL}/api/spreadsheets/${templateId}/description-overrides`,
      {
        headers: { "X-User-Id": userId },
      }
    );

    if (!response.ok) {
      console.warn(`[API] Failed to fetch description overrides: ${response.status}`);
      return {};
    }

    const data = await response.json();
    const rawOverrides = data.overrides || {};
    
    // Normalize keys: convert short type names to full role names
    // This ensures consistency with col.role used in App.tsx
    const normalizedOverrides: Record<string, DescriptionOverrides> = {};
    for (const [productKey, descriptions] of Object.entries(rawOverrides)) {
      const normalizedDescriptions: DescriptionOverrides = {};
      for (const [key, value] of Object.entries(descriptions as DescriptionOverrides)) {
        // Convert short name to full role name if applicable
        const fullKey = shortToFullRole[key] || key;
        normalizedDescriptions[fullKey] = value;
      }
      normalizedOverrides[productKey] = normalizedDescriptions;
    }
    
    return normalizedOverrides;
  } catch (err) {
    console.error("[API] getDescriptionOverrides error:", err);
    return {};
  }
}

/**
 * Save description override for a specific product
 */
export async function saveDescriptionOverride(
  userId: string,
  templateId: string,
  productKey: string,
  descriptionType: DescriptionType,
  content: string
): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/description-overrides`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
      },
      body: JSON.stringify({ productKey, descriptionType, content }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to save description override");
  }
}

/**
 * Delete description overrides for a specific product
 */
export async function deleteDescriptionOverride(
  userId: string,
  templateId: string,
  productKey: string
): Promise<void> {
  const response = await fetch(
    `${BACKEND_URL}/api/spreadsheets/${templateId}/description-overrides/${encodeURIComponent(productKey)}`,
    {
      method: "DELETE",
      headers: { "X-User-Id": userId },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to delete description override");
  }
}

/**
 * Check if a template has a specific description field mapped
 */
export function hasDescriptionField(
  template: SpreadsheetTemplate,
  descriptionType: DescriptionType
): boolean {
  if (!template.columns) return false;
  
  const roleMap: Record<DescriptionType, string> = {
    seo: "seo_description",
    geo: "geo_description",
    gso: "gso_description",
    // Phase 2: Additional fields
    seo_title: "seo_title",
    tags: "tags",
    meta_title: "meta_title",
    meta_description: "meta_description",
  };
  
  const role = roleMap[descriptionType];
  return template.columns.some((col: any) => col.role === role);
}

// ============ SSE Progress Support ============

export type ImageGenerationStage = 
  | 'idle'
  | 'understanding'
  | 'planning'
  | 'generating'
  | 'uploading'
  | 'complete'
  | 'error';

// Text generation stage - sent when text is ready before images
export type TextGenerationStage = 'text_complete';

export interface ProgressEvent {
  type: 'progress';
  stage: ImageGenerationStage | TextGenerationStage;
  timestamp: number;
  message?: string;
}

export interface ResultEvent {
  type: 'result';
  timestamp: number;
  success: boolean;
  results?: GenerateResultItem[];
  descriptions?: {
    seo?: string | null;
    geo?: string | null;
    gso?: string | null;
    tags?: string | null;
    meta_title?: string | null;
    meta_description?: string | null;
    seo_title?: string | null;
    [key: string]: string | null | undefined;
  };
  generationId?: string;
  error?: string;
  code?: string;
}

type SSEEvent = ProgressEvent | ResultEvent;

export type OnProgressCallback = (stage: ImageGenerationStage | TextGenerationStage, data?: Partial<ProgressEvent>) => void;

/**
 * Generate images with real-time progress updates via SSE
 */
export async function generateImagesWithProgress(
  req: GenerateRequest,
  onProgress: OnProgressCallback
): Promise<GenerateResponse> {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid || null;
  const email = user?.email || null;

  const payload: Record<string, unknown> = {
    uid,
    email,
    workMode: req.workMode ?? "import",
    productCategory: (req.productCategory || "").trim(),
    mainPrompt: (req.mainPrompt || "").trim(),
    variations: Array.isArray(req.variations)
      ? req.variations.map((v) => (v || "").trim()).filter(Boolean)
      : [],
    mainPhotosB64: Array.isArray(req.mainPhotosB64) ? req.mainPhotosB64 : [],
    refImagesB64: Array.isArray(req.refImagesB64) ? req.refImagesB64 : [],
    genStrategy: req.genStrategy ?? "auto",
    genCount: req.genCount ?? 1,
    seoEnabled: req.seoEnabled ?? false,
    geoEnabled: req.geoEnabled ?? false,
    gsoEnabled: req.gsoEnabled ?? false,
    tagsEnabled: req.tagsEnabled ?? false,
    metaTitleEnabled: req.metaTitleEnabled ?? false,
    metaDescriptionEnabled: req.metaDescriptionEnabled ?? false,
    seoTitleEnabled: req.seoTitleEnabled ?? false,
    customFieldsEnabled: req.customFieldsEnabled ?? {},
    seoPlatform: req.seoPlatform ?? "generic",
    geoPlatform: req.geoPlatform ?? "generic",
    gsoPlatform: req.gsoPlatform ?? "generic",
    contentPlatform: req.contentPlatform ?? req.seoPlatform ?? "generic",
    skuEnabled: req.skuEnabled ?? false,
    skuMode: req.skuMode ?? "rule",
    skuName: (req.skuName || "").trim(),
    seqDigits: req.seqDigits ?? 3,
    aspectRatio: req.aspectRatio ?? "1:1",
    resolution: req.resolution ?? "1024",
    width: req.width,
    height: req.height,
  };

  if (req.spreadsheetContext) {
    payload.spreadsheetContext = req.spreadsheetContext;
  }

  console.log("[API] Starting SSE generation request");

  return new Promise((resolve) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    fetch(`${BACKEND_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        
        if (contentType?.includes('text/event-stream')) {
          const reader = response.body?.getReader();
          if (!reader) throw new Error("No response body");

          const decoder = new TextDecoder();
          let buffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const eventData = JSON.parse(line.slice(6)) as SSEEvent;
                    
                    if (eventData.type === "progress") {
                      const pe = eventData as ProgressEvent;
                      console.log(`[API] Progress: ${pe.stage}`, pe.message || '');
                      onProgress(pe.stage, pe);
                    } else if (eventData.type === "result") {
                      const re = eventData as ResultEvent;
                      console.log("[API] Result:", re.success);
                      resolve({
                        success: re.success,
                        results: re.results || [],
                        descriptions: re.descriptions || {},
                        generationId: re.generationId,
                        error: re.error,
                        code: re.code,
                      });
                      return;
                    }
                  } catch {
                    console.warn("[API] Parse error:", line);
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        } else {
          const data = await response.json();
          resolve({
            success: data.success ?? false,
            results: data.results || [],
            descriptions: data.descriptions || {},
            generationId: data.generationId,
            error: data.error,
            code: data.code,
          });
        }
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        console.error("[API] SSE error:", error);
        onProgress('error', { message: error.message });
        resolve({
          success: false,
          error: error.name === 'AbortError' ? 'Request timed out' : error.message,
        });
      });
  });
}