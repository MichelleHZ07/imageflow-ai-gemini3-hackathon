/**
 * TargetSpreadsheetModal.tsx
 * 
 * Modal for selecting target spreadsheet and target product.
 * Style matches SpreadsheetProductModal exactly.
 * 
 * Features:
 * - Auto-select first template on open
 * - Two-panel layout: Left for template/mode, Right for products
 * - Write mode: Add (new row) or Override (existing row)
 * - Add mode: sub-options for position (last row / before selected)
 * - Add mode: requires both product_id and sku fields
 * - Product display: "product_id sku" format (matching ResultsModal)
 * - Accent background for selected items (no borders)
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import styled from "styled-components";
import {
  getUserSpreadsheetTemplates,
  fetchSpreadsheetRows,
  fetchSpreadsheetResults,
  getExportOverrides,
  getDescriptionOverrides,
  DescriptionOverrides,
  SpreadsheetTemplate,
  SpreadsheetRowItem,
  RowMode,
} from "../lib/api";
import { getSpreadsheetById } from "../lib/spreadsheetTemplateUtils";
import { applySpreadsheetResultsToRows, mergeNewProductsIntoRows } from "../lib/spreadsheetOverlay";
import { getProxiedImageUrl } from "../lib/imageProxy";

// ============================================================
// Types
// ============================================================

export type WriteMode = "add" | "override";
export type AddPosition = "last" | "before";

interface ImageEntry {
  url: string;
  label: string;
  colIndex: number;
}

export interface TargetSpreadsheetConfig {
  targetTemplateId: string;
  targetTemplateName: string;
  targetPlatform: string;
  targetRowMode: "PER_PRODUCT" | "PER_IMAGE";
  writeMode: WriteMode;
  targetProductKey: string;
  targetRowIndex?: number;
  targetRowIndices?: number[];
  targetSku?: string;
  targetProductId?: string;
  targetTitle?: string;
  targetCategory?: string;
  targetImages?: ImageEntry[];
  // Add mode specific
  addPosition?: AddPosition;
  insertBeforeProductKey?: string;
  // Stage 20: New product identification
  isNewProduct?: boolean;
  // Stage 20: Target template columns for category slots display
  targetTemplateColumns?: Array<{ name: string; role: string; columnIndex: number }>;
  // Stage 21: Target product fields for cross-save fieldValues display
  targetFields?: Record<string, any>;
}

interface TargetSpreadsheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: TargetSpreadsheetConfig) => void;
  userId: string;
  excludeTemplateId?: string;
  initialConfig?: TargetSpreadsheetConfig | null;
}

// ============================================================
// Helpers
// ============================================================

function getOverrideImages(override: any): string[] | undefined {
  if (!override) return undefined;
  if (override.images && Array.isArray(override.images)) return override.images;
  if (Array.isArray(override)) return override;
  return undefined;
}

/**
 * Extract categories array from override
 * Categories are stored as role tokens (e.g., "col:Silver Image URL")
 */
function getOverrideCategories(override: any): string[] | undefined {
  if (!override) return undefined;
  if (override.categories && Array.isArray(override.categories)) {
    return override.categories;
  }
  return undefined;
}

/**
 * Convert category token to label
 * Token format: "col:Silver Image URL" -> "Silver Image URL"
 */
function categoryTokenToLabel(token: string): string {
  if (!token) return "Image";
  if (token.startsWith("col:")) {
    return token.substring(4);
  }
  return token;
}

function computeProductKey(
  item: SpreadsheetRowItem,
  rowMode: RowMode,
  groupByField: "sku" | "product_id" = "product_id"
): string {
  if (rowMode === "PER_PRODUCT") {
    // For new products (rowIndex = -1), use item.key which contains productId::sku
    if (item.rowIndex === -1) {
      return item.key || "";
    }
    return `row-${item.rowIndex}`;
  }
  const productId = item.fields.product_id || "";
  const sku = item.fields.sku || "";
  if (groupByField === "sku") {
    if (productId && sku) return `${productId}::${sku}`;
    return sku || productId || item.key || "";
  }
  return productId || sku || item.key || "";
}

/**
 * Get display name for a product (matching ResultsModal format)
 * Format: "product_id sku" (space-separated)
 */
function getProductDisplayName(item: SpreadsheetRowItem): string {
  const productId = item.fields.product_id || "";
  const sku = item.fields.sku || "";
  
  if (productId && sku) {
    return `${productId} ${sku}`;
  }
  if (productId) return productId;
  if (sku) return sku;
  return `row-${item.rowIndex}`;
}

function getEffectiveImages(
  item: SpreadsheetRowItem,
  exportOverrides: Record<string, any>,
  rowMode: RowMode,
  groupByField: "sku" | "product_id" = "product_id"
): ImageEntry[] {
  // For new products (rowIndex = -1), use item.key directly since it matches the override key
  const isNewProduct = item.rowIndex === -1;
  const productKey = isNewProduct ? (item.key || "") : computeProductKey(item, rowMode, groupByField);
  const override = exportOverrides[productKey];
  const overrideUrls = getOverrideImages(override);
  
  if (overrideUrls && overrideUrls.length > 0) {
    const overrideCategories = getOverrideCategories(override);
    const originalImages = item.fields.images || [];
    
    // If we have categories saved with override, use them
    if (overrideCategories && overrideCategories.length === overrideUrls.length) {
      return overrideUrls.map((url, idx) => ({
        url,
        label: categoryTokenToLabel(overrideCategories[idx]),
        colIndex: -1,
      }));
    }
    
    // No categories saved - build from position using original images structure
    // This handles legacy overrides that don't have categories
    if (originalImages.length > 0) {
      // Build column sizes from original images
      const columnSizes: Record<string, number> = {};
      const columnOrder: string[] = [];
      for (const img of originalImages) {
        if (!columnSizes[img.label]) {
          columnSizes[img.label] = 0;
          columnOrder.push(img.label);
        }
        columnSizes[img.label]++;
      }
      
      // Determine last column (for extras)
      const lastColumn = columnOrder.length > 0 ? columnOrder[columnOrder.length - 1] : "Image";
      
      // Assign categories based on position
      return overrideUrls.map((url, idx) => {
        let offset = 0;
        for (const colName of columnOrder) {
          const colSize = columnSizes[colName];
          if (idx < offset + colSize) {
            return { url, label: colName, colIndex: -1 };
          }
          offset += colSize;
        }
        // Beyond all original columns - add to last column
        return { url, label: lastColumn, colIndex: -1 };
      });
    }
    
    // Fallback: no original images to reference
    const defaultLabel = "Image";
    return overrideUrls.map(url => ({ url, label: defaultLabel, colIndex: -1 }));
  }
  
  if (item.fields.images && item.fields.images.length > 0) {
    return item.fields.images;
  }
  
  return [];
}

// ============================================================
// Component
// ============================================================

export default function TargetSpreadsheetModal({
  isOpen,
  onClose,
  onConfirm,
  userId,
  excludeTemplateId,
  initialConfig,
}: TargetSpreadsheetModalProps) {
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [error, setError] = useState("");

  const [writeMode, setWriteMode] = useState<WriteMode>("add");
  
  // Add mode: position options
  const [addPosition, setAddPosition] = useState<AddPosition>("last");
  const [insertBeforeKey, setInsertBeforeKey] = useState<string | null>(null);

  const [rows, setRows] = useState<SpreadsheetRowItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rowMode, setRowMode] = useState<RowMode>("PER_PRODUCT");
  const [groupByField, setGroupByField] = useState<"sku" | "product_id">("product_id");
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [exportOverrides, setExportOverrides] = useState<Record<string, any>>({});
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, DescriptionOverrides>>({});
  const [scenarios, setScenarios] = useState<any[]>([]);
  // Stage 20: Store complete columns from fetchSpreadsheetRows
  const [templateColumns, setTemplateColumns] = useState<Array<{ name: string; role: string; columnIndex: number }>>([]);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Add mode: new product fields (both required)
  const [newProductId, setNewProductId] = useState("");
  const [newSku, setNewSku] = useState("");

  // Filter and sort templates
  const filteredTemplates = useMemo(() => {
    return templates
      .filter((t) => t.status === "mapped" && t.id !== excludeTemplateId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [templates, excludeTemplateId]);

  const selectedTemplate = filteredTemplates.find((t) => t.id === selectedTemplateId);

  // Load templates and auto-select first
  useEffect(() => {
    if (!isOpen || !userId) return;

    setLoading(true);
    setError("");
    
    getUserSpreadsheetTemplates(userId)
      .then((list) => {
        setTemplates(list);
        
        // Auto-select first mapped template (after filtering and sorting)
        const mapped = list
          .filter((t) => t.status === "mapped" && t.id !== excludeTemplateId)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        
        if (initialConfig?.targetTemplateId) {
          setSelectedTemplateId(initialConfig.targetTemplateId);
        } else if (mapped.length > 0) {
          setSelectedTemplateId(mapped[0].id);
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load spreadsheets");
      })
      .finally(() => setLoading(false));
  }, [isOpen, userId, excludeTemplateId, initialConfig]);

  // Load products when template selected
  useEffect(() => {
    if (!selectedTemplateId || !userId) {
      setRows([]);
      setTotal(0);
      return;
    }

    async function loadProducts() {
      try {
        setLoadingProducts(true);

        const currentTemplate = templates.find(t => t.id === selectedTemplateId);
        const templateGroupByField = (currentTemplate as any)?.groupByField || "product_id";

        // Load rows, scenarios, overrides, description overrides, and full template data in parallel
        const [rowsData, scenariosData, overridesData, descOverridesData, fullTemplateData] = await Promise.all([
          fetchSpreadsheetRows(userId, selectedTemplateId, {
            page,
            pageSize,
            search: searchQuery,
          }),
          fetchSpreadsheetResults(userId, selectedTemplateId),
          getExportOverrides(userId, selectedTemplateId),
          getDescriptionOverrides(userId, selectedTemplateId),
          getSpreadsheetById(userId, selectedTemplateId),
        ]);

        const mergedItems = applySpreadsheetResultsToRows(
          rowsData.items,
          scenariosData,
          rowsData.rowMode,
          templateGroupByField
        );

        // Stage 20: Merge new products from exportOverrides into the rows
        const itemsWithNewProducts = mergeNewProductsIntoRows(
          mergedItems,
          overridesData,
          rowsData.rowMode,
          templateGroupByField,
          descOverridesData
        );

        setRows(itemsWithNewProducts);
        setTotal(rowsData.total);
        setRowMode(rowsData.rowMode);
        setGroupByField(templateGroupByField);
        setExportOverrides(overridesData);
        setDescriptionOverrides(descOverridesData);
        setScenarios(scenariosData || []);
        
        // Stage 20: Save complete columns from getSpreadsheetById (preferred) or fallback to template list
        const columnsData = fullTemplateData?.columns || currentTemplate?.columns || [];
        setTemplateColumns(columnsData.map((col: any, idx: number) => ({
          name: col.name,
          role: col.role || "",
          columnIndex: idx,
        })));
      } catch (err: any) {
        console.error("Failed to load products:", err);
      } finally {
        setLoadingProducts(false);
      }
    }

    loadProducts();
  }, [selectedTemplateId, page, searchQuery, userId, templates]);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setWriteMode(initialConfig?.writeMode || "add");
      setSelectedRowKey(initialConfig?.targetProductKey || null);
      setAddPosition("last");
      setInsertBeforeKey(null);
      setNewProductId("");
      setNewSku("");
      setSearchInput("");
      setSearchQuery("");
      setPage(1);
      setError("");
    }
  }, [isOpen, initialConfig]);

  // Reset product selection when template changes
  useEffect(() => {
    setSelectedRowKey(null);
    setAddPosition("last");
    setInsertBeforeKey(null);
    setNewProductId("");
    setNewSku("");
    setPage(1);
    setSearchInput("");
    setSearchQuery("");
    setTemplateColumns([]); // Reset columns when template changes
  }, [selectedTemplateId]);

  // Reset add mode state when write mode changes
  useEffect(() => {
    if (writeMode === "override") {
      setAddPosition("last");
      setInsertBeforeKey(null);
      setNewProductId("");
      setNewSku("");
    } else {
      setSelectedRowKey(null);
    }
  }, [writeMode]);

  const handleSearchSubmit = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearchSubmit();
  }, [handleSearchSubmit]);

  // Check if product has any updates (images or descriptions)
  const isProductUpdated = useCallback((item: SpreadsheetRowItem): boolean => {
    const productKey = computeProductKey(item, rowMode, groupByField);
    
    // Check if has overlay from scenarios (AI generated images)
    const hasOverlay = scenarios.some(s => s.productKey === productKey);
    
    // Check if has export override (saved image changes)
    const hasExportOverride = !!exportOverrides[productKey];
    
    // Check if has description override (saved text changes)
    const hasDescOverride = (() => {
      const saved = descriptionOverrides[productKey];
      if (!saved) return false;
      return Object.values(saved).some(v => v !== undefined && v !== "");
    })();
    
    return hasOverlay || hasExportOverride || hasDescOverride;
  }, [scenarios, exportOverrides, descriptionOverrides, rowMode, groupByField]);

  // Derive placeholder hints from first non-empty product_id and sku in existing rows
  const placeholderHints = useMemo(() => {
    let hintProductId = "";
    let hintSku = "";
    for (const item of rows) {
      if (!hintProductId && item.fields.product_id) {
        hintProductId = item.fields.product_id;
      }
      if (!hintSku && item.fields.sku) {
        hintSku = item.fields.sku;
      }
      if (hintProductId && hintSku) break;
    }
    return {
      productId: hintProductId ? `e.g. ${hintProductId}` : "Enter product ID...",
      sku: hintSku ? `e.g. ${hintSku}` : "Enter SKU...",
    };
  }, [rows]);

  const handleRowClick = (item: SpreadsheetRowItem) => {
    const key = computeProductKey(item, rowMode, groupByField);
    
    if (writeMode === "override") {
      // Override mode: select product to override
      setSelectedRowKey(key);
    } else if (addPosition === "before") {
      // Add mode with "before" position: select product to insert before
      setInsertBeforeKey(key);
    }
  };

  const handleConfirm = () => {
    if (!selectedTemplate) return;

    let effectiveProductKey = "";
    let effectiveImages: ImageEntry[] = [];
    let effectiveRowIndex: number | undefined;
    let effectiveRowIndices: number[] | undefined;
    let effectiveSku: string | undefined;
    let effectiveProductId: string | undefined;
    let effectiveTitle: string | undefined;
    let effectiveCategory: string | undefined;
    let effectiveFields: Record<string, any> | undefined;

    if (writeMode === "override") {
      // Override mode: use selected product
      if (selectedRowKey) {
        const selectedItem = rows.find(
          (item) => computeProductKey(item, rowMode, groupByField) === selectedRowKey
        );
        if (selectedItem) {
          effectiveProductKey = selectedRowKey;
          effectiveImages = getEffectiveImages(selectedItem, exportOverrides, rowMode, groupByField);
          effectiveRowIndex = selectedItem.rowIndex;
          effectiveRowIndices = selectedItem.rowIndices;
          effectiveSku = selectedItem.fields.sku;
          effectiveProductId = selectedItem.fields.product_id;
          effectiveTitle = selectedItem.fields.product_title;
          effectiveCategory = selectedItem.fields.category;
          // Stage 21: Include all fields for cross-save fieldValues display
          effectiveFields = { ...selectedItem.fields };
        }
      }
    } else {
      // Add mode: create new product with both product_id and sku
      const trimmedProductId = newProductId.trim();
      const trimmedSku = newSku.trim();
      
      if (trimmedProductId && trimmedSku) {
        // Generate productKey based on rowMode and groupByField
        // For PER_PRODUCT: always use "product_id::sku" format (no row index for new products)
        // For PER_IMAGE: match the groupByField setting
        if (rowMode === "PER_IMAGE" && groupByField === "product_id") {
          // PER_IMAGE with product_id grouping: use only product_id
          effectiveProductKey = trimmedProductId;
        } else {
          // PER_PRODUCT or PER_IMAGE with sku grouping: use "product_id::sku" format
          effectiveProductKey = `${trimmedProductId}::${trimmedSku}`;
        }
        effectiveProductId = trimmedProductId;
        effectiveSku = trimmedSku;
        effectiveImages = []; // New product, no images yet
        effectiveFields = {}; // New product, no fields yet
      }
    }

    if (!effectiveProductKey) return;

    onConfirm({
      targetTemplateId: selectedTemplate.id,
      targetTemplateName: selectedTemplate.templateName,
      targetPlatform: selectedTemplate.platform,
      targetRowMode: selectedTemplate.rowMode,
      writeMode,
      targetProductKey: effectiveProductKey,
      targetRowIndex: effectiveRowIndex,
      targetRowIndices: effectiveRowIndices,
      targetSku: effectiveSku,
      targetProductId: effectiveProductId,
      targetTitle: effectiveTitle,
      targetCategory: effectiveCategory,
      targetImages: effectiveImages,
      // Add mode specific fields
      addPosition: writeMode === "add" ? addPosition : undefined,
      insertBeforeProductKey: writeMode === "add" && addPosition === "before" ? insertBeforeKey || undefined : undefined,
      // Stage 20: Mark as new product when in add mode
      isNewProduct: writeMode === "add" ? true : undefined,
      // Stage 20: Include target template columns for category slots display
      // Use templateColumns state which comes from fetchSpreadsheetRows (complete data)
      targetTemplateColumns: templateColumns.length > 0 
        ? templateColumns 
        : selectedTemplate.columns?.map((col, idx) => ({
            name: col.name,
            role: col.role || "",
            columnIndex: idx,
          })),
      // Stage 21: Include target product fields for cross-save fieldValues display
      targetFields: effectiveFields,
    });
    onClose();
  };

  const canConfirm = useMemo(() => {
    if (!selectedTemplateId) return false;
    
    if (writeMode === "override") {
      // Override mode: must select a product
      return !!selectedRowKey;
    }
    
    // Add mode: must fill both product_id and sku
    const hasProductId = newProductId.trim() !== "";
    const hasSku = newSku.trim() !== "";
    const hasRequiredFields = hasProductId && hasSku;
    
    // If "before" position, must also select a product to insert before
    if (addPosition === "before") {
      return hasRequiredFields && !!insertBeforeKey;
    }
    
    return hasRequiredFields;
  }, [selectedTemplateId, writeMode, selectedRowKey, newProductId, newSku, addPosition, insertBeforeKey]);

  const totalPages = Math.ceil(total / pageSize);
  const hasProducts = rows.length > 0;

  // Get display name for insert before product
  const insertBeforeDisplayName = useMemo(() => {
    if (!insertBeforeKey) return "";
    const item = rows.find(r => computeProductKey(r, rowMode, groupByField) === insertBeforeKey);
    return item ? getProductDisplayName(item) : insertBeforeKey;
  }, [insertBeforeKey, rows, rowMode, groupByField]);

  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <ModalHeader>
          <ModalTitle>Select Target Spreadsheet</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        {/* Body */}
        <ModalBody>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          {loading ? (
            <LoadingText>Loading spreadsheets...</LoadingText>
          ) : filteredTemplates.length === 0 ? (
            <EmptyState>
              <EmptyText>No spreadsheets available</EmptyText>
              <EmptySubtext>
                {excludeTemplateId
                  ? "No other mapped spreadsheets found."
                  : "No mapped spreadsheets found."}
              </EmptySubtext>
            </EmptyState>
          ) : (
            <TwoPanelLayout>
              {/* Left Panel */}
              <LeftPanel>
                {/* Template Selection */}
                <ExpandableSection>
                  <Label>Target Spreadsheet</Label>
                  <TemplateList>
                    {filteredTemplates.map((t) => (
                      <TemplateItem
                        key={t.id}
                        $selected={selectedTemplateId === t.id}
                        onClick={() => setSelectedTemplateId(t.id)}
                      >
                        <TemplateRadio $selected={selectedTemplateId === t.id}>
                          {selectedTemplateId === t.id && <RadioDot />}
                        </TemplateRadio>
                        <TemplateInfo>
                          <TemplateName $selected={selectedTemplateId === t.id}>
                            {t.templateName}
                          </TemplateName>
                          <TemplateMeta $selected={selectedTemplateId === t.id}>
                            {t.platform} · {t.rowCount} rows
                          </TemplateMeta>
                        </TemplateInfo>
                      </TemplateItem>
                    ))}
                  </TemplateList>
                </ExpandableSection>

                {/* Write Mode */}
                {selectedTemplateId && (
                  <Section>
                    <Label>Write Mode</Label>
                    <WriteModeList>
                      {/* Add as New Row */}
                      <WriteModeItem
                        $selected={writeMode === "add"}
                        onClick={() => setWriteMode("add")}
                      >
                        <WriteModeRadio $selected={writeMode === "add"}>
                          {writeMode === "add" && <RadioDot />}
                        </WriteModeRadio>
                        <WriteModeContent>
                          <WriteModeLabel $selected={writeMode === "add"}>
                            Add a New Product
                          </WriteModeLabel>
                          <WriteModeDesc $selected={writeMode === "add"}>
                            Create new product entry
                          </WriteModeDesc>
                        </WriteModeContent>
                      </WriteModeItem>

                      {/* Add Mode Sub-options */}
                      {writeMode === "add" && (
                        <SubOptionsContainer>
                          <SubOption onClick={() => setAddPosition("last")}>
                            <SubRadioCircle $selected={addPosition === "last"}>
                              {addPosition === "last" && <SubRadioDot />}
                            </SubRadioCircle>
                            <SubOptionText>Add as last row</SubOptionText>
                          </SubOption>

                          <SubOption onClick={() => setAddPosition("before")}>
                            <SubRadioCircle $selected={addPosition === "before"}>
                              {addPosition === "before" && <SubRadioDot />}
                            </SubRadioCircle>
                            <SubOptionText>
                              Add before{" "}
                              {insertBeforeKey ? (
                                <SelectedProductBadge>{insertBeforeDisplayName}</SelectedProductBadge>
                              ) : (
                                <SelectHint>(select on right →)</SelectHint>
                              )}
                            </SubOptionText>
                          </SubOption>
                        </SubOptionsContainer>
                      )}

                      {/* Use Existing */}
                      <WriteModeItem
                        $selected={writeMode === "override"}
                        onClick={() => setWriteMode("override")}
                      >
                        <WriteModeRadio $selected={writeMode === "override"}>
                          {writeMode === "override" && <RadioDot />}
                        </WriteModeRadio>
                        <WriteModeContent>
                          <WriteModeLabel $selected={writeMode === "override"}>
                            Select a Product
                          </WriteModeLabel>
                          <WriteModeDesc $selected={writeMode === "override"}>
                            Work with existing product's images
                          </WriteModeDesc>
                        </WriteModeContent>
                      </WriteModeItem>
                    </WriteModeList>
                  </Section>
                )}
              </LeftPanel>

              {/* Right Panel - Products */}
              <RightPanel>
                {selectedTemplateId && (hasProducts || loadingProducts) && (
                  <RightSection>
                    <Label>
                      {writeMode === "override" 
                        ? "Select Existing Product" 
                        : addPosition === "before"
                          ? "Select Product to Insert Before"
                          : "Existing Products"}
                    </Label>
                    
                    {/* Search */}
                    <SearchRow>
                      <SearchInput
                        type="text"
                        placeholder="Search by SKU, title..."
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        disabled={loadingProducts}
                      />
                      <SearchButton onClick={handleSearchSubmit} disabled={loadingProducts}>
                        <SearchIcon>⌕</SearchIcon>
                      </SearchButton>
                    </SearchRow>

                    {/* Product List */}
                    <ProductList>
                      {loadingProducts ? (
                        <LoadingText>Loading products...</LoadingText>
                      ) : (
                        rows.map((item) => {
                          const rowKey = computeProductKey(item, rowMode, groupByField);
                          // Selection logic depends on mode
                          const isSelected = writeMode === "override" 
                            ? selectedRowKey === rowKey 
                            : (addPosition === "before" && insertBeforeKey === rowKey);
                          const effectiveImages = getEffectiveImages(item, exportOverrides, rowMode, groupByField);
                          const imageCount = effectiveImages.length;
                          const firstImage = effectiveImages[0]?.url;
                          // Use displayName format: "product_id sku"
                          const displayName = getProductDisplayName(item);
                          // Check if product has updates
                          const hasUpdates = isProductUpdated(item);

                          return (
                            <ProductItem
                              key={rowKey}
                              $selected={isSelected}
                              $clickable={writeMode === "override" || addPosition === "before"}
                              onClick={() => handleRowClick(item)}
                            >
                              {/* Thumbnail */}
                              <ProductThumbnail>
                                {firstImage ? (
                                  <ThumbnailImage src={getProxiedImageUrl(firstImage)} alt="" />
                                ) : (
                                  <ThumbnailPlaceholder>No image</ThumbnailPlaceholder>
                                )}
                              </ProductThumbnail>
                              
                              {/* Info */}
                              <ProductInfo>
                                <ProductSKURow>
                                  <ProductSKU $selected={isSelected}>
                                    {displayName}
                                  </ProductSKU>
                                  {hasUpdates && <UpdatedTag>Updated</UpdatedTag>}
                                </ProductSKURow>
                                {item.fields.product_title && (
                                  <ProductTitle $selected={isSelected}>
                                    {item.fields.product_title}
                                  </ProductTitle>
                                )}
                                <ProductMeta $selected={isSelected}>
                                  {item.fields.category && <span>{item.fields.category}</span>}
                                  <span>{imageCount} images</span>
                                </ProductMeta>
                              </ProductInfo>

                              {/* Checkbox - only show when clickable */}
                              {(writeMode === "override" || addPosition === "before") && (
                                <SelectCheckbox $selected={isSelected}>
                                  {isSelected && <CheckIcon>✓</CheckIcon>}
                                </SelectCheckbox>
                              )}
                            </ProductItem>
                          );
                        })
                      )}
                    </ProductList>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <Pagination>
                        <PaginationButton
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1 || loadingProducts}
                        >
                          Previous
                        </PaginationButton>
                        <PageInfo>
                          Page {page} of {totalPages}
                        </PageInfo>
                        <PaginationButton
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages || loadingProducts}
                        >
                          Next
                        </PaginationButton>
                      </Pagination>
                    )}

                    {/* New Product Fields - For Add mode (below product list) */}
                    {writeMode === "add" && (
                      <NewProductSection>
                        <NewProductFields>
                          <FieldGroup>
                            <FieldLabel>Product ID <RequiredMark>*</RequiredMark></FieldLabel>
                            <ProductKeyInput
                              type="text"
                              value={newProductId}
                              onChange={(e) => setNewProductId(e.target.value)}
                              placeholder={placeholderHints.productId}
                            />
                          </FieldGroup>
                          <FieldGroup>
                            <FieldLabel>SKU <RequiredMark>*</RequiredMark></FieldLabel>
                            <ProductKeyInput
                              type="text"
                              value={newSku}
                              onChange={(e) => setNewSku(e.target.value)}
                              placeholder={placeholderHints.sku}
                            />
                          </FieldGroup>
                        </NewProductFields>
                        <ProductKeyHint>
                          Both fields are required to create a new product.
                        </ProductKeyHint>
                      </NewProductSection>
                    )}
                  </RightSection>
                )}

                {/* Override mode with empty template */}
                {selectedTemplateId && writeMode === "override" && !hasProducts && !loadingProducts && (
                  <EmptyState>
                    <EmptyText>No products to override</EmptyText>
                    <EmptySubtext>
                      Switch to "Add" mode to create new products.
                    </EmptySubtext>
                  </EmptyState>
                )}

                {/* Add mode with last position and empty template */}
                {selectedTemplateId && writeMode === "add" && addPosition === "last" && !hasProducts && !loadingProducts && (
                  <Section>
                    <Label>New Product</Label>
                    <NewProductFields>
                      <FieldGroup>
                        <FieldLabel>Product ID <RequiredMark>*</RequiredMark></FieldLabel>
                        <ProductKeyInput
                          type="text"
                          value={newProductId}
                          onChange={(e) => setNewProductId(e.target.value)}
                          placeholder={placeholderHints.productId}
                        />
                      </FieldGroup>
                      <FieldGroup>
                        <FieldLabel>SKU <RequiredMark>*</RequiredMark></FieldLabel>
                        <ProductKeyInput
                          type="text"
                          value={newSku}
                          onChange={(e) => setNewSku(e.target.value)}
                          placeholder={placeholderHints.sku}
                        />
                      </FieldGroup>
                    </NewProductFields>
                    <ProductKeyHint>
                      This spreadsheet has no products yet. Both fields are required.
                    </ProductKeyHint>
                  </Section>
                )}
              </RightPanel>
            </TwoPanelLayout>
          )}
        </ModalBody>

        {/* Footer */}
        <ModalFooter>
          <FooterSpacer />
          <CancelButton onClick={onClose}>Cancel</CancelButton>
          <ConfirmButton disabled={!canConfirm} onClick={handleConfirm}>
            Confirm
          </ConfirmButton>
        </ModalFooter>
      </Modal>
    </Overlay>
  );
}

// ============================================================
// Styled Components - Matching SpreadsheetProductModal
// ============================================================

const Overlay = styled.div`
  position: fixed;
  inset: 0;
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
  width: 900px;
  height: 750px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px 20px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalTitle = styled.h2`
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
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
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const FooterSpacer = styled.div`
  flex: 1;
`;

const TwoPanelLayout = styled.div`
  display: grid;
  grid-template-columns: 380px 440px;
  gap: 28px;
  flex: 1;
  min-height: 0;
`;

const LeftPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-height: 0;
`;

const RightPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
`;

/* Right panel section that takes full height */
const RightSection = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`;

/* Section that expands to fill available space */
const ExpandableSection = styled(Section)`
  flex: 1;
`;

const Label = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

// Template List
const TemplateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 120px;
  max-height: 280px;
  overflow-y: auto;
`;

const TemplateItem = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const TemplateRadio = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.border};
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
  background: ${({ theme }) => theme.colors.white};
`;

const TemplateInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const TemplateName = styled.div<{ $selected: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TemplateMeta = styled.div<{ $selected: boolean }>`
  font-size: 12px;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.muted};
  margin-top: 2px;
`;

// Write Mode
const WriteModeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const WriteModeItem = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const WriteModeRadio = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  transition: all 0.2s;
`;

const WriteModeContent = styled.div`
  flex: 1;
`;

const WriteModeLabel = styled.div<{ $selected: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.text};
`;

const WriteModeDesc = styled.div<{ $selected: boolean }>`
  font-size: 12px;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.muted};
  margin-top: 2px;
`;

// Sub-options for Add mode (matching SaveToSpreadsheetModal style)
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
  border: 2px solid ${({ theme }) => theme.colors.accent};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.accent : "transparent")};
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
  background: ${({ theme }) => theme.colors.white};
`;

const SubOptionText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
`;

const SelectedProductBadge = styled.span`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SelectHint = styled.span`
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
`;

// New Product Fields
const NewProductFields = styled.div`
  display: flex;
  flex-direction: row;
  gap: 12px;
`;

const FieldGroup = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FieldLabel = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const RequiredMark = styled.span`
  color: #e53935;
`;

// Search
const SearchRow = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
`;

const SearchInput = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 10px 14px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const SearchButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const SearchIcon = styled.span`
  font-size: 18px;
  color: ${({ theme }) => theme.colors.white};
  line-height: 1;
`;

// Product List - Matching SpreadsheetProductModal
const ProductList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const ProductItem = styled.div<{ $selected: boolean; $clickable?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: ${({ $clickable }) => ($clickable !== false ? "pointer" : "default")};
  transition: all 0.2s;

  &:hover {
    opacity: ${({ $clickable }) => ($clickable !== false ? 0.9 : 1)};
  }
`;

const ProductThumbnail = styled.div`
  width: 64px;
  height: 64px;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.border};
`;

const ThumbnailImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ThumbnailPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
`;

const ProductInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ProductSKU = styled.div<{ $selected: boolean }>`
  font-size: 15px;
  font-weight: 800;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
`;

const ProductSKURow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const UpdatedTag = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  background: ${({ theme }) => theme.colors.white};
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
`;

const ProductTitle = styled.div<{ $selected: boolean }>`
  font-size: 14px;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ProductMeta = styled.div<{ $selected: boolean }>`
  font-size: 12px;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.muted};
  display: flex;
  gap: 10px;
`;

const SelectCheckbox = styled.div<{ $selected: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
`;

const CheckIcon = styled.span`
  color: ${({ theme }) => theme.colors.accent};
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
`;

// Pagination - Matching SpreadsheetProductModal
const Pagination = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 12px;
`;

const PaginationButton = styled.button`
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.accent};
    color: ${({ theme }) => theme.colors.white};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const PageInfo = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
  white-space: nowrap;
`;

const ProductKeyInput = styled.input`
  width: 100%;
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px 14px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }
`;

const ProductKeyHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: 6px;
`;

// New Product Section (for right panel, below product list)
const NewProductSection = styled.div`
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 16px;

  &::before,
  &::after {
    content: "";
    flex: 1;
    height: 1px;
    background: ${({ theme }) => theme.colors.border};
  }
`;

// Empty & Loading States
const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  gap: 8px;
`;

const EmptyText = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptySubtext = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const LoadingText = styled.div`
  text-align: center;
  padding: 48px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.muted};
`;

const ErrorMessage = styled.div`
  background: #fee;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  color: #c33;
  font-size: 14px;
`;

// Buttons - Matching SpreadsheetProductModal
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

const ConfirmButton = styled.button`
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