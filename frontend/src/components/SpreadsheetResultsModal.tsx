import React, { useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import { getProxiedImageUrl } from "../lib/imageProxy";
import AlertModal from "./AlertModal";
import {
  fetchSpreadsheetRows,
  fetchSpreadsheetResults,
  exportSpreadsheetWithResults,
  downloadBlob,
  getExportOverrides,
  saveExportOverride,
  getDescriptionOverrides,
  saveDescriptionOverride,
  DescriptionOverrides,
  DescriptionType,
  SpreadsheetRowItem,
  SpreadsheetResultScenario,
} from "../lib/api";
import { SpreadsheetTemplate } from "../lib/spreadsheetTemplateUtils";
import {
  buildSpreadsheetResultsView,
  ProductImagesView,
  SpreadsheetResultsView,
  CategorizedImages,
  mergeNewProductsIntoView,
} from "../lib/spreadsheetOverlay";

interface SpreadsheetResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: SpreadsheetTemplate;
  userId: string;
  onTemplateUpdated?: () => void;  // Called when product data is saved (images/descriptions)
}

// Export overrides: productKey -> array of image URLs for export
// Note: Backend now returns { images: string[], categories: string[] } format
// but we keep this type for backward compatibility with other components
type ExportOverrideMap = Record<string, any>;  // Can be string[] or { images, categories }

// Internal type for new format with categories
interface ExportOverrideWithCategories {
  images: string[];
  categories: string[];  // 'main', 'additional', 'slot-1', etc.
}

// Helper to extract images array from override (handles both old and new formats)
function getOverrideImages(override: any): string[] | undefined {
  if (!override) return undefined;
  // New format: { images: [...], categories: [...] }
  if (override.images && Array.isArray(override.images)) {
    return override.images;
  }
  // Old format: string[]
  if (Array.isArray(override)) {
    return override;
  }
  return undefined;
}

// Helper to extract categories array from override
function getOverrideCategories(override: any): string[] | undefined {
  if (!override) return undefined;
  // New format: { images: [...], categories: [...] }
  if (override.categories && Array.isArray(override.categories)) {
    return override.categories;
  }
  return undefined;
}

// Description overrides: productKey -> { seo?, geo?, gso?, tags?, etc. }
type DescriptionOverrideMap = Record<string, DescriptionOverrides>;

// Filter mode for product list
type FilterMode = "all" | "updated";

/**
 * Fetch all spreadsheet products (handles pagination internally)
 */
async function fetchAllSpreadsheetProducts(
  userId: string,
  templateId: string,
  pageSize: number = 100
): Promise<SpreadsheetRowItem[]> {
  const allItems: SpreadsheetRowItem[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetchSpreadsheetRows(userId, templateId, {
      page,
      pageSize,
    });

    allItems.push(...response.items);

    const totalPages = Math.ceil(response.total / pageSize);
    hasMore = page < totalPages;
    page++;
  }

  return allItems;
}

/**
 * 灵活的 export override 查找
 * 尝试多种 key 格式来查找 override，解决 key 不一致问题
 * (例如 "row-2" vs "银色" 的问题)
 * 
 * 核心逻辑：
 * 1. 优先精确匹配 productKey
 * 2. 如果没有精确匹配，查找该产品的备选 key（SKU 等）
 * 3. 但备选 key 必须是该产品独有的，不能被其他产品共享
 * 
 * Returns raw override value (can be string[] or { images, categories })
 * Use getOverrideImages() and getOverrideCategories() to extract data
 */
function findExportOverride(
  overrides: ExportOverrideMap,
  productKey: string,
  originalRows: SpreadsheetRowItem[],
  rowMode: "PER_PRODUCT" | "PER_IMAGE",
  groupByField: "sku" | "product_id" = "product_id"
): any | undefined {
  // Helper to check if override has data
  const hasData = (val: any): boolean => {
    if (!val) return false;
    const images = getOverrideImages(val);
    return !!(images && images.length > 0);
  };
  
  // Helper to compute productKey for a row based on groupByField
  const getRowProductKey = (r: SpreadsheetRowItem): string => {
    if (rowMode === "PER_PRODUCT") {
      return r.key || `row-${r.rowIndex}`;
    }
    // PER_IMAGE mode
    const productId = r.fields.product_id || "";
    const sku = r.fields.sku || "";
    if (groupByField === "sku") {
      // Group by product_id + sku combination
      if (productId && sku) {
        return `${productId}::${sku}`;
      }
      return sku || productId || r.key || "";
    }
    // Default: group by product_id only
    return productId || sku || r.key || "";
  };

  // 1. 先尝试精确匹配 - 这是最优先的
  if (hasData(overrides[productKey])) {
    return overrides[productKey];
  }
  
  // 2. 找到当前产品对应的行
  let currentRow: SpreadsheetRowItem | undefined;
  let currentRowIndices: number[] = [];
  
  if (rowMode === "PER_IMAGE") {
    // PER_IMAGE: find rows with matching productKey
    const matchingRows = originalRows.filter(r => getRowProductKey(r) === productKey);
    if (matchingRows.length > 0) {
      currentRow = matchingRows[0];
      currentRowIndices = matchingRows.map(r => r.rowIndex).filter((idx): idx is number => idx !== undefined);
    }
  } else {
    // PER_PRODUCT: productKey 是 row-N 格式
    currentRow = originalRows.find(r => {
      const rowKey = r.key || `row-${r.rowIndex}`;
      return rowKey === productKey;
    });
    if (currentRow?.rowIndex !== undefined) {
      currentRowIndices = [currentRow.rowIndex];
    }
  }
  
  if (!currentRow) {
    return undefined;
  }
  
  // 3. 收集当前产品的备选 key
  const alternativeKeys: string[] = [];
  if (currentRow.fields.sku) alternativeKeys.push(currentRow.fields.sku);
  if (currentRow.fields.product_id) alternativeKeys.push(currentRow.fields.product_id);
  if (currentRow.key && currentRow.key !== productKey) alternativeKeys.push(currentRow.key);
  for (const idx of currentRowIndices) {
    const rowKey = `row-${idx}`;
    if (rowKey !== productKey) alternativeKeys.push(rowKey);
  }
  
  // 4. 对于每个备选 key，检查它是否是当前产品独有的
  //    如果其他产品也有相同的 SKU/key，则不能使用这个备选 key
  for (const altKey of alternativeKeys) {
    if (!hasData(overrides[altKey])) {
      continue;
    }
    
    // 检查这个 altKey 是否被其他产品共享
    const isShared = originalRows.some(r => {
      // 跳过当前产品的行
      if (currentRowIndices.includes(r.rowIndex!)) {
        return false;
      }
      // 检查其他产品是否也使用这个 key
      return r.fields.sku === altKey || 
             r.fields.product_id === altKey || 
             r.key === altKey ||
             `row-${r.rowIndex}` === altKey;
    });
    
    if (!isShared) {
      // 这个 key 是当前产品独有的，可以安全使用
      console.log(`[ResultsModal] Found override using alt key "${altKey}" (original: "${productKey}")`);
      return overrides[altKey];
    } else {
      console.log(`[ResultsModal] Skipping shared key "${altKey}" for product "${productKey}"`);
    }
  }
  
  return undefined;
}


// Helper to build category labels array from images and original categorization
// ImageCategory can be 'main', 'additional', 'slot-N', or column name - NO 'other' category
// Position-based: images inherit category based on position, extras go to last category
type ImageCategory = string;

/**
 * Convert category token to ImageCategory (column name).
 * Token format: "col:Silver Image URL" -> "Silver Image URL"
 */
function roleTokenToImageCategory(token: string): ImageCategory {
  if (!token) return 'Image';
  
  // Handle column-based token format: "col:ColumnName"
  if (token.startsWith('col:')) {
    return token.substring(4);
  }
  
  // Legacy fallback: return token as-is (will be treated as column name)
  return token;
}

/**
 * Convert ImageCategory (column name) to token.
 * Format: "Silver Image URL" -> "col:Silver Image URL"
 */
function imageCategoryToRoleToken(category: ImageCategory): string {
  if (!category) return 'col:Image';
  
  // Already in token format
  if (category.startsWith('col:')) {
    return category;
  }
  
  return `col:${category}`;
}

/**
 * Build categories array based on image positions.
 * Uses byColumnName from original categorized data.
 */
function buildCategoriesArray(
  images: string[],
  originalCategorized: { byColumnName: Record<string, string[]> }
): ImageCategory[] {
  const byColumnName = originalCategorized.byColumnName || {};
  const columnNames = Object.keys(byColumnName);
  
  if (columnNames.length === 0) {
    // No columns defined, use default
    return images.map(() => 'Image');
  }
  
  const columnSizes: Record<string, number> = {};
  for (const colName of columnNames) {
    columnSizes[colName] = byColumnName[colName]?.length || 0;
  }
  
  // Determine last column with images (for "Add" mode)
  let lastColumn = columnNames[0];
  for (let i = columnNames.length - 1; i >= 0; i--) {
    if (columnSizes[columnNames[i]] > 0) {
      lastColumn = columnNames[i];
      break;
    }
  }
  
  // Position-based category assignment
  return images.map((url, index) => {
    let offset = 0;
    for (const colName of columnNames) {
      const colSize = columnSizes[colName];
      if (index < offset + colSize) {
        return colName;
      }
      offset += colSize;
    }
    // Beyond all original columns - add to last column
    return lastColumn;
  });
}

/**
 * Format product key for display in the sidebar list
 * For new products (isNewProduct: true), compute a display key based on insertion position
 * e.g., if inserted before row-7, show as "row-6+"
 */
function formatProductDisplayKey(
  product: ProductImagesView,
  allProducts: ProductImagesView[]
): string {
  // Regular products: return productKey as-is
  if (!product.isNewProduct) {
    return product.productKey;
  }
  
  // New products: compute display key based on insertBeforeProductKey
  const insertBeforeKey = product.newProductInfo?.insertBeforeProductKey;
  
  if (insertBeforeKey && insertBeforeKey.startsWith("row-")) {
    // Extract row number and subtract 1 to get "row-N+"
    const rowNum = parseInt(insertBeforeKey.replace("row-", ""), 10);
    if (!isNaN(rowNum) && rowNum > 1) {
      return `row-${rowNum - 1}+`;
    }
    // If inserting before row-1, use "row-0+"
    return "row-0+";
  }
  
  // Fallback: find position in the array and compute based on neighbors
  const index = allProducts.indexOf(product);
  if (index > 0) {
    const prevProduct = allProducts[index - 1];
    if (!prevProduct.isNewProduct && prevProduct.productKey.startsWith("row-")) {
      const prevRowNum = parseInt(prevProduct.productKey.replace("row-", ""), 10);
      if (!isNaN(prevRowNum)) {
        return `row-${prevRowNum}+`;
      }
    }
  }
  
  // Last fallback: just show "new"
  return "new";
}

export default function SpreadsheetResultsModal({
  isOpen,
  onClose,
  template,
  userId,
  onTemplateUpdated,
}: SpreadsheetResultsModalProps) {
  // Data loading state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<SpreadsheetResultsView | null>(null);
  
  // Store original rows for description lookup
  const [originalRows, setOriginalRows] = useState<SpreadsheetRowItem[]>([]);
  
  // Store all scenarios for AI artwork display
  const [allScenarios, setAllScenarios] = useState<SpreadsheetResultScenario[]>([]);

  // Filter and search state
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");

  // Selected product state
  const [activeProductKey, setActiveProductKey] = useState<string | null>(null);

  // Current working images for active product (editable state)
  const [exportImages, setExportImages] = useState<string[]>([]);
  
  // Category labels for each image (parallel array with exportImages)
  const [imageCategories, setImageCategories] = useState<ImageCategory[]>([]);

  // Saved export overrides (persists across product selection)
  const [exportOverrides, setExportOverrides] = useState<ExportOverrideMap>({});

  // Track if current product has unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Lightbox preview state
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  // Dedupe toggle for current product
  const [dedupeEnabled, setDedupeEnabled] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  
  // AI Artwork drag state (separate from regular drag)
  const [aiDragUrl, setAiDragUrl] = useState<string | null>(null);

  // Export state
  const [exporting, setExporting] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  
  // AI Artwork panel visibility
  const [showAIArtwork, setShowAIArtwork] = useState(false);

  // Description state
  const [descriptionOverrides, setDescriptionOverrides] = useState<DescriptionOverrideMap>({});
  const [editingSeoDescription, setEditingSeoDescription] = useState("");
  const [editingGeoDescription, setEditingGeoDescription] = useState("");
  const [editingGsoDescription, setEditingGsoDescription] = useState("");
  // Phase 2: Additional fields
  const [editingTags, setEditingTags] = useState("");
  const [editingMetaTitle, setEditingMetaTitle] = useState("");
  const [editingMetaDescription, setEditingMetaDescription] = useState("");
  const [editingSeoTitle, setEditingSeoTitle] = useState("");
  // Custom fields with enableGeneration (non-standard fields)
  const [editingCustomFields, setEditingCustomFields] = useState<Record<string, string>>({});
  const [savingDescription, setSavingDescription] = useState<string | null>(null);
  const [hasDescriptionChanges, setHasDescriptionChanges] = useState(false);

  // Alert modal state for unsaved changes confirmation
  const [alertConfig, setAlertConfig] = useState<{
    show: boolean;
    title: string;
    message: string;
    onDiscard: () => void;  // Action to execute when discarding changes
    isError?: boolean;  // If true, show only OK button (for error messages)
  }>({ show: false, title: "", message: "", onDiscard: () => {} });

  // Track if we're in initial load (to skip useEffect that would override correct data)
  const isInitialLoadRef = React.useRef(true);
  // Track loaded overrides for use in useEffect (avoids stale closure)
  const exportOverridesRef = React.useRef<ExportOverrideMap>({});
  const descriptionOverridesRef = React.useRef<DescriptionOverrideMap>({});
  // Track previous filterMode to detect tab changes
  const prevFilterModeRef = React.useRef<FilterMode | null>(null);

  // Load data when modal opens
  useEffect(() => {
    if (!isOpen || !template || !userId) return;

    const loadData = async () => {
      setLoading(true);
      setError("");
      setView(null);  // Reset view to avoid showing stale data
      setActiveProductKey(null);  // Reset selection
      setExportImages([]);
      setHasUnsavedChanges(false);
      setHasDescriptionChanges(false);
      setShowAIArtwork(false);  // Reset AI artwork panel visibility
      
      // Reset initial load flag for the useEffect
      isInitialLoadRef.current = true;
      // Reset filterMode ref so useEffect doesn't trigger on initial load
      prevFilterModeRef.current = filterMode;

      try {
        // Fetch all rows, scenarios, and saved overrides in parallel
        const [rows, scenarios, savedOverrides, savedDescriptions] = await Promise.all([
          fetchAllSpreadsheetProducts(userId, template.id),
          fetchSpreadsheetResults(userId, template.id),
          getExportOverrides(userId, template.id),
          getDescriptionOverrides(userId, template.id),
        ]);

        console.log("[ResultsModal] Loaded savedOverrides:", savedOverrides);
        console.log("[ResultsModal] Override keys:", Object.keys(savedOverrides));
        console.log("[ResultsModal] Loaded savedDescriptions:", savedDescriptions);
        console.log("[ResultsModal] Loaded scenarios:", scenarios.length);

        // Load saved overrides (also update ref immediately for useEffect)
        setExportOverrides(savedOverrides);
        exportOverridesRef.current = savedOverrides;
        
        // Load saved description overrides
        setDescriptionOverrides(savedDescriptions);
        descriptionOverridesRef.current = savedDescriptions;
        
        // Save original rows for description lookup
        setOriginalRows(rows);
        
        // Save all scenarios for AI artwork
        setAllScenarios(scenarios);

        // Build the results view
        const resultsView = buildSpreadsheetResultsView(
          rows,
          scenarios,
          template.id,
          template.templateName,
          template.rowMode,
          (template as any).groupByField || "product_id"
        );

        // Stage 20: Merge new products from exportOverrides into the view
        const viewWithNewProducts = mergeNewProductsIntoView(resultsView, savedOverrides);

        setView(viewWithNewProducts);

        // Select first product - prefer most recently updated (from ANY source)
        if (viewWithNewProducts.products.length > 0) {
          let firstProduct = viewWithNewProducts.products[0];
          
          // Build map of productKey -> latest update time from ALL sources
          const productLatestUpdate = new Map<string, number>();
          
          // 1. Check scenarios (AI generation results)
          for (const scenario of scenarios) {
            const existing = productLatestUpdate.get(scenario.productKey) || 0;
            if (scenario.createdAt > existing) {
              productLatestUpdate.set(scenario.productKey, scenario.createdAt);
            }
          }
          
          // 2. Check export overrides (image reordering/deletion in ResultsModal)
          for (const [productKey, override] of Object.entries(savedOverrides)) {
            const updatedAt = (override as any)?.updatedAt;
            if (updatedAt && typeof updatedAt === 'number') {
              const existing = productLatestUpdate.get(productKey) || 0;
              if (updatedAt > existing) {
                productLatestUpdate.set(productKey, updatedAt);
              }
            }
          }
          
          // 3. Check description overrides (text field edits in ResultsModal)
          for (const [productKey, override] of Object.entries(savedDescriptions)) {
            const updatedAt = (override as any)?.updatedAt;
            if (updatedAt && typeof updatedAt === 'number') {
              const existing = productLatestUpdate.get(productKey) || 0;
              if (updatedAt > existing) {
                productLatestUpdate.set(productKey, updatedAt);
              }
            }
          }
          
          // Find the product with most recent update (if any updates exist)
          let latestTime = 0;
          for (const product of viewWithNewProducts.products) {
            const updateTime = productLatestUpdate.get(product.productKey) || 0;
            if (updateTime > latestTime) {
              latestTime = updateTime;
              firstProduct = product;
            }
          }
          
          console.log("[ResultsModal] Selected product:", firstProduct.productKey, 
            "latestUpdateTime:", latestTime ? new Date(latestTime).toISOString() : "none");
          
          setActiveProductKey(firstProduct.productKey);
          // Use flexible lookup to find override (handles key mismatch)
          const savedOverride = findExportOverride(
            savedOverrides,
            firstProduct.productKey,
            rows,
            template.rowMode,
            (template as any).groupByField || "product_id"
          );
          const savedImages = getOverrideImages(savedOverride);
          const savedCategories = getOverrideCategories(savedOverride);
          console.log("[ResultsModal] First product: " + firstProduct.productKey + ", savedImages:", savedImages?.length || 0);
          if (savedImages && savedImages.length > 0) {
            setExportImages([...savedImages]);
            // Use saved categories if available, otherwise build from position
            if (savedCategories && savedCategories.length === savedImages.length) {
              // Convert role-based tokens to ImageCategory
              setImageCategories(savedCategories.map(roleTokenToImageCategory));
              console.log("[ResultsModal] Using saved images AND categories for first product");
            } else {
              setImageCategories(buildCategoriesArray(savedImages, firstProduct.originalCategorized));
              console.log("[ResultsModal] Using saved images with rebuilt categories for first product");
            }
          } else {
            setExportImages([...firstProduct.currentImageUrls]);
            setImageCategories(buildCategoriesArray(firstProduct.currentImageUrls, firstProduct.originalCategorized));
            console.log("[ResultsModal] Using currentImageUrls for first product");
          }
          
          // Initialize description fields for first product (same logic as useEffect)
          const groupByField = (template as any).groupByField || "product_id";
          const originalRow = rows.find(row => {
            // For PER_PRODUCT mode, productKey is "row-N" format, match by rowIndex
            if (firstProduct.productKey.startsWith("row-")) {
              const rowNum = parseInt(firstProduct.productKey.replace("row-", ""), 10);
              if (row.rowIndex === rowNum) return true;
            }
            // For PER_IMAGE mode, compute rowKey based on groupByField
            const productId = row.fields.product_id || "";
            const sku = row.fields.sku || "";
            let rowKey: string;
            if (groupByField === "sku") {
              if (productId && sku) {
                rowKey = `${productId}::${sku}`;
              } else {
                rowKey = sku || productId || row.key || "";
              }
            } else {
              rowKey = productId || sku || row.key || "";
            }
            return rowKey === firstProduct.productKey;
          });
          
          const originalSeo = originalRow?.fields.seo_description || "";
          const originalGeo = originalRow?.fields.geo_description || "";
          const originalGso = originalRow?.fields.gso_description || "";
          const originalTags = originalRow?.fields.tags || "";
          const originalMetaTitle = originalRow?.fields.meta_title || "";
          const originalMetaDesc = originalRow?.fields.meta_description || "";
          const originalSeoTitle = originalRow?.fields.seo_title || "";
          
          // Use full role names (api.ts normalizes short names to full names)
          const firstProductDescriptions = savedDescriptions[firstProduct.productKey];
          setEditingSeoDescription(firstProductDescriptions?.seo_description ?? originalSeo);
          setEditingGeoDescription(firstProductDescriptions?.geo_description ?? originalGeo);
          setEditingGsoDescription(firstProductDescriptions?.gso_description ?? originalGso);
          setEditingTags(firstProductDescriptions?.tags ?? originalTags);
          setEditingMetaTitle(firstProductDescriptions?.meta_title ?? originalMetaTitle);
          setEditingMetaDescription(firstProductDescriptions?.meta_description ?? originalMetaDesc);
          setEditingSeoTitle(firstProductDescriptions?.seo_title ?? originalSeoTitle);
          
          // Load custom fields for first product
          const customFieldValues: Record<string, string> = {};
          if (template.columns) {
            const standardRoles = new Set([
              "seo_description", "geo_description", "gso_description",
              "tags", "meta_title", "meta_description", "seo_title",
              "sku", "product_id", "ignore",
              "image_url", "image_position",
            ]);
            template.columns
              .filter((col: any) => col.role && col.role !== "ignore" && !standardRoles.has(col.role))
              .forEach((col: any) => {
                const role = col.role as string;
                let originalValue = originalRow?.fields[role as keyof typeof originalRow.fields];
                if (originalValue === undefined && originalRow?.fields.attributes) {
                  originalValue = originalRow.fields.attributes[role];
                }
                const savedValue = (firstProductDescriptions as Record<string, string | undefined>)?.[role];
                let originalStr = "";
                if (typeof originalValue === 'number') {
                  originalStr = String(originalValue);
                } else if (typeof originalValue === 'string') {
                  originalStr = originalValue;
                }
                customFieldValues[role] = savedValue ?? originalStr;
              });
          }
          setEditingCustomFields(customFieldValues);
          console.log("[ResultsModal] Initialized description fields for first product:", firstProduct.productKey);
        } else {
          setActiveProductKey(null);
        }
      } catch (err: any) {
        console.error("[ResultsModal] Error loading data:", err);
        setError(err.message || "Failed to load results");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, template?.id, userId]);

  // Filter and sort products based on filter mode, search, and update time
  const filteredProducts = useMemo(() => {
    if (!view) return [];

    let products = view.products;

    // Apply filter mode - include products with ANY type of update
    if (filterMode === "updated") {
      products = products.filter(
        (p) => p.hasResults || 
               !!findExportOverride(exportOverrides, p.productKey, originalRows, template.rowMode, (template as any).groupByField || "product_id") ||
               !!descriptionOverrides[p.productKey]
      );
    }

    // Apply search
    if (search.trim()) {
      const query = search.toLowerCase();
      products = products.filter(
        (p) =>
          p.productKey.toLowerCase().includes(query) ||
          (p.title ?? "").toLowerCase().includes(query)
      );
    }

    // Only sort by update time when in "updated" filter mode
    // In "all" mode, keep original spreadsheet order
    if (filterMode === "updated") {
      // Build a map of productKey -> most recent update from ALL sources
      const productLatestUpdate = new Map<string, number>();
      
      // 1. Check scenarios
      for (const scenario of allScenarios) {
        const existing = productLatestUpdate.get(scenario.productKey) || 0;
        if (scenario.createdAt > existing) {
          productLatestUpdate.set(scenario.productKey, scenario.createdAt);
        }
      }
      
      // 2. Check export overrides
      for (const [productKey, override] of Object.entries(exportOverrides)) {
        const updatedAt = (override as any)?.updatedAt;
        if (updatedAt && typeof updatedAt === 'number') {
          const existing = productLatestUpdate.get(productKey) || 0;
          if (updatedAt > existing) {
            productLatestUpdate.set(productKey, updatedAt);
          }
        }
      }
      
      // 3. Check description overrides
      for (const [productKey, override] of Object.entries(descriptionOverrides)) {
        const updatedAt = (override as any)?.updatedAt;
        if (updatedAt && typeof updatedAt === 'number') {
          const existing = productLatestUpdate.get(productKey) || 0;
          if (updatedAt > existing) {
            productLatestUpdate.set(productKey, updatedAt);
          }
        }
      }

      // Sort products: recently updated first
      return [...products].sort((a, b) => {
        const aTime = productLatestUpdate.get(a.productKey) || 0;
        const bTime = productLatestUpdate.get(b.productKey) || 0;
        
        // Sort by most recent update first
        if (aTime !== bTime) return bTime - aTime;
        
        // For same timestamp, sort alphabetically
        return (a.productKey || "").localeCompare(b.productKey || "");
      });
    }

    // "all" mode: keep original order
    return products;
  }, [view, filterMode, search, exportOverrides, descriptionOverrides, originalRows, template.rowMode, allScenarios]);

  // Auto-select first product when filterMode changes or current selection is filtered out
  useEffect(() => {
    // Skip during loading to avoid flicker
    if (loading) return;
    
    // Skip if no products
    if (!filteredProducts.length) {
      prevFilterModeRef.current = filterMode;
      return;
    }
    
    // Check if this is filterMode change
    const modeChanged = prevFilterModeRef.current !== null && prevFilterModeRef.current !== filterMode;
    prevFilterModeRef.current = filterMode;
    
    // Check if current selection is still in the filtered list
    const currentInList = activeProductKey && filteredProducts.some(p => p.productKey === activeProductKey);
    
    // Only re-select if current selection is not in list (e.g., filtered out by search or "updated" filter)
    // Don't re-select on mode change since both modes prefer the same product (most recently updated)
    if (!currentInList) {
      setActiveProductKey(filteredProducts[0].productKey);
    }
  }, [filterMode, filteredProducts, activeProductKey, loading]);

  // Get active product details
  const activeProduct = useMemo(() => {
    return view?.products.find((p) => p.productKey === activeProductKey) ?? null;
  }, [view, activeProductKey]);
  
  // Get all AI artwork URLs for active product (from all scenarios)
  const aiArtworkUrls = useMemo(() => {
    if (!activeProductKey || !allScenarios.length) return [];
    
    // Get all scenarios for this product
    const productScenarios = allScenarios.filter(s => s.productKey === activeProductKey);
    
    // Collect all unique image URLs from all scenarios
    const allUrls: string[] = [];
    const seen = new Set<string>();
    
    // Sort by createdAt descending (newest first) for display
    const sorted = [...productScenarios].sort((a, b) => b.createdAt - a.createdAt);
    
    for (const scenario of sorted) {
      for (const url of scenario.imageUrls || []) {
        if (url && !seen.has(url)) {
          seen.add(url);
          allUrls.push(url);
        }
      }
    }
    
    return allUrls;
  }, [activeProductKey, allScenarios]);

  // Format display name for active product (product_id + sku with space instead of ::)
  const activeProductDisplayName = useMemo(() => {
    if (!activeProduct) return "";
    
    const productKey = activeProduct.productKey;
    
    // If productKey contains "::", replace with space for display
    if (productKey.includes("::")) {
      return productKey.replace("::", " ");
    }
    
    // For PER_PRODUCT mode (row-N format), try to get product_id and sku from originalRows
    if (productKey.startsWith("row-")) {
      const rowNum = parseInt(productKey.replace("row-", ""), 10);
      const originalRow = originalRows.find(r => r.rowIndex === rowNum);
      if (originalRow) {
        const productId = originalRow.fields.product_id || "";
        const sku = originalRow.fields.sku || "";
        if (productId && sku) {
          return `${productId} ${sku}`;
        }
        if (productId) return productId;
        if (sku) return sku;
      }
      // Fallback to row-N
      return productKey;
    }
    
    // Default: return as-is
    return productKey;
  }, [activeProduct, originalRows]);

  // Calculate categorized images for display using imageCategories labels
  // Each image has its own category label that can be changed by dragging
  // Returns: { byColumnName: { "Column Name": [...] } }
  const categorizedExportImages = useMemo(() => {
    const result: { 
      byColumnName: Record<string, Array<{url: string, index: number}>>
    } = {
      byColumnName: {},
    };
    
    // Initialize byColumnName from template columns
    const templateImgCols = template?.columns
      ?.filter((col: any) => col.role === 'image_url')
      .map((col: any) => col.name) || [];
    
    for (const colName of templateImgCols) {
      result.byColumnName[colName] = [];
    }
    
    // Also initialize from original categorized if available
    if (activeProduct?.originalCategorized?.byColumnName) {
      for (const colName of Object.keys(activeProduct.originalCategorized.byColumnName)) {
        if (!result.byColumnName[colName]) {
          result.byColumnName[colName] = [];
        }
      }
    }
    
    const firstColName = templateImgCols[0] || Object.keys(result.byColumnName)[0] || 'Image';
    
    exportImages.forEach((url, index) => {
      const category = imageCategories[index] || firstColName;
      
      // Add to the appropriate column
      if (!result.byColumnName[category]) {
        result.byColumnName[category] = [];
      }
      result.byColumnName[category].push({ url, index });
    });
    
    return result;
  }, [exportImages, imageCategories, activeProduct, template]);

  // Get all image_url column names from template
  const templateImageColumns = useMemo(() => {
    if (!template?.columns) return [];
    return template.columns
      .filter((col: any) => col.role === 'image_url')
      .map((col: any) => col.name);
  }, [template]);

  // Get all column names for rendering
  // Priority: template columns, then original data, then export data
  const columnNames = useMemo(() => {
    const names = new Set<string>();
    
    // Add all image_url columns from template
    templateImageColumns.forEach((name: string) => names.add(name));
    
    // Add from original categorized
    if (activeProduct?.originalCategorized?.byColumnName) {
      Object.keys(activeProduct.originalCategorized.byColumnName).forEach(name => names.add(name));
    }
    
    // Add from current export images
    Object.keys(categorizedExportImages.byColumnName).forEach(name => names.add(name));
    
    return Array.from(names);
  }, [templateImageColumns, activeProduct, categorizedExportImages]);

  // Check if we should show categorized view
  // Show when there are any column names defined
  const hasCategorizedImages = useMemo(() => {
    if (!activeProduct) return false;
    return columnNames.length > 0;
  }, [activeProduct, columnNames]);

  // Keep ref in sync with state
  useEffect(() => {
    exportOverridesRef.current = exportOverrides;
  }, [exportOverrides]);

  useEffect(() => {
    descriptionOverridesRef.current = descriptionOverrides;
  }, [descriptionOverrides]);

  // Load exportImages when product changes (but not on initial load)
  useEffect(() => {
    // Skip initial load - loadData already sets exportImages correctly
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    if (!activeProduct) {
      setExportImages([]);
      setImageCategories([]);
      setEditingSeoDescription("");
      setEditingGeoDescription("");
      setEditingGsoDescription("");
      setEditingTags("");
      setEditingMetaTitle("");
      setEditingMetaDescription("");
      setEditingSeoTitle("");
      return;
    }

    // Use flexible lookup to find override (handles key mismatch)
    const savedOverride = findExportOverride(
      exportOverridesRef.current,
      activeProduct.productKey,
      originalRows,
      template.rowMode,
      (template as any).groupByField || "product_id"
    );
    const savedImages = getOverrideImages(savedOverride);
    const savedCategories = getOverrideCategories(savedOverride);
    if (savedImages && savedImages.length > 0) {
      setExportImages([...savedImages]);
      // Use saved categories if available
      if (savedCategories && savedCategories.length === savedImages.length) {
        // Convert role-based tokens to ImageCategory
        setImageCategories(savedCategories.map(roleTokenToImageCategory));
      } else {
        setImageCategories(buildCategoriesArray(savedImages, activeProduct.originalCategorized));
      }
    } else {
      setExportImages([...activeProduct.currentImageUrls]);
      setImageCategories(buildCategoriesArray(activeProduct.currentImageUrls, activeProduct.originalCategorized));
    }
    
    // Load description overrides for active product
    // Helper to find originalRow by productKey
    const groupByField = (template as any).groupByField || "product_id";
    const originalRow = originalRows.find(row => {
      // For PER_PRODUCT mode, productKey is "row-N" format, match by rowIndex
      if (activeProduct.productKey.startsWith("row-")) {
        const rowNum = parseInt(activeProduct.productKey.replace("row-", ""), 10);
        if (row.rowIndex === rowNum) return true;
      }
      // For PER_IMAGE mode, compute rowKey based on groupByField
      const productId = row.fields.product_id || "";
      const sku = row.fields.sku || "";
      let rowKey: string;
      if (groupByField === "sku") {
        // productKey format is "product_id::sku"
        if (productId && sku) {
          rowKey = `${productId}::${sku}`;
        } else {
          rowKey = sku || productId || row.key || "";
        }
      } else {
        rowKey = productId || sku || row.key || "";
      }
      return rowKey === activeProduct.productKey;
    });
    
    const originalSeo = originalRow?.fields.seo_description || "";
    const originalGeo = originalRow?.fields.geo_description || "";
    const originalGso = originalRow?.fields.gso_description || "";
    const originalTags = originalRow?.fields.tags || "";
    const originalMetaTitle = originalRow?.fields.meta_title || "";
    const originalMetaDesc = originalRow?.fields.meta_description || "";
    const originalSeoTitle = originalRow?.fields.seo_title || "";
    
    const savedDescriptions = descriptionOverridesRef.current[activeProduct.productKey];
    setEditingSeoDescription(savedDescriptions?.seo_description ?? originalSeo);
    setEditingGeoDescription(savedDescriptions?.geo_description ?? originalGeo);
    setEditingGsoDescription(savedDescriptions?.gso_description ?? originalGso);
    setEditingTags(savedDescriptions?.tags ?? originalTags);
    setEditingMetaTitle(savedDescriptions?.meta_title ?? originalMetaTitle);
    setEditingMetaDescription(savedDescriptions?.meta_description ?? originalMetaDesc);
    setEditingSeoTitle(savedDescriptions?.seo_title ?? originalSeoTitle);
    
    // Load custom fields (all non-standard mapped fields, not just enableGeneration)
    const customFieldValues: Record<string, string> = {};
    if (template.columns) {
      const standardRoles = new Set([
        "seo_description", "geo_description", "gso_description",
        "tags", "meta_title", "meta_description", "seo_title",
        "sku", "product_id", "ignore",
        "image_url", "image_position",
      ]);
      template.columns
        .filter((col: any) => col.role && col.role !== "ignore" && !standardRoles.has(col.role))
        .forEach((col: any) => {
          const role = col.role as string;
          // Try direct field access first
          let originalValue = originalRow?.fields[role as keyof typeof originalRow.fields];
          // If not found, try attributes
          if (originalValue === undefined && originalRow?.fields.attributes) {
            originalValue = originalRow.fields.attributes[role];
          }
          const savedValue = (savedDescriptions as Record<string, string | undefined>)?.[role];
          // Handle numeric values
          let originalStr = "";
          if (typeof originalValue === 'number') {
            originalStr = String(originalValue);
          } else if (typeof originalValue === 'string') {
            originalStr = originalValue;
          }
          customFieldValues[role] = savedValue ?? originalStr;
        });
    }
    setEditingCustomFields(customFieldValues);
    
    setHasUnsavedChanges(false);
    setHasDescriptionChanges(false);
    
    // Reset AI artwork panel when switching products
    setShowAIArtwork(false);
  }, [activeProduct?.productKey, originalRows, template.rowMode]);

  // Check if product has saved export override (uses flexible lookup)
  const hasSavedOverride = (productKey: string) => {
    return !!findExportOverride(exportOverrides, productKey, originalRows, template.rowMode, (template as any).groupByField || "product_id");
  };

  // Check if product has saved description override
  const hasSavedDescriptionOverride = (productKey: string) => {
    const saved = descriptionOverrides[productKey];
    if (!saved) return false;
    // Check if any description field has been saved (including custom fields)
    return Object.values(saved).some(v => v !== undefined && v !== "");
  };

  // Check if product is "updated" (has results, saved image overrides, or saved description overrides)
  const isUpdated = (product: ProductImagesView) => {
    return product.hasResults || hasSavedOverride(product.productKey) || hasSavedDescriptionOverride(product.productKey);
  };

  // Count updated products
  const updatedCount = useMemo(() => {
    if (!view) return 0;
    return view.products.filter((p) => isUpdated(p)).length;
  }, [view, exportOverrides, descriptionOverrides]);

  // Check if there are any unsaved changes (images or descriptions)
  const hasAnyUnsavedChanges = hasUnsavedChanges || hasDescriptionChanges;

  // Show alert modal for unsaved changes confirmation
  const showUnsavedChangesAlert = (action: string, onDiscard: () => void) => {
    if (!hasAnyUnsavedChanges) {
      onDiscard();
      return;
    }
    setAlertConfig({
      show: true,
      title: "Unsaved Changes",
      message: `You have unsaved changes. Are you sure you want to ${action}? Your changes will be lost.`,
      onDiscard: () => {
        setAlertConfig(prev => ({ ...prev, show: false }));
        onDiscard();
      },
    });
  };

  // Close alert modal
  const closeAlert = () => {
    setAlertConfig(prev => ({ ...prev, show: false }));
  };

  // Handle product selection with unsaved changes check
  const handleProductSelect = (productKey: string) => {
    if (productKey === activeProductKey) return;
    showUnsavedChangesAlert("switch to another product", () => {
      setActiveProductKey(productKey);
    });
  };

  // Handle close with unsaved changes check
  const handleClose = () => {
    showUnsavedChangesAlert("close this dialog", () => {
      onClose();
    });
  };

  // ========== Image Operations ==========

  // Delete image at index
  const handleDeleteImage = (index: number) => {
    setExportImages((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setImageCategories((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setHasUnsavedChanges(true);
  };

  // Drag handlers for export images
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    setAiDragUrl(null);  // Clear AI drag when starting export drag
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.setData("drag-type", "export");
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    // Check if this is AI artwork drag (check types, since getData not available in dragover)
    const isAIDrag = e.dataTransfer.types.includes("application/x-ai-artwork") || aiDragUrl;
    e.dataTransfer.dropEffect = isAIDrag ? "copy" : "move";
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  // Drop on a specific image - insert at that position, inherit that image's category
  const handleDrop = (e: React.DragEvent, dropIndex: number, targetCategory?: ImageCategory) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if this is an AI artwork drop (check dataTransfer first, then state)
    const aiUrl = e.dataTransfer.getData("application/x-ai-artwork") || aiDragUrl;
    
    if (aiUrl) {
      // Add AI artwork image to this position
      const newCategory = targetCategory || imageCategories[dropIndex] || 'main';
      
      setExportImages((prev) => {
        const next = [...prev];
        next.splice(dropIndex, 0, aiUrl);
        return next;
      });
      
      setImageCategories((prev) => {
        const next = [...prev];
        next.splice(dropIndex, 0, newCategory);
        return next;
      });
      
      setAiDragUrl(null);
      setDragOverIndex(null);
      setDragOverCategory(null);
      setHasUnsavedChanges(true);
      return;
    }
    
    const fromIndex = dragIndex;

    if (fromIndex === null || fromIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      setDragOverCategory(null);
      return;
    }

    // Use existing category if not specified (for flat view)
    const newCategory = targetCategory || imageCategories[dropIndex] || 'main';

    // Move image and update category
    setExportImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      // Calculate insert position after removal:
      // - When dragging forward: indices shift down after removal
      // - For adjacent swap (dropIndex = fromIndex + 1), use dropIndex to actually swap
      // - For non-adjacent forward drag, use dropIndex - 1 to insert before target
      // - When dragging backward: use dropIndex directly
      let adjustedDropIndex: number;
      if (fromIndex < dropIndex) {
        // Dragging forward - special case for adjacent
        adjustedDropIndex = dropIndex === fromIndex + 1 ? dropIndex : dropIndex - 1;
      } else {
        // Dragging backward
        adjustedDropIndex = dropIndex;
      }
      next.splice(adjustedDropIndex, 0, moved);
      return next;
    });
    
    setImageCategories((prev) => {
      const next = [...prev];
      next.splice(fromIndex, 1);
      let adjustedDropIndex: number;
      if (fromIndex < dropIndex) {
        adjustedDropIndex = dropIndex === fromIndex + 1 ? dropIndex : dropIndex - 1;
      } else {
        adjustedDropIndex = dropIndex;
      }
      next.splice(adjustedDropIndex, 0, newCategory);
      return next;
    });

    setDragIndex(null);
    setDragOverIndex(null);
    setDragOverCategory(null);
    setHasUnsavedChanges(true);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
    setDragOverCategory(null);
    setAiDragUrl(null);
  };

  // Category-level drag handlers for dropping into category areas
  const handleCategoryDragOver = (e: React.DragEvent, category: string) => {
    e.preventDefault();
    // Check if this is AI artwork drag (check types, since getData not available in dragover)
    const isAIDrag = e.dataTransfer.types.includes("application/x-ai-artwork") || aiDragUrl;
    e.dataTransfer.dropEffect = isAIDrag ? "copy" : "move";
    setDragOverCategory(category);
  };

  const handleCategoryDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the category box entirely
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverCategory(null);
    }
  };

  // Drop on category empty area - add to end of that category
  const handleCategoryDrop = (e: React.DragEvent, targetCategory: ImageCategory) => {
    e.preventDefault();
    
    // Check if this is an AI artwork drop (check dataTransfer first, then state)
    const aiUrl = e.dataTransfer.getData("application/x-ai-artwork") || aiDragUrl;
    
    if (aiUrl) {
      // Add AI artwork image to end of this category
      // Find the last position of this category in imageCategories
      let targetIndex = exportImages.length; // Default to end
      
      // Find where this category ends
      for (let i = imageCategories.length - 1; i >= 0; i--) {
        if (imageCategories[i] === targetCategory) {
          targetIndex = i + 1;
          break;
        }
      }
      
      // Helper to get category order index
      // For new column-name format: use position in columnNames array
      // For legacy format: main=0, additional=1, slot-N=2+N
      const getCategoryOrderIndex = (cat: ImageCategory): number => {
        // NEW: Check if this is a column name (from template)
        if (columnNames.length > 0) {
          const colIndex = columnNames.indexOf(cat);
          if (colIndex >= 0) {
            return colIndex;  // Use template column order
          }
        }
        
        // LEGACY: main/additional/slot format
        if (cat === 'main') return 0;
        if (cat === 'additional') return 1;
        if (cat.startsWith('slot-')) {
          const slotNum = Number(cat.replace('slot-', ''));
          return 2 + slotNum;
        }
        return 999;
      };
      
      // If no images of this category exist, find where it should go
      if (targetIndex === exportImages.length && imageCategories.length > 0) {
        const targetOrderIndex = getCategoryOrderIndex(targetCategory);
        
        for (let i = 0; i < imageCategories.length; i++) {
          const cat = imageCategories[i];
          if (getCategoryOrderIndex(cat) > targetOrderIndex) {
            targetIndex = i;
            break;
          }
        }
      }
      
      setExportImages((prev) => {
        const next = [...prev];
        next.splice(targetIndex, 0, aiUrl);
        return next;
      });
      
      setImageCategories((prev) => {
        const next = [...prev];
        next.splice(targetIndex, 0, targetCategory);
        return next;
      });
      
      setAiDragUrl(null);
      setDragOverIndex(null);
      setDragOverCategory(null);
      setHasUnsavedChanges(true);
      return;
    }
    
    const fromIndex = dragIndex;
    if (fromIndex === null) {
      setDragIndex(null);
      setDragOverIndex(null);
      setDragOverCategory(null);
      return;
    }

    // Find the last position of this category in imageCategories
    // Insert after the last image of this category
    let targetIndex = 0;
    for (let i = imageCategories.length - 1; i >= 0; i--) {
      if (imageCategories[i] === targetCategory) {
        targetIndex = i + 1;
        break;
      }
    }
    
    // Helper to get category order index
    const getCategoryOrderIndex = (cat: ImageCategory): number => {
      if (cat === 'main') return 0;
      if (cat === 'additional') return 1;
      if (cat.startsWith('slot-')) {
        const slotNum = Number(cat.replace('slot-', ''));
        return 2 + slotNum; // slots start at index 2
      }
      return 999;
    };
    
    // If no images of this category exist, find where it should go based on category order
    if (targetIndex === 0 && imageCategories.length > 0) {
      const targetOrderIndex = getCategoryOrderIndex(targetCategory);
      
      // Find the first image of a later category
      for (let i = 0; i < imageCategories.length; i++) {
        const cat = imageCategories[i];
        if (getCategoryOrderIndex(cat) > targetOrderIndex) {
          targetIndex = i;
          break;
        }
      }
      // If all images are of earlier categories, insert at end
      if (targetIndex === 0) {
        targetIndex = imageCategories.length;
      }
    }

    // Adjust targetIndex if we're moving from before it
    const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;

    // Move image and update category
    setExportImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(adjustedTargetIndex, 0, moved);
      return next;
    });
    
    setImageCategories((prev) => {
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(adjustedTargetIndex, 0, targetCategory);
      return next;
    });

    setDragIndex(null);
    setDragOverIndex(null);
    setDragOverCategory(null);
    setHasUnsavedChanges(true);
  };

  // ========== AI Artwork Drag Handlers ==========
  
  const handleAIArtworkDragStart = (e: React.DragEvent, url: string) => {
    setAiDragUrl(url);
    setDragIndex(null);  // Clear export drag when starting AI drag
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", url);
    e.dataTransfer.setData("application/x-ai-artwork", url);
  };
  
  const handleAIArtworkDragEnd = () => {
    setAiDragUrl(null);
    setDragOverIndex(null);
    setDragOverCategory(null);
  };

  // ========== Reset & Save Operations ==========

  const handleToggleAIArtwork = () => {
    setShowAIArtwork(!showAIArtwork);
  };

  const handleResetToOriginal = () => {
    if (!activeProduct) return;
    setExportImages([...activeProduct.originalImageUrls]);
    setImageCategories(buildCategoriesArray(activeProduct.originalImageUrls, activeProduct.originalCategorized));
    setHasUnsavedChanges(true);
  };

  const handleResetToLastSaved = () => {
    if (!activeProduct) return;
    const savedOverride = findExportOverride(
      exportOverrides,
      activeProduct.productKey,
      originalRows,
      template.rowMode,
      (template as any).groupByField || "product_id"
    );
    const savedImages = getOverrideImages(savedOverride);
    const savedCategories = getOverrideCategories(savedOverride);
    if (savedImages) {
      setExportImages([...savedImages]);
      // Use saved categories if available
      if (savedCategories && savedCategories.length === savedImages.length) {
        // Convert role-based tokens to ImageCategory
        setImageCategories(savedCategories.map(roleTokenToImageCategory));
      } else {
        setImageCategories(buildCategoriesArray(savedImages, activeProduct.originalCategorized));
      }
      setHasUnsavedChanges(false);
    }
  };

  const hasLastSaved = activeProduct 
    ? !!findExportOverride(exportOverrides, activeProduct.productKey, originalRows, template.rowMode, (template as any).groupByField || "product_id")
    : false;

  const handleSave = async () => {
    if (!activeProduct) return;

    // Build ordered images and categories by column names
    const orderedItems: Array<{ url: string; category: ImageCategory }> = columnNames.flatMap(colName => 
      (categorizedExportImages.byColumnName[colName] || []).map(item => ({ 
        url: item.url, 
        category: colName as ImageCategory 
      }))
    );
    
    const orderedImages = orderedItems.map(item => item.url);
    const orderedCategories = orderedItems.map(item => item.category);
    
    // Convert ImageCategory to tokens for storage
    const orderedRoleTokens = orderedCategories.map(imageCategoryToRoleToken);

    console.log("[ResultsModal] Saving " + orderedImages.length + " images for " + activeProduct.productKey);

    setSaving(true);
    try {
      // Save both images and role-based tokens to backend
      await saveExportOverride(
        userId,
        template.id,
        activeProduct.productKey,
        orderedImages,
        orderedRoleTokens  // Pass role-based tokens
      );

      console.log("[ResultsModal] Backend save successful for " + activeProduct.productKey);

      // Update local state with new format { images, categories }
      const newOverrides = {
        ...exportOverrides,
        [activeProduct.productKey]: {
          images: [...orderedImages],
          categories: [...orderedRoleTokens],  // Store role-based tokens
        },
      };
      setExportOverrides(newOverrides);
      exportOverridesRef.current = newOverrides;
      
      // Also update local state to match saved order (keep as ImageCategory for UI)
      setExportImages(orderedImages);
      setImageCategories(orderedCategories);
      
      setHasUnsavedChanges(false);
      
      // Notify parent that template data was updated (for sorting)
      onTemplateUpdated?.();
      
      console.log("[ResultsModal] Local state updated, total overrides: " + Object.keys(newOverrides).length);
    } catch (err: any) {
      console.error("[ResultsModal] Failed to save:", err);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ========== Helper: Find Original Row ==========
  
  // Helper function to find originalRow by productKey (supports both PER_PRODUCT and PER_IMAGE modes)
  const findOriginalRowByProductKey = (productKey: string): SpreadsheetRowItem | undefined => {
    const groupByField = (template as any).groupByField || "product_id";
    return originalRows.find(row => {
      // For PER_PRODUCT mode, productKey is "row-N" format, match by rowIndex
      if (productKey.startsWith("row-")) {
        const rowNum = parseInt(productKey.replace("row-", ""), 10);
        if (row.rowIndex === rowNum) return true;
      }
      // For PER_IMAGE mode, compute rowKey based on groupByField
      const productId = row.fields.product_id || "";
      const sku = row.fields.sku || "";
      let rowKey: string;
      if (groupByField === "sku") {
        // productKey format is "product_id::sku"
        if (productId && sku) {
          rowKey = `${productId}::${sku}`;
        } else {
          rowKey = sku || productId || row.key || "";
        }
      } else {
        rowKey = productId || sku || row.key || "";
      }
      return rowKey === productKey;
    });
  };

  // ========== Description Operations ==========

  const getOriginalDescription = (type: DescriptionType): string => {
    if (!activeProduct) return "";
    const originalRow = findOriginalRowByProductKey(activeProduct.productKey);
    if (!originalRow) return "";
    
    const fieldMap: Record<DescriptionType, string> = {
      seo: "seo_description",
      geo: "geo_description",
      gso: "gso_description",
      tags: "tags",
      meta_title: "meta_title",
      meta_description: "meta_description",
      seo_title: "seo_title",
    };
    
    const fieldName = fieldMap[type];
    const value = originalRow.fields[fieldName as keyof typeof originalRow.fields];
    return typeof value === 'string' ? value : "";
  };

  const hasDescriptionField = (type: DescriptionType): boolean => {
    if (!template.columns) return false;
    const roleMap: Record<string, string> = {
      seo: "seo_description",
      geo: "geo_description",
      gso: "gso_description",
      tags: "tags",
      meta_title: "meta_title",
      meta_description: "meta_description",
      seo_title: "seo_title",
    };
    const role = roleMap[type] || type;
    
    // Show field if it's mapped in the template (regardless of enableGeneration)
    return template.columns.some((col: any) => col.role === role);
  };

  // Get all mapped custom fields (excluding standard fields, identity and image fields)
  const getCustomGenerationFields = useMemo(() => {
    if (!template.columns) return [];
    
    // Standard roles that are already handled by dedicated UI
    const standardRoles = new Set([
      "seo_description", "geo_description", "gso_description",
      "tags", "meta_title", "meta_description", "seo_title",
      // Identity and image fields (never show in product information)
      "sku", "product_id", "ignore",
      "image_url", "image_position",
    ]);
    
    // Get FIELD_ROLE_GROUPS to find labels
    // Keys must match actual role values from template.columns
    const fieldRoleLabels: Record<string, string> = {
      product_title: "Product Title",
      description: "Description",
      category: "Category / Type",
      vendor_name: "Vendor Name",
      vendor_link: "Vendor Link",
      vendor_sku: "Vendor SKU",
      vendor_price: "Vendor Price",
      price: "Price",
      compare_at_price: "Compare-at Price",
      cost: "Cost per Item",
      shipping_weight_grams: "Weight (grams)",
      shipping_weight_unit: "Weight Unit",
      barcode: "GTIN / UPC / EAN",
      quantity: "Quantity / Stock",
      attr_material: "Material",
      attr_color: "Color",
      attr_size: "Size",
      attr_gender: "Gender",
      attr_age_group: "Age Group",
      attr_condition: "Condition",
      source_link: "Source Link",
      source_image: "Source Image",
      url_handle: "URL Handle",
    };
    
    // Return all mapped fields that are not standard/identity/image
    return template.columns
      .filter((col: any) => 
        col.role && 
        col.role !== "ignore" &&
        !standardRoles.has(col.role)
      )
      .map((col: any) => ({
        role: col.role as string,
        columnName: col.name,
        label: fieldRoleLabels[col.role] || col.role.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
      }));
  }, [template.columns]);

  // Get original value for a custom field
  const getOriginalCustomFieldValue = (role: string): string => {
    if (!activeProduct) return "";
    const originalRow = findOriginalRowByProductKey(activeProduct.productKey);
    if (!originalRow) return "";
    
    // Try direct field access first (for standard fields)
    let value = originalRow.fields[role as keyof typeof originalRow.fields];
    
    // If not found, try attributes (for non-standard fields)
    if (value === undefined && originalRow.fields.attributes) {
      value = originalRow.fields.attributes[role];
    }
    
    // Handle numeric values by converting to string
    if (typeof value === 'number') {
      return String(value);
    }
    return typeof value === 'string' ? value : "";
  };

  // Check if custom field has been modified from original
  const isCustomFieldModified = (role: string): boolean => {
    const original = getOriginalCustomFieldValue(role);
    return (editingCustomFields[role] || "") !== original;
  };

  // Check if custom field is same as saved
  const isCustomFieldSameAsSaved = (role: string): boolean => {
    if (!activeProduct) return true;
    
    const savedOverride = descriptionOverrides[activeProduct.productKey];
    const original = getOriginalCustomFieldValue(role);
    const savedValue = (savedOverride as Record<string, string | undefined>)?.[role] ?? original;
    
    return (editingCustomFields[role] || "") === savedValue;
  };

  // Handle custom field change
  const handleCustomFieldChange = (role: string, value: string) => {
    setEditingCustomFields(prev => ({ ...prev, [role]: value }));
    setHasDescriptionChanges(true);
  };

  // Handle save custom field
  const handleSaveCustomField = async (role: string) => {
    if (!activeProduct) return;

    const content = editingCustomFields[role] || "";

    setSavingDescription(role);
    try {
      await saveDescriptionOverride(
        userId,
        template.id,
        activeProduct.productKey,
        role as DescriptionType,
        content
      );

      const newOverrides = {
        ...descriptionOverrides,
        [activeProduct.productKey]: {
          ...(descriptionOverrides[activeProduct.productKey] || {}),
          [role]: content,
        },
      };
      setDescriptionOverrides(newOverrides);
      descriptionOverridesRef.current = newOverrides;
      
      // Notify parent that template data was updated (for sorting)
      onTemplateUpdated?.();
      
      console.log("[ResultsModal] Saved custom field " + role + " for " + activeProduct.productKey);
    } catch (err: any) {
      console.error("[ResultsModal] Failed to save custom field:", err);
      alert("Failed to save. Please try again.");
    } finally {
      setSavingDescription(null);
    }
  };

  // Handle reset custom field
  const handleResetCustomField = (role: string) => {
    const original = getOriginalCustomFieldValue(role);
    setEditingCustomFields(prev => ({ ...prev, [role]: original }));
    setHasDescriptionChanges(true);
  };

  const handleDescriptionChange = (type: DescriptionType, value: string) => {
    switch (type) {
      case "seo": setEditingSeoDescription(value); break;
      case "geo": setEditingGeoDescription(value); break;
      case "gso": setEditingGsoDescription(value); break;
      case "tags": setEditingTags(value); break;
      case "meta_title": setEditingMetaTitle(value); break;
      case "meta_description": setEditingMetaDescription(value); break;
      case "seo_title": setEditingSeoTitle(value); break;
    }
    setHasDescriptionChanges(true);
  };

  const handleSaveDescription = async (type: DescriptionType) => {
    if (!activeProduct) return;

    if (!hasDescriptionField(type)) {
      alert("Your spreadsheet template doesn't have a " + type.toUpperCase().replace('_', ' ') + " field mapped. Please go to CSV Templates page to map the appropriate column.");
      return;
    }

    const getContent = (): string => {
      switch (type) {
        case "seo": return editingSeoDescription;
        case "geo": return editingGeoDescription;
        case "gso": return editingGsoDescription;
        case "tags": return editingTags;
        case "meta_title": return editingMetaTitle;
        case "meta_description": return editingMetaDescription;
        case "seo_title": return editingSeoTitle;
        default: return "";
      }
    };
    const content = getContent();

    setSavingDescription(type);
    try {
      await saveDescriptionOverride(
        userId,
        template.id,
        activeProduct.productKey,
        type,
        content
      );

      const newOverrides = {
        ...descriptionOverrides,
        [activeProduct.productKey]: {
          ...(descriptionOverrides[activeProduct.productKey] || {}),
          [type]: content,
        },
      };
      setDescriptionOverrides(newOverrides);
      descriptionOverridesRef.current = newOverrides;
      
      // Notify parent that template data was updated (for sorting)
      onTemplateUpdated?.();
      
      console.log("[ResultsModal] Saved " + type + " description for " + activeProduct.productKey);
    } catch (err: any) {
      console.error("[ResultsModal] Failed to save description:", err);
      alert("Failed to save description. Please try again.");
    } finally {
      setSavingDescription(null);
    }
  };

  const handleResetDescription = (type: DescriptionType) => {
    const original = getOriginalDescription(type);
    switch (type) {
      case "seo": setEditingSeoDescription(original); break;
      case "geo": setEditingGeoDescription(original); break;
      case "gso": setEditingGsoDescription(original); break;
      case "tags": setEditingTags(original); break;
      case "meta_title": setEditingMetaTitle(original); break;
      case "meta_description": setEditingMetaDescription(original); break;
      case "seo_title": setEditingSeoTitle(original); break;
    }
    setHasDescriptionChanges(true);
  };

  const isDescriptionModified = (type: DescriptionType): boolean => {
    const original = getOriginalDescription(type);
    const getCurrent = (): string => {
      switch (type) {
        case "seo": return editingSeoDescription;
        case "geo": return editingGeoDescription;
        case "gso": return editingGsoDescription;
        case "tags": return editingTags;
        case "meta_title": return editingMetaTitle;
        case "meta_description": return editingMetaDescription;
        case "seo_title": return editingSeoTitle;
        default: return "";
      }
    };
    return getCurrent() !== original;
  };

  const isDescriptionSameAsSaved = (type: DescriptionType): boolean => {
    if (!activeProduct) return true;
    
    const savedOverride = descriptionOverrides[activeProduct.productKey];
    const original = getOriginalDescription(type);
    const savedValue = savedOverride?.[type] ?? original;
    
    const getCurrent = (): string => {
      switch (type) {
        case "seo": return editingSeoDescription;
        case "geo": return editingGeoDescription;
        case "gso": return editingGsoDescription;
        case "tags": return editingTags;
        case "meta_title": return editingMetaTitle;
        case "meta_description": return editingMetaDescription;
        case "seo_title": return editingSeoTitle;
        default: return "";
      }
    };
    
    return getCurrent() === savedValue;
  };

  const hasAnyDescriptionField = hasDescriptionField("seo") || hasDescriptionField("geo") || hasDescriptionField("gso") ||
                                 hasDescriptionField("tags") || hasDescriptionField("meta_title") || 
                                 hasDescriptionField("meta_description") || hasDescriptionField("seo_title") ||
                                 getCustomGenerationFields.length > 0;
  
  const hasAnyDescription = hasAnyDescriptionField || editingSeoDescription || editingGeoDescription || editingGsoDescription || 
                            editingTags || editingMetaTitle || editingMetaDescription || editingSeoTitle ||
                            Object.values(editingCustomFields).some(v => v !== "");

  // ========== Lightbox Navigation ==========

  const openLightbox = (url: string, index: number) => {
    setPreviewSrc(url);
    setPreviewIndex(index);
  };

  const closeLightbox = () => {
    setPreviewSrc(null);
  };

  const goToPrevImage = () => {
    if (exportImages.length === 0) return;
    const newIndex =
      (previewIndex - 1 + exportImages.length) % exportImages.length;
    setPreviewIndex(newIndex);
    setPreviewSrc(exportImages[newIndex]);
  };

  const goToNextImage = () => {
    if (exportImages.length === 0) return;
    const newIndex = (previewIndex + 1) % exportImages.length;
    setPreviewIndex(newIndex);
    setPreviewSrc(exportImages[newIndex]);
  };

  // ========== Export Logic ==========

  const handleExport = (onlyUpdated: boolean) => {
    if (!view || exporting) return;
    
    // Check for unsaved changes before export
    showUnsavedChangesAlert("export", async () => {
      setExporting(true);
      try {
        const blob = await exportSpreadsheetWithResults(userId, template.id, {
          onlyUpdated,
          dedupeImages: dedupeEnabled,
          exportOverrides,
        });

        // Use original file extension from template
        const originalExt = template.originalFileName?.split('.').pop()?.toLowerCase() || 'csv';
        const ext = ['xls', 'xlsx', 'csv'].includes(originalExt) ? originalExt : 'csv';
        const filename = template.templateName + "-export-" + Date.now() + "." + ext;
        downloadBlob(blob, filename);
      } catch (err: any) {
        console.error("[Export] Error:", err);
        setAlertConfig({
          show: true,
          title: "Export Failed",
          message: err.message || "Export failed. Please try again.",
          onDiscard: closeAlert,
          isError: true,
        });
      } finally {
        setExporting(false);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <>
      <Overlay onClick={handleClose}>
        <Modal onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <ModalHeader>
            <HeaderContent>
              <ModalTitle>Results · {template.templateName}</ModalTitle>
              <ModalSubtitle>
                Preview and export image updates for this spreadsheet
              </ModalSubtitle>
            </HeaderContent>
            <CloseButton onClick={handleClose}>×</CloseButton>
          </ModalHeader>

        {/* Body */}
        <ModalBody>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          {loading ? (
            <LoadingState>Loading results...</LoadingState>
          ) : !view ? (
            <EmptyState>No data available</EmptyState>
          ) : view.products.length === 0 ? (
            <EmptyState>
              <EmptyTitle>No products found</EmptyTitle>
              <EmptyText>
                This spreadsheet doesn't have any products yet.
              </EmptyText>
            </EmptyState>
          ) : (
            <ContentGrid>
              {/* Left Column: Product List */}
              <LeftColumn>
                <FilterSection>
                  {/* Filter Toggle */}
                  <FilterToggle>
                    <FilterButton
                      $active={filterMode === "all"}
                      onClick={() => setFilterMode("all")}
                    >
                      All ({view.totalProducts})
                    </FilterButton>
                    <FilterButton
                      $active={filterMode === "updated"}
                      onClick={() => setFilterMode("updated")}
                    >
                      Updated ({updatedCount})
                    </FilterButton>
                  </FilterToggle>

                  {/* Search */}
                  <SearchInput
                    type="text"
                    placeholder="Search by SKU or title..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </FilterSection>

                {/* Product List */}
                <ProductList>
                  {filteredProducts.length === 0 ? (
                    <EmptyText>No products match your filters</EmptyText>
                  ) : (
                    filteredProducts.map((product) => {
                      const isActive = product.productKey === activeProductKey;
                      const updated = isUpdated(product);
                      const savedOverride = findExportOverride(
                        exportOverrides,
                        product.productKey,
                        originalRows,
                        template.rowMode,
                        (template as any).groupByField || "product_id"
                      );
                      const savedImages = getOverrideImages(savedOverride);
                      const finalCount =
                        savedImages?.length ?? product.currentImageUrls.length;

                      return (
                        <ProductItem
                          key={product.productKey}
                          $active={isActive}
                          onClick={() => handleProductSelect(product.productKey)}
                        >
                          <ProductMain>
                            <ProductKey $active={isActive}>
                              {formatProductDisplayKey(product, filteredProducts)}
                            </ProductKey>
                            {product.title && (
                              <ProductTitle $active={isActive}> · {product.title}</ProductTitle>
                            )}
                          </ProductMain>
                          <ProductMeta>
                            <MetaText $active={isActive}>
                              Original: {product.originalImageUrls.length} · Final:{" "}
                              {finalCount}
                            </MetaText>
                            {updated && <UpdatedTag>Updated</UpdatedTag>}
                          </ProductMeta>
                        </ProductItem>
                      );
                    })
                  )}
                </ProductList>
              </LeftColumn>

              {/* Right Column: Product Details */}
              <RightColumn>
                {!activeProduct ? (
                  <EmptyState>Select a product to view details</EmptyState>
                ) : (
                  <>
                    {/* Product Info Header */}
                    <ProductHeader>
                      <ProductHeaderTitle>
                        {activeProductDisplayName}
                      </ProductHeaderTitle>
                      <ProductHeaderMeta>
                        Original: {activeProduct.originalImageUrls.length} images ·
                        Export: {exportImages.length} images ·{" "}
                        {activeProduct.rowMode === "PER_IMAGE"
                          ? "Per-Image"
                          : "Per-Product"}
                      </ProductHeaderMeta>
                    </ProductHeader>

                    {/* Image Grid - Categorized or Flat view */}
                    <ImageSection>
                      <SectionLabel>
                        Images for Export ({exportImages.length})
                      </SectionLabel>
                      {exportImages.length === 0 ? (
                        <EmptyText>No images</EmptyText>
                      ) : !hasCategorizedImages ? (
                        /* Flat view when no image columns are mapped */
                        <ImageGrid>
                          {exportImages.map((url, idx) => (
                            <ImageCard
                              key={`flat-${url}-${idx}`}
                              draggable
                              onDragStart={(e) => handleDragStart(e, idx)}
                              onDragOver={(e) => handleDragOver(e, idx)}
                              onDragLeave={handleDragLeave}
                              onDrop={(e) => handleDrop(e, idx)}
                              onDragEnd={handleDragEnd}
                              $isDragging={dragIndex === idx}
                              $isDragOver={dragOverIndex === idx}
                              onClick={() => openLightbox(url, idx)}
                            >
                              <DeleteButton
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteImage(idx);
                                }}
                                title="Remove image"
                              >
                                ×
                              </DeleteButton>
                              <ImagePreview $url={url} />
                              <DragHandle>⋮⋮</DragHandle>
                            </ImageCard>
                          ))}
                        </ImageGrid>
                      ) : (
                        /* Unified categorized view - single container with dashed category boxes */
                        <UnifiedContainer>
                          {columnNames.map((colName) => {
                            const colImages = categorizedExportImages.byColumnName[colName] || [];
                            
                            return (
                              <DashedCategoryBox
                                key={`col-box-${colName}`}
                                $isDragOver={dragOverCategory === colName}
                                onDragOver={(e) => handleCategoryDragOver(e, colName as ImageCategory)}
                                onDragLeave={handleCategoryDragLeave}
                                onDrop={(e) => handleCategoryDrop(e, colName as ImageCategory)}
                              >
                                <CategoryBoxLabel>{colName} ({colImages.length})</CategoryBoxLabel>
                                <CategoryImageGrid>
                                  {colImages.map((item) => (
                                    <ImageCard
                                      key={`col-${colName}-${item.index}`}
                                      draggable
                                      onDragStart={(e) => handleDragStart(e, item.index)}
                                      onDragOver={(e) => { e.stopPropagation(); handleDragOver(e, item.index); }}
                                      onDragLeave={handleDragLeave}
                                      onDrop={(e) => handleDrop(e, item.index, colName as ImageCategory)}
                                      onDragEnd={handleDragEnd}
                                      $isDragging={dragIndex === item.index}
                                      $isDragOver={dragOverIndex === item.index}
                                      onClick={() => openLightbox(item.url, item.index)}
                                    >
                                      <DeleteButton
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteImage(item.index);
                                        }}
                                        title="Remove image"
                                      >
                                        ×
                                      </DeleteButton>
                                      <ImagePreview $url={item.url} />
                                      <DragHandle>⋮⋮</DragHandle>
                                    </ImageCard>
                                  ))}
                                  {colImages.length === 0 && (
                                    <EmptyDropZone>Drop image here</EmptyDropZone>
                                  )}
                                </CategoryImageGrid>
                              </DashedCategoryBox>
                            );
                          })}
                        </UnifiedContainer>
                      )}
                    </ImageSection>
                    
                    {/* AI Artwork Section - Collapsible */}
                    {showAIArtwork && aiArtworkUrls.length > 0 && (
                      <AIArtworkSection>
                        <AIArtworkHeader>
                          <SectionLabel>AI Artwork ({aiArtworkUrls.length})</SectionLabel>
                          <AIArtworkHint>Drag images to add them to export categories above</AIArtworkHint>
                        </AIArtworkHeader>
                        <AIArtworkContainer>
                          <AIArtworkGrid>
                            {aiArtworkUrls.map((url, idx) => (
                              <AIArtworkCard
                                key={`ai-${idx}-${url}`}
                                draggable
                                onDragStart={(e) => handleAIArtworkDragStart(e, url)}
                                onDragEnd={handleAIArtworkDragEnd}
                                $isDragging={aiDragUrl === url}
                                onClick={() => openLightbox(url, idx)}
                              >
                                <ImagePreview $url={url} />
                              </AIArtworkCard>
                            ))}
                          </AIArtworkGrid>
                        </AIArtworkContainer>
                      </AIArtworkSection>
                    )}

                    {/* Organization Tools */}
                    <ToolsSection>
                      <SectionLabel>Organize for Export</SectionLabel>
                      <ToolsHint>
                        Changes are saved for export only. Spreadsheet data in
                        Firestore will not be modified.
                      </ToolsHint>

                      {/* Reset & Save Buttons */}
                      <ToolRow>
                        <ToolButton 
                          onClick={handleToggleAIArtwork}
                          disabled={aiArtworkUrls.length === 0}
                          title={aiArtworkUrls.length === 0 ? "No AI artwork available for this product" : ""}
                        >
                          {showAIArtwork ? "Hide AI artwork" : `Show all Generated artwork${aiArtworkUrls.length > 0 ? ` (${aiArtworkUrls.length})` : ''}`}
                        </ToolButton>
                        <ToolButton onClick={handleResetToOriginal}>
                          Reset to original images
                        </ToolButton>
                        {hasLastSaved && (
                          <ToolButton onClick={handleResetToLastSaved}>
                            Reset to last saved
                          </ToolButton>
                        )}
                        <SaveButton
                          onClick={handleSave}
                          $hasChanges={hasUnsavedChanges}
                          disabled={!hasUnsavedChanges || saving}
                        >
                          {saving ? "Saving..." : hasUnsavedChanges ? "Save" : "Saved"}
                        </SaveButton>
                      </ToolRow>

                      {hasUnsavedChanges && (
                        <UnsavedHint>
                          You have unsaved changes for this product.
                        </UnsavedHint>
                      )}
                    </ToolsSection>

                    {/* Product Information Editing Section */}
                    {hasAnyDescription && (
                      <ToolsSection>
                        <SectionLabel>Product Information</SectionLabel>
                        <ToolsHint>
                          Edit and save product fields to the spreadsheet template.
                        </ToolsHint>

                        {/* SEO Description */}
                        {(editingSeoDescription || hasDescriptionField("seo")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>SEO Description</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("seo")}
                                  disabled={!isDescriptionModified("seo")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("seo")}
                                  disabled={savingDescription === "seo" || isDescriptionSameAsSaved("seo")}
                                >
                                  {savingDescription === "seo" ? "Saving..." : isDescriptionSameAsSaved("seo") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingSeoDescription}
                              onChange={(e) => handleDescriptionChange("seo", e.target.value)}
                              placeholder="SEO description..."
                              rows={3}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* GEO Description */}
                        {(editingGeoDescription || hasDescriptionField("geo")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>GEO Description</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("geo")}
                                  disabled={!isDescriptionModified("geo")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("geo")}
                                  disabled={savingDescription === "geo" || isDescriptionSameAsSaved("geo")}
                                >
                                  {savingDescription === "geo" ? "Saving..." : isDescriptionSameAsSaved("geo") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingGeoDescription}
                              onChange={(e) => handleDescriptionChange("geo", e.target.value)}
                              placeholder="GEO description..."
                              rows={3}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* GSO Description */}
                        {(editingGsoDescription || hasDescriptionField("gso")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>GSO Description</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("gso")}
                                  disabled={!isDescriptionModified("gso")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("gso")}
                                  disabled={savingDescription === "gso" || isDescriptionSameAsSaved("gso")}
                                >
                                  {savingDescription === "gso" ? "Saving..." : isDescriptionSameAsSaved("gso") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingGsoDescription}
                              onChange={(e) => handleDescriptionChange("gso", e.target.value)}
                              placeholder="GSO description..."
                              rows={3}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* Tags */}
                        {(editingTags || hasDescriptionField("tags")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>Tags</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("tags")}
                                  disabled={!isDescriptionModified("tags")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("tags")}
                                  disabled={savingDescription === "tags" || isDescriptionSameAsSaved("tags")}
                                >
                                  {savingDescription === "tags" ? "Saving..." : isDescriptionSameAsSaved("tags") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingTags}
                              onChange={(e) => handleDescriptionChange("tags", e.target.value)}
                              placeholder="Comma-separated tags..."
                              rows={2}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* SEO Title */}
                        {(editingSeoTitle || hasDescriptionField("seo_title")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>SEO Title</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("seo_title")}
                                  disabled={!isDescriptionModified("seo_title")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("seo_title")}
                                  disabled={savingDescription === "seo_title" || isDescriptionSameAsSaved("seo_title")}
                                >
                                  {savingDescription === "seo_title" ? "Saving..." : isDescriptionSameAsSaved("seo_title") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingSeoTitle}
                              onChange={(e) => handleDescriptionChange("seo_title", e.target.value)}
                              placeholder="SEO optimized title..."
                              rows={1}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* Meta Title */}
                        {(editingMetaTitle || hasDescriptionField("meta_title")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>Meta Title</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("meta_title")}
                                  disabled={!isDescriptionModified("meta_title")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("meta_title")}
                                  disabled={savingDescription === "meta_title" || isDescriptionSameAsSaved("meta_title")}
                                >
                                  {savingDescription === "meta_title" ? "Saving..." : isDescriptionSameAsSaved("meta_title") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingMetaTitle}
                              onChange={(e) => handleDescriptionChange("meta_title", e.target.value)}
                              placeholder="Page meta title..."
                              rows={1}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* Meta Description */}
                        {(editingMetaDescription || hasDescriptionField("meta_description")) && (
                          <DescriptionEditBox>
                            <DescEditHeader>
                              <DescEditLabel>Meta Description</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetDescription("meta_description")}
                                  disabled={!isDescriptionModified("meta_description")}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveDescription("meta_description")}
                                  disabled={savingDescription === "meta_description" || isDescriptionSameAsSaved("meta_description")}
                                >
                                  {savingDescription === "meta_description" ? "Saving..." : isDescriptionSameAsSaved("meta_description") ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingMetaDescription}
                              onChange={(e) => handleDescriptionChange("meta_description", e.target.value)}
                              placeholder="Page meta description..."
                              rows={2}
                            />
                          </DescriptionEditBox>
                        )}

                        {/* Custom Fields with enableGeneration */}
                        {getCustomGenerationFields.map((field) => (
                          <DescriptionEditBox key={field.role}>
                            <DescEditHeader>
                              <DescEditLabel>{field.label}</DescEditLabel>
                              <DescEditButtons>
                                <SmallButton 
                                  onClick={() => handleResetCustomField(field.role)}
                                  disabled={!isCustomFieldModified(field.role)}
                                >
                                  Reset
                                </SmallButton>
                                <SmallButton 
                                  $primary
                                  onClick={() => handleSaveCustomField(field.role)}
                                  disabled={savingDescription === field.role || isCustomFieldSameAsSaved(field.role)}
                                >
                                  {savingDescription === field.role ? "Saving..." : isCustomFieldSameAsSaved(field.role) ? "Saved" : "Save"}
                                </SmallButton>
                              </DescEditButtons>
                            </DescEditHeader>
                            <DescEditTextarea
                              value={editingCustomFields[field.role] || ""}
                              onChange={(e) => handleCustomFieldChange(field.role, e.target.value)}
                              placeholder={`${field.label}...`}
                              rows={2}
                            />
                          </DescriptionEditBox>
                        ))}
                      </ToolsSection>
                    )}
                  </>
                )}
              </RightColumn>
            </ContentGrid>
          )}
        </ModalBody>

        {/* Footer */}
        <ModalFooter>
          <CancelButton onClick={handleClose}>Cancel</CancelButton>
          <FooterSpacer />
          <DedupeToggle>
            <ToggleSwitch
              $active={dedupeEnabled}
              onClick={() => setDedupeEnabled(!dedupeEnabled)}
            >
              <ToggleKnob $active={dedupeEnabled} />
            </ToggleSwitch>
            <ToggleLabel>Dedupe</ToggleLabel>
          </DedupeToggle>
          <ExportButton
            $secondary
            onClick={() => handleExport(true)}
            disabled={loading || !view || exporting}
          >
            {exporting ? "Exporting..." : "Export updated only"}
          </ExportButton>
          <ExportButton
            onClick={() => handleExport(false)}
            disabled={loading || !view || exporting}
          >
            {exporting ? "Exporting..." : "Export all"}
          </ExportButton>
        </ModalFooter>
      </Modal>

      {/* Lightbox Preview */}
      {previewSrc && (
        <LightboxOverlay onClick={closeLightbox}>
          <LightboxWrapper onClick={(e) => e.stopPropagation()}>
            <LightboxContent>
              <LightboxClose onClick={closeLightbox}>×</LightboxClose>
              <LightboxNav $direction="left" onClick={goToPrevImage}>
                ‹
              </LightboxNav>
              <LightboxImage src={previewSrc} alt="Preview" />
              <LightboxNav $direction="right" onClick={goToNextImage}>
                ›
              </LightboxNav>
            </LightboxContent>
            <LightboxCounter>
              {previewIndex + 1} / {exportImages.length}
            </LightboxCounter>
          </LightboxWrapper>
        </LightboxOverlay>
      )}
      </Overlay>

      {/* Alert Modal for unsaved changes */}
      {alertConfig.show && (
        <AlertModal
          title={alertConfig.title}
          message={alertConfig.message}
          onClose={closeAlert}
          onConfirm={alertConfig.isError ? closeAlert : alertConfig.onDiscard}
          showCancel={!alertConfig.isError}
          confirmText={alertConfig.isError ? "OK" : "Discard Changes"}
          cancelText="Go Back"
        />
      )}
    </>
  );
}

// ============ Styled Components ============

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 100%;
  max-width: 1100px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadow.soft};
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const HeaderContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ModalTitle = styled.h2`
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

const ModalSubtitle = styled.p`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  font-size: 28px;
  color: ${({ theme }) => theme.colors.muted};
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const ModalBody = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const ContentGrid = styled.div`
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 60vh;
`;

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  overflow: hidden;
`;

const FilterSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const FilterToggle = styled.div`
  display: flex;
  gap: 8px;
`;

const FilterButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  background: ${({ theme, $active }) =>
    $active ? theme.colors.accent : theme.colors.inner};
  color: ${({ theme, $active }) =>
    $active ? theme.colors.white : theme.colors.text};

  &:hover {
    opacity: 0.9;
  }
`;

const SearchInput = styled.input`
  padding: 10px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.accent}40;
  }
`;

const ProductList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ProductItem = styled.div<{ $active: boolean }>`
  padding: 12px 14px;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.15s;
  background: ${({ theme, $active }) =>
    $active ? theme.colors.accent : theme.colors.inner};

  &:hover {
    opacity: 0.9;
  }
`;

const ProductMain = styled.div`
  display: flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
`;

const ProductKey = styled.span<{ $active?: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.text};
  white-space: nowrap;
`;

const ProductTitle = styled.span<{ $active?: boolean }>`
  font-size: 13px;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ProductMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
`;

const MetaText = styled.span<{ $active?: boolean }>`
  font-size: 12px;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.muted};
`;

const UpdatedTag = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  background: ${({ theme }) => theme.colors.white};
  padding: 2px 8px;
  border-radius: 10px;
`;

const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 24px;
  gap: 20px;
  overflow-y: auto;
`;

const ProductHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ProductHeaderTitle = styled.h3`
  font-size: 18px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

const ProductHeaderMeta = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
`;

const ImageSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

/* Categorized Image Display */
const CategorizedImageContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const CategorySection = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
`;

/* Unified container for all images - allows cross-category dragging */
const UnifiedContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 16px;
`;

/* Dashed box for each category - provides visual separation */
const DashedCategoryBox = styled.div<{ $isDragOver?: boolean }>`
  border: 2px dashed ${({ theme, $isDragOver }) => 
    $isDragOver ? theme.colors.accent : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  transition: all 0.2s;
  background: ${({ theme, $isDragOver }) => 
    $isDragOver ? `${theme.colors.accent}10` : 'transparent'};
`;

/* Empty drop zone placeholder */
const EmptyDropZone = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  border: 1px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  color: ${({ theme }) => theme.colors.muted};
  font-size: 12px;
`;

/* Label inside dashed box */
const CategoryBoxLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

/* Image grid inside each category box */
const CategoryImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 10px;
  min-height: 40px;
`;

const CategoryHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
`;

const CategoryLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const SectionLabel = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
`;

const ImageCard = styled.div<{ $isDragging?: boolean; $isDragOver?: boolean }>`
  position: relative;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  background: ${({ theme }) => theme.colors.inner};
  cursor: grab;
  transition: all 0.15s;
  opacity: ${({ $isDragging }) => ($isDragging ? 0.5 : 1)};
  transform: ${({ $isDragOver }) => ($isDragOver ? "scale(1.05)" : "scale(1)")};
  box-shadow: ${({ $isDragOver }) =>
    $isDragOver ? "0 4px 12px rgba(0,0,0,0.15)" : "none"};

  &:hover {
    transform: scale(1.02);
  }

  &:active {
    cursor: grabbing;
  }
`;

const DeleteButton = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;

  ${ImageCard}:hover & {
    opacity: 1;
  }
`;

const DragHandle = styled.div`
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;
  pointer-events: none;

  ${ImageCard}:hover & {
    opacity: 1;
  }
`;

const ImagePreview = styled.div<{ $url: string }>`
     width: 100%;
     height: 100%;
     background-image: url(${({ $url }) => getProxiedImageUrl($url)});
     background-size: cover;
     background-position: center;
   `;

const ToolsSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const ToolsHint = styled.p`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  font-style: italic;
`;

const ToolRow = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const ToolButton = styled.button`
  padding: 8px 14px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SaveButton = styled.button<{ $hasChanges: boolean }>`
  padding: 8px 18px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme, $hasChanges }) =>
    $hasChanges ? theme.colors.accent : theme.colors.white};
  color: ${({ theme, $hasChanges }) =>
    $hasChanges ? theme.colors.white : theme.colors.muted};
  font-size: 13px;
  font-weight: 700;
  cursor: ${({ $hasChanges }) => ($hasChanges ? "pointer" : "default")};
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
`;

const UnsavedHint = styled.p`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.accent};
  margin: 0;
  font-weight: 600;
`;

/* ========== AI Artwork Section ========== */
const AIArtworkSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const AIArtworkHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const AIArtworkHint = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
`;

const AIArtworkContainer = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 16px;
`;

const AIArtworkGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 10px;
`;

const AIArtworkCard = styled.div<{ $isDragging?: boolean }>`
  position: relative;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  background: ${({ theme }) => theme.colors.inner};
  cursor: grab;
  transition: opacity 0.15s;
  opacity: ${({ $isDragging }) => ($isDragging ? 0.5 : 1)};
  user-select: none;
  -webkit-user-drag: element;

  &:active {
    cursor: grabbing;
  }

  & img, & > div {
    pointer-events: none;
  }
`;

/* ========== Footer Toggle ========== */
const DedupeToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
`;

const ToggleSwitch = styled.div<{ $active: boolean }>`
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: ${({ theme, $active }) =>
    $active ? theme.colors.accent : theme.colors.border};
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
`;

const ToggleKnob = styled.div<{ $active: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: ${({ $active }) => ($active ? "20px" : "2px")};
  transition: all 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
`;

const ToggleLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const ModalFooter = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const FooterSpacer = styled.div`
  flex: 1;
`;

const CancelButton = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 24px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const ExportButton = styled.button<{ $secondary?: boolean }>`
  background: ${({ theme, $secondary }) =>
    $secondary ? theme.colors.inner : theme.colors.accent};
  color: ${({ theme, $secondary }) =>
    $secondary ? theme.colors.text : theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 24px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 8px;
`;

const EmptyTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const ErrorMessage = styled.div`
  background: #fee;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  margin: 16px 24px;
  color: #c33;
  font-size: 14px;
`;

// ============ Lightbox Styles ============

const LightboxOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
`;

const LightboxWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`;

const LightboxContent = styled.div`
  position: relative;
  background: ${({ theme }) => theme.colors.card};
  border-radius: 16px;
  padding: 24px;
  box-shadow: ${({ theme }) => theme.shadow.soft};
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const LightboxImage = styled.img`
  max-width: 70vw;
  max-height: 75vh;
  object-fit: contain;
  border-radius: 8px;
`;

const LightboxClose = styled.button`
  position: absolute;
  top: 12px;
  right: 12px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.card};
  color: ${({ theme }) => theme.colors.text};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
  }
`;

const LightboxNav = styled.button<{ $direction: "left" | "right" }>`
  position: absolute;
  ${({ $direction }) =>
    $direction === "left" ? "left: -50px;" : "right: -50px;"}
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.card};
  color: ${({ theme }) => theme.colors.text};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  font-size: 22px;
  font-weight: 400;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
  }
`;

const LightboxCounter = styled.div`
  background: ${({ theme }) => theme.colors.card};
  color: ${({ theme }) => theme.colors.text};
  padding: 6px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: ${({ theme }) => theme.shadow.soft};
`;

/* ============ Description Editing ============ */

const DescriptionEditBox = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  margin-top: 8px;
`;

const DescEditHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const DescEditLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const DescEditButtons = styled.div`
  display: flex;
  gap: 6px;
`;

const SmallButton = styled.button<{ $primary?: boolean }>`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const DescEditTextarea = styled.textarea`
  width: 100%;
  background: ${({ theme }) => theme.colors.card};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 10px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: ${({ theme }) => theme.colors.text};
  resize: vertical;
  min-height: 60px;
  line-height: 1.5;

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
  }
`;