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
  SpreadsheetResultScenario,
  RowMode,
  buildProductInfoFromFields,
} from "../lib/api";
import { getProxiedImageUrl } from "../lib/imageProxy";
import type { ProductInfo } from "../lib/api";
import { applySpreadsheetResultsToRows, mergeNewProductsIntoRows } from "../lib/spreadsheetOverlay";

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
  
  // Unified images array with original column name as label
  images: Array<{
    url: string;
    label: string;      // Original column name
    colIndex: number;   // Column position
  }>;
  
  // Template columns for displaying all categories (including empty ones)
  templateColumns?: Array<{
    name: string;
    role: string;
  }>;
  
  // P1b: Product info for description generation
  productInfo?: ProductInfo;
}

interface SpreadsheetProductModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  // Updated to include product list and selected index for navigation
  onSelect: (
    selection: SpreadsheetSelection, 
    items?: SpreadsheetRowItem[], 
    selectedIndex?: number
  ) => void;
  // Initial selection to sync with current product (for Change button)
  initialSelection?: SpreadsheetSelection | null;
}

// Image entry type
interface ImageEntry {
  url: string;
  label: string;
  colIndex: number;
}

// Helper function to calculate image counts from images array
function getImageCountsFromImages(images: ImageEntry[] = []) {
  const totalCount = images.length;
  const uniqueCount = new Set(images.map(img => img.url)).size;
  return { totalCount, uniqueCount };
}

// Helper to extract images from override (handles both old string[] and new {images, categories} formats)
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

// Helper function to compute productKey based on rowMode and groupByField
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
  // PER_IMAGE mode
  const productId = item.fields.product_id || "";
  const sku = item.fields.sku || "";
  
  if (groupByField === "sku") {
    // Group by product_id + sku combination
    if (productId && sku) {
      return `${productId}::${sku}`;
    }
    return sku || productId || item.key || "";
  }
  // Default: group by product_id only
  return productId || sku || item.key || "";
}

// Helper function to get effective images (from exportOverrides if available)
function getEffectiveImages(
  item: SpreadsheetRowItem,
  exportOverrides: Record<string, any>,
  rowMode: RowMode,
  groupByField: "sku" | "product_id" = "product_id"
): ImageEntry[] {
  // For new products (rowIndex = -1), use item.key directly since it matches the override key
  const isNewProduct = item.rowIndex === -1;
  const productKey = isNewProduct ? (item.key || "") : computeProductKey(item, rowMode, groupByField);
  
  console.log(`[getEffectiveImages] rowMode=${rowMode}, productKey=${productKey}, rowIndex=${item.rowIndex}, isNewProduct=${isNewProduct}`);
  
  const override = exportOverrides[productKey];
  const overrideUrls = getOverrideImages(override);
  const overrideCategories = getOverrideCategories(override);
  
  if (overrideUrls && overrideUrls.length > 0) {
    console.log(`[getEffectiveImages] Using ${overrideUrls.length} images from exportOverrides with ${overrideCategories.length} categories`);
    // Convert URLs to ImageEntry format with correct categories
    return overrideUrls.map((url, idx) => {
      // Extract label from category token (e.g., "col:主图（URL）地址" -> "主图（URL）地址")
      const categoryToken = overrideCategories[idx] || "";
      const label = categoryToken.startsWith("col:") ? categoryToken.substring(4) : categoryToken || "Image";
      return { url, label, colIndex: -1 };
    });
  }
  
  // Use original row data (including images set in createNewProductRowItem for new products)
  if (item.fields.images && item.fields.images.length > 0) {
    console.log(`[getEffectiveImages] Using ${item.fields.images.length} images from row data`);
    return item.fields.images;
  }
  
  console.log(`[getEffectiveImages] No images found`);
  return [];
}

// Helper to extract categories from override
function getOverrideCategories(override: any): string[] {
  if (!override) return [];
  if (Array.isArray(override)) return [];  // Old format: no categories
  if (override.categories && Array.isArray(override.categories)) return override.categories;
  return [];
}

export default function SpreadsheetProductModal({
  isOpen,
  userId,
  onClose,
  onSelect,
  initialSelection,
}: SpreadsheetProductModalProps) {
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<SpreadsheetRowItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rowMode, setRowMode] = useState<RowMode>("PER_PRODUCT");
  const [groupByField, setGroupByField] = useState<"sku" | "product_id">("product_id");
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<SpreadsheetResultScenario[]>([]);
  const [exportOverrides, setExportOverrides] = useState<Record<string, any>>({});
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, DescriptionOverrides>>({});
  
  // Track previous template ID to detect template changes
  const prevTemplateIdRef = React.useRef<string>("");

  const pageSize = 20;

  // Sort templates by updatedAt (most recent first) and filter by mapped status
  const sortedTemplates = useMemo(() => {
    return templates
      .filter(t => t.status === "mapped")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [templates]);

  // Load templates on mount
  useEffect(() => {
    if (!isOpen || !userId) return;

    async function loadTemplates() {
      try {
        setLoading(true);
        setError("");
        const temps = await getUserSpreadsheetTemplates(userId);
        setTemplates(temps);

        if (temps.length === 1) {
          setSelectedTemplateId(temps[0].id);
        }
      } catch (err: any) {
        setError(err.message || "Failed to load templates");
      } finally {
        setLoading(false);
      }
    }

    loadTemplates();
  }, [isOpen, userId]);

  // Sync selection with initialSelection when modal opens (for Change button)
  useEffect(() => {
    if (!isOpen || !initialSelection) return;
    
    // Sync template selection
    if (initialSelection.templateId && initialSelection.templateId !== selectedTemplateId) {
      setSelectedTemplateId(initialSelection.templateId);
    }
    
    // Sync row selection - use the key from initialSelection
    if (initialSelection.key) {
      setSelectedRowKey(initialSelection.key);
      console.log(`[SpreadsheetProductModal] Synced selection from initialSelection: key=${initialSelection.key}`);
    }
  }, [isOpen, initialSelection]); // Re-run when modal opens or initialSelection changes

  // Load rows and overlay when template or searchQuery changes
  useEffect(() => {
    if (!selectedTemplateId) {
      setRows([]);
      setTotal(0);
      setScenarios([]);
      return;
    }

    async function loadRowsWithOverlay() {
      try {
        setLoading(true);
        setError("");

        // Get current template to access groupByField
        const currentTemplate = templates.find(t => t.id === selectedTemplateId);
        const templateGroupByField = (currentTemplate as any)?.groupByField || "product_id";

        // Fetch rows, overlay scenarios, export overrides, and description overrides in parallel
        const [rowsData, scenariosData, overridesData, descOverridesData] = await Promise.all([
          fetchSpreadsheetRows(userId, selectedTemplateId, {
            page,
            pageSize,
            search: searchQuery,
          }),
          fetchSpreadsheetResults(userId, selectedTemplateId),
          getExportOverrides(userId, selectedTemplateId),
          getDescriptionOverrides(userId, selectedTemplateId),
        ]);

        // Apply overlay to rows to get "working view" with groupByField support
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
        setScenarios(scenariosData);
        setExportOverrides(overridesData);
        setDescriptionOverrides(descOverridesData);
        console.log(`[SpreadsheetProductModal] Loaded with groupByField=${templateGroupByField}`);
        console.log(`[SpreadsheetProductModal] exportOverrides keys:`, Object.keys(overridesData));
        console.log(`[SpreadsheetProductModal] descriptionOverrides keys:`, Object.keys(descOverridesData));
        
        // Only reset selectedRowKey when template actually changes (not on pagination/search)
        // This preserves selection when reopening modal with Change button
        const templateChanged = prevTemplateIdRef.current !== "" && prevTemplateIdRef.current !== selectedTemplateId;
        if (templateChanged) {
          setSelectedRowKey(null);
          console.log(`[SpreadsheetProductModal] Template changed, resetting selectedRowKey`);
        }
        prevTemplateIdRef.current = selectedTemplateId;
      } catch (err: any) {
        setError(err.message || "Failed to load products");
      } finally {
        setLoading(false);
      }
    }

    loadRowsWithOverlay();
  }, [selectedTemplateId, page, searchQuery, userId, templates]);

  const handleSearchSubmit = useCallback(() => {
    setSearchQuery(searchInput);
    setPage(1);
  }, [searchInput]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearchSubmit();
    }
  }, [handleSearchSubmit]);

  const handleRowClick = (item: SpreadsheetRowItem) => {
    // Use computeProductKey to handle groupByField correctly
    const key = computeProductKey(item, rowMode, groupByField);
    setSelectedRowKey(key);
  };

  const handleSelectProduct = () => {
    if (!selectedRowKey) return;

    // Use computeProductKey for consistent key comparison
    const selectedIndex = rows.findIndex((item) => 
      computeProductKey(item, rowMode, groupByField) === selectedRowKey
    );

    if (selectedIndex === -1) return;

    const selectedItem = rows[selectedIndex];
    const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
    if (!selectedTemplate) return;

    console.log(`[handleSelectProduct] selectedRowKey=${selectedRowKey}, rowMode=${rowMode}, groupByField=${groupByField}`);

    // P1b: Build productInfo from the selected item's fields
    const productInfo = buildProductInfoFromFields(selectedItem.fields);

    // Get effective images (from exportOverrides if available)
    const effectiveImages = getEffectiveImages(selectedItem, exportOverrides, rowMode, groupByField);
    console.log(`[handleSelectProduct] Got ${effectiveImages.length} images`);

    // Use computeProductKey for consistent key calculation
    const selectionKey = computeProductKey(selectedItem, rowMode, groupByField);

    const selection: SpreadsheetSelection = {
      templateId: selectedTemplateId,
      templateName: selectedTemplate.templateName,
      rowMode,
      key: selectionKey,
      rowIndex: selectedItem.rowIndex,
      rowIndices: selectedItem.rowIndices,
      sku: selectedItem.fields.sku,
      productId: selectedItem.fields.product_id,
      title: selectedItem.fields.product_title,
      category: selectedItem.fields.category,
      // Unified images array
      images: effectiveImages,
      // Template columns for displaying all categories (including empty ones)
      templateColumns: selectedTemplate.columns?.map(col => ({
        name: col.name,
        role: col.role || "",
      })),
      // P1b: Include productInfo for description generation
      productInfo,
    };

    // Pass the rows array and selected index for navigation support
    onSelect(selection, rows, selectedIndex);
  };

  // Check if product has any updates (scenarios, export overrides, or description overrides)
  const isProductUpdated = useCallback((item: SpreadsheetRowItem): boolean => {
    const productKey = computeProductKey(item, rowMode, groupByField);
    
    // Check if has overlay from scenarios (AI generated images)
    // Directly check the scenarios array for any matching productKey
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

  if (!isOpen) return null;

  const totalPages = Math.ceil(total / pageSize);

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        {/* Header with bottom border */}
        <ModalHeader>
          <ModalTitle>Select Spreadsheet Product</ModalTitle>
          <CloseButton onClick={onClose}>×</CloseButton>
        </ModalHeader>

        <ModalBody>
          {error && <ErrorMessage>{error}</ErrorMessage>}

          {sortedTemplates.length === 0 && !loading ? (
            <EmptyState>
              <EmptyText>No ready spreadsheet templates found.</EmptyText>
              <EmptySubtext>
                Please complete the field mapping for your templates first.
              </EmptySubtext>
            </EmptyState>
          ) : (
            <>
              {/* Template selector - sorted by most recently updated */}
              <Section>
                <Label>Template</Label>
                <Select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    setPage(1);
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  disabled={loading}
                >
                  <option value="">Select a template...</option>
                  {sortedTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.templateName} ({t.platform}, {t.rowMode === "PER_IMAGE" ? "Per-Image" : "Per-Product"})
                    </option>
                  ))}
                </Select>
              </Section>

              {/* Search with circular button */}
              {selectedTemplateId && (
                <Section>
                  <Label>Search</Label>
                  <SearchRow>
                    <SearchInput
                      type="text"
                      placeholder="Search by SKU, product title, category..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={handleSearchKeyDown}
                      disabled={loading}
                    />
                    <SearchButton onClick={handleSearchSubmit} disabled={loading}>
                      <SearchIcon>⌕</SearchIcon>
                    </SearchButton>
                  </SearchRow>
                </Section>
              )}

              {/* Row list */}
              {selectedTemplateId && (
                <RowList>
                  {loading ? (
                    <LoadingText>Loading products...</LoadingText>
                  ) : rows.length === 0 ? (
                    <EmptyText>No products found.</EmptyText>
                  ) : (
                    rows.map((item, index) => {
                      // Use computeProductKey for consistent key format
                      const rowKey = computeProductKey(item, rowMode, groupByField);
                      const isSelected = selectedRowKey === rowKey;
                      
                      // Calculate total and unique image counts
                      const effectiveImages = getEffectiveImages(item, exportOverrides, rowMode, groupByField);
                      const { totalCount, uniqueCount } = getImageCountsFromImages(effectiveImages);
                      
                      // Check if product has any updates
                      const hasUpdates = isProductUpdated(item);

                      return (
                        <RowItem
                          key={rowKey}
                          $selected={isSelected}
                          onClick={() => handleRowClick(item)}
                        >
                          <ProductThumbnail>
                            {effectiveImages.length > 0 ? (
                              <ThumbnailImage src={getProxiedImageUrl(effectiveImages[0].url)} alt="" />
                            ) : (
                              <ThumbnailPlaceholder>No image</ThumbnailPlaceholder>
                            )}
                          </ProductThumbnail>
                          <RowContent>
                            <RowMain>
                              <RowSKU $selected={isSelected}>{item.fields.sku || item.fields.product_id || "N/A"}</RowSKU>
                              {hasUpdates && <UpdatedTag>Updated</UpdatedTag>}
                              {item.fields.product_title && (
                                <RowTitle $selected={isSelected}>{item.fields.product_title}</RowTitle>
                              )}
                            </RowMain>
                            <RowMeta $selected={isSelected}>
                              {item.fields.category && (
                                <MetaItem>{item.fields.category}</MetaItem>
                              )}
                              {item.fields.price != null && (
                                <MetaItem>${item.fields.price}</MetaItem>
                              )}
                            </RowMeta>
                            <RowImages $selected={isSelected}>
                              {totalCount === uniqueCount ? (
                                // No duplicates - show simple count
                                <>{totalCount} images</>
                              ) : (
                                // Has duplicates - show both total and unique
                                <>
                                  {totalCount} total · <UniqueCount $selected={isSelected}>{uniqueCount} distinct</UniqueCount>
                                </>
                              )}
                            </RowImages>
                          </RowContent>
                          <SelectCheckbox $selected={isSelected}>
                            {isSelected && <CheckIcon>✓</CheckIcon>}
                          </SelectCheckbox>
                        </RowItem>
                      );
                    })
                  )}
                </RowList>
              )}
            </>
          )}
        </ModalBody>

        {/* Footer with top border and pagination centered */}
        <ModalFooter>
          <CancelButton onClick={onClose}>Cancel</CancelButton>
          
          {selectedTemplateId && totalPages > 1 ? (
            <Pagination>
              <PaginationButton
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
              >
                Previous
              </PaginationButton>
              <PageInfo>
                Page {page} of {totalPages}
              </PageInfo>
              <PaginationButton
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
              >
                Next
              </PaginationButton>
            </Pagination>
          ) : (
            <FooterSpacer />
          )}

          <SelectButton 
            onClick={handleSelectProduct} 
            disabled={!selectedRowKey || loading}
          >
            Use product
          </SelectButton>
        </ModalFooter>
      </Modal>
    </Overlay>
  );
}

/* Styled Components */
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
  width: 100%;
  max-width: 640px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

/* Header with bottom border - like CsvTemplatesPage */
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
  padding: 24px 28px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  font-weight: 700;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const Select = styled.select`
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 10px 12px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const SearchRow = styled.div`
  display: flex;
  gap: 8px;
`;

const SearchInput = styled.input`
  flex: 1;
  background: ${({ theme }) => theme.colors.inner};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 10px 12px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* Circular search button */
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
    cursor: not-allowed;
  }
`;

const SearchIcon = styled.span`
  font-size: 18px;
  color: ${({ theme }) => theme.colors.white};
  line-height: 1;
`;

const RowList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 200px;
`;

/* Row item - selected uses accent, unselected uses inner */
const RowItem = styled.div<{ $selected: boolean }>`
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  &:hover {
    opacity: 0.9;
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

const RowContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const RowMain = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const RowSKU = styled.div<{ $selected?: boolean }>`
  font-weight: 800;
  font-size: 15px;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.text};
`;

const RowTitle = styled.div<{ $selected?: boolean }>`
  font-size: 14px;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.text};
`;

// Updated tag - same style as SpreadsheetResultsModal
const UpdatedTag = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  background: ${({ theme }) => theme.colors.white};
  padding: 2px 8px;
  border-radius: 10px;
  flex-shrink: 0;
`;

const RowMeta = styled.div<{ $selected?: boolean }>`
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.muted};
`;

const MetaItem = styled.span``;

const RowImages = styled.div<{ $selected?: boolean }>`
  font-size: 12px;
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.muted};
`;

// Highlight the unique count to make it stand out
const UniqueCount = styled.span<{ $selected?: boolean }>`
  color: ${({ theme, $selected }) => $selected ? theme.colors.white : theme.colors.accent};
  font-weight: 600;
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

/* Footer with top border - like CsvTemplatesPage */
const ModalFooter = styled.div`
  display: flex;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  align-items: center;
`;

const FooterSpacer = styled.div`
  flex: 1;
`;

const Pagination = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
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

/* Cancel button - matching SkuRuleModal */
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

const SelectButton = styled.button`
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