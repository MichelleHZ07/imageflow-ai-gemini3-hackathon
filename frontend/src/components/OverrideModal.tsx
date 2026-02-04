import React, { useState, useMemo, useCallback } from "react";
import styled from "styled-components";
import {
  saveExportOverride,
  RowMode,
  AddPosition,
} from "../lib/api";
import { getProxiedImageUrl } from "../lib/imageProxy";
import type { TargetSpreadsheetConfig } from "./TargetSpreadsheetModal";

// ============================================================
// Types
// ============================================================

export interface SourceImageItem {
  url: string;
  label: string;      // Category label (e.g., "主图（URL）地址")
  colIndex: number;
}

export interface OverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  
  // Source spreadsheet info
  sourceTemplateName: string;
  sourceTemplateId: string;
  sourceProductKey: string;
  sourceProductTitle?: string;
  sourceSku?: string;
  sourceRowMode: RowMode;
  sourceImages: SourceImageItem[];
  sourceTemplateColumns?: Array<{ name: string; role: string }>;
  
  // Target config
  targetConfig: TargetSpreadsheetConfig;
  
  // Callbacks
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  onSaved?: () => void;
  onPreview?: (url: string) => void;
  // Callback to update target images in parent component
  onTargetImagesUpdate?: (images: Array<{ url: string; label: string; colIndex: number }>) => void;
}

// ============================================================
// Helper Functions
// ============================================================

/** Get image columns from template columns */
function getImageColumns(columns: Array<{ name: string; role: string }> | undefined): Array<{ name: string; token: string }> {
  if (!columns) return [];
  return columns
    .filter(col => col.role === "image_url")
    .map(col => ({ name: col.name, token: `col:${col.name}` }));
}

/** Group images by category label */
function groupImagesByCategory(images: SourceImageItem[]): Map<string, SourceImageItem[]> {
  const groups = new Map<string, SourceImageItem[]>();
  for (const img of images) {
    const label = img.label || "Image";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(img);
  }
  return groups;
}

/** Dedupe images for display */
function dedupeImages(images: SourceImageItem[]): SourceImageItem[] {
  const seen = new Set<string>();
  const result: SourceImageItem[] = [];
  for (const img of images) {
    if (!seen.has(img.url)) {
      seen.add(img.url);
      result.push(img);
    }
  }
  return result;
}

// Internal mode types for UI (matching SaveToSpreadsheetModal)
type SaveCategory = "add" | "replace";
type ReplaceOption = "all" | "from";
type AddOption = "last" | "before";

// ============================================================
// Component
// ============================================================

export default function OverrideModal({
  isOpen,
  onClose,
  userId,
  sourceTemplateName,
  sourceTemplateId,
  sourceProductKey,
  sourceProductTitle,
  sourceSku,
  sourceRowMode,
  sourceImages,
  sourceTemplateColumns,
  targetConfig,
  onSuccess,
  onError,
  onSaved,
  onPreview,
  onTargetImagesUpdate,
}: OverrideModalProps) {
  // Selection state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  
  // Save options state (matching SaveToSpreadsheetModal)
  const [saveCategory, setSaveCategory] = useState<SaveCategory>("add");
  const [addOption, setAddOption] = useState<AddOption>("last");
  const [addBeforeIndex, setAddBeforeIndex] = useState<string>("1");
  const [replaceOption, setReplaceOption] = useState<ReplaceOption>("from");
  const [replaceFromIndex, setReplaceFromIndex] = useState<string>("1");
  const [selectedCategoryToken, setSelectedCategoryToken] = useState<string>("");
  
  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  
  // Track if any changes were made (for Save button)
  const [hasChanges, setHasChanges] = useState(false);
  
  // Local state for target images (updated after each Transfer)
  const [localTargetImages, setLocalTargetImages] = useState<Array<{ url: string; label: string; colIndex: number }>>([]);

  // Derived data
  const isPERProduct = targetConfig.targetRowMode === "PER_PRODUCT";
  
  // Source images - deduped for display
  const dedupedSourceImages = useMemo(() => dedupeImages(sourceImages), [sourceImages]);
  
  // Group source images by category (for PER_PRODUCT)
  const sourceGrouped = useMemo(() => {
    const groups = groupImagesByCategory(dedupedSourceImages);
    // Get template columns for ordering
    const imageCols = getImageColumns(sourceTemplateColumns);
    if (imageCols.length === 0) return Array.from(groups.entries());
    
    // Order by template column order
    const ordered: [string, SourceImageItem[]][] = [];
    for (const col of imageCols) {
      if (groups.has(col.name)) {
        ordered.push([col.name, groups.get(col.name)!]);
      }
    }
    // Add any categories not in template
    for (const [label, imgs] of groups) {
      if (!ordered.some(([l]) => l === label)) {
        ordered.push([label, imgs]);
      }
    }
    return ordered;
  }, [dedupedSourceImages, sourceTemplateColumns]);

  // Initialize localTargetImages from props when modal opens
  React.useEffect(() => {
    if (isOpen) {
      const imgs = targetConfig.targetImages || [];
      // Dedupe images during initialization to avoid index mismatch
      const seen = new Set<string>();
      const dedupedImgs = imgs.filter(img => {
        if (seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });
      setLocalTargetImages(dedupedImgs.map(img => ({
        url: img.url,
        label: img.label || "Image",
        colIndex: img.colIndex ?? -1,
      })));
      
      // Debug: Log unique labels and categories for verification
      const uniqueLabels = [...new Set(dedupedImgs.map(img => img.label))];
      console.log(`[OverrideModal] Initialized with ${dedupedImgs.length} deduped images (from ${imgs.length})`);
      console.log(`[OverrideModal] Target image labels:`, uniqueLabels);
      console.log(`[OverrideModal] Target template columns:`, targetConfig.targetTemplateColumns?.filter(c => c.role === "image_url").map(c => c.name));
      
      setHasChanges(false);
      setSelectMode(false);
      setSelectedUrls(new Set());
    }
  }, [isOpen, targetConfig.targetImages]);

  // Target images - use local state (deduped for display)
  const targetImages = useMemo(() => {
    const seen = new Set<string>();
    return localTargetImages.filter(img => {
      if (seen.has(img.url)) return false;
      seen.add(img.url);
      return true;
    });
  }, [localTargetImages]);
  
  // Target image count for position validation
  const targetImageCount = targetImages.length;
  
  // Group target images by category (for PER_PRODUCT)
  const targetGrouped = useMemo(() => {
    const groups = new Map<string, typeof targetImages>();
    for (const img of targetImages) {
      const label = img.label || "Image";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(img);
    }
    
    // Get template columns for ordering
    const imageCols = getImageColumns(
      targetConfig.targetTemplateColumns?.map(c => ({ name: c.name, role: c.role || "" }))
    );
    if (imageCols.length === 0) return Array.from(groups.entries());
    
    // Order by template column order
    const ordered: [string, typeof targetImages][] = [];
    for (const col of imageCols) {
      const existing = groups.get(col.name) || [];
      ordered.push([col.name, existing]);
    }
    // Add any categories not in template
    for (const [label, imgs] of groups) {
      if (!ordered.some(([l]) => l === label)) {
        ordered.push([label, imgs]);
      }
    }
    return ordered;
  }, [targetImages, targetConfig.targetTemplateColumns]);

  // Target image categories for dropdown
  const targetCategories = useMemo(() => {
    const cols = getImageColumns(
      targetConfig.targetTemplateColumns?.map(c => ({ name: c.name, role: c.role || "" }))
    );
    return cols;
  }, [targetConfig.targetTemplateColumns]);

  // ✅ Reset selectedCategoryToken when target template changes
  React.useEffect(() => {
    if (targetCategories.length > 0) {
      setSelectedCategoryToken(targetCategories[0].token);
    } else {
      setSelectedCategoryToken("");
    }
  }, [targetConfig.targetTemplateId, targetCategories]); // Reset when template or categories change

  // Toggle selection
  const toggleSelect = useCallback((url: string) => {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  }, []);

  // Select all
  const selectAll = useCallback(() => {
    setSelectedUrls(new Set(dedupedSourceImages.map(img => img.url)));
  }, [dedupedSourceImages]);

  // Deselect all
  const deselectAll = useCallback(() => {
    setSelectedUrls(new Set());
  }, []);

  // Handle transfer - execute single transfer operation
  const handleTransfer = useCallback(async () => {
    if (selectedUrls.size === 0) {
      setError("Please select at least one image");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const selectedImageUrls = Array.from(selectedUrls);
      
      // localTargetImages is already deduped at initialization
      const existingImages = localTargetImages.map(img => img.url);
      const existingCategories = localTargetImages.map(img => `col:${img.label || "Image"}`);
      
      // Determine target category token
      const targetCategoryToken = isPERProduct && selectedCategoryToken 
        ? selectedCategoryToken 
        : (targetCategories.length > 0 ? targetCategories[0].token : "col:Image");
      
      // Debug: Show all unique categories and the selected one
      const uniqueExistingCategories = [...new Set(existingCategories)];
      console.log(`[OverrideModal] Transfer start:`, {
        selectedCount: selectedImageUrls.length,
        existingCount: existingImages.length,
        targetCategoryToken,
        selectedCategoryToken,
        uniqueExistingCategories,
        targetCategoriesTokens: targetCategories.map(c => c.token),
      });
      
      // Count images per category for debugging
      const categoryCountMap = new Map<string, number>();
      existingCategories.forEach(cat => {
        categoryCountMap.set(cat, (categoryCountMap.get(cat) || 0) + 1);
      });
      console.log(`[OverrideModal] Images per category:`);
      categoryCountMap.forEach((count, cat) => {
        console.log(`  ${cat}: ${count} images`);
      });
      
      let finalImages: string[];
      let finalCategories: string[];
      
      if (saveCategory === "add") {
        if (addOption === "before") {
          // Add before position
          let insertIdx = Math.max(0, parseInt(addBeforeIndex) - 1);
          
          // For PER_PRODUCT, find the global index within the selected category
          if (isPERProduct && targetCategoryToken) {
            const categoryIndices: number[] = [];
            for (let i = 0; i < existingCategories.length; i++) {
              if (existingCategories[i] === targetCategoryToken) {
                categoryIndices.push(i);
              }
            }
            const localIdx = Math.max(0, parseInt(addBeforeIndex) - 1);
            
            console.log(`[OverrideModal] Add Before: targetCategoryToken="${targetCategoryToken}", localIdx=${localIdx}, categoryIndices=`, categoryIndices);
            
            if (categoryIndices.length === 0) {
              console.warn(`[OverrideModal] WARNING: No images found for category "${targetCategoryToken}" in Add Before mode`);
            }
            
            if (localIdx < categoryIndices.length) {
              insertIdx = categoryIndices[localIdx];
              console.log(`[OverrideModal] Add Before: inserting at global index ${insertIdx} (category-local ${localIdx})`);
            } else if (categoryIndices.length > 0) {
              // Beyond category length, insert at end of category
              insertIdx = categoryIndices[categoryIndices.length - 1] + 1;
              console.log(`[OverrideModal] Add Before: localIdx ${localIdx} beyond category, inserting at end: ${insertIdx}`);
            } else {
              // No images in category yet, append to end
              insertIdx = existingImages.length;
              console.log(`[OverrideModal] Add Before: no images in category, appending at end: ${insertIdx}`);
            }
          }
          
          if (insertIdx >= existingImages.length) {
            // Position beyond end, append
            finalImages = [...existingImages, ...selectedImageUrls];
            // Always preserve categories; for new images use targetCategoryToken or default
            const newImageCategory = targetCategoryToken || existingCategories[0] || "col:Image";
            finalCategories = [...existingCategories, ...selectedImageUrls.map(() => newImageCategory)];
          } else {
            finalImages = [
              ...existingImages.slice(0, insertIdx),
              ...selectedImageUrls,
              ...existingImages.slice(insertIdx),
            ];
            // Always preserve categories; for new images use targetCategoryToken or default
            const newImageCategory = targetCategoryToken || existingCategories[0] || "col:Image";
            finalCategories = [
              ...existingCategories.slice(0, insertIdx),
              ...selectedImageUrls.map(() => newImageCategory),
              ...existingCategories.slice(insertIdx),
            ];
          }
        } else {
          // Add to last
          finalImages = [...existingImages, ...selectedImageUrls];
          // Always preserve categories; for new images use targetCategoryToken or default
          const newImageCategory = targetCategoryToken || existingCategories[0] || "col:Image";
          finalCategories = [...existingCategories, ...selectedImageUrls.map(() => newImageCategory)];
        }
      } else {
        // Replace mode
        if (replaceOption === "all") {
          // Replace all images in the selected category
          if (isPERProduct && targetCategoryToken) {
            finalImages = [];
            finalCategories = [];
            // Keep images from other categories, replace target category
            let replacedCategory = false;
            for (let i = 0; i < existingImages.length; i++) {
              if (existingCategories[i] === targetCategoryToken) {
                if (!replacedCategory) {
                  // Insert new images at first occurrence of target category
                  finalImages.push(...selectedImageUrls);
                  finalCategories.push(...selectedImageUrls.map(() => targetCategoryToken));
                  replacedCategory = true;
                }
                // Skip old images in this category
              } else {
                finalImages.push(existingImages[i]);
                finalCategories.push(existingCategories[i]);
              }
            }
            // If category didn't exist, append new images
            if (!replacedCategory) {
              finalImages.push(...selectedImageUrls);
              finalCategories.push(...selectedImageUrls.map(() => targetCategoryToken));
            }
          } else {
            // PER_IMAGE: Replace all
            finalImages = [...selectedImageUrls];
            // Use existing category or default for all new images
            const defaultCategory = existingCategories[0] || targetCategoryToken || "col:Image";
            finalCategories = selectedImageUrls.map(() => defaultCategory);
          }
        } else {
          // Replace from position - need to calculate global index based on category for PER_PRODUCT
          finalImages = [...existingImages];
          // Always preserve existing categories (needed for label matching in display)
          finalCategories = [...existingCategories];
          
          if (isPERProduct && targetCategoryToken) {
            // Find all global indices for the target category
            const categoryIndices: number[] = [];
            for (let i = 0; i < existingCategories.length; i++) {
              if (existingCategories[i] === targetCategoryToken) {
                categoryIndices.push(i);
              }
            }
            
            const startLocalIdx = Math.max(0, parseInt(replaceFromIndex) - 1);
            
            console.log(`[OverrideModal] Replace: targetCategoryToken="${targetCategoryToken}", startLocalIdx=${startLocalIdx}, categoryIndices=`, categoryIndices);
            
            // Warning if category not found
            if (categoryIndices.length === 0) {
              console.warn(`[OverrideModal] WARNING: No images found for category "${targetCategoryToken}"`);
              console.warn(`[OverrideModal] Available categories:`, [...new Set(existingCategories)]);
            }
            
            // Replace images within the category
            for (let i = 0; i < selectedImageUrls.length; i++) {
              const localIdx = startLocalIdx + i;
              if (localIdx < categoryIndices.length) {
                // Replace existing image in category
                const globalIdx = categoryIndices[localIdx];
                finalImages[globalIdx] = selectedImageUrls[i];
                // Keep category unchanged
                console.log(`[OverrideModal] Replacing at global index ${globalIdx} (category-local ${localIdx}), url=${selectedImageUrls[i].substring(0, 50)}...`);
              } else {
                // Append to end of this category (after last image of this category)
                // Find the position to insert: after the last image of this category, before next category
                const insertPos = categoryIndices.length > 0 
                  ? categoryIndices[categoryIndices.length - 1] + 1 + (localIdx - categoryIndices.length)
                  : finalImages.length;
                
                // Insert at correct position
                finalImages.splice(insertPos, 0, selectedImageUrls[i]);
                finalCategories.splice(insertPos, 0, targetCategoryToken);
                // Update categoryIndices for subsequent iterations
                categoryIndices.push(insertPos);
                console.log(`[OverrideModal] Appending at position ${insertPos} (category-local ${localIdx}), url=${selectedImageUrls[i].substring(0, 50)}...`);
              }
            }
          } else {
            // PER_IMAGE: Simple global index replacement
            const replaceIdx = Math.max(0, parseInt(replaceFromIndex) - 1);
            // Get the default category for new images (use existing or first available)
            const defaultCategory = existingCategories[0] || targetCategoryToken || "col:Image";
            for (let i = 0; i < selectedImageUrls.length; i++) {
              const targetIdx = replaceIdx + i;
              if (targetIdx < finalImages.length) {
                finalImages[targetIdx] = selectedImageUrls[i];
                // Category stays the same for replacements
              } else {
                finalImages.push(selectedImageUrls[i]);
                finalCategories.push(defaultCategory);  // Add category for new images
              }
            }
          }
        }
      }

      // Re-sort by category order for PER_PRODUCT
      if (isPERProduct && finalCategories.length > 0 && targetCategories.length > 1) {
        const categoryOrderMap = new Map(targetCategories.map((col, idx) => [col.token, idx]));
        const pairs = finalImages.map((img, idx) => ({
          image: img,
          category: finalCategories[idx],
          originalIdx: idx,
        }));
        pairs.sort((a, b) => {
          const orderA = categoryOrderMap.get(a.category) ?? 999;
          const orderB = categoryOrderMap.get(b.category) ?? 999;
          if (orderA !== orderB) return orderA - orderB;
          return a.originalIdx - b.originalIdx;
        });
        finalImages = pairs.map(p => p.image);
        finalCategories = pairs.map(p => p.category);
      }

      console.log(`[OverrideModal] Transferring to target:`, {
        targetTemplateId: targetConfig.targetTemplateId,
        targetProductKey: targetConfig.targetProductKey,
        finalImagesCount: finalImages.length,
        finalCategoriesCount: finalCategories.length,
        selectedCount: selectedImageUrls.length,
        saveCategory,
        addOption,
        replaceOption,
        replaceFromIndex,
        selectedCategoryToken,
      });
      
      // Log detailed final state for debugging
      console.log(`[OverrideModal] Final images by category:`);
      const categoryGroups = new Map<string, number>();
      finalCategories.forEach(cat => {
        categoryGroups.set(cat, (categoryGroups.get(cat) || 0) + 1);
      });
      categoryGroups.forEach((count, cat) => {
        console.log(`  ${cat}: ${count} images`);
      });

      // ✅ Build newProductOptions if this is a new product (cross-save to different spreadsheet)
      const isNewProduct = !!(targetConfig as any)?.isNewProduct;
      const newProductOptions = isNewProduct ? {
        isNewProduct: true as const,
        productId: (targetConfig as any).targetProductId || "",
        sku: (targetConfig as any).targetSku || "",
        addPosition: ((targetConfig as any).addPosition || "last") as AddPosition,
        ...((targetConfig as any).insertBeforeProductKey && {
          insertBeforeProductKey: (targetConfig as any).insertBeforeProductKey,
        }),
      } : undefined;

      if (isNewProduct) {
        console.log(`[OverrideModal] New product detected, adding newProductOptions:`, newProductOptions);
      }

      // Save to target template
      await saveExportOverride(
        userId,
        sourceTemplateId,  // Source template for audit
        targetConfig.targetProductKey!,
        finalImages,
        finalCategories,
        targetConfig.targetTemplateId,  // Target template
        newProductOptions  // ✅ Stage 20: New product options
      );

      // Update local target images state to reflect the change
      const newLocalTargetImages = finalImages.map((url, idx) => {
        const category = finalCategories[idx] || "";
        const label = category.startsWith("col:") ? category.substring(4) : category || "Image";
        const colIndex = targetConfig.targetTemplateColumns?.findIndex(
          (col: any) => col.name === label && col.role === "image_url"
        ) ?? -1;
        return { url, label, colIndex };
      });
      setLocalTargetImages(newLocalTargetImages);
      
      // Notify parent component of the update
      onTargetImagesUpdate?.(newLocalTargetImages);
      
      // Mark that changes were made
      setHasChanges(true);
      
      // Clear selection after successful transfer
      setSelectedUrls(new Set());
      
      // Show success message but don't close modal
      onSuccess?.(`Transferred ${selectedImageUrls.length} image${selectedImageUrls.length > 1 ? "s" : ""}`);
      
    } catch (e: any) {
      const errorMsg = e.message || "Failed to transfer images";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      setSubmitting(false);
    }
  }, [
    selectedUrls, localTargetImages, isPERProduct, selectedCategoryToken, targetCategories,
    saveCategory, addOption, addBeforeIndex, replaceOption, replaceFromIndex,
    userId, sourceTemplateId, targetConfig, onSuccess, onError
  ]);

  // Handle final save - close modal and trigger parent refresh
  const handleFinalSave = useCallback(() => {
    if (hasChanges) {
      onSaved?.();
    }
    onClose();
  }, [hasChanges, onSaved, onClose]);

  // Handle close (X button, overlay click, Cancel) - same as save since transfers are immediate
  const handleClose = useCallback(() => {
    if (hasChanges) {
      onSaved?.();
    }
    onClose();
  }, [hasChanges, onSaved, onClose]);

  // Exit select mode
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedUrls(new Set());
  }, []);

  if (!isOpen) return null;

  const selectedCount = selectedUrls.size;

  return (
    <Overlay onClick={handleClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <HeaderContent>
            <ModalTitle>Override Images</ModalTitle>
            <ModalSubtitle>
              Transfer images from {sourceTemplateName} to {targetConfig.targetTemplateName}
            </ModalSubtitle>
          </HeaderContent>
          <CloseButton onClick={handleClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          <ContentGrid>
            {/* ===== LEFT COLUMN: Source Images ===== */}
            <LeftColumn>
              <ColumnHeader>
                <ColumnLabel>FROM</ColumnLabel>
                <ColumnName>{sourceTemplateName}</ColumnName>
              </ColumnHeader>
              <ProductLine>
                <ProductSKU>{sourceSku || sourceProductKey}</ProductSKU>
                {sourceProductTitle && <ProductTitleInline>· {sourceProductTitle}</ProductTitleInline>}
              </ProductLine>
              <ColumnDivider />

              {/* Source Images */}
              <ImagesScrollArea>
                {sourceRowMode === "PER_PRODUCT" ? (
                  // PER_PRODUCT: Grouped by category
                  sourceGrouped.map(([category, images]) => (
                    <CategorySection key={category}>
                      <CategoryTitle>{category} ({images.length})</CategoryTitle>
                      <ImageGrid>
                        {images.length > 0 ? images.map((img, i) => (
                          <ImageWrapper 
                            key={`${img.url}-${i}`}
                            $selectable={selectMode}
                            $selected={selectedUrls.has(img.url)}
                            onClick={() => selectMode ? toggleSelect(img.url) : onPreview?.(img.url)}
                          >
                            <ImageThumb $bg={img.url} />
                            {selectMode && (
                              <Checkbox $checked={selectedUrls.has(img.url)}>
                                {selectedUrls.has(img.url) && "✓"}
                              </Checkbox>
                            )}
                            <ImageNumber>{i + 1}</ImageNumber>
                          </ImageWrapper>
                        )) : (
                          <EmptySlot>Empty</EmptySlot>
                        )}
                      </ImageGrid>
                    </CategorySection>
                  ))
                ) : (
                  // PER_IMAGE: Flat grid
                  <ImageGrid>
                    {dedupedSourceImages.map((img, i) => (
                      <ImageWrapper 
                        key={`${img.url}-${i}`}
                        $selectable={selectMode}
                        $selected={selectedUrls.has(img.url)}
                        onClick={() => selectMode ? toggleSelect(img.url) : onPreview?.(img.url)}
                      >
                        <ImageThumb $bg={img.url} />
                        {selectMode && (
                          <Checkbox $checked={selectedUrls.has(img.url)}>
                            {selectedUrls.has(img.url) && "✓"}
                          </Checkbox>
                        )}
                        <ImageNumber>{i + 1}</ImageNumber>
                      </ImageWrapper>
                    ))}
                  </ImageGrid>
                )}
              </ImagesScrollArea>
              
              {/* Select Mode Toggle - Below images */}
              <SelectModeSection>
                {!selectMode ? (
                  <SelectButton onClick={() => setSelectMode(true)}>
                    Select
                  </SelectButton>
                ) : (
                  <SelectModeActions>
                    <SelectActionBtn onClick={selectAll}>All</SelectActionBtn>
                    <SelectActionBtn onClick={deselectAll}>None</SelectActionBtn>
                    <CancelSelectBtn onClick={exitSelectMode}>Cancel</CancelSelectBtn>
                    {selectedCount > 0 && (
                      <SelectedCount>{selectedCount} selected</SelectedCount>
                    )}
                  </SelectModeActions>
                )}
              </SelectModeSection>
            </LeftColumn>

            {/* ===== RIGHT COLUMN: Target Images ===== */}
            <RightColumn>
              <ColumnHeader>
                <ColumnLabel>TO</ColumnLabel>
                <ColumnName>{targetConfig.targetTemplateName}</ColumnName>
              </ColumnHeader>
              <ProductLine>
                <ProductSKU>{targetConfig.targetSku || targetConfig.targetProductId || targetConfig.targetProductKey}</ProductSKU>
                {targetConfig.targetTitle && <ProductTitleInline>· {targetConfig.targetTitle}</ProductTitleInline>}
              </ProductLine>
              <ColumnDivider />

              {/* Target Images */}
              <ImagesScrollArea>
                {isPERProduct ? (
                  // PER_PRODUCT: Grouped by category
                  targetGrouped.map(([category, images]) => (
                    <CategorySection key={category}>
                      <CategoryTitle>{category} ({images.length})</CategoryTitle>
                      <ImageGrid>
                        {images.length > 0 ? images.map((img, i) => (
                          <ImageWrapper 
                            key={`${img.url}-${i}`}
                            onClick={() => onPreview?.(img.url)}
                          >
                            <ImageThumb $bg={img.url} />
                            <ImageNumber>{i + 1}</ImageNumber>
                          </ImageWrapper>
                        )) : (
                          <EmptySlot>Empty</EmptySlot>
                        )}
                      </ImageGrid>
                    </CategorySection>
                  ))
                ) : (
                  // PER_IMAGE: Flat grid
                  <ImageGrid>
                    {targetImages.map((img, i) => (
                      <ImageWrapper 
                        key={`${img.url}-${i}`}
                        onClick={() => onPreview?.(img.url)}
                      >
                        <ImageThumb $bg={img.url} />
                        <ImageNumber>{i + 1}</ImageNumber>
                      </ImageWrapper>
                    ))}
                  </ImageGrid>
                )}
              </ImagesScrollArea>

              {/* Save Options (when selecting and has selections) - Below images */}
              {selectMode && selectedCount > 0 && (
                <ModeSection>
                  <ModeTitle>Save Mode</ModeTitle>

                  {/* Add Images Option */}
                  <ModeCategorySection $expanded={saveCategory === "add"}>
                    <ModeCategoryHeader $selected={saveCategory === "add"} onClick={() => setSaveCategory("add")}>
                      <RadioCircle $selected={saveCategory === "add"}>
                        {saveCategory === "add" && <RadioDotInner />}
                      </RadioCircle>
                      <ModeCategoryLabel $selected={saveCategory === "add"}>Add images</ModeCategoryLabel>
                    </ModeCategoryHeader>

                    {saveCategory === "add" && (
                      <SubOptionsContainer>
                        <SubOption onClick={() => setAddOption("last")}>
                          <SubRadioCircle $selected={addOption === "last"}>
                            {addOption === "last" && <SubRadioDot />}
                          </SubRadioCircle>
                          <SubOptionText>Add to the end of existing images</SubOptionText>
                        </SubOption>

                        <SubOption onClick={() => setAddOption("before")}>
                          <SubRadioCircle $selected={addOption === "before"}>
                            {addOption === "before" && <SubRadioDot />}
                          </SubRadioCircle>
                          <SubOptionText>
                            Add before image #
                            {addOption === "before" ? (
                              <NumberInput
                                type="number"
                                min={1}
                                max={targetImageCount || 1}
                                value={addBeforeIndex}
                                onChange={(e) => setAddBeforeIndex(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <BoldNum>{addBeforeIndex}</BoldNum>
                            )}
                          </SubOptionText>
                        </SubOption>

                        {/* Category selector for PER_PRODUCT */}
                        {isPERProduct && targetCategories.length > 1 && (
                          <CategorySelectorRow>
                            <CategorySelectorLabel>Save to category:</CategorySelectorLabel>
                            <CategorySelectDropdown
                              value={selectedCategoryToken}
                              onChange={(e) => setSelectedCategoryToken(e.target.value)}
                            >
                              {targetCategories.map((col) => (
                                <option key={col.token} value={col.token}>
                                  {col.name}
                                </option>
                              ))}
                            </CategorySelectDropdown>
                          </CategorySelectorRow>
                        )}
                      </SubOptionsContainer>
                    )}
                  </ModeCategorySection>

                  {/* Replace Images Option */}
                  <ModeCategorySection $expanded={saveCategory === "replace"}>
                    <ModeCategoryHeader $selected={saveCategory === "replace"} onClick={() => setSaveCategory("replace")}>
                      <RadioCircle $selected={saveCategory === "replace"}>
                        {saveCategory === "replace" && <RadioDotInner />}
                      </RadioCircle>
                      <ModeCategoryLabel $selected={saveCategory === "replace"}>Replace images</ModeCategoryLabel>
                    </ModeCategoryHeader>

                    {saveCategory === "replace" && (
                      <SubOptionsContainer>
                        <SubOption onClick={() => setReplaceOption("from")}>
                          <SubRadioCircle $selected={replaceOption === "from"}>
                            {replaceOption === "from" && <SubRadioDot />}
                          </SubRadioCircle>
                          <SubOptionText>
                            Replace from image #
                            {replaceOption === "from" ? (
                              <NumberInput
                                type="number"
                                min={1}
                                max={targetImageCount || 1}
                                value={replaceFromIndex}
                                onChange={(e) => setReplaceFromIndex(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <BoldNum>{replaceFromIndex}</BoldNum>
                            )}
                          </SubOptionText>
                        </SubOption>

                        <SubOption onClick={() => setReplaceOption("all")}>
                          <SubRadioCircle $selected={replaceOption === "all"}>
                            {replaceOption === "all" && <SubRadioDot />}
                          </SubRadioCircle>
                          <SubOptionText>Replace all images for this product</SubOptionText>
                        </SubOption>

                        {/* Category selector for PER_PRODUCT */}
                        {isPERProduct && targetCategories.length > 1 && replaceOption !== "all" && (
                          <CategorySelectorRow>
                            <CategorySelectorLabel>In category:</CategorySelectorLabel>
                            <CategorySelectDropdown
                              value={selectedCategoryToken}
                              onChange={(e) => setSelectedCategoryToken(e.target.value)}
                            >
                              {targetCategories.map((col) => (
                                <option key={col.token} value={col.token}>
                                  {col.name}
                                </option>
                              ))}
                            </CategorySelectDropdown>
                          </CategorySelectorRow>
                        )}
                      </SubOptionsContainer>
                    )}
                  </ModeCategorySection>
                  
                  {/* Transfer Button inside Save Mode */}
                  <TransferButtonRow>
                    <TransferButton 
                      onClick={handleTransfer}
                      disabled={submitting || selectedCount === 0}
                    >
                      {submitting ? "Transferring..." : `Transfer ${selectedCount} Image${selectedCount !== 1 ? "s" : ""}`}
                    </TransferButton>
                  </TransferButtonRow>
                </ModeSection>
              )}
            </RightColumn>
          </ContentGrid>

          {error && <ErrorMessage>{error}</ErrorMessage>}
        </ModalBody>

        <ModalFooter>
          <CancelButton onClick={handleClose}>Cancel</CancelButton>
          <SaveButton onClick={handleFinalSave}>
            Save
          </SaveButton>
        </ModalFooter>
      </Modal>
    </Overlay>
  );
}

// ============================================================
// Styled Components
// ============================================================

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 100%;
  max-width: 900px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadow.soft};
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px;
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
  font-size: 13px;
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
  grid-template-columns: 1fr 1fr;
  flex: 1;
  overflow: hidden;
`;

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  overflow: hidden;
  padding: 16px;
`;

const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px;
`;

const ColumnHeader = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
`;

const ColumnLabel = styled.span`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
`;

const ColumnName = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const ColumnDivider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin-bottom: 12px;
`;

const ProductLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 4px;
  margin-bottom: 8px;
  overflow: hidden;
`;

const ProductSKU = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  flex-shrink: 0;
`;

const ProductTitleInline = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SelectModeSection = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const SelectButton = styled.button`
  padding: 8px 16px;
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const SelectModeActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const SelectActionBtn = styled.button`
  padding: 6px 12px;
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const CancelSelectBtn = styled.button`
  padding: 6px 12px;
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const SelectedCount = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  margin-left: 4px;
`;

const ImagesScrollArea = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CategorySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CategoryTitle = styled.div`
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
`;

const ImageWrapper = styled.div<{ $selectable?: boolean; $selected?: boolean }>`
  position: relative;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
  
  ${({ $selectable, $selected, theme }) => $selectable && `
    border: 3px solid ${$selected ? theme.colors.accent : "transparent"};
  `}

  &:hover {
    transform: scale(1.02);
  }
`;

const ImageThumb = styled.div<{ $bg: string }>`
  width: 100%;
  height: 100%;
  background: url(${({ $bg }) => getProxiedImageUrl($bg)}) center / cover no-repeat;
  background-color: ${({ theme }) => theme.colors.inner};
`;

const Checkbox = styled.div<{ $checked: boolean }>`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${({ $checked, theme }) => $checked ? theme.colors.accent : "rgba(255,255,255,0.9)"};
  border: 2px solid ${({ $checked, theme }) => $checked ? theme.colors.accent : theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.white};
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
`;

const ImageNumber = styled.div`
  position: absolute;
  bottom: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const EmptySlot = styled.div`
  aspect-ratio: 1;
  background: ${({ theme }) => theme.colors.card};
  border: 2px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

// ============================================================
// Save Mode Section (matching SaveToSpreadsheetModal style)
// ============================================================

const ModeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModeTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 4px;
`;

const TransferButtonRow = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const TransferButton = styled.button`
  padding: 10px 20px;
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
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

const ModeCategorySection = styled.div<{ $expanded: boolean }>`
  display: flex;
  flex-direction: column;
  background: ${({ theme, $expanded }) => 
    $expanded ? theme.colors.accent : theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  transition: background 0.2s;
`;

const ModeCategoryHeader = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const ModeCategoryLabel = styled.div<{ $selected?: boolean }>`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.text};
`;

const RadioCircle = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ theme, $selected }) => ($selected ? theme.colors.white : theme.colors.border)};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.white : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
`;

const RadioDotInner = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
`;

const SubOptionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 4px 14px 12px 44px;
  gap: 8px;
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
  width: 14px;
  height: 14px;
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
  font-size: 12px;
  color: ${({ theme }) => theme.colors.white};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const BoldNum = styled.span`
  font-weight: 700;
`;

const NumberInput = styled.input`
  width: 50px;
  padding: 4px 6px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  background: ${({ theme }) => theme.colors.white};
  text-align: center;

  &:focus {
    outline: none;
  }

  /* Hide spinner buttons */
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  -moz-appearance: textfield;
`;

const CategorySelectorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0 0 0;
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
`;

const CategorySelectorLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.white};
  opacity: 0.9;
`;

const CategorySelectDropdown = styled.select`
  flex: 1;
  padding: 6px 10px;
  font-size: 12px;
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;

  &:focus {
    outline: none;
  }
`;

const ErrorMessage = styled.div`
  padding: 12px 16px;
  background: #fee;
  color: #c00;
  font-size: 13px;
  margin: 0 16px 16px;
  border-radius: ${({ theme }) => theme.radius.md};
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const CancelButton = styled.button`
  padding: 10px 20px;
  background: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const SaveButton = styled.button`
  padding: 10px 20px;
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
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