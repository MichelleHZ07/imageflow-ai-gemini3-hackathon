import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import styled from "styled-components";
import AlertModal from "./AlertModal";
import {
  saveSpreadsheetResults,
  saveExportOverride,
  SaveSpreadsheetResultsPayload,
  SpreadsheetResultMode,
  RowMode,
  SpreadsheetTemplateColumn,
  AddPosition,
} from "../lib/api";
import {
  dedupeForDisplay,
  getDedupeCount,
  buildVisiblePairs,
  dedupeVisiblePairs,
} from "../lib/dedupeUtils";
import type { TargetSpreadsheetConfig } from "./TargetSpreadsheetModal";

// ============================================================
// Image Helpers
// ============================================================

/** Get all image URLs from unified images array */
function getAllImageUrls(images: Array<{ url: string; label: string; colIndex: number }> | undefined): string[] {
  if (!images || images.length === 0) return [];
  return images.map(img => img.url);
}

// ============================================================
// Image Column Helpers (for category token generation)
// ============================================================

/** Represents an image column from the template */
interface ImageCol {
  columnIndex: number;
  role: string;
  name: string;
}

/**
 * Extract all image columns from template columns, preserving original order.
 * Image columns are identified by role "image_url"
 */
function getImageColumns(columns: SpreadsheetTemplateColumn[] | undefined): ImageCol[] {
  if (!columns) return [];

  const imageCols: ImageCol[] = [];
  columns.forEach((col, idx) => {
    if (col.role === "image_url") {
      imageCols.push({ columnIndex: idx, role: col.role, name: col.name });
    }
  });

  return imageCols;
}

/**
 * Generate a category token from an image column.
 * Token format: "col:{columnName}"
 */
function toCategoryToken(col: ImageCol): string {
  return `col:${col.name}`;
}

/**
 * Group images by their category token (for export/rendering).
 */
function groupByToken(images: string[], categories: string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (let i = 0; i < images.length; i++) {
    const token = categories[i] || "";
    if (!result[token]) result[token] = [];
    result[token].push(images[i]);
  }
  return result;
}

// ============================================================
// PER_IMAGE mapping helper
// ============================================================

/**
 * Find the index of the nth occurrence of `url` in `arr`.
 * nth is 1-based: nth=1 returns first match index.
 */
function findNthIndex(arr: string[], url: string, nth: number): number {
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === url) {
      count += 1;
      if (count === nth) return i;
    }
  }
  return -1;
}

/**
 * SpreadsheetSelection interface - matches the one in SpreadsheetProductModal
 */
export interface SpreadsheetSelection {
  templateId: string;
  templateName: string;
  rowMode: RowMode;
  key: string;
  rowIndex?: number;
  rowIndices?: number[];
  sku?: string;
  productId?: string;
  title?: string;
  category?: string;
  // Unified images array
  images: Array<{ url: string; label: string; colIndex: number }>;
  // Template columns for displaying all categories (including empty ones)
  templateColumns?: Array<{ name: string; role: string }>;
}

/**
 * Payload for onScenarioApplied callback - used to update frontend overlay
 */
export interface ScenarioAppliedPayload {
  mode: SpreadsheetResultMode;
  finalImages: string[];
  finalCategories: string[];
  // Phase 2: Cross-save fields
  isCrossSave?: boolean;
  targetTemplateId?: string;
  targetProductKey?: string;
}

// Internal mode types for UI
type SaveCategory = "add" | "replace";
type ReplaceOption = "all" | "from";
type AddOption = "last" | "before";

interface SaveToSpreadsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  selection: SpreadsheetSelection;
  generatedImageUrls: string[];
  generationId?: string;
  onSaved?: () => void;
  onScenarioApplied?: (payload: ScenarioAppliedPayload) => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;

  // Current image index in LeftPanel (0-based)
  currentImageIndex?: number;

  // PER_PRODUCT ID mapping: panel visible IDs for position mapping
  panelVisibleIds?: string[];
  panelVisibleCount?: number;

  // Export truth arrays (complete, including hidden items)
  exportImages?: string[];
  exportCategories?: string[];
  exportIds?: string[];

  // PER_IMAGE (legacy): DO NOT use for indexing if user removed items
  panelImages?: string[];

  // ✅ NEW: PER_IMAGE exact list used by LeftPanel BEFORE dedupe, AFTER removals
  // i.e. activeImageUrls = allSpreadsheetImageUrls.filter(url => !removedUrlsForPerImage.has(url))
  panelActiveImageUrls?: string[];

  // Template columns for PER_PRODUCT category token generation
  currentTemplateColumns?: SpreadsheetTemplateColumn[];

  // Phase 2: Cross-spreadsheet save support
  targetConfig?: TargetSpreadsheetConfig | null;
  
  // ✅ NEW: Save target mode - required to correctly detect cross-save
  // Only when saveTargetMode === "different" should we use targetConfig
  saveTargetMode?: "original" | "different" | "default";
  
  // ✅ NEW: Target template active image URLs (after hiding)
  // For cross-save, this is the deduped/filtered list from LeftPanel
  targetActiveImageUrls?: string[];
}

export default function SaveToSpreadsheetModal({
  isOpen,
  onClose,
  userId,
  selection,
  generatedImageUrls,
  generationId,
  onSaved,
  onScenarioApplied,
  onSuccess,
  onError,
  currentImageIndex = 0,

  // PER_PRODUCT ID mapping
  panelVisibleIds = [],
  panelVisibleCount,

  // Export truth arrays
  exportImages = [],
  exportCategories = [],
  exportIds = [],

  // PER_IMAGE legacy
  panelImages = [],

  // ✅ NEW: PER_IMAGE true panel active URLs
  panelActiveImageUrls = [],

  currentTemplateColumns,
  
  // Phase 2: Cross-spreadsheet save
  targetConfig,
  
  // ✅ FIX: Save target mode - determines if we should use targetConfig
  saveTargetMode = "original",
  
  // ✅ NEW: Target template active image URLs
  targetActiveImageUrls = [],
}: SaveToSpreadsheetModalProps) {
  const [saveCategory, setSaveCategory] = useState<SaveCategory>("add");
  const [replaceOption, setReplaceOption] = useState<ReplaceOption>("from");
  const [replaceFromIndex, setReplaceFromIndex] = useState<string>("1");
  // Stage 20: Add option state
  const [addOption, setAddOption] = useState<AddOption>("last");
  const [addBeforeIndex, setAddBeforeIndex] = useState<string>("1");
  // Stage 20: Category selection for PER_PRODUCT multi-category
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // ============ Cross-save and Create mode detection ============
  // ✅ FIX: Only consider it cross-save when saveTargetMode === "different"
  // This ensures switching back to "original" correctly uses source table
  const isCrossSave = !!(
    saveTargetMode === "different" && 
    targetConfig && 
    targetConfig.targetTemplateId !== selection.templateId
  );
  const isNewProduct = !!(targetConfig as any)?.isNewProduct;
  // Create mode with targetConfig: selection was built from targetConfig, they have same templateId
  // but we still need to use targetConfig's data
  // Only applies when saveTargetMode is "different" (Create mode sets this when selecting a target)
  const isCreateModeWithTarget = !isCrossSave && saveTargetMode === "different" && !!targetConfig?.targetTemplateId;
  // Use target data when cross-saving OR in Create mode with target
  const useTargetData = isCrossSave || isCreateModeWithTarget;
  
  // ============ Effective row mode (use target's if cross-saving or Create mode) ============
  const effectiveRowMode = useTargetData ? targetConfig!.targetRowMode : selection.rowMode;
  const isPERProduct = effectiveRowMode === "PER_PRODUCT";

  // ============ Effective template columns (use target's if cross-saving or Create mode) ============
  const effectiveTemplateColumns: SpreadsheetTemplateColumn[] = useTargetData && targetConfig?.targetTemplateColumns
    ? targetConfig.targetTemplateColumns.map(col => ({
        name: col.name,
        role: col.role || "",
        sampleValues: [],
        multiValue: false,
        separator: ",",
      }))
    : (currentTemplateColumns || []);

  // ============ Effective existing images & categories (use target's if cross-saving or Create mode) ============
  const effectiveExistingImages: string[] = useTargetData
    ? (targetConfig?.targetImages?.map(img => img.url) || [])
    : exportImages;

  const effectiveExistingCategories: string[] = useTargetData
    ? (targetConfig?.targetImages?.map(img => {
        // Use label directly - it already contains the correct category name
        // colIndex is often -1 for cross-save scenarios, so we use label instead
        const colName = img.label || "Image";
        return `col:${colName}`;
      }) || [])
    : exportCategories;

  // For PER_PRODUCT panel visible IDs - use empty for cross-save/Create mode since we work with target data directly
  const effectivePanelVisibleIds: string[] = useTargetData ? [] : panelVisibleIds;
  const effectiveExportIds: string[] = useTargetData ? [] : exportIds;

  // Build visible pairs for PER_PRODUCT (safe: filters -1 indices and empty URLs)
  // For cross-save/Create mode, use target's existing images count directly
  const visiblePairsForCount = isPERProduct && !useTargetData
    ? buildVisiblePairs(panelVisibleIds, exportIds, exportImages)
    : [];

  // ✅ IMPORTANT: PER_IMAGE count must match LeftPanel deduped display count,
  // which is dedupeForDisplay(activeImageUrls) where activeImageUrls already filters removed URLs.
  const perImageCountSource =
    panelActiveImageUrls.length > 0
      ? panelActiveImageUrls
      : panelImages.length > 0
      ? panelImages
      : getAllImageUrls(selection.images);

  // For cross-save/Create mode: use target's active images (after hiding) with dedupe
  // For same-template save:
  //   PER_PRODUCT: 用可见数量
  //   PER_IMAGE: 用去重后的显示数量
  const originalImageCount = useTargetData
    ? getDedupeCount(targetActiveImageUrls.length > 0 ? targetActiveImageUrls : effectiveExistingImages)
    : isPERProduct
      ? (panelVisibleIds?.length ?? panelVisibleCount ?? exportImages.length)
      : getDedupeCount(perImageCountSource);

  // Track if we've initialized for this modal open
  const hasInitializedRef = useRef(false);
  const prevIsOpenRef = useRef(isOpen);

  // Reset state when modal opens (only once per open)
  useEffect(() => {
    // Detect transition from closed to open
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;
    
    // Reset initialization flag when modal closes
    if (!isOpen) {
      hasInitializedRef.current = false;
      return;
    }
    
    // Only initialize once per modal open
    if (hasInitializedRef.current) {
      return;
    }
    
    hasInitializedRef.current = true;
    
    setSaveCategory("add");
    setReplaceOption(generatedImageUrls.length > 1 ? "all" : "from");
    setReplaceFromIndex(String(currentImageIndex + 1));
    // Stage 20: Initialize add options
    setAddOption("last");
    setAddBeforeIndex(String(originalImageCount > 0 ? 1 : 0));
    // Stage 20: Initialize category selection - use effective template columns
    const imageCols = getImageColumns(effectiveTemplateColumns);
    if (imageCols.length > 0) {
      setSelectedCategory(toCategoryToken(imageCols[imageCols.length - 1]));
    }
    setError("");
    
    // Debug log for Replace #N mapping verification
    console.log(`[SaveToSpreadsheetModal] Modal initialized:`, {
      rowMode: effectiveRowMode,
      sourceRowMode: selection.rowMode,
      targetRowMode: targetConfig?.targetRowMode,
      isCrossSave,
      isCreateModeWithTarget,
      useTargetData,
      isNewProduct,
      targetConfigExists: !!targetConfig,
      targetTemplateId: targetConfig?.targetTemplateId,
      sourceTemplateId: selection.templateId,
      targetTemplateName: targetConfig?.targetTemplateName,
      targetImagesCount: targetConfig?.targetImages?.length,
      panelActiveImageUrlsLen: panelActiveImageUrls?.length ?? 0,
      panelImagesLen: panelImages?.length ?? 0,
      panelVisibleIdsLen: panelVisibleIds?.length ?? 0,
      exportIdsLen: exportIds?.length ?? 0,
      exportImagesLen: exportImages?.length ?? 0,
      exportCategoriesLen: exportCategories?.length ?? 0,
      effectiveExistingImagesLen: effectiveExistingImages?.length ?? 0,
      effectiveExistingCategoriesLen: effectiveExistingCategories?.length ?? 0,
      effectiveExistingCategoriesSample: effectiveExistingCategories?.slice(0, 5),
      targetImagesLabels: useTargetData ? targetConfig?.targetImages?.slice(0, 5).map(img => img.label) : undefined,
      effectiveTemplateColumnsLen: effectiveTemplateColumns?.length ?? 0,
      originalImageCount,
    });
  }, [isOpen, currentImageIndex, generatedImageUrls.length, effectiveRowMode, panelActiveImageUrls, panelImages, panelVisibleIds, exportIds, exportImages, exportCategories, effectiveTemplateColumns, originalImageCount, isCrossSave, isCreateModeWithTarget, useTargetData, isNewProduct, effectiveExistingImages, effectiveExistingCategories, selection.rowMode, selection.templateId, targetConfig]);

  if (!isOpen) return null;

  const getApiMode = (): SpreadsheetResultMode => {
    // Use effective row mode (target's if cross-saving)
    if (effectiveRowMode === "PER_PRODUCT") {
      return saveCategory === "replace"
        ? "REPLACE_ALL_IMAGES_PER_PRODUCT"
        : "APPEND_IMAGES_PER_PRODUCT";
    } else {
      return saveCategory === "replace"
        ? "REPLACE_ALL_ROWS_PER_IMAGE"
        : "APPEND_ROWS_PER_IMAGE";
    }
  };

  const validateInputs = (): string | null => {
    if (saveCategory === "replace" && replaceOption === "from") {
      const num = parseInt(replaceFromIndex);
      if (replaceFromIndex.trim() === "" || isNaN(num)) {
        return "Please enter a valid image number";
      }
      if (num < 1) {
        return "Image number must be at least 1";
      }
      
      // For PER_PRODUCT mode with a selected category, validate against category count
      if (isPERProduct && selectedCategory) {
        // Count images in the selected category
        const categoryImageCount = effectiveExistingCategories.filter(
          cat => cat === selectedCategory
        ).length;
        
        if (categoryImageCount > 0 && num > categoryImageCount) {
          // Extract category display name from token (e.g., "col:变种图（URL）地址" -> "变种图（URL）地址")
          const categoryName = selectedCategory.startsWith("col:") 
            ? selectedCategory.substring(4) 
            : selectedCategory;
          return `Image number ${num} exceeds the count in "${categoryName}" (only ${categoryImageCount} image${categoryImageCount > 1 ? 's' : ''})`;
        }
      } else {
        // For PER_IMAGE or when no category selected, validate against total count
        if (num > originalImageCount && originalImageCount > 0) {
          return `Image number cannot exceed ${originalImageCount} (total images in preview)`;
        }
      }
    }
    return null;
  };

  /**
   * Build initial categories from selection images.
   * Each image's label (column name) becomes its category token.
   */
  const buildInitialCategoriesFromTemplate = (): string[] => {
    // For cross-save/Create mode, use target template data
    if (useTargetData && targetConfig?.targetImages && targetConfig.targetImages.length > 0) {
      return targetConfig.targetImages.map(img => {
        const colName = targetConfig?.targetTemplateColumns?.[img.colIndex]?.name || img.label || "Image";
        return `col:${colName}`;
      });
    }
    
    // Use unified images array - each image has its label (column name)
    if (selection.images && selection.images.length > 0) {
      return selection.images.map(img => `col:${img.label}`);
    }
    
    // Fallback: use first image_url column from effective template
    const imageCols = getImageColumns(effectiveTemplateColumns);
    const imageUrlCol = imageCols.find(col => col.role === "image_url");
    const defaultToken = imageUrlCol ? `col:${imageUrlCol.name}` : "col:Image";
    
    return getAllImageUrls(selection.images).map(() => defaultToken);
  };

  /**
   * Calculate updated arrays AND categories.
   * Key principle:
   * - PER_IMAGE "Replace #N" MUST map to LeftPanel's visible deduped items, even after user removed (×) images.
   * - Writing back MUST target the full truth array (selection main+additional+slot, in that order),
   *   while correctly handling duplicates (same URL appearing multiple times).
   */
  const calculateUpdatedArraysWithCategories = () => {
    const newImages = generatedImageUrls || [];

    // ==================== PER_IMAGE MODE ====================
    if (!isPERProduct) {
      // Full truth (write-back target) - use unified images array
      // For cross-save/Create mode, use TARGET's images; for same-template save, use SOURCE's images
      const allExistingImages = useTargetData
        ? [...effectiveExistingImages]
        : getAllImageUrls(selection.images);

      // Get existing categories for PER_IMAGE mode (needed for label matching in display)
      const defaultCategoryToken = effectiveTemplateColumns.length > 0
        ? `col:${effectiveTemplateColumns.find(c => c.role === "image_url")?.name || "Image"}`
        : "col:Image";
      
      let existingCategories: string[];
      if (useTargetData && effectiveExistingCategories.length === allExistingImages.length) {
        existingCategories = [...effectiveExistingCategories];
      } else {
        // Build categories from existing images or use default
        existingCategories = allExistingImages.map(() => defaultCategoryToken);
      }

      let finalImages: string[] = [...allExistingImages];
      let finalCategories: string[] = [...existingCategories];

      // LeftPanel active list (pre-dedupe, post-removals) - this is the only correct source of "panel position"
      // For cross-save/Create mode, use targetActiveImageUrls (from LeftPanel, already filtered for hidden items)
      // For same-template save, use panelActiveImageUrls
      const panelActive = useTargetData
        ? (targetActiveImageUrls && targetActiveImageUrls.length > 0
            ? [...targetActiveImageUrls]
            : [...allExistingImages])
        : panelActiveImageUrls && panelActiveImageUrls.length > 0
          ? [...panelActiveImageUrls]
          : panelImages && panelImages.length > 0
          ? [...panelImages]
          : [...allExistingImages];

      if (saveCategory === "replace") {
        if (replaceOption === "all") {
          finalImages = [...newImages];
          finalCategories = newImages.map(() => defaultCategoryToken);
          console.log(
            `[SaveToSpreadsheetModal] PER_IMAGE Replace All: ${newImages.length} new images`
          );
        } else {
          // Replace One: replace ALL occurrences of the chosen URL in truth list
          // This ensures the dedupe display stays consistent (same count before/after)
          const displayItems = dedupeForDisplay(panelActive);
          const displayPosition = Math.max(0, parseInt(replaceFromIndex) - 1);
          const replacementUrl = newImages[0];

          if (!replacementUrl) {
            console.warn(`[SaveToSpreadsheetModal] PER_IMAGE Replace One: no replacement URL`);
          } else if (displayPosition < 0 || displayPosition >= displayItems.length) {
            console.warn(
              `[SaveToSpreadsheetModal] PER_IMAGE Replace One: displayPosition ${displayPosition} out of bounds [0, ${displayItems.length})`
            );
          } else {
            const chosen = displayItems[displayPosition];
            const chosenUrl = chosen.url;

            // Replace ALL occurrences of chosenUrl in the truth list
            // Categories stay the same for replacements
            let replacedCount = 0;
            for (let i = 0; i < finalImages.length; i++) {
              if (finalImages[i] === chosenUrl) {
                finalImages[i] = replacementUrl;
                replacedCount++;
              }
            }
            
            console.log(
              `[SaveToSpreadsheetModal] PER_IMAGE Replace One: replaced ${replacedCount} occurrences of URL at display#${displayPosition + 1}`
            );
          }
        }
      } else {
        // Add mode
        if (addOption === "before") {
          // Add before #N: insert new images before the specified position
          const displayItems = dedupeForDisplay(panelActive);
          const displayPosition = Math.max(0, parseInt(addBeforeIndex));
          
          if (displayPosition === 0) {
            // Insert at the beginning
            finalImages = [...newImages, ...allExistingImages];
            finalCategories = [...newImages.map(() => defaultCategoryToken), ...existingCategories];
            console.log(`[SaveToSpreadsheetModal] PER_IMAGE Add Before: inserted ${newImages.length} images at beginning`);
          } else if (displayPosition > displayItems.length) {
            // Position beyond end, append
            finalImages = [...allExistingImages, ...newImages];
            finalCategories = [...existingCategories, ...newImages.map(() => defaultCategoryToken)];
            console.log(`[SaveToSpreadsheetModal] PER_IMAGE Add Before: position ${displayPosition} beyond end, appending ${newImages.length} images`);
          } else {
            // Find the actual index in the truth list for the display position
            const targetItem = displayItems[displayPosition - 1];
            const insertIndex = allExistingImages.indexOf(targetItem.url);
            
            if (insertIndex === -1) {
              // Fallback: append
              finalImages = [...allExistingImages, ...newImages];
              finalCategories = [...existingCategories, ...newImages.map(() => defaultCategoryToken)];
              console.log(`[SaveToSpreadsheetModal] PER_IMAGE Add Before: target not found, appending ${newImages.length} images`);
            } else {
              finalImages = [
                ...allExistingImages.slice(0, insertIndex),
                ...newImages,
                ...allExistingImages.slice(insertIndex),
              ];
              finalCategories = [
                ...existingCategories.slice(0, insertIndex),
                ...newImages.map(() => defaultCategoryToken),
                ...existingCategories.slice(insertIndex),
              ];
              console.log(`[SaveToSpreadsheetModal] PER_IMAGE Add Before: inserted ${newImages.length} images before position #${displayPosition}`);
            }
          }
        } else {
          // Add to last: append to end of full truth
          finalImages = [...allExistingImages, ...newImages];
          finalCategories = [...existingCategories, ...newImages.map(() => defaultCategoryToken)];
          console.log(`[SaveToSpreadsheetModal] PER_IMAGE Add: appended ${newImages.length} images`);
        }
      }

      return {
        finalImages,
        finalCategories,
      };
    }

    // ==================== PER_PRODUCT MODE ====================

    // Use effective template columns (target's if cross-saving)
    const imageCols = getImageColumns(effectiveTemplateColumns);

    const defaultToken = imageCols.length > 0 ? toCategoryToken(imageCols[0]) : "col:Image";
    const firstColToken = imageCols.length > 0 ? toCategoryToken(imageCols[0]) : defaultToken;
    const lastColToken =
      imageCols.length > 0 ? toCategoryToken(imageCols[imageCols.length - 1]) : defaultToken;

    // ===== Use effective existing data (target's if cross-saving/Create mode) =====
    // For cross-save/Create mode: use target product's existing images
    // For same-template save: use source export data
    
    const allExisting = useTargetData
      ? [...effectiveExistingImages]
      : (exportImages && exportImages.length > 0
          ? [...exportImages]
          : getAllImageUrls(selection.images));

    let existingCategories: string[];

    if (useTargetData) {
      // Cross-save/Create mode: use target's categories
      existingCategories = effectiveExistingCategories.length === allExisting.length
        ? [...effectiveExistingCategories]
        : allExisting.map(() => defaultToken);
      
      // Debug: show unique categories detected
      const uniqueCategories = [...new Set(existingCategories)];
      console.log(`[SaveToSpreadsheetModal] Using target data: ${existingCategories.length} categories, unique: [${uniqueCategories.join(', ')}]`);
    } else if (exportCategories && exportCategories.length === allExisting.length) {
      existingCategories = [...exportCategories];
      console.log(`[SaveToSpreadsheetModal] Using ${existingCategories.length} categories from export truth`);
    } else {
      existingCategories = buildInitialCategoriesFromTemplate();
      while (existingCategories.length < allExisting.length) {
        existingCategories.push(defaultToken);
      }
      console.log(`[SaveToSpreadsheetModal] Built ${existingCategories.length} categories from template`);
    }

    let finalImages: string[] = [...allExisting];
    let finalCategories: string[] = [...existingCategories];

    if (saveCategory === "replace") {
      if (replaceOption === "all") {
        finalImages = [...newImages];
        finalCategories = newImages.map(() => firstColToken);
        console.log(
          `[SaveToSpreadsheetModal] PER_PRODUCT Replace All: ${newImages.length} new images with token ${firstColToken}`
        );
      } else {
        // Replace from position: Map panel position to export index, then replace N images from that position
        // N = generatedImageUrls.length
        // 
        // Stage 20 FIX: When user selects a category (e.g., "变种图"), find position #N WITHIN that category,
        // not the overall panel position. This fixes the bug where "Replace #1 in 变种图" was replacing 主图.
        const displayPosition = Math.max(0, parseInt(replaceFromIndex) - 1);

        // Debug: show the URL mapping so user can verify
        const panelUrlMapping = panelVisibleIds?.map((id, idx) => {
          const exportIdx = exportIds?.indexOf(id) ?? -1;
          const url = exportIdx >= 0 && exportImages ? exportImages[exportIdx] : 'NOT_FOUND';
          const cat = exportIdx >= 0 && existingCategories ? existingCategories[exportIdx] : 'UNKNOWN';
          return `panel[${idx}] = export[${exportIdx}] cat=${cat}: ${url?.substring(0, 40)}...`;
        });
        
        console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Replace Debug:`, {
          displayPosition,
          selectedCategory,
          panelVisibleIdsLen: panelVisibleIds?.length,
          exportIdsLen: exportIds?.length,
          exportImagesLen: exportImages?.length,
          finalImagesLen: finalImages.length,
          newImagesLen: newImages.length,
          panelUrlMapping,
        });

        // Stage 20 FIX: When a category is selected, filter items to only that category
        // Then find position #N within those filtered items
        let targetExportIdx = -1;
        let targetCategory = selectedCategory || lastColToken;
        
        if (selectedCategory && imageCols.length > 1) {
          // Build visible indices with global dedupe
          const categoryVisibleIndices: number[] = [];
          
          if (useTargetData) {
            // Cross-save/Create mode: Build visible indices from TARGET's effectiveExistingImages
            const seen = new Set<string>();
            const visibleIndices: number[] = [];
            for (let i = 0; i < effectiveExistingImages.length; i++) {
              const url = effectiveExistingImages[i];
              if (url && !seen.has(url)) {
                seen.add(url);
                visibleIndices.push(i);
              }
            }
            // Filter to selected category
            for (const idx of visibleIndices) {
              if (existingCategories[idx] === selectedCategory) {
                categoryVisibleIndices.push(idx);
              }
            }
            console.log(`[SaveToSpreadsheetModal] Target data PER_PRODUCT Replace: category ${selectedCategory} has ${categoryVisibleIndices.length} visible items at indices:`, categoryVisibleIndices);
          } else {
            // Same-template: Use panelVisibleIds which is GLOBALLY deduped to match panel display
            for (const visibleId of (panelVisibleIds || [])) {
              const exportIdx = exportIds?.indexOf(visibleId) ?? -1;
              if (exportIdx >= 0 && existingCategories[exportIdx] === selectedCategory) {
                categoryVisibleIndices.push(exportIdx);
              }
            }
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: category ${selectedCategory} has ${categoryVisibleIndices.length} VISIBLE items (global deduped) at export indices:`, categoryVisibleIndices);
          }
          
          if (displayPosition < categoryVisibleIndices.length) {
            // Found: the Nth visible item within this category
            targetExportIdx = categoryVisibleIndices[displayPosition];
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: position #${displayPosition + 1} in category -> export index ${targetExportIdx}`);
          } else {
            console.warn(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: position ${displayPosition + 1} exceeds visible category count ${categoryVisibleIndices.length}`);
          }
        } else {
          // No category filter (single category or not selected) - use overall position
          if (useTargetData) {
            // Cross-save/Create mode: Build visible indices from TARGET
            const seen = new Set<string>();
            const visibleIndices: number[] = [];
            for (let i = 0; i < effectiveExistingImages.length; i++) {
              const url = effectiveExistingImages[i];
              if (url && !seen.has(url)) {
                seen.add(url);
                visibleIndices.push(i);
              }
            }
            if (displayPosition < visibleIndices.length) {
              targetExportIdx = visibleIndices[displayPosition];
              targetCategory = existingCategories[targetExportIdx] || lastColToken;
            }
            console.log(`[SaveToSpreadsheetModal] Target data PER_PRODUCT Replace: no category filter, position ${displayPosition} -> index ${targetExportIdx}`);
          } else {
            // Same-template: use panelVisibleIds
            const visibleId = panelVisibleIds?.[displayPosition];
            if (visibleId) {
              targetExportIdx = exportIds?.indexOf(visibleId) ?? -1;
              targetCategory = existingCategories[targetExportIdx] || lastColToken;
            }
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: no category filter, using panel position ${displayPosition} -> export index ${targetExportIdx}`);
          }
        }

        if (targetExportIdx < 0) {
          console.warn(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: target export index not found`);
        } else if (targetExportIdx >= finalImages.length) {
          console.warn(`[SaveToSpreadsheetModal] PER_PRODUCT Replace: targetExportIdx ${targetExportIdx} >= finalImages.length ${finalImages.length}! Data mismatch.`);
          // Fallback: use the last valid index
          const safeStartIdx = Math.min(displayPosition, finalImages.length - 1);
          const keepBefore = finalImages.slice(0, safeStartIdx);
          const keepAfter = finalImages.slice(safeStartIdx + newImages.length);
          const keepCatsBefore = finalCategories.slice(0, safeStartIdx);
          const keepCatsAfter = finalCategories.slice(safeStartIdx + newImages.length);
          const replacedCategory = targetCategory;
          const newCats = newImages.map(() => replacedCategory);
          
          finalImages = [...keepBefore, ...newImages, ...keepAfter];
          finalCategories = [...keepCatsBefore, ...newCats, ...keepCatsAfter];
          
          console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Replace (fallback): used safeStartIdx ${safeStartIdx}`);
        } else {
          // Normal case: targetExportIdx is valid
          const keepBefore = finalImages.slice(0, targetExportIdx);
          const keepAfter = finalImages.slice(targetExportIdx + newImages.length);
          const keepCatsBefore = finalCategories.slice(0, targetExportIdx);
          const keepCatsAfter = finalCategories.slice(targetExportIdx + newImages.length);
          
          // New images use the selected category (or the replaced position's category)
          const replacedCategory = targetCategory;
          const newCats = newImages.map(() => replacedCategory);
          
          finalImages = [...keepBefore, ...newImages, ...keepAfter];
          finalCategories = [...keepCatsBefore, ...newCats, ...keepCatsAfter];
          
          console.log(
            `[SaveToSpreadsheetModal] PER_PRODUCT Replace: position #${displayPosition + 1} in ${selectedCategory || 'all'} -> export index ${targetExportIdx}, replaced ${newImages.length} images with category ${replacedCategory}`
          );
        }
      }
    } else {
      // Add mode - use selectedCategory if available, otherwise default to last non-empty category
      let targetCategoryToken = selectedCategory || lastColToken;
      
      // If no selectedCategory, find the last non-empty category
      if (!selectedCategory && existingCategories.length > 0) {
        const existingTokenSet = new Set(existingCategories);
        for (let i = imageCols.length - 1; i >= 0; i--) {
          const colToken = toCategoryToken(imageCols[i]);
          if (existingTokenSet.has(colToken)) {
            targetCategoryToken = colToken;
            break;
          }
        }
      }
      
      if (addOption === "before") {
        // Add before #N: insert new images before the specified position
        // displayPosition is 1-based (e.g., "Before #2" means insert before item 2 in the category)
        const displayPosition = Math.max(0, parseInt(addBeforeIndex));
        
        // Stage 20 FIX: When user selects a category (e.g., "附图"), find position #N WITHIN that category,
        // not the overall panel position. This fixes the bug where "Add Before #2 in 附图" was inserting
        // before the 1st 附图 instead of before the 2nd.
        let insertIndex = -1;
        
        if (selectedCategory && imageCols.length > 1) {
          // Build visible indices with global dedupe
          const categoryVisibleIndices: number[] = [];
          
          if (useTargetData) {
            // Cross-save/Create mode: Build visible indices from TARGET's effectiveExistingImages
            const seen = new Set<string>();
            const visibleIndices: number[] = [];
            for (let i = 0; i < effectiveExistingImages.length; i++) {
              const url = effectiveExistingImages[i];
              if (url && !seen.has(url)) {
                seen.add(url);
                visibleIndices.push(i);
              }
            }
            // Filter to selected category
            for (const idx of visibleIndices) {
              if (existingCategories[idx] === selectedCategory) {
                categoryVisibleIndices.push(idx);
              }
            }
            console.log(`[SaveToSpreadsheetModal] Target data PER_PRODUCT Add Before: category ${selectedCategory} has ${categoryVisibleIndices.length} visible items at indices:`, categoryVisibleIndices);
          } else {
            // Same-template: Use panelVisibleIds which is GLOBALLY deduped
            for (const visibleId of (panelVisibleIds || [])) {
              const exportIdx = exportIds?.indexOf(visibleId) ?? -1;
              if (exportIdx >= 0 && existingCategories[exportIdx] === selectedCategory) {
                categoryVisibleIndices.push(exportIdx);
              }
            }
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: category ${selectedCategory} has ${categoryVisibleIndices.length} VISIBLE items (global deduped) at export indices:`, categoryVisibleIndices);
          }
          
          if (displayPosition === 0 || categoryVisibleIndices.length === 0) {
            // Insert at the beginning of this category
            // Find where this category starts in the sorted array
            insertIndex = categoryVisibleIndices.length > 0 ? categoryVisibleIndices[0] : allExisting.length;
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: insert at beginning of category -> index ${insertIndex}`);
          } else if (displayPosition > categoryVisibleIndices.length) {
            // Position beyond category items, append to end of category
            insertIndex = categoryVisibleIndices.length > 0 
              ? categoryVisibleIndices[categoryVisibleIndices.length - 1] + 1 
              : allExisting.length;
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: position ${displayPosition} beyond visible category count ${categoryVisibleIndices.length}, insert after last -> index ${insertIndex}`);
          } else {
            // Found: insert before the Nth visible item within this category
            // displayPosition is 1-based, so "Before #2" means categoryVisibleIndices[1] (0-based index 1)
            insertIndex = categoryVisibleIndices[displayPosition - 1];
            console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: position #${displayPosition} in category -> export index ${insertIndex}`);
          }
        } else {
          // No category filter (single category or not selected) - use overall visible position
          if (useTargetData) {
            // Cross-save/Create mode: Build visible indices from TARGET
            const seen = new Set<string>();
            const visibleIndices: number[] = [];
            for (let i = 0; i < effectiveExistingImages.length; i++) {
              const url = effectiveExistingImages[i];
              if (url && !seen.has(url)) {
                seen.add(url);
                visibleIndices.push(i);
              }
            }
            if (displayPosition === 0 || visibleIndices.length === 0) {
              insertIndex = 0;
              console.log(`[SaveToSpreadsheetModal] Target data PER_PRODUCT Add Before: no category filter, insert at beginning`);
            } else if (displayPosition > visibleIndices.length) {
              insertIndex = allExisting.length;
              console.log(`[SaveToSpreadsheetModal] Cross-save PER_PRODUCT Add Before: no category filter, position ${displayPosition} beyond end, append`);
            } else {
              insertIndex = visibleIndices[displayPosition - 1];
              console.log(`[SaveToSpreadsheetModal] Cross-save PER_PRODUCT Add Before: no category filter, position ${displayPosition} -> index ${insertIndex}`);
            }
          } else {
            // Same-template: use panelVisibleIds
            const visiblePairs = dedupeVisiblePairs(buildVisiblePairs(panelVisibleIds, exportIds, exportImages));
            
            if (displayPosition === 0 || visiblePairs.length === 0) {
              insertIndex = 0;
              console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: no category filter, insert at beginning`);
            } else if (displayPosition > visiblePairs.length) {
              insertIndex = allExisting.length;
              console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: no category filter, position ${displayPosition} beyond end, append`);
            } else {
              const targetPair = visiblePairs[displayPosition - 1];
              insertIndex = targetPair.exportIndex;
              console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: no category filter, using panel position ${displayPosition} -> export index ${insertIndex}`);
            }
          }
        }
        
        // Perform the insertion
        if (insertIndex < 0 || insertIndex > allExisting.length) {
          // Fallback: append
          finalImages = [...allExisting, ...newImages];
          finalCategories = [...existingCategories, ...newImages.map(() => targetCategoryToken)];
          console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: invalid index ${insertIndex}, appending ${newImages.length} images`);
        } else {
          finalImages = [
            ...allExisting.slice(0, insertIndex),
            ...newImages,
            ...allExisting.slice(insertIndex),
          ];
          finalCategories = [
            ...existingCategories.slice(0, insertIndex),
            ...newImages.map(() => targetCategoryToken),
            ...existingCategories.slice(insertIndex),
          ];
          console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add Before: inserted ${newImages.length} images at index ${insertIndex} with category ${targetCategoryToken}`);
        }
      } else {
        // Add to last: append to end
        finalImages = [...allExisting, ...newImages];
        finalCategories = [...existingCategories, ...newImages.map(() => targetCategoryToken)];
        console.log(`[SaveToSpreadsheetModal] PER_PRODUCT Add: appended ${newImages.length} images with category ${targetCategoryToken}`);
      }
    }

    // Stage 20 FIX: Re-sort images by original column order to maintain correct category display order
    // This ensures that after any add/replace operation, images are still grouped by their
    // original column order (e.g., 主图 -> 附图 -> 变种图), not the order they were inserted
    if (imageCols.length > 1 && finalImages.length > 0 && finalCategories.length === finalImages.length) {
      // Build category order map: { "col:主图（URL）地址": 0, "col:附图（URL）地址": 1, ... }
      const categoryOrderMap = new Map<string, number>();
      imageCols.forEach((col, idx) => {
        categoryOrderMap.set(toCategoryToken(col), idx);
      });
      
      // Create pairs of [image, category, originalIndex] for stable sorting
      const pairs = finalImages.map((img, idx) => ({
        image: img,
        category: finalCategories[idx],
        originalIdx: idx,
      }));
      
      // Sort by category order, then by original index within same category (stable)
      pairs.sort((a, b) => {
        const orderA = categoryOrderMap.get(a.category) ?? 999;
        const orderB = categoryOrderMap.get(b.category) ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.originalIdx - b.originalIdx; // Preserve order within same category
      });
      
      // Check if sort changed anything
      const orderChanged = pairs.some((p, idx) => p.originalIdx !== idx);
      if (orderChanged) {
        finalImages = pairs.map(p => p.image);
        finalCategories = pairs.map(p => p.category);
        console.log(`[SaveToSpreadsheetModal] PER_PRODUCT: Re-sorted images by category order`);
      }
    }

    return {
      finalImages,
      finalCategories,
    };
  };

  const handleSave = async () => {
    const validationError = validateInputs();
    if (validationError) {
      setAlertMessage(validationError);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const apiMode = getApiMode();
      
      // Debug: Log targetConfig to diagnose cross-save issues
      console.log(`[SaveToSpreadsheetModal] handleSave debug:`, {
        targetConfigExists: !!targetConfig,
        targetTemplateId: targetConfig?.targetTemplateId,
        selectionTemplateId: selection.templateId,
        areTemplateIdsDifferent: targetConfig?.targetTemplateId !== selection.templateId,
        targetProductKey: targetConfig?.targetProductKey,
        selectionKey: selection.key,
      });
      
      // Determine effective target based on targetConfig
      // CRITICAL: Use component-level isCrossSave which was computed at render time
      const handleSaveIsCrossSave = !!(targetConfig && targetConfig.targetTemplateId !== selection.templateId);
      const handleSaveIsNewProduct = !!(targetConfig as any)?.isNewProduct;
      // For Create mode: if targetConfig exists and selection was built from it, they have same templateId
      // but we still need to use targetConfig's data for saving
      const isCreateModeWithTarget = !handleSaveIsCrossSave && !!targetConfig?.targetTemplateId;
      const effectiveTemplateId = (handleSaveIsCrossSave || isCreateModeWithTarget) 
        ? targetConfig!.targetTemplateId 
        : selection.templateId;
      const effectiveProductKey = (handleSaveIsCrossSave || isCreateModeWithTarget) && targetConfig!.targetProductKey 
        ? targetConfig!.targetProductKey 
        : selection.key;
      
      console.log(`[SaveToSpreadsheetModal] Cross-save detection:`, {
        isCrossSave: handleSaveIsCrossSave,
        isNewProduct: handleSaveIsNewProduct,
        isCreateModeWithTarget,
        effectiveTemplateId,
        effectiveProductKey,
      });
      
      // Determine if we need to use targetConfig data
      const useTargetConfig = handleSaveIsCrossSave || isCreateModeWithTarget;
      
      const payload: SaveSpreadsheetResultsPayload = {
        templateId: selection.templateId,  // Source template (for audit)
        productKey: effectiveProductKey,
        rowMode: useTargetConfig ? targetConfig!.targetRowMode : selection.rowMode,
        mode: apiMode,
        imageUrls: generatedImageUrls,
        rowIndices: selection.rowIndices,
        generationId,
        // Phase 2: Cross-spreadsheet save fields (also for Create mode with target)
        ...(useTargetConfig && {
          targetTemplateId: targetConfig!.targetTemplateId,
          writeMode: targetConfig!.writeMode,
        }),
      };

      await saveSpreadsheetResults(userId, payload);

      const { finalImages, finalCategories } = calculateUpdatedArraysWithCategories();

      console.log(`[SaveToSpreadsheetModal] Saving exportOverride:`);
      console.log(`  - productKey: ${effectiveProductKey}`);
      console.log(`  - rowMode: ${useTargetConfig ? targetConfig!.targetRowMode : selection.rowMode}`);
      console.log(`  - templateId: ${effectiveTemplateId}${handleSaveIsCrossSave ? ' (cross-save)' : ''}${isCreateModeWithTarget ? ' (create-mode)' : ''}${handleSaveIsNewProduct ? ' (new product)' : ''}`);
      console.log(`  - finalImages: ${finalImages.length}`, finalImages);
      console.log(`  - finalCategories: ${finalCategories.length}`, finalCategories);

      // Stage 20: Build newProductOptions if this is a new product
      const newProductOptions = handleSaveIsNewProduct && targetConfig ? {
        isNewProduct: true as const,
        productId: targetConfig.targetProductId!,
        sku: targetConfig.targetSku!,
        addPosition: (targetConfig.addPosition || "last") as AddPosition,
        insertBeforeProductKey: targetConfig.insertBeforeProductKey,
      } : undefined;

      if (handleSaveIsNewProduct) {
        console.log(`  - newProductOptions:`, newProductOptions);
      }

      // Save to effective target template
      await saveExportOverride(
        userId, 
        selection.templateId,  // Source template
        effectiveProductKey, 
        finalImages, 
        finalCategories,
        useTargetConfig ? effectiveTemplateId : undefined,  // Target template (if cross-save or create mode)
        newProductOptions  // Stage 20: New product options
      );
      console.log(
        `[SaveToSpreadsheetModal] Saved exportOverride for ${effectiveProductKey}: ${finalImages.length} images${useTargetConfig ? ` to ${targetConfig!.targetTemplateName}` : ''}${handleSaveIsNewProduct ? ' (new product)' : ''}`
      );

      onScenarioApplied?.({
        mode: apiMode,
        finalImages,
        finalCategories,
        // Phase 2: Cross-save info (also for Create mode with target)
        isCrossSave: useTargetConfig,
        targetTemplateId: useTargetConfig ? effectiveTemplateId : undefined,
        targetProductKey: useTargetConfig ? effectiveProductKey : undefined,
      });

      onSaved?.();
      onSuccess?.(
        `Successfully saved ${generatedImageUrls.length} image${
          generatedImageUrls.length > 1 ? "s" : ""
        } to ${useTargetConfig ? targetConfig!.targetTemplateName : 'spreadsheet'}${handleSaveIsNewProduct ? ' as new product' : ''}`
      );
      onClose();
    } catch (e: any) {
      const errorMsg = e.message || "Failed to save images to spreadsheet";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const itemLabel = "images";
  const itemLabelSingular = "image";

  return (
    <>
      {alertMessage && (
        <AlertModal
          title="Invalid Input"
          message={alertMessage}
          onClose={() => setAlertMessage(null)}
          confirmText="OK"
        />
      )}
      {ReactDOM.createPortal(
      <Overlay onClick={onClose}>
        <Modal onClick={(e) => e.stopPropagation()}>
          <ModalHeader>
            <ModalTitle>Save to Spreadsheet</ModalTitle>
            <CloseButton onClick={onClose}>×</CloseButton>
          </ModalHeader>

          <ModalBody>
            {error && <ErrorMessage>{error}</ErrorMessage>}

          <SummarySection>
            <SummaryRow>
              <SummaryLabel>Template</SummaryLabel>
              <SummaryValue>
                {useTargetData ? targetConfig!.targetTemplateName : selection.templateName}
                {isCrossSave && <CrossSaveIndicator>(cross-save)</CrossSaveIndicator>}
                {isCreateModeWithTarget && <CrossSaveIndicator>(create mode)</CrossSaveIndicator>}
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Product</SummaryLabel>
              <SummaryValue>
                {useTargetData 
                  ? (targetConfig!.targetSku || targetConfig!.targetProductId || targetConfig!.targetProductKey)
                  : (selection.sku || selection.productId || selection.key)}
                {useTargetData && targetConfig!.targetTitle && <ProductTitle> — {targetConfig!.targetTitle}</ProductTitle>}
                {!useTargetData && selection.title && <ProductTitle> — {selection.title}</ProductTitle>}
              </SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Row Mode</SummaryLabel>
              <SummaryValue>{effectiveRowMode === "PER_IMAGE" ? "Per-Image" : "Per-Product"}</SummaryValue>
            </SummaryRow>
            <Divider />
            <SummaryRow>
              <SummaryLabel>Original {itemLabel}</SummaryLabel>
              <SummaryValue>{originalImageCount}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>Generated {itemLabel}</SummaryLabel>
              <SummaryValue $highlight>{generatedImageUrls.length}</SummaryValue>
            </SummaryRow>
          </SummarySection>

          <ModeSection>
            <ModeHeader>
              <ModeTitle>Save Mode</ModeTitle>
            </ModeHeader>

            <CategorySection $expanded={saveCategory === "add"}>
              <CategoryHeader $selected={saveCategory === "add"} onClick={() => {
                console.log('[SaveToSpreadsheetModal] Add button clicked, setting saveCategory to add');
                setSaveCategory("add");
              }}>
                <RadioCircle $selected={saveCategory === "add"}>{saveCategory === "add" && <RadioDot />}</RadioCircle>
                <CategoryLabel $selected={saveCategory === "add"}>Add {itemLabel}</CategoryLabel>
              </CategoryHeader>

              {saveCategory === "add" && (
                <SubOptionsContainer>
                  {/* Add to last option */}
                  <SubOption onClick={() => setAddOption("last")}>
                    <SubRadioCircle $selected={addOption === "last"}>
                      {addOption === "last" && <SubRadioDot />}
                    </SubRadioCircle>
                    <SubOptionText>
                      Add to the end of existing {itemLabel}
                    </SubOptionText>
                  </SubOption>

                  {/* Add before #N option */}
                  <SubOption onClick={() => setAddOption("before")}>
                    <SubRadioCircle $selected={addOption === "before"}>
                      {addOption === "before" && <SubRadioDot />}
                    </SubRadioCircle>
                    <SubOptionText>
                      Add before {itemLabelSingular} #
                      {addOption === "before" ? (
                        <NumberInput
                          type="number"
                          min={originalImageCount === 0 ? 0 : 1}
                          max={originalImageCount || 1}
                          value={addBeforeIndex}
                          onChange={(e) => setAddBeforeIndex(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span style={{ fontWeight: 700 }}>{addBeforeIndex}</span>
                      )}
                    </SubOptionText>
                  </SubOption>
                  {addOption === "before" && (
                    <SubHint>
                      The image number refers to the {useTargetData ? 'target product' : 'current preview panel'} position
                    </SubHint>
                  )}

                  {/* Category selector for PER_PRODUCT with multiple categories */}
                  {isPERProduct && getImageColumns(effectiveTemplateColumns).length > 1 && (
                    <CategorySelectorRow>
                      <CategorySelectorLabel>Save to category:</CategorySelectorLabel>
                      <CategorySelect
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                      >
                        {getImageColumns(effectiveTemplateColumns).map((col) => (
                          <option key={col.columnIndex} value={toCategoryToken(col)}>
                            {col.name}
                          </option>
                        ))}
                      </CategorySelect>
                    </CategorySelectorRow>
                  )}
                </SubOptionsContainer>
              )}
            </CategorySection>

            <CategorySection $expanded={saveCategory === "replace"}>
              <CategoryHeader
                $selected={saveCategory === "replace"}
                onClick={() => {
                  console.log('[SaveToSpreadsheetModal] Replace button clicked, setting saveCategory to replace');
                  setSaveCategory("replace");
                }}
              >
                <RadioCircle $selected={saveCategory === "replace"}>
                  {saveCategory === "replace" && <RadioDot />}
                </RadioCircle>
                <CategoryLabel $selected={saveCategory === "replace"}>Replace {itemLabel}</CategoryLabel>
              </CategoryHeader>

              {saveCategory === "replace" && (
                <SubOptionsContainer>
                  {generatedImageUrls.length === 1 && (
                    <>
                      <SubOption onClick={() => setReplaceOption("from")}>
                        <SubRadioCircle $selected={replaceOption === "from"}>
                          {replaceOption === "from" && <SubRadioDot />}
                        </SubRadioCircle>
                        <SubOptionText>
                          Replace the {itemLabelSingular} #
                          {replaceOption === "from" ? (
                            <NumberInput
                              type="number"
                              min={1}
                              max={originalImageCount || 1}
                              value={replaceFromIndex}
                              onChange={(e) => setReplaceFromIndex(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span style={{ fontWeight: 700 }}>{replaceFromIndex}</span>
                          )}
                        </SubOptionText>
                      </SubOption>
                      {replaceOption === "from" && (
                        <SubHint>
                          The image number refers to the {useTargetData ? 'target product' : 'current preview panel'} position
                        </SubHint>
                      )}
                    </>
                  )}

                  <SubOption onClick={() => setReplaceOption("all")}>
                    <SubRadioCircle $selected={replaceOption === "all"}>
                      {replaceOption === "all" && <SubRadioDot />}
                    </SubRadioCircle>
                    <SubOptionText>Replace all {itemLabel} for this product</SubOptionText>
                  </SubOption>

                  {/* Category selector for PER_PRODUCT with multiple categories */}
                  {isPERProduct && getImageColumns(effectiveTemplateColumns).length > 1 && replaceOption !== "all" && (
                    <CategorySelectorRow>
                      <CategorySelectorLabel>In category:</CategorySelectorLabel>
                      <CategorySelect
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                      >
                        {getImageColumns(effectiveTemplateColumns).map((col) => (
                          <option key={col.columnIndex} value={toCategoryToken(col)}>
                            {col.name}
                          </option>
                        ))}
                      </CategorySelect>
                    </CategorySelectorRow>
                  )}
                </SubOptionsContainer>
              )}
            </CategorySection>

            <HintText>
              You can reorder or delete images in the Export panel on the Spreadsheet Templates page.
            </HintText>
          </ModeSection>
        </ModalBody>

        <ModalFooter>
          <CancelButton onClick={onClose} disabled={submitting}>
            Cancel
          </CancelButton>
          <SaveButton onClick={handleSave} disabled={submitting || generatedImageUrls.length === 0}>
            {submitting ? "Saving..." : "Save"}
          </SaveButton>
        </ModalFooter>
      </Modal>
    </Overlay>,
    document.body
    )}
    </>
  );
}

/* ============ Styled Components ============ */

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 90%;
  max-width: 520px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalTitle = styled.h2`
  font-size: 18px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
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
  padding: 24px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const ErrorMessage = styled.div`
  background: #fee;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  color: #c33;
  font-size: 14px;
`;

const SummarySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
`;

const SummaryLabel = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
`;

const SummaryValue = styled.div<{ $highlight?: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme, $highlight }) => ($highlight ? theme.colors.accent : theme.colors.text)};
  text-align: right;
`;

const ProductTitle = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.muted};
`;

const CrossSaveIndicator = styled.span`
  margin-left: 8px;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 600;
  text-transform: uppercase;
`;

const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin: 4px 0;
`;

const ModeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ModeHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const ModeTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const ModeHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
`;

const HintText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
  margin-top: 8px;
  padding: 0 4px;
`;

const SubHint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.white};
  font-style: italic;
  padding-left: 26px;
  margin-top: -4px;
`;

// Stage 20: Category selector for PER_PRODUCT multi-category
const CategorySelectorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 4px 26px;
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;

const CategorySelectorLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.white};
  opacity: 0.9;
`;

const CategorySelect = styled.select`
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.text};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.accent};
  }
`;

const CategorySection = styled.div<{ $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  background: ${({ theme, $expanded }) => 
    $expanded ? theme.colors.accent : theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  transition: background 0.2s;
`;

const CategoryHeader = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const CategoryLabel = styled.div<{ $selected?: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.text};
`;

const RadioCircle = styled.div<{ $selected: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid
    ${({ theme, $selected }) => ($selected ? theme.colors.white : theme.colors.border)};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.white : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
`;

const RadioDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
`;

const SubOptionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 16px 14px 48px;
  gap: 10px;
`;

const SubOption = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 0;

  &:hover {
    opacity: 0.8;
  }
`;

const SubRadioCircle = styled.div<{ $selected: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.white};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.white : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
`;

const SubRadioDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
`;

const SubOptionText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  gap: 8px;
`;

const NumberInput = styled.input`
  width: 56px;
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  background: ${({ theme }) => theme.colors.white};
  text-align: center;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.accent};
  }

  /* Hide spinner buttons */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  -moz-appearance: textfield;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
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

  &:hover:not(:disabled) {
    opacity: 0.8;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SaveButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
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