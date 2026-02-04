/**
 * Spreadsheet Overlay Utilities
 * 
 * Implements the "original table + overlay" pattern:
 * - Original rows remain read-only
 * - SpreadsheetResultScenario records describe all replace/append operations
 * - This utility merges them to produce a "working view"
 * 
 * File location: frontend/src/lib/spreadsheetOverlay.ts
 */

import { 
  SpreadsheetRowItem, 
  SpreadsheetResultScenario, 
  SpreadsheetResultMode, 
  RowMode, 
  ImageEntry,
  // Stage 20: Export override types for new products
  ExportOverrideValue,
  ExportOverrideNewProduct,
  isNewProductOverride,
  AddPosition,
} from "./api";

// GroupByField type for PER_IMAGE mode
type GroupByField = "sku" | "product_id";

// ============================================================
// Types for Results Modal
// ============================================================

/**
 * Categorized images by column name
 */
export interface CategorizedImages {
  // Images grouped by original column name (e.g., { "Silver Image URL": [...], "Gold Image URL": [...] })
  byColumnName: Record<string, string[]>;
}

/**
 * View of a single product's images for the Results modal
 */
export interface ProductImagesView {
  productKey: string;
  title: string | null;
  rowMode: RowMode;
  originalImageUrls: string[];   // From original spreadsheet (before any scenarios)
  currentImageUrls: string[];    // After applying all scenarios
  originalCategorized: CategorizedImages;  // Categorized original images by type
  hasResults: boolean;           // Whether this product has any scenarios
  scenarioCount: number;
  // Stage 20: New product fields
  isNewProduct?: boolean;        // True if this is a new product (not in original spreadsheet)
  newProductInfo?: {
    productId: string;
    sku: string;
    addPosition: AddPosition;
    insertBeforeProductKey?: string;
    sourceTemplateId?: string;
  };
}

/**
 * Complete view for the Spreadsheet Results modal
 */
export interface SpreadsheetResultsView {
  templateId: string;
  templateName: string;
  rowMode: RowMode;
  products: ProductImagesView[];
  totalProducts: number;
  productsWithResults: number;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Deduplicate URLs while preserving order
 */
export function deduplicateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  
  for (const url of urls) {
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  
  return result;
}

/**
 * Apply scenarios to original images to get current images
 * Scenarios are applied in createdAt order (oldest first)
 */
export function applyScenariosToImages(
  originalImages: string[],
  scenarios: SpreadsheetResultScenario[]
): string[] {
  if (!scenarios || scenarios.length === 0) {
    return [...originalImages];
  }

  // Sort by createdAt ascending (oldest first)
  const sorted = [...scenarios].sort((a, b) => a.createdAt - b.createdAt);

  let result = [...originalImages];

  for (const scenario of sorted) {
    const newImages = scenario.imageUrls || [];

    if (scenario.mode === "REPLACE_ALL_IMAGES_PER_PRODUCT" ||
        scenario.mode === "REPLACE_ALL_ROWS_PER_IMAGE") {
      // Replace mode: new images become the entire list
      result = [...newImages];
    } else if (scenario.mode === "APPEND_IMAGES_PER_PRODUCT" ||
               scenario.mode === "APPEND_ROWS_PER_IMAGE") {
      // Append mode: add new images after existing
      result = [...result, ...newImages];
    }
  }

  return result;
}

/**
 * Extract all image URLs from a row item
 * Prioritizes new images[] array, falls back to legacy fields
 */
function getImageUrlsFromRow(item: SpreadsheetRowItem): string[] {
  // Use unified images array
  if (item.fields.images && item.fields.images.length > 0) {
    return item.fields.images.map((img: ImageEntry) => img.url);
  }
  return [];
}

/**
 * Extract categorized images from a row item
 * Groups images by their original column name (label)
 */
function getCategorizedImagesFromRow(item: SpreadsheetRowItem): CategorizedImages {
  const byColumnName: Record<string, string[]> = {};
  
  // Use unified images array - group by column name (label)
  if (item.fields.images && item.fields.images.length > 0) {
    for (const img of item.fields.images) {
      if (!byColumnName[img.label]) {
        byColumnName[img.label] = [];
      }
      byColumnName[img.label].push(img.url);
    }
  }
  
  return { byColumnName };
}

/**
 * Get product key from row item
 * For PER_PRODUCT: each row is separate, use row-based key
 * For PER_IMAGE: group by product_id or product_id+sku based on groupByField
 * 
 * @param groupByField - "product_id": all SKUs under same product_id merge
 *                       "sku": each product_id+sku combination is separate
 */
function getProductKey(
  item: SpreadsheetRowItem, 
  rowMode: RowMode,
  groupByField: GroupByField = "product_id"
): string {
  if (rowMode === "PER_PRODUCT") {
    // Each row is separate - use item.key which is row-specific
    return item.key || `row-${item.rowIndex || Math.random()}`;
  }
  
  // PER_IMAGE mode
  const productId = item.fields.product_id || "";
  const sku = item.fields.sku || "";
  
  if (groupByField === "sku") {
    // Group by product_id + sku combination
    // Each variant is a separate product
    if (productId && sku) {
      return `${productId}::${sku}`;
    }
    // Fallback: use whichever is available
    return sku || productId || item.key || "";
  }
  
  // Default: group by product_id only (all SKUs merge)
  return productId || sku || item.key || "";
}

// ============================================================
// Main View Builder
// ============================================================

/**
 * Build a complete results view for the Results modal
 * 
 * @param items - All rows from fetchSpreadsheetRows (all pages)
 * @param scenarios - All scenarios from fetchSpreadsheetResults
 * @param templateId - Template ID
 * @param templateName - Template name
 * @param rowMode - Template row mode
 * @param groupByField - For PER_IMAGE: how to group rows into products
 * @returns SpreadsheetResultsView
 */
export function buildSpreadsheetResultsView(
  items: SpreadsheetRowItem[],
  scenarios: SpreadsheetResultScenario[],
  templateId: string,
  templateName: string,
  rowMode: RowMode,
  groupByField: GroupByField = "product_id"
): SpreadsheetResultsView {
  // Group scenarios by productKey
  const scenariosByProduct = new Map<string, SpreadsheetResultScenario[]>();
  
  for (const scenario of scenarios) {
    const key = scenario.productKey;
    if (!scenariosByProduct.has(key)) {
      scenariosByProduct.set(key, []);
    }
    scenariosByProduct.get(key)!.push(scenario);
  }

  // Build product views
  // For PER_PRODUCT: each item is one product
  // For PER_IMAGE: items are already aggregated by key
  const productMap = new Map<string, ProductImagesView>();

  for (const item of items) {
    const productKey = getProductKey(item, rowMode, groupByField);
    if (!productKey) continue;

    // Check if we already have this product (shouldn't happen if data is clean)
    if (productMap.has(productKey)) {
      // Merge images
      const existing = productMap.get(productKey)!;
      const newUrls = getImageUrlsFromRow(item);
      existing.originalImageUrls.push(...newUrls);
      
      // Merge byColumnName
      const newCategorized = getCategorizedImagesFromRow(item);
      for (const [colName, urls] of Object.entries(newCategorized.byColumnName)) {
        if (!existing.originalCategorized.byColumnName[colName]) {
          existing.originalCategorized.byColumnName[colName] = [];
        }
        existing.originalCategorized.byColumnName[colName].push(...urls);
      }
      continue;
    }

    // Get original images - NO automatic deduplication
    // Deduplication is controlled by the Dedupe toggle in the UI
    const originalUrls = getImageUrlsFromRow(item);
    
    // Get categorized original images
    const originalCategorized = getCategorizedImagesFromRow(item);

    // Get scenarios for this product
    const productScenarios = scenariosByProduct.get(productKey) || [];
    const hasResults = productScenarios.length > 0;

    // Calculate current images by applying scenarios
    const currentUrls = applyScenariosToImages(originalUrls, productScenarios);

    // Create product view
    const productView: ProductImagesView = {
      productKey,
      title: item.fields.product_title || null,
      rowMode,
      originalImageUrls: originalUrls,
      currentImageUrls: currentUrls,
      originalCategorized,
      hasResults,
      scenarioCount: productScenarios.length,
    };

    productMap.set(productKey, productView);
  }

  // Convert to array
  const products = Array.from(productMap.values());

  // Count products with results
  const productsWithResults = products.filter(p => p.hasResults).length;

  return {
    templateId,
    templateName,
    rowMode,
    products,
    totalProducts: products.length,
    productsWithResults,
  };
}

// ============================================================
// Legacy Functions (for backward compatibility)
// ============================================================

/**
 * Apply overlay scenarios to original rows to produce a "working view"
 * 
 * @param items - Original rows from fetchSpreadsheetRows
 * @param scenarios - All scenarios from fetchSpreadsheetResults
 * @param rowMode - The template's row mode
 * @param groupByField - For PER_IMAGE: how to group rows into products
 * @returns Merged rows with overlay applied
 */
export function applySpreadsheetResultsToRows(
  items: SpreadsheetRowItem[],
  scenarios: SpreadsheetResultScenario[],
  rowMode: RowMode,
  groupByField: GroupByField = "product_id"
): SpreadsheetRowItem[] {
  // If no scenarios, return original items unchanged
  if (!scenarios || scenarios.length === 0) {
    return items;
  }

  // Group scenarios by productKey
  const scenariosByProduct = new Map<string, SpreadsheetResultScenario[]>();
  
  for (const scenario of scenarios) {
    const key = scenario.productKey;
    if (!scenariosByProduct.has(key)) {
      scenariosByProduct.set(key, []);
    }
    scenariosByProduct.get(key)!.push(scenario);
  }

  // Sort each group by createdAt ascending (oldest first)
  for (const [key, group] of scenariosByProduct) {
    group.sort((a, b) => a.createdAt - b.createdAt);
  }

  // Apply scenarios to each item
  return items.map(item => {
    // Determine the product key for this item
    const productKey = getProductKey(item, rowMode, groupByField);
    
    // Find scenarios for this product
    const productScenarios = scenariosByProduct.get(productKey);
    
    // If no scenarios for this product, return original item
    if (!productScenarios || productScenarios.length === 0) {
      return item;
    }

    // Initialize with original images array
    let currentImages: ImageEntry[] = item.fields.images ? [...item.fields.images] : [];
    
    // Get default label from first image, or use "Image" as fallback
    const defaultLabel = currentImages.length > 0 ? currentImages[0].label : "Image";

    // Apply each scenario in order
    for (const scenario of productScenarios) {
      const newUrls = scenario.imageUrls || [];

      if (scenario.rowMode === "PER_PRODUCT") {
        if (scenario.mode === "REPLACE_ALL_IMAGES_PER_PRODUCT") {
          // Replace all images with new ones
          currentImages = newUrls.map(url => ({
            url,
            label: defaultLabel,
            colIndex: -1,
          }));
        } else if (scenario.mode === "APPEND_IMAGES_PER_PRODUCT") {
          // Append new images
          const newImages = newUrls.map(url => ({
            url,
            label: defaultLabel,
            colIndex: -1,
          }));
          currentImages = [...currentImages, ...newImages];
        }
      } else if (scenario.rowMode === "PER_IMAGE") {
        if (scenario.mode === "REPLACE_ALL_ROWS_PER_IMAGE") {
          // Replace all images
          currentImages = newUrls.map(url => ({
            url,
            label: defaultLabel,
            colIndex: -1,
          }));
        } else if (scenario.mode === "APPEND_ROWS_PER_IMAGE") {
          // Append new images
          const newImages = newUrls.map(url => ({
            url,
            label: defaultLabel,
            colIndex: -1,
          }));
          currentImages = [...currentImages, ...newImages];
        }
      }
    }

    // Return new item with updated images array
    return {
      ...item,
      fields: {
        ...item.fields,
        images: currentImages,
      },
    };
  });
}

/**
 * Get the final image count for a product after applying all scenarios
 */
export function getProductImageCountsAfterOverlay(
  originalUrls: string[],
  scenarios: SpreadsheetResultScenario[]
): { totalCount: number } {
  if (!scenarios || scenarios.length === 0) {
    return { totalCount: originalUrls.length };
  }

  // Sort by createdAt ascending
  const sorted = [...scenarios].sort((a, b) => a.createdAt - b.createdAt);

  let currentImages = [...originalUrls];

  for (const scenario of sorted) {
    const newImages = scenario.imageUrls || [];

    if (scenario.mode === "REPLACE_ALL_IMAGES_PER_PRODUCT" || 
        scenario.mode === "REPLACE_ALL_ROWS_PER_IMAGE") {
      currentImages = [...newImages];
    } else if (scenario.mode === "APPEND_IMAGES_PER_PRODUCT" || 
               scenario.mode === "APPEND_ROWS_PER_IMAGE") {
      currentImages = [...currentImages, ...newImages];
    }
  }

  return { totalCount: currentImages.length };
}

/**
 * Check if a product has any overlay modifications
 */
export function hasProductOverlay(
  productKey: string,
  scenarios: SpreadsheetResultScenario[]
): boolean {
  return scenarios.some(s => s.productKey === productKey);
}

/**
 * Get all unique product keys that have overlays
 */
export function getProductKeysWithOverlays(
  scenarios: SpreadsheetResultScenario[]
): string[] {
  const keys = new Set<string>();
  for (const scenario of scenarios) {
    keys.add(scenario.productKey);
  }
  return Array.from(keys);
}

// ============================================================
// Stage 20: New Product Support
// ============================================================

/**
 * Merge new products from exportOverrides into an existing SpreadsheetResultsView
 * 
 * This function:
 * 1. Scans exportOverrides for entries with isNewProduct: true
 * 2. Creates ProductImagesView entries for new products
 * 3. Inserts them at the correct position based on addPosition
 * 4. Skips new products that already exist in the view (by productKey)
 * 
 * @param view - The existing SpreadsheetResultsView (from buildSpreadsheetResultsView)
 * @param exportOverrides - The exportOverrides map from getExportOverrides
 * @returns Updated SpreadsheetResultsView with new products merged in
 */
export function mergeNewProductsIntoView(
  view: SpreadsheetResultsView,
  exportOverrides: Record<string, ExportOverrideValue>
): SpreadsheetResultsView {
  // Collect existing product keys
  const existingKeys = new Set(view.products.map(p => p.productKey));
  
  // Find new products from exportOverrides
  const newProducts: Array<{
    productKey: string;
    override: ExportOverrideNewProduct;
  }> = [];
  
  for (const [productKey, override] of Object.entries(exportOverrides)) {
    if (isNewProductOverride(override)) {
      // Skip if this product already exists in the view
      if (!existingKeys.has(productKey)) {
        newProducts.push({ productKey, override });
      }
    }
  }
  
  // If no new products, return original view
  if (newProducts.length === 0) {
    return view;
  }
  
  // Sort new products: "last" products by createdAt, "before" products will be inserted in order
  const lastProducts = newProducts
    .filter(np => np.override.addPosition === "last")
    .sort((a, b) => (a.override.updatedAt || 0) - (b.override.updatedAt || 0));
  
  const beforeProducts = newProducts
    .filter(np => np.override.addPosition === "before");
  
  // Start with a copy of existing products
  let mergedProducts = [...view.products];
  
  // Insert "before" products at their specified positions
  for (const { productKey, override } of beforeProducts) {
    const insertBeforeKey = override.insertBeforeProductKey;
    const insertIndex = mergedProducts.findIndex(p => p.productKey === insertBeforeKey);
    
    const newProductView = createNewProductView(productKey, override, view.rowMode);
    
    if (insertIndex >= 0) {
      // Insert before the specified product
      mergedProducts.splice(insertIndex, 0, newProductView);
    } else {
      // If target not found, append to end
      mergedProducts.push(newProductView);
    }
  }
  
  // Append "last" products at the end
  for (const { productKey, override } of lastProducts) {
    const newProductView = createNewProductView(productKey, override, view.rowMode);
    mergedProducts.push(newProductView);
  }
  
  return {
    ...view,
    products: mergedProducts,
    totalProducts: mergedProducts.length,
  };
}

/**
 * Create a ProductImagesView for a new product from exportOverride
 */
function createNewProductView(
  productKey: string,
  override: ExportOverrideNewProduct,
  rowMode: RowMode
): ProductImagesView {
  // Generate a user-friendly title from sku for new products
  // This helps display them nicely in the ResultModal sidebar
  const title = override.sku ? `New: ${override.sku}` : null;
  
  return {
    productKey,
    title,
    rowMode,
    originalImageUrls: [],  // New products have no original images
    currentImageUrls: override.images || [],  // Use saved images
    originalCategorized: { byColumnName: {} },
    hasResults: (override.images?.length || 0) > 0,
    scenarioCount: 0,
    // Stage 20: Mark as new product
    isNewProduct: true,
    newProductInfo: {
      productId: override.productId,
      sku: override.sku,
      addPosition: override.addPosition,
      insertBeforeProductKey: override.insertBeforeProductKey,
      sourceTemplateId: override.sourceTemplateId,
    },
  };
}

/**
 * Merge new products into SpreadsheetRowItem array for TargetSpreadsheetModal
 * 
 * @param items - Original row items from fetchSpreadsheetRows
 * @param exportOverrides - The exportOverrides map from getExportOverrides
 * @param rowMode - The template's row mode
 * @param groupByField - For PER_IMAGE: how to group rows into products
 * @param descriptionOverrides - Optional description overrides to populate product_title
 * @returns Merged row items with new products inserted at correct positions
 */
export function mergeNewProductsIntoRows(
  items: SpreadsheetRowItem[],
  exportOverrides: Record<string, ExportOverrideValue>,
  rowMode: RowMode,
  groupByField: GroupByField = "product_id",
  descriptionOverrides?: Record<string, Record<string, string | undefined>>
): SpreadsheetRowItem[] {
  // Helper to compute product key matching TargetSpreadsheetModal's logic
  const computeKey = (item: SpreadsheetRowItem): string => {
    if (rowMode === "PER_PRODUCT") {
      // PER_PRODUCT: use row-based key
      return `row-${item.rowIndex}`;
    }
    // PER_IMAGE mode
    const productId = item.fields.product_id || "";
    const sku = item.fields.sku || "";
    
    if (groupByField === "sku") {
      if (productId && sku) return `${productId}::${sku}`;
      return sku || productId || item.key || "";
    }
    return productId || sku || item.key || "";
  };
  
  // Collect existing product keys using computed keys
  const existingKeys = new Set(items.map(item => computeKey(item)));
  
  // Find new products from exportOverrides
  const newProducts: Array<{
    productKey: string;
    override: ExportOverrideNewProduct;
  }> = [];
  
  for (const [productKey, override] of Object.entries(exportOverrides)) {
    if (isNewProductOverride(override)) {
      // Skip if this product already exists
      if (!existingKeys.has(productKey)) {
        newProducts.push({ productKey, override });
      }
    }
  }
  
  // If no new products, return original items
  if (newProducts.length === 0) {
    return items;
  }
  
  // Sort new products: "last" products by createdAt, "before" products will be inserted in order
  const lastProducts = newProducts
    .filter(np => np.override.addPosition === "last" || !np.override.addPosition)
    .sort((a, b) => (a.override.updatedAt || 0) - (b.override.updatedAt || 0));
  
  const beforeProducts = newProducts
    .filter(np => np.override.addPosition === "before");
  
  // Start with a copy of existing items
  let mergedItems = [...items];
  
  // Insert "before" products at their specified positions
  for (const { productKey, override } of beforeProducts) {
    const insertBeforeKey = override.insertBeforeProductKey;
    // Use computeKey to match how TargetSpreadsheetModal computes keys
    const insertIndex = mergedItems.findIndex(item => computeKey(item) === insertBeforeKey);
    
    const newItem = createNewProductRowItem(productKey, override, rowMode, descriptionOverrides);
    
    if (insertIndex >= 0) {
      // Insert before the specified product
      mergedItems.splice(insertIndex, 0, newItem);
    } else {
      // If target not found, append to end
      mergedItems.push(newItem);
    }
  }
  
  // Append "last" products at the end
  for (const { productKey, override } of lastProducts) {
    const newItem = createNewProductRowItem(productKey, override, rowMode, descriptionOverrides);
    mergedItems.push(newItem);
  }
  
  return mergedItems;
}

/**
 * Create a SpreadsheetRowItem for a new product
 */
function createNewProductRowItem(
  productKey: string,
  override: ExportOverrideNewProduct,
  _rowMode: RowMode,
  descriptionOverrides?: Record<string, Record<string, string | undefined>>
): SpreadsheetRowItem {
  // Convert override.images to ImageEntry format
  const images: Array<{ url: string; label: string; colIndex: number }> = [];
  if (override.images && override.images.length > 0) {
    const categories = override.categories || [];
    for (let i = 0; i < override.images.length; i++) {
      const url = override.images[i];
      // Extract label from category token (e.g., "col:Image Src" -> "Image Src")
      const category = categories[i] || "";
      const label = category.startsWith("col:") ? category.substring(4) : category || "Image";
      images.push({ url, label, colIndex: -1 });
    }
  }
  
  // Get product_title from descriptionOverrides if available
  const descOverride = descriptionOverrides?.[productKey];
  const productTitle = descOverride?.product_title || undefined;
  
  return {
    key: productKey,
    rowIndex: -1,  // Mark as new product (not from original spreadsheet)
    fields: {
      product_id: override.productId,
      sku: override.sku,
      product_title: productTitle,
      images,  // Use images from override
      sourceRowIndex: -1,  // Mark as new product
    },
  };
}