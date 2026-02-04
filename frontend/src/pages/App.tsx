import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import styled from "styled-components";
import { doc, getDoc, setDoc, updateDoc, Firestore } from "firebase/firestore";
import { db } from "../lib/firebase";
import LeftPanel, { ImageData, SpreadsheetSelection, SpreadsheetImageItem } from "../components/LeftPanel";
import PromptCard from "../components/PromptCard";
import type { AspectRatio, Resolution } from "../components/PromptCard";
import { getImageDimensions } from "../components/PromptCard";
import { SkuRule } from "../components/SkuRuleModal";
import ResultColumn from "../components/ResultColumn";
import ImagePreview from "../components/ImagePreview";
import AlertModal from "../components/AlertModal";
import SpreadsheetProductModal from "../components/SpreadsheetProductModal";
import { ScenarioAppliedPayload } from "../components/SaveToSpreadsheetModal";
import TargetSpreadsheetModal, { TargetSpreadsheetConfig } from "../components/TargetSpreadsheetModal";
import { generateImages, generateImagesWithProgress, ImageGenerationStage, getUserSpreadsheetTemplates, fetchSpreadsheetRows, getExportOverrides, saveExportOverride, getDescriptionOverrides, DescriptionOverrides, SpreadsheetRowItem, SpreadsheetContext, PlatformType, buildProductInfoFromFields, DescriptionType, saveDescriptionOverride, templatePlatformToPlatformType, ExportOverrideValue, ProductInfo, ImageEntry, normalizeDescriptionType } from "../lib/api";

// Helper function to extract URLs from unified images array
function getAllImageUrls(images: ImageEntry[] | undefined): string[] {
  if (!images || images.length === 0) return [];
  return images.map(img => img.url);
}
import { getSpreadsheetById, SpreadsheetTemplate } from "../lib/spreadsheetTemplateUtils";
import { downloadImage, downloadMultiple, DownloadMetadata } from "../lib/downloadUtils";
import { loadImagesFromUrls, clearImageCache } from "../lib/spreadsheetImageLoader";
import { processImageFiles } from "../lib/imageUtils";
import {
  ToggleWrapper,
  ToggleTrack,
  ToggleThumb,
  ToggleLabelLeft,
  ToggleLabelRight,
} from "../styles/layout";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import {
  getUserSkuTemplates,
  saveSkuTemplate,
  setActiveTemplate as setActiveTemplateInFirebase,
} from "../lib/skuTemplateUtils";

type WorkMode = "import" | "create";
type GenStrategy = "auto" | "manual";
type SkuMode = "rule" | "direct";
type SaveTargetMode = "original" | "different" | "default";

export default function App() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [workMode, setWorkMode] = useState<WorkMode>("create");
  
  // Panel collapsed states (Result starts collapsed, Prompt starts expanded)
  const [resultPanelCollapsed, setResultPanelCollapsed] = useState(true);
  const [promptPanelCollapsed, setPromptPanelCollapsed] = useState(false);
  
  // ========== Mode-specific state management ==========
  // Each mode (Import/Create) maintains its own independent state
  interface ModeState {
    spreadsheetSelection: SpreadsheetSelection | null;
    mainPhotos: ImageData[];
    refImages: ImageData[];
    allSpreadsheetImageUrls: string[];
    panelActiveImageUrls: string[];
    exportImageItems: SpreadsheetImageItem[];
    generationHiddenIds: Set<string>;
    productList: SpreadsheetRowItem[];
    currentProductIndex: number;
    currentTemplateId: string;
    currentSpreadsheetTemplate: SpreadsheetTemplate | null;
    productCategory: string;
    mainPrompt: string;
    variations: string[];
    results: any;
    cachedExportOverrides: Record<string, ExportOverrideValue>;
    cachedDescriptionOverrides: Record<string, DescriptionOverrides>;
    lastLoadedTemplateId: string;
    isCategoryDirty: boolean;
    isPromptDirty: boolean;
    skuDirectInput: string;
    savedSkuName: string;
    // Description settings
    seoEnabled: boolean;
    geoEnabled: boolean;
    gsoEnabled: boolean;
    tagsEnabled: boolean;
    metaTitleEnabled: boolean;
    metaDescriptionEnabled: boolean;
    seoTitleEnabled: boolean;
    seoPlatform: PlatformType;
    geoPlatform: PlatformType;
    gsoPlatform: PlatformType;
    // SKU settings
    skuEnabled: boolean;
    skuMode: SkuMode;
    directInputAddSequence: boolean;
    directInputSeqDigits: number;
    downloadCounter: number;
    // Spreadsheet toggle (Create mode can toggle, Import always true)
    useSpreadsheetProducts: boolean;
    // Output settings
    aspectRatio: AspectRatio;
    resolution: Resolution;
    // Target selection state
    saveTargetMode: SaveTargetMode;
    targetConfig: TargetSpreadsheetConfig | null;
    // ✅ FIX: Separate descriptions by saveTargetMode
    sourceDescriptions: Record<string, string | null>;
    targetDescriptions: Record<string, string | null>;
    // ✅ FIX: Track platform used during generation for each save target
    sourceContentPlatform: PlatformType | null;
    targetContentPlatform: PlatformType | null;
  }
  
  // Store state snapshots for each mode
  const importModeStateRef = useRef<ModeState | null>(null);
  const createModeStateRef = useRef<ModeState | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [imageGenerationStage, setImageGenerationStage] = useState<ImageGenerationStage>('idle');
  const [textIsReady, setTextIsReady] = useState(false);
  const [alert, setAlert] = useState<{
    title?: string;
    message?: string;
    showLoginBtn?: boolean;
    showCancel?: boolean;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({});
  const [results, setResults] = useState<any>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  
  // ✅ FIX: Separate descriptions storage by saveTargetMode
  // sourceDescriptions: for original (Import) or default (Create) mode
  // targetDescriptions: for different (cross-save or Create with target) mode
  const [sourceDescriptions, setSourceDescriptions] = useState<Record<string, string | null>>({});
  const [targetDescriptions, setTargetDescriptions] = useState<Record<string, string | null>>({});

  // ✅ FIX: Track platform used during generation for each save target
  // Allows correct platform display when switching between scenarios:
  //   Create+default, Create+different, Import+original, Import+different
  const [sourceContentPlatform, setSourceContentPlatform] = useState<PlatformType | null>(null);
  const [targetContentPlatform, setTargetContentPlatform] = useState<PlatformType | null>(null);

  const [mainPhotos, setMainPhotos] = useState<ImageData[]>([]);
  const [refImages, setRefImages] = useState<ImageData[]>([]);
  
  // ✅ FIX: Separate resultURLsRef for each mode to prevent cross-mode cleanup
  const importModeResultURLsRef = useRef<string[]>([]);
  const createModeResultURLsRef = useRef<string[]>([]);
  // Legacy ref - now points to current mode's ref
  const resultURLsRef = useRef<string[]>([]);

  const [productCategory, setProductCategory] = useState("");
  const [mainPrompt, setMainPrompt] = useState("");
  const [variations, setVariations] = useState<string[]>([]);

  const [genCount, setGenCount] = useState(4);
  const [genStrategy, setGenStrategy] = useState<GenStrategy>("auto");
  
  // Description states (SEO/GEO/GSO)
  const [seoEnabled, setSeoEnabled] = useState(false);
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [gsoEnabled, setGsoEnabled] = useState(false);
  
  // Phase 2: Extended description fields
  const [tagsEnabled, setTagsEnabled] = useState(false);
  const [metaTitleEnabled, setMetaTitleEnabled] = useState(false);
  const [metaDescriptionEnabled, setMetaDescriptionEnabled] = useState(false);
  const [seoTitleEnabled, setSeoTitleEnabled] = useState(false);
  
  // Custom fields with enableGeneration (non-standard fields)
  const [customFieldsEnabled, setCustomFieldsEnabled] = useState<Record<string, boolean>>({});
  
  // P1b: Platform selection for descriptions
  const [seoPlatform, setSeoPlatform] = useState<PlatformType>("generic");
  const [geoPlatform, setGeoPlatform] = useState<PlatformType>("generic");
  const [gsoPlatform, setGsoPlatform] = useState<PlatformType>("generic");

  // SKU states
  const [skuEnabled, setSkuEnabled] = useState(false);
  const [skuMode, setSkuMode] = useState<SkuMode>("rule");
  const [skuTemplates, setSkuTemplates] = useState<Record<string, SkuRule>>({});
  const [activeTemplate, setActiveTemplate] = useState<string>("");
  const [skuVariableValues, setSkuVariableValues] = useState<Record<string, string>>({});
  const [skuDirectInput, setSkuDirectInput] = useState("");
  const [savedSkuName, setSavedSkuName] = useState<string>("");
  
  // Direct Input sequence number states
  const [directInputAddSequence, setDirectInputAddSequence] = useState(false);
  const [directInputSeqDigits, setDirectInputSeqDigits] = useState(3);
  
  // Rule-Based sequence number override (undefined means use template default)
  const [ruleBasedSeqDigits, setRuleBasedSeqDigits] = useState<number | undefined>(undefined);
  
  // Global download counter for sequential SKU numbering
  const [downloadCounter, setDownloadCounter] = useState(1);
  
  // Output settings
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<Resolution>("1024");
  // ✅ Shadow refs: always hold latest values so mode-switch save never uses stale closure
  const aspectRatioRef = useRef(aspectRatio);
  const resolutionRef = useRef(resolution);
  useEffect(() => { aspectRatioRef.current = aspectRatio; }, [aspectRatio]);
  useEffect(() => { resolutionRef.current = resolution; }, [resolution]);

  // Spreadsheet product selection states
  const [useSpreadsheetProducts, setUseSpreadsheetProducts] = useState(false); // Default false for create mode (default)
  const [spreadsheetSelection, setSpreadsheetSelection] = useState<SpreadsheetSelection | null>(null);
  const [showSpreadsheetModal, setShowSpreadsheetModal] = useState(false);
  const [hasTemplates, setHasTemplates] = useState(false);
  
  // Save target configuration
  const [saveTargetMode, setSaveTargetMode] = useState<SaveTargetMode>("default");
  const [targetConfig, setTargetConfig] = useState<TargetSpreadsheetConfig | null>(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetSpreadsheetTemplate, setTargetSpreadsheetTemplate] = useState<SpreadsheetTemplate | null>(null);
  // Stage 21: Target description overrides for cross-save fieldValues display
  const [targetDescriptionOverrides, setTargetDescriptionOverrides] = useState<Record<string, DescriptionOverrides>>({});
  
  // Store all image URLs from current product (not sliced) - for PER_IMAGE mode
  const [allSpreadsheetImageUrls, setAllSpreadsheetImageUrls] = useState<string[]>([]);
  
  // PER_IMAGE: LeftPanel "去重前, hide 后"的真实列表, 用于 SaveTo 的 Replace #N 映射
  const [panelActiveImageUrls, setPanelActiveImageUrls] = useState<string[]>([]);
  
  // Target template active image URLs (after hiding) - for cross-save
  const [targetActiveImageUrls, setTargetActiveImageUrls] = useState<string[]>([]);
  
  
  // ========== PER_PRODUCT: Two separate data paths ==========
  // 
  // Path A: Export/Result Truth (exportImageItems)
  //   - Source: original row images + categories, merged with exportOverride if exists
  //   - Only modified by: ResultsModal, SaveToSpreadsheetModal
  //   - Used for: export, ResultsModal display, saving overrides
  //
  // Path B: Generation Input Filter (generationHiddenIds)
  //   - LeftPanel × only modifies this
  //   - Does NOT affect exportImageItems or Firestore
  //   - Used for: filtering which images to use for generation
  
  // Export truth: the complete set of images for export (not affected by LeftPanel ×)
  const [exportImageItems, setExportImageItems] = useState<SpreadsheetImageItem[]>([]);
  
  // Generation filter: IDs hidden in LeftPanel (doesn't delete from export, just hides for generation)
  const [generationHiddenIds, setGenerationHiddenIds] = useState<Set<string>>(new Set());
  
  // Track which image URLs were used in the last generation (for visual indicator)
  // Source panel (spreadsheet images)
  const [usedForGenerationUrls, setUsedForGenerationUrls] = useState<Set<string>>(new Set());
  // Target panel (Different mode images)
  const [targetUsedForGenerationUrls, setTargetUsedForGenerationUrls] = useState<Set<string>>(new Set());
  
  // Trigger to restore hidden images in LeftPanel after generation completes
  const [restoreTrigger, setRestoreTrigger] = useState(0);
  
  // Visible items for LeftPanel (export items minus hidden)
  const visibleImageItems = useMemo(() => 
    exportImageItems.filter(item => !generationHiddenIds.has(item.id)), 
    [exportImageItems, generationHiddenIds]
  );
  
  // Panel visible IDs - for SaveToSpreadsheetModal to map panel position to export index
  // IMPORTANT: Must match LeftPanel's deduped display order!
  // LeftPanel shows deduped images, so panelVisibleIds must also be deduped by URL
  const panelVisibleIds = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of visibleImageItems) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        result.push(item.id);  // Keep first occurrence's ID for each unique URL
      }
    }
    return result;
  }, [visibleImageItems]);
  
  // Debug: log panelVisibleIds whenever it changes
  useEffect(() => {
    if (panelVisibleIds.length > 0 && exportImageItems.length > 0) {
      const mapping = panelVisibleIds.map((id, idx) => {
        const item = exportImageItems.find(e => e.id === id);
        const exportIdx = exportImageItems.findIndex(e => e.id === id);
        return `panel[${idx}] = export[${exportIdx}]: ${item?.url?.substring(0, 50) || 'NOT_FOUND'}...`;
      });
      console.log(`[App] panelVisibleIds updated:`, {
        count: panelVisibleIds.length,
        exportCount: exportImageItems.length,
        hiddenCount: generationHiddenIds.size,
        mapping,
      });
    }
  }, [panelVisibleIds, exportImageItems, generationHiddenIds]);
  
  // Export arrays for SaveToSpreadsheetModal (complete export truth, including hidden)
  const exportImages = useMemo(() => 
    exportImageItems.map(item => item.url), [exportImageItems]);
  const exportCategories = useMemo(() => 
    exportImageItems.map(item => item.categoryToken), [exportImageItems]);
  const exportIds = useMemo(() => 
    exportImageItems.map(item => item.id), [exportImageItems]);
  
  // ========== Navigation Blocking: Warn when leaving with unsaved changes ==========
  // Detect if there's any non-empty state that would be lost on navigation
  const hasUnsavedChanges = useMemo(() => {
    // Check for uploaded images (Create mode)
    if (mainPhotos.length > 0) return true;
    // Check for reference images
    if (refImages.length > 0) return true;
    // Check for generation results
    if (results && results.urls && results.urls.length > 0) return true;
    // Check for spreadsheet selection (Import mode)
    if (spreadsheetSelection) return true;
    // Check for prompt content
    if (mainPrompt.trim().length > 0) return true;
    // Check for variations
    if (variations.length > 0 && variations.some(v => v.trim().length > 0)) return true;
    // Check for product category
    if (productCategory.trim().length > 0) return true;
    // Check for descriptions
    if (Object.values(sourceDescriptions).some(d => d && d.trim().length > 0)) return true;
    if (Object.values(targetDescriptions).some(d => d && d.trim().length > 0)) return true;
    
    return false;
  }, [mainPhotos, refImages, results, spreadsheetSelection, mainPrompt, variations, productCategory, sourceDescriptions, targetDescriptions]);
  
  // Browser beforeunload event for page refresh/close/external navigation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Skip if user already confirmed leaving via AlertModal
      if ((window as any).__imageflowSkipBeforeUnload) {
        return;
      }
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ""; // Required for Chrome
        return ""; // Required for some browsers
      }
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);
  
  // Expose hasUnsavedChanges to window for NavBar to check during in-app navigation
  useEffect(() => {
    (window as any).__imageflowHasUnsavedChanges = () => hasUnsavedChanges;
    return () => {
      delete (window as any).__imageflowHasUnsavedChanges;
    };
  }, [hasUnsavedChanges]);
  
  // Derived arrays for backward compatibility (from exportImageItems, not filtered)
  const activeSpreadsheetImages = useMemo(() => 
    exportImageItems.map(item => item.url), [exportImageItems]);
  const activeSpreadsheetCategories = useMemo(() => 
    exportImageItems.map(item => item.categoryToken), [exportImageItems]);
  
  // Cache export overrides for current template
  // Value can be either new format { images, categories } or old format string[]
  const [cachedExportOverrides, setCachedExportOverrides] = useState<Record<string, ExportOverrideValue>>({});
  // Cache description overrides for current template
  const [cachedDescriptionOverrides, setCachedDescriptionOverrides] = useState<Record<string, DescriptionOverrides>>({});
  const [lastLoadedTemplateId, setLastLoadedTemplateId] = useState<string>("");
  
  // Helper function to extract images from export override (handles both old and new formats)
  const getOverrideImages = (override: ExportOverrideValue | undefined): string[] => {
    if (!override) return [];
    if (Array.isArray(override)) return override;  // Old format: string[]
    if (override.images && Array.isArray(override.images)) return override.images;  // New format
    return [];
  };
  
  // Helper function to extract categories from export override
  const getOverrideCategories = (override: ExportOverrideValue | undefined): string[] => {
    if (!override) return [];
    if (Array.isArray(override)) return [];  // Old format: no categories
    if (override.categories && Array.isArray(override.categories)) return override.categories;
    return [];
  };
  
  /**
   * Compute productKey based on rowMode and groupByField
   * For PER_PRODUCT: use row-based key
   * For PER_IMAGE with groupByField="product_id": use productId
   * For PER_IMAGE with groupByField="sku": use productId::sku combination
   */
  const computeProductKey = useCallback((
    rowMode: "PER_PRODUCT" | "PER_IMAGE",
    productId: string | undefined,
    sku: string | undefined,
    key: string,
    groupByField: "sku" | "product_id" = "product_id"
  ): string => {
    if (rowMode === "PER_PRODUCT") {
      return key;
    }
    // PER_IMAGE mode
    const pid = productId || "";
    const s = sku || "";
    if (groupByField === "sku") {
      // Group by product_id + sku combination
      if (pid && s) {
        return `${pid}::${s}`;
      }
      return s || pid || key;
    }
    // Default: group by product_id only
    return pid || s || key;
  }, []);
  
  /**
   * Build SpreadsheetImageItem array with stable unique IDs.
   * id format: `${productKey}|${categoryToken}|${indexInCategory}|${urlHash}`
   * The urlHash ensures that when an image is replaced, the ID changes,
   * which triggers cache invalidation and UI update.
   */
  const buildImageItems = useCallback((
    productKey: string,
    urls: string[],
    categories: string[]
  ): SpreadsheetImageItem[] => {
    // Count occurrences per category to generate unique index within each category
    const categoryCounters: Record<string, number> = {};
    
    // Simple hash function for URL (last 8 chars of URL to make ID somewhat stable but change on replace)
    const hashUrl = (url: string) => {
      // Use last part of URL (filename) as hash to detect replacements
      const parts = url.split('/');
      const filename = parts[parts.length - 1] || '';
      return filename.slice(0, 12).replace(/[^a-zA-Z0-9]/g, '');
    };
    
    return urls.map((url, idx) => {
      const categoryToken = categories[idx] || "col:Image";
      const categoryIndex = categoryCounters[categoryToken] || 0;
      categoryCounters[categoryToken] = categoryIndex + 1;
      
      // Include URL hash in ID so replacements are detected
      const urlHash = hashUrl(url);
      
      return {
        id: `${productKey}|${categoryToken}|${categoryIndex}|${urlHash}`,
        url,
        categoryToken,
      };
    });
  }, []);
  
  // Track current product list and index for navigation
  const [productList, setProductList] = useState<SpreadsheetRowItem[]>([]);
  const [currentProductIndex, setCurrentProductIndex] = useState(-1);
  const [currentTemplateId, setCurrentTemplateId] = useState<string>("");
  
  // Current spreadsheet template (with columns info for field validation)
  const [currentSpreadsheetTemplate, setCurrentSpreadsheetTemplate] = useState<SpreadsheetTemplate | null>(null);
  
  // Stage 14: Field values for ResultColumn collapsible display
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  
  // Ref to skip useEffect when description is just saved (avoid overwriting immediate update)
  const skipFieldValuesEffectRef = useRef(false);
  
  // Ref to track current product index for callbacks (avoids stale closure)
  const currentProductIndexRef = useRef(currentProductIndex);
  useEffect(() => {
    currentProductIndexRef.current = currentProductIndex;
  }, [currentProductIndex]);

  // Stage 14: Update fieldValues when product changes
  // FIXED: Only show fields that have enableGeneration=true in template step4
  // Also uses saved descriptionOverrides if available (to show AI-generated content)
  // Stage 21: In cross-save mode, use target template's fields and description overrides
  useEffect(() => {
    // Skip this effect if we just saved a description (to preserve immediate UI update)
    if (skipFieldValuesEffectRef.current) {
      skipFieldValuesEffectRef.current = false;
      return;
    }
    
    // Determine if we're in cross-save mode
    const isCrossSave = saveTargetMode === "different" && targetConfig && targetSpreadsheetTemplate;
    
    // In cross-save mode, use target data; otherwise use source data
    if (isCrossSave) {
      // Cross-save mode: use target product fields and target template columns
      const values: Record<string, string> = {};
      const targetFields = targetConfig.targetFields || {};
      const targetProductKey = targetConfig.targetProductKey;
      
      // Get saved description overrides for target product
      const savedDescriptions = targetDescriptionOverrides[targetProductKey] || {};
      
      // Use target template columns to determine which fields to show
      if (targetSpreadsheetTemplate?.columns) {
        targetSpreadsheetTemplate.columns.forEach(col => {
          // Only include fields where enableGeneration is explicitly true
          if (col.role && col.enableGeneration === true) {
            // Priority: 1) saved description override, 2) original target field value
            let fieldValue: string | undefined;
            
            // First check if there's a saved override for this field
            const savedValue = (savedDescriptions as Record<string, string | undefined>)[col.role];
            if (savedValue !== undefined && savedValue !== "") {
              fieldValue = savedValue;
            } else {
              // Fall back to target product's original data
              fieldValue = targetFields[col.role];
              
              // If not found directly, check in attributes
              if (fieldValue === undefined && targetFields.attributes) {
                fieldValue = targetFields.attributes[col.role];
              }
            }
            
            // Only add to values if there's actual content
            if (fieldValue && typeof fieldValue === 'string' && fieldValue.trim()) {
              values[col.role] = fieldValue;
            } else if (typeof fieldValue === 'number') {
              values[col.role] = String(fieldValue);
            }
          }
        });
      }
      
      setFieldValues(values);
      return;
    }
    
    // Normal mode: use source data
    if (currentProductIndex < 0 || !productList[currentProductIndex]) {
      setFieldValues({});
      return;
    }
    
    const item = productList[currentProductIndex];
    const values: Record<string, string> = {};
    
    // Compute productKey to look up descriptionOverrides
    const groupByField = (currentSpreadsheetTemplate as any)?.groupByField || "product_id";
    const rowMode = spreadsheetSelection?.rowMode || "PER_PRODUCT";
    const productKey = computeProductKey(
      rowMode,
      item.fields.product_id,
      item.fields.sku,
      item.key || `row-${item.rowIndex}`,
      groupByField
    );
    
    // Get saved description overrides for this product
    const savedDescriptions = cachedDescriptionOverrides[productKey] || {};
    
    // Only extract fields that have enableGeneration=true in the template columns
    // This matches what user selected in CSV template step4 "AI Generation" settings
    if (currentSpreadsheetTemplate?.columns) {
      currentSpreadsheetTemplate.columns.forEach(col => {
        // Only include fields where enableGeneration is explicitly true
        if (col.role && col.enableGeneration === true) {
          // Priority: 1) saved description override, 2) original field value
          let fieldValue: string | undefined;
          
          // First check if there's a saved override for this field
          // API now returns normalized keys (full role names like 'seo_description')
          const savedValue = (savedDescriptions as Record<string, string | undefined>)[col.role];
          if (savedValue !== undefined && savedValue !== "") {
            fieldValue = savedValue;
          } else {
            // Fall back to original data
            // Check direct field access first
            fieldValue = (item.fields as any)[col.role];
            
            // If not found directly, check in attributes
            if (fieldValue === undefined && item.fields.attributes) {
              fieldValue = item.fields.attributes[col.role];
            }
          }
          
          // Only add to values if there's actual content
          if (fieldValue && typeof fieldValue === 'string' && fieldValue.trim()) {
            values[col.role] = fieldValue;
          } else if (typeof fieldValue === 'number') {
            values[col.role] = String(fieldValue);
          }
        }
      });
    }
    
    setFieldValues(values);
  }, [currentProductIndex, productList, currentSpreadsheetTemplate, cachedDescriptionOverrides, spreadsheetSelection?.rowMode, computeProductKey, saveTargetMode, targetConfig, targetSpreadsheetTemplate, targetDescriptionOverrides]);

  // P1a: Dirty state tracking for auto-fill
  const [isCategoryDirty, setIsCategoryDirty] = useState(false);
  const [isPromptDirty, setIsPromptDirty] = useState(false);

  useEffect(() => {
    return () => {
      // Cleanup all blob URLs on unmount
      importModeResultURLsRef.current.forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      createModeResultURLsRef.current.forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  // ✅ FIX: Only cleanup current mode's results, not both modes
  const cleanupOldResults = useCallback(() => {
    const currentRef = workMode === "import" ? importModeResultURLsRef : createModeResultURLsRef;
    currentRef.current.forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
    currentRef.current = [];
  }, [workMode]);

  // Load user data and SKU templates from subcollection
  useEffect(() => {
    if (!user?.uid || !db) return;
    
    const loadUserData = async () => {
      try {
        const userRef = doc(db as Firestore, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const data = userSnap.data();
          
          if (data.activeSkuTemplate) {
            setActiveTemplate(data.activeSkuTemplate);
          }
          
          if (data.currentSkuValues) {
            setSkuVariableValues(data.currentSkuValues);
            if (data.currentSkuValues.baseSkuName) {
              setSavedSkuName(data.currentSkuValues.baseSkuName);
            }
          }
        }
        
        const templates = await getUserSkuTemplates(user.uid);
        setSkuTemplates(templates);
        console.log("[App] Loaded SKU templates:", Object.keys(templates));
        
      } catch (error) {
        console.error("Failed to load user data:", error);
      }
    };
    
    loadUserData();
  }, [user?.uid]);

  // Check if user has any mapped spreadsheet templates
  useEffect(() => {
    if (!user?.uid) {
      setHasTemplates(false);
      return;
    }

    async function checkTemplates() {
      if (!user?.uid) return;
      
      try {
        const templates = await getUserSpreadsheetTemplates(user.uid);
        setHasTemplates(templates.length > 0);
      } catch (err) {
        console.error("Failed to check spreadsheet templates:", err);
        setHasTemplates(false);
      }
    }

    checkTemplates();
  }, [user?.uid]);

  // Load target spreadsheet template when targetConfig changes
  useEffect(() => {
    if (!user?.uid || !targetConfig?.targetTemplateId) {
      setTargetSpreadsheetTemplate(null);
      setTargetDescriptionOverrides({});
      return;
    }

    async function loadTargetTemplate() {
      try {
        const [template, descOverrides] = await Promise.all([
          getSpreadsheetById(user!.uid, targetConfig!.targetTemplateId),
          getDescriptionOverrides(user!.uid, targetConfig!.targetTemplateId),
        ]);
        setTargetSpreadsheetTemplate(template);
        setTargetDescriptionOverrides(descOverrides || {});
        console.log(`[App] Loaded target template: ${template?.templateName}`);
        console.log(`[App] Loaded target description overrides: ${Object.keys(descOverrides || {}).length} products`);
        
        // Update targetConfig.targetTemplateColumns with complete columns from loaded template
        // This ensures LeftPanel can display all image categories (including empty ones)
        if (template?.columns && template.columns.length > 0) {
          const currentColumns = targetConfig?.targetTemplateColumns || [];
          const newColumns = template.columns.map((col: any, idx: number) => ({
            name: col.name,
            role: col.role || "",
            columnIndex: idx,
          }));
          
          // Only update if columns are different (more complete)
          const currentImageCols = currentColumns.filter((c: any) => c.role === "image_url").length;
          const newImageCols = newColumns.filter((c: any) => c.role === "image_url").length;
          
          if (newImageCols > currentImageCols) {
            console.log(`[App] Updating targetConfig.targetTemplateColumns: ${currentImageCols} -> ${newImageCols} image columns`);
            setTargetConfig(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                targetTemplateColumns: newColumns,
              };
            });
          }
        }
      } catch (err) {
        console.error("[App] Failed to load target template:", err);
        setTargetSpreadsheetTemplate(null);
        setTargetDescriptionOverrides({});
      }
    }

    loadTargetTemplate();
  }, [user?.uid, targetConfig?.targetTemplateId]);

  // Create mode: Clear descriptions when switching to a different target table
  // This prevents showing mismatched generated content from Default Export mode
  const prevTargetTemplateIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (workMode === "create") {
      const currentTargetId = targetConfig?.targetTemplateId;
      const prevTargetId = prevTargetTemplateIdRef.current;
      
      // If switching from no target to a target, or from one target to another
      if (currentTargetId && currentTargetId !== prevTargetId) {
        console.log(`[App] Create mode: target table changed, clearing descriptions`);
        // Clear only descriptions, keep images
        setResults((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            descriptions: {},
          };
        });
      }
      
      prevTargetTemplateIdRef.current = currentTargetId;
    }
  }, [workMode, targetConfig?.targetTemplateId]);

  // Compute effective template for ResultColumn display
  // When targeting a different spreadsheet, use target template's fields/platform
  const effectiveTemplate = useMemo(() => {
    if (saveTargetMode === "different" && targetSpreadsheetTemplate) {
      return targetSpreadsheetTemplate;
    }
    return currentSpreadsheetTemplate;
  }, [saveTargetMode, targetSpreadsheetTemplate, currentSpreadsheetTemplate]);

  // Sync platform when effective template or saveTargetMode changes
  // Recorded generation platform takes priority over template default
  useEffect(() => {
    const recordedPlatform = saveTargetMode === "different"
      ? targetContentPlatform
      : sourceContentPlatform;

    if (recordedPlatform !== null) {
      // Restore the platform that was used during generation for this scenario
      setSeoPlatform(recordedPlatform);
      setGeoPlatform(recordedPlatform);
      setGsoPlatform(recordedPlatform);
      console.log(`[App] Platform restored from generation (saveTargetMode=${saveTargetMode}): ${recordedPlatform}`);
    } else if (effectiveTemplate?.platform) {
      // Fall back to template platform when no generation has occurred yet
      const templatePlatform = templatePlatformToPlatformType(effectiveTemplate.platform);
      setSeoPlatform(templatePlatform);
      setGeoPlatform(templatePlatform);
      setGsoPlatform(templatePlatform);
      console.log(`[App] Platform synced to effective template: ${templatePlatform}`);
    }
    // If neither exists (Create mode without template, no generation), keep current platform
  }, [effectiveTemplate?.platform, saveTargetMode, sourceContentPlatform, targetContentPlatform]);

  // ✅ FIX: Auto-sync enabled states when effectiveTemplate changes
  // When switching saveTargetMode (Original ↔ Different), the effective template changes.
  // The enabled states (seoEnabled, tagsEnabled, customFieldsEnabled, etc.) must reflect
  // the new template's enableGeneration flags, otherwise generation will only include
  // fields from the previous template.
  //
  // ✅ CRITICAL FIX: Reset ALL standard fields to false FIRST, then enable only those
  // present in the template. Without this, fields from the previous scenario (e.g. GEO, GSO)
  // that don't exist in the new template remain enabled and get sent to generation.
  //
  // Also saves manual enabled states when entering template mode (Create → Different)
  // and restores them when returning to non-template mode (Different → Download Only).
  const prevEffectiveTemplateIdRef = useRef<string | undefined>(undefined);
  const savedManualEnabledStatesRef = useRef<{
    seo: boolean; geo: boolean; gso: boolean;
    tags: boolean; metaTitle: boolean; metaDesc: boolean; seoTitle: boolean;
    custom: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    const templateId = (effectiveTemplate as any)?.id || effectiveTemplate?.templateName;
    const prevId = prevEffectiveTemplateIdRef.current;
    prevEffectiveTemplateIdRef.current = templateId;

    // No change — skip
    if (templateId === prevId) return;

    // Case 1: Template became null/undefined (e.g. switching back to Download Only in Create mode)
    if (!templateId || !effectiveTemplate?.columns) {
      if (savedManualEnabledStatesRef.current) {
        const s = savedManualEnabledStatesRef.current;
        setSeoEnabled(s.seo);
        setGeoEnabled(s.geo);
        setGsoEnabled(s.gso);
        setTagsEnabled(s.tags);
        setMetaTitleEnabled(s.metaTitle);
        setMetaDescriptionEnabled(s.metaDesc);
        setSeoTitleEnabled(s.seoTitle);
        setCustomFieldsEnabled(s.custom);
        savedManualEnabledStatesRef.current = null;
        console.log(`[App] effectiveTemplate cleared, restored pre-sync enabled states`);
      }
      return;
    }

    console.log(`[App] effectiveTemplate changed: ${prevId} → ${templateId}, auto-syncing enabled states`);

    // Case 2: Going from no-template to template — save current manual states for later restore
    // (prevId is undefined/null = user was in a mode without template, e.g. Create Download Only)
    if (!prevId) {
      savedManualEnabledStatesRef.current = {
        seo: seoEnabled, geo: geoEnabled, gso: gsoEnabled,
        tags: tagsEnabled, metaTitle: metaTitleEnabled,
        metaDesc: metaDescriptionEnabled, seoTitle: seoTitleEnabled,
        custom: { ...customFieldsEnabled },
      };
      console.log(`[App] Saved manual enabled states before template sync`);
    }

    // ✅ FIX: In Create mode, do NOT auto-enable description fields when a target
    // template is selected. The user controls descriptions via the Product Descriptions
    // toggle in ResultColumn. Without this guard, selecting a target template silently
    // enables seoEnabled/tagsEnabled/etc., causing descriptions to generate even though
    // the toggle appears OFF.
    if (workMode === 'create') {
      console.log(`[App] Create mode: skipping auto-enable of description fields`);
      return;
    }

    // ✅ CRITICAL: Reset ALL standard fields to false first.
    // Fields not present in the new template MUST be disabled.
    setSeoEnabled(false);
    setGeoEnabled(false);
    setGsoEnabled(false);
    setTagsEnabled(false);
    setMetaTitleEnabled(false);
    setMetaDescriptionEnabled(false);
    setSeoTitleEnabled(false);

    // Standard role → setter mapping
    const standardRoleMap: Record<string, (v: boolean) => void> = {
      seo_description: setSeoEnabled,
      ai_seo_description: setSeoEnabled,
      geo_description: setGeoEnabled,
      ai_geo_description: setGeoEnabled,
      gso_description: setGsoEnabled,
      ai_gso_description: setGsoEnabled,
      tags: setTagsEnabled,
      meta_title: setMetaTitleEnabled,
      meta_description: setMetaDescriptionEnabled,
      seo_title: setSeoTitleEnabled,
    };
    // Identity / image roles to skip
    const skipRoles = new Set(["sku", "product_id", "ignore", "image_url", "image_position"]);

    const newCustomFields: Record<string, boolean> = {};

    // Enable only fields that exist in the template with enableGeneration=true
    for (const col of effectiveTemplate.columns) {
      if (!col.role || skipRoles.has(col.role)) continue;
      const enabled = col.enableGeneration === true;

      if (standardRoleMap[col.role]) {
        standardRoleMap[col.role](enabled);
      } else {
        // Custom field
        newCustomFields[col.role] = enabled;
      }
    }

    setCustomFieldsEnabled(newCustomFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplate]);

  // P1a: Auto-fill category when spreadsheet product is selected
  // ✅ FIX: Also react to saveTargetMode changes — use target data in "different" mode
  useEffect(() => {
    if (!useSpreadsheetProducts) return;

    // Determine the effective product data based on saveTargetMode
    let category: string | undefined;

    if (saveTargetMode === "different" && targetConfig) {
      // Different mode: use target product's data
      category = targetConfig.targetCategory;
    } else if (spreadsheetSelection) {
      // Default/Original mode: use source product's data
      category = spreadsheetSelection.category;
    }

    // Auto-fill category if user hasn't typed anything manually yet
    if (!isCategoryDirty && category && category.trim()) {
      setProductCategory(category);
    }

    // NOTE: Removed auto-fill for mainPrompt - user prefers to enter prompts manually
  }, [
    useSpreadsheetProducts,
    spreadsheetSelection?.key, // change when user selects a new product
    spreadsheetSelection?.category,
    saveTargetMode, // ✅ react to save target mode changes
    targetConfig?.targetCategory, // ✅ react to target product changes
    isCategoryDirty,
  ]);

  // ✅ FIX: Reset dirty flags when saveTargetMode changes so auto-fill can kick in
  const prevSaveTargetModeRef = useRef(saveTargetMode);
  useEffect(() => {
    if (saveTargetMode !== prevSaveTargetModeRef.current) {
      console.log(`[App] saveTargetMode changed: ${prevSaveTargetModeRef.current} → ${saveTargetMode}, resetting dirty flags`);
      prevSaveTargetModeRef.current = saveTargetMode;
      setIsCategoryDirty(false);
      setIsPromptDirty(false);
    }
  }, [saveTargetMode]);

  // Save template to subcollection
  const handleSkuRuleSave = useCallback(async (rule: SkuRule) => {
    // Check if user is logged in first
    if (!user?.uid) {
      setAlert({
        title: "Sign In Required",
        message: "Please sign in to save your SKU template. Your template will be saved after you log in.",
        showLoginBtn: true,
      });
      return;
    }
    
    if (!db) return;
    
    try {
      await saveSkuTemplate(user.uid, rule, true);
      
      const updatedTemplates = await getUserSkuTemplates(user.uid);
      setSkuTemplates(updatedTemplates);
      setActiveTemplate(rule.templateName);
      
      setSkuVariableValues({});
      setSavedSkuName("");
      
      console.log(`[App] Template "${rule.templateName}" saved successfully`);
      
      setAlert({
        title: "Success",
        message: `Template "${rule.templateName}" saved successfully!`
      });
    } catch (error) {
      console.error("[App] Failed to save SKU template:", error);
      setAlert({
        title: "Save Failed",
        message: "Could not save SKU template. Please try again."
      });
    }
  }, [user?.uid, db]);

  const handleSelectTemplate = useCallback(async (templateName: string) => {
    if (!user?.uid || !db) return;
    
    try {
      await setActiveTemplateInFirebase(user.uid, templateName);
      
      setActiveTemplate(templateName);
      setSkuVariableValues({});
      setSavedSkuName("");
      setRuleBasedSeqDigits(undefined); // Reset to use template default
      
      console.log(`Template "${templateName}" selected`);
    } catch (error) {
      console.error("Failed to select template:", error);
    }
  }, [user?.uid, db]);

  const handleSkuVariableChange = useCallback((varId: string, value: string) => {
    setSkuVariableValues((prev) => ({
      ...prev,
      [varId]: value,
    }));
    setSavedSkuName("");
  }, []);

  const isSeqVariable = (varId: string, varName: string) => {
    return varId === "seq_num" || varName.toLowerCase().includes("seq");
  };

  const handleSaveSkuName = useCallback(async () => {
    if (!user?.uid || !db) return;
    
    let baseName = "";
    let seqDigitsToSave = 3;
    
    if (skuMode === "direct") {
      // Direct Input mode: use skuDirectInput directly
      if (!skuDirectInput.trim()) return;
      baseName = skuDirectInput.trim();
      seqDigitsToSave = directInputSeqDigits;
    } else {
      // Rule-Based mode: build from template
      if (!activeTemplate) return;
      const template = skuTemplates[activeTemplate];
      if (!template) return;
      
      baseName = template.prefix;

      if (baseName && template.separator) baseName += template.separator;
      
      const parts: string[] = [];
      
      template.variables.forEach((variable) => {
        if (!isSeqVariable(variable.id, variable.name)) {
          const value = skuVariableValues[variable.id];
          if (value) {
            parts.push(value);
          }
        }
      });
      
      baseName += parts.join(template.separator);
      
      if (template.suffix) {
        if (template.separator) baseName += template.separator;
        baseName += template.suffix;
      }
      
      seqDigitsToSave = ruleBasedSeqDigits ?? template.seqDigits;
    }
    
    try {
      const userRef = doc(db as Firestore, "users", user.uid);
      
      // For Direct Input mode, only save essential fields (clear old Rule-Based variables)
      // Only include seqDigits if sequence number is enabled
      // For Rule-Based mode, include all variable values
      let skuDataToSave;
      if (skuMode === "direct") {
        if (directInputAddSequence) {
          skuDataToSave = {
            templateName: "__direct__",
            baseSkuName: baseName,
            seqDigits: seqDigitsToSave,
            addSequence: true
          };
        } else {
          // No sequence number - don't save seqDigits
          skuDataToSave = {
            templateName: "__direct__",
            baseSkuName: baseName,
            addSequence: false
          };
        }
      } else {
        skuDataToSave = {
          templateName: activeTemplate,
          ...skuVariableValues,
          baseSkuName: baseName,
          seqDigits: seqDigitsToSave
        };
      }
      
      // Use updateDoc to completely replace currentSkuValues (removes old fields)
      await updateDoc(userRef, {
        currentSkuValues: skuDataToSave
      });
      
      setSavedSkuName(baseName);
      console.log(`[App] SKU name saved: ${baseName}`);
      
      setAlert({
        title: "Success",
        message: `SKU name "${baseName}" saved successfully!`
      });
    } catch (error) {
      console.error("[App] Failed to save SKU name:", error);
      setAlert({
        title: "Save Failed",
        message: "Could not save SKU name. Please try again."
      });
    }
  }, [user?.uid, skuMode, skuDirectInput, directInputAddSequence, directInputSeqDigits, ruleBasedSeqDigits, activeTemplate, skuTemplates, skuVariableValues, db]);

  // Handle SKU toggle - clear Firebase data when turning off
  const handleSkuToggle = useCallback(async () => {
    const newEnabled = !skuEnabled;
    setSkuEnabled(newEnabled);
    
    // When turning OFF, clear all SKU-related data from Firebase and local state
    if (!newEnabled && user?.uid && db) {
      try {
        const userRef = doc(db as Firestore, "users", user.uid);
        // Clear currentSkuValues from Firebase completely
        await updateDoc(userRef, {
          currentSkuValues: {}
        });
        console.log("[App] SKU disabled - cleared currentSkuValues from Firebase");
      } catch (error) {
        console.error("[App] Failed to clear SKU values:", error);
      }
      
      // Clear local state
      setSavedSkuName("");
      setSkuDirectInput("");
      setSkuVariableValues({});
      setRuleBasedSeqDigits(undefined);
    }
  }, [skuEnabled, user?.uid, db]);

  // Build selection from a row item
  const buildSelectionFromRow = useCallback((
    item: SpreadsheetRowItem, 
    templateId: string, 
    templateName: string, 
    rowMode: "PER_PRODUCT" | "PER_IMAGE",
    groupByField?: "product_id" | "sku"
  ): SpreadsheetSelection => {
    // IMPORTANT: For PER_PRODUCT mode, use row-based key (e.g., "row-2")
    // For PER_IMAGE mode, use sku/product_id for grouping based on groupByField
    let key: string;
    if (rowMode === "PER_PRODUCT") {
      key = `row-${item.rowIndex}`;
    } else {
      // PER_IMAGE mode
      if (groupByField === "sku") {
        // When grouping by SKU, use product_id::sku format to distinguish variants
        const productId = item.fields.product_id || "";
        const sku = item.fields.sku || "";
        if (productId && sku) {
          key = `${productId}::${sku}`;
        } else {
          key = sku || productId || `row-${item.rowIndex}`;
        }
      } else {
        // Default: group by product_id
        key = item.fields.product_id || item.fields.sku || `row-${item.rowIndex}`;
      }
    }
    
    // Build productInfo from spreadsheet fields for category auto-resolution
    const productInfo: ProductInfo = {
      title: item.fields.product_title,
      category: item.fields.category,
      sku: item.fields.sku,
      description: item.fields.description,
      seoTitle: item.fields.seo_title,
      seoDescription: item.fields.seo_description,
      tags: item.fields.tags ? item.fields.tags.split(",").map(t => t.trim()) : undefined,
      vendor: item.fields.vendor_name,
      attributes: {
        color: item.fields.attr_color,
        size: item.fields.attr_size,
        material: item.fields.attr_material,
        style: item.fields.attr_style,
      },
    };
    
    return {
      templateId,
      templateName,
      rowMode,
      key,
      rowIndex: item.rowIndex,
      rowIndices: item.rowIndices,
      sku: item.fields.sku,
      productId: item.fields.product_id,
      title: item.fields.product_title,
      category: item.fields.category,
      // Unified images array
      images: item.fields.images || [],
      productInfo,
    };
  }, []);

  /**
   * Build initial categories from selection images.
   * Each image's label (original column name) becomes its category token.
   */
  const buildCategoriesFromTemplate = useCallback((
    selection: SpreadsheetSelection
  ): string[] => {
    // Each image has its label (original column name) as category
    if (selection.images && selection.images.length > 0) {
      return selection.images.map(img => `col:${img.label}`);
    }
    return [];
  }, []);

  // Handle spreadsheet product selection - store ALL URLs
  // NOTE: Don't load images here - let LeftPanel's useEffect handle it
  // to avoid race conditions with cache clearing
  const handleSelectProduct = useCallback(
    async (selection: SpreadsheetSelection, items?: SpreadsheetRowItem[], selectedIndex?: number) => {
      try {
        console.log("Selecting spreadsheet product:", selection);

        // ✅ Bug Fix: Clear image cache when selecting a new product to prevent stale cached images
        clearImageCache();
        console.log(`[App] Cleared image cache before loading new product`);

        // Load export overrides, description overrides, and template in parallel
        let overrides: Record<string, ExportOverrideValue> = {};
        let descOverrides: Record<string, DescriptionOverrides> = {};
        let template: SpreadsheetTemplate | null = null;
        if (user?.uid) {
          console.log(`[App] Loading overrides and template for ${selection.templateId}`);
          const [overridesData, descOverridesData, templateData] = await Promise.all([
            getExportOverrides(user.uid, selection.templateId),
            getDescriptionOverrides(user.uid, selection.templateId),
            getSpreadsheetById(user.uid, selection.templateId),
          ]);
          overrides = overridesData;
          descOverrides = descOverridesData;
          template = templateData;
          setCachedExportOverrides(overrides);
          setCachedDescriptionOverrides(descOverrides);
          setLastLoadedTemplateId(selection.templateId);
          setCurrentSpreadsheetTemplate(template);
          
          // Auto-set platform from template (user can still change it manually via dropdown)
          // If there's a recorded generation platform for the current scenario, use that instead
          if (template?.platform) {
            const recordedPlatform = saveTargetMode === "different"
              ? targetContentPlatform
              : sourceContentPlatform;
            
            if (recordedPlatform !== null) {
              setSeoPlatform(recordedPlatform);
              setGeoPlatform(recordedPlatform);
              setGsoPlatform(recordedPlatform);
              console.log(`[App] Platform restored from generation record: ${recordedPlatform} (template: ${template.platform})`);
            } else {
              const templatePlatform = templatePlatformToPlatformType(template.platform);
              setSeoPlatform(templatePlatform);
              setGeoPlatform(templatePlatform);
              setGsoPlatform(templatePlatform);
              console.log(`[App] Auto-set platform to: ${templatePlatform} (from template: ${template.platform})`);
            }
          }
          
          console.log(`[App] Loaded template:`, template?.templateName, `platform:`, template?.platform);
          console.log(`[App] Loaded ${Object.keys(overrides).length} export overrides, ${Object.keys(descOverrides).length} description overrides, template columns:`, template?.columns?.length);
        }

        // Check if this product has saved export overrides
        // Use computeProductKey to handle groupByField correctly
        const groupByField = (template as any)?.groupByField || "product_id";
        const productKey = computeProductKey(
          selection.rowMode,
          selection.productId,
          selection.sku,
          selection.key,
          groupByField
        );
        const savedOverrideImages = getOverrideImages(overrides[productKey]);
        const savedOverrideCategories = getOverrideCategories(overrides[productKey]);
        
        let allUrls: string[];
        let allCategories: string[];
        
        if (savedOverrideImages.length > 0) {
          // Use saved export override images and categories
          allUrls = [...savedOverrideImages];  // Don't dedupe - preserve order for categories
          allCategories = [...savedOverrideCategories];
          console.log(`[App] Using ${allUrls.length} saved images from exportOverrides for ${productKey}`);
        } else {
          // Use original images from spreadsheet
          allUrls = getAllImageUrls(selection.images);
          // Build categories (for PER_PRODUCT mode)
          if (selection.rowMode === "PER_PRODUCT") {
            allCategories = buildCategoriesFromTemplate(selection);
          } else {
            allCategories = [];  // PER_IMAGE mode doesn't use categories
          }
          console.log(`[App] Using ${allUrls.length} original images from spreadsheet for ${productKey}`);
        }
        
        // For PER_PRODUCT: build exportImageItems (export truth)
        // For PER_IMAGE: use simple URL array
        if (selection.rowMode === "PER_PRODUCT") {
          const items = buildImageItems(productKey, allUrls, allCategories);
          setExportImageItems(items);
          // Clear hidden filter when switching products
          setGenerationHiddenIds(new Set());
          console.log(`[App] Built ${items.length} export image items for PER_PRODUCT`);
        } else {
          // PER_IMAGE mode: just store URLs, no items
          setExportImageItems([]);
          setGenerationHiddenIds(new Set());
          setAllSpreadsheetImageUrls(allUrls);
        }

        // Clear mainPhotos - LeftPanel's useEffect will load them
        setMainPhotos([]);
        setPanelActiveImageUrls([]); // Clear - LeftPanel will repopulate via onPanelImagesChange

        // Save selection for display
        setSpreadsheetSelection(selection);
        
        // Store template ID for navigation
        setCurrentTemplateId(selection.templateId);
        
        // Store product list and index if provided
        if (items && selectedIndex !== undefined) {
          setProductList(items);
          setCurrentProductIndex(selectedIndex);
        }

        // P1a: Reset dirty flags when selecting a new product to allow auto-fill
        setIsCategoryDirty(false);
        setIsPromptDirty(false);

        // Close modal
        setShowSpreadsheetModal(false);

        console.log(`[App] Selected product with ${allUrls.length} total images`);
      } catch (err) {
        console.error("Failed to select spreadsheet product:", err);
        setAlert({
          title: "Error",
          message: "Failed to select product from spreadsheet. Please try again."
        });
      }
    },
    [user?.uid]
  );

  // Load images from specific URLs (for pagination)
  const handleLoadMoreImages = useCallback(async (urls: string[]): Promise<ImageData[]> => {
    try {
      const images = await loadImagesFromUrls(urls, processImageFiles);
      return images;
    } catch (err) {
      console.error("Failed to load images:", err);
      return [];
    }
  }, []);

  /**
   * Handle hiding an image item in LeftPanel.
   * This does NOT delete from exportImageItems - just hides for generation input.
   * The image remains in export truth and will be saved to Firestore.
   */
  const handleToggleHideItem = useCallback((itemId: string) => {
    setGenerationHiddenIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
        console.log(`[App] handleToggleHideItem: unhid ${itemId}`);
      } else {
        newSet.add(itemId);
        console.log(`[App] handleToggleHideItem: hid ${itemId}`);
      }
      return newSet;
    });
  }, []);

  // Navigate to previous/next product
  const handleNavigateProduct = useCallback(async (direction: "prev" | "next") => {
    if (!user?.uid || !spreadsheetSelection || productList.length === 0) return;
    
    const newIndex = direction === "prev" 
      ? currentProductIndex - 1 
      : currentProductIndex + 1;
    
    if (newIndex < 0 || newIndex >= productList.length) return;
    
    const newItem = productList[newIndex];
    
    console.log(`[App] handleNavigateProduct: direction=${direction}, newIndex=${newIndex}`);
    console.log(`[App] newItem from productList:`, {
      key: newItem.key,
      sku: newItem.fields.sku,
      images: newItem.fields.images?.length || 0,
    });
    
    // ✅ Bug Fix: Clear image cache when switching products to prevent stale cached images
    // This ensures LeftPanel loads fresh images for the new product, not cached data from previous product
    clearImageCache();
    console.log(`[App] Cleared image cache before navigating to new product`);
    
    // Build selection from the new item
    const newSelection = buildSelectionFromRow(
      newItem,
      spreadsheetSelection.templateId,
      spreadsheetSelection.templateName,
      spreadsheetSelection.rowMode,
      currentSpreadsheetTemplate?.groupByField
    );
    
    console.log(`[App] newSelection built:`, {
      images: newSelection.images?.length || 0,
    });
    
    setCurrentProductIndex(newIndex);
    
    // Check if this product has saved export overrides
    // Use computeProductKey to handle groupByField correctly
    const groupByField = (currentSpreadsheetTemplate as any)?.groupByField || "product_id";
    const productKey = computeProductKey(
      newSelection.rowMode,
      newSelection.productId,
      newSelection.sku,
      newSelection.key,
      groupByField
    );
    const savedOverrideImages = getOverrideImages(cachedExportOverrides[productKey]);
    const savedOverrideCategories = getOverrideCategories(cachedExportOverrides[productKey]);
    
    let allUrls: string[];
    let allCategories: string[];
    
    if (savedOverrideImages.length > 0) {
      // Use saved export override images and categories
      allUrls = [...savedOverrideImages];  // Don't dedupe - preserve order for categories
      allCategories = [...savedOverrideCategories];
      console.log(`[App] Navigate: Using ${allUrls.length} saved images from exportOverrides for ${productKey}`);
    } else {
      // Use original images from spreadsheet
      allUrls = getAllImageUrls(newSelection.images);
      // Build categories (for PER_PRODUCT mode)
      if (newSelection.rowMode === "PER_PRODUCT") {
        allCategories = buildCategoriesFromTemplate(newSelection);
      } else {
        allCategories = [];  // PER_IMAGE mode doesn't use categories
      }
      console.log(`[App] Navigate: Using ${allUrls.length} original images for ${productKey}`);
    }
    
    setAllSpreadsheetImageUrls(allUrls);
    
    // For PER_PRODUCT: build exportImageItems (export truth)
    // For PER_IMAGE: use simple URL array
    if (newSelection.rowMode === "PER_PRODUCT") {
      const items = buildImageItems(productKey, allUrls, allCategories);
      setExportImageItems(items);
      // Clear hidden filter when switching products
      setGenerationHiddenIds(new Set());
      console.log(`[App] Navigate: Built ${items.length} export image items for PER_PRODUCT`);
    } else {
      // PER_IMAGE mode: just store URLs, no items
      setExportImageItems([]);
      setGenerationHiddenIds(new Set());
    }
    
    setMainPhotos([]); // Clear - LeftPanel will load
    setPanelActiveImageUrls([]); // Clear - LeftPanel will repopulate via onPanelImagesChange
    setSpreadsheetSelection(newSelection);

    // P1a: Reset dirty flags when navigating to allow auto-fill
    setIsCategoryDirty(false);
    setIsPromptDirty(false);

    console.log(`[App] Navigated to ${direction} product: ${newSelection.sku || newSelection.productId}`);
  }, [user?.uid, spreadsheetSelection, productList, currentProductIndex, buildSelectionFromRow, cachedExportOverrides, buildCategoriesFromTemplate]);

  // Actually perform the clear operation
  const performClearSpreadsheetSelection = useCallback(() => {
    // === Clear spreadsheet selection state ===
    setSpreadsheetSelection(null);
    setMainPhotos([]);
    setAllSpreadsheetImageUrls([]);
    setPanelActiveImageUrls([]);
    setExportImageItems([]);
    setGenerationHiddenIds(new Set());
    setProductList([]);
    setCurrentProductIndex(-1);
    setCurrentTemplateId("");
    setCurrentSpreadsheetTemplate(null);
    
    // === Clear PromptCard fields ===
    setProductCategory("");
    setMainPrompt("");
    setVariations([]);
    setIsCategoryDirty(false);
    setIsPromptDirty(false);
    
    // === Reset generation settings to defaults ===
    setGenCount(4);
    setGenStrategy("auto");
    
    // === Reset Product Descriptions settings ===
    setSeoEnabled(false);
    setGeoEnabled(false);
    setGsoEnabled(false);
    setTagsEnabled(false);
    setMetaTitleEnabled(false);
    setMetaDescriptionEnabled(false);
    setSeoTitleEnabled(false);
    setSeoPlatform("generic");
    setGeoPlatform("generic");
    setGsoPlatform("generic");
    // Reset recorded generation platforms
    setSourceContentPlatform(null);
    setTargetContentPlatform(null);
    
    // === Reset SKU Label settings ===
    setSkuEnabled(false);
    setSkuMode("rule");
    setSkuDirectInput("");
    setSavedSkuName("");
    setDirectInputAddSequence(false);
    setDirectInputSeqDigits(3);
    
    // === Clear reference images ===
    setRefImages([]);
    
    // === Clear results ===
    setResults(null);
    setDownloadCounter(1);
    
    // ✅ FIX: Clear separate descriptions
    setSourceDescriptions({});
    setTargetDescriptions({});
    
    // === Clear export overrides cache ===
    setCachedExportOverrides({});
    setLastLoadedTemplateId("");
    
    // === Reset spreadsheet toggle (Import stays true, Create resets to false) ===
    if (workMode === "create") {
      setUseSpreadsheetProducts(false);
    }
    
    // === Clear current mode's saved state ref ===
    // So switching modes and back won't restore cleared state
    if (workMode === "import") {
      importModeStateRef.current = null;
    } else {
      createModeStateRef.current = null;
    }
  }, [workMode]);

  // Refresh export overrides cache for current template
  const refreshExportOverrides = useCallback(async () => {
    if (!user?.uid || !currentTemplateId) return;
    
    console.log(`[App] Refreshing export overrides for template ${currentTemplateId}`);
    const overrides = await getExportOverrides(user.uid, currentTemplateId);
    setCachedExportOverrides(overrides);
    console.log(`[App] Refreshed ${Object.keys(overrides).length} export overrides`);
    
    // If we have a current selection, update its images
    if (spreadsheetSelection) {
      // Use computeProductKey to handle groupByField correctly
      const groupByField = (currentSpreadsheetTemplate as any)?.groupByField || "product_id";
      const productKey = computeProductKey(
        spreadsheetSelection.rowMode,
        spreadsheetSelection.productId,
        spreadsheetSelection.sku,
        spreadsheetSelection.key,
        groupByField
      );
      const savedOverrideImages = getOverrideImages(overrides[productKey]);
      
      if (savedOverrideImages.length > 0) {
        // DO NOT dedupe - preserve full array for correct position mapping
        const allUrls = [...savedOverrideImages];
        setAllSpreadsheetImageUrls(allUrls);
        setMainPhotos([]); // Clear - LeftPanel will reload
        console.log(`[App] Updated current product images from refreshed overrides: ${allUrls.length} images (no dedup)`);
      }
    }
  }, [user?.uid, currentTemplateId, spreadsheetSelection, currentSpreadsheetTemplate, computeProductKey]);

  // ========== Handle mode switch with state preservation ==========
  const handleWorkModeChange = useCallback((targetMode: WorkMode) => {
    if (targetMode === workMode) return;
    
    // ✅ CRITICAL FIX: Prevent mode switch during generation
    // This prevents results from appearing in the wrong mode
    if (isLoading) {
      console.log(`[App] Mode switch blocked: generation in progress`);
      return;
    }
    
    // 1. Save current mode's state
    const currentState: ModeState = {
      spreadsheetSelection,
      mainPhotos,
      refImages,
      allSpreadsheetImageUrls,
      panelActiveImageUrls,
      exportImageItems,
      generationHiddenIds,
      productList,
      currentProductIndex,
      currentTemplateId,
      currentSpreadsheetTemplate,
      productCategory,
      mainPrompt,
      variations,
      results,
      cachedExportOverrides,
      cachedDescriptionOverrides,
      lastLoadedTemplateId,
      isCategoryDirty,
      isPromptDirty,
      skuDirectInput,
      savedSkuName,
      seoEnabled,
      geoEnabled,
      gsoEnabled,
      tagsEnabled,
      metaTitleEnabled,
      metaDescriptionEnabled,
      seoTitleEnabled,
      seoPlatform,
      geoPlatform,
      gsoPlatform,
      skuEnabled,
      skuMode,
      directInputAddSequence,
      directInputSeqDigits,
      downloadCounter,
      useSpreadsheetProducts,
      aspectRatio: aspectRatioRef.current,
      resolution: resolutionRef.current,
      saveTargetMode,
      targetConfig,
      // ✅ FIX: Save separate descriptions
      sourceDescriptions,
      targetDescriptions,
      // ✅ FIX: Save recorded generation platforms
      sourceContentPlatform,
      targetContentPlatform,
    };
    
    if (workMode === "import") {
      importModeStateRef.current = currentState;
    } else {
      createModeStateRef.current = currentState;
    }
    
    // 2. Restore target mode's state (or use defaults)
    const targetStateRef = targetMode === "import" ? importModeStateRef : createModeStateRef;
    const savedState = targetStateRef.current;
    
    if (savedState) {
      // Restore saved state
      setSpreadsheetSelection(savedState.spreadsheetSelection);
      setMainPhotos(savedState.mainPhotos);
      setRefImages(savedState.refImages);
      setAllSpreadsheetImageUrls(savedState.allSpreadsheetImageUrls);
      setPanelActiveImageUrls(savedState.panelActiveImageUrls);
      setExportImageItems(savedState.exportImageItems);
      setGenerationHiddenIds(savedState.generationHiddenIds);
      setProductList(savedState.productList);
      setCurrentProductIndex(savedState.currentProductIndex);
      setCurrentTemplateId(savedState.currentTemplateId);
      setCurrentSpreadsheetTemplate(savedState.currentSpreadsheetTemplate);
      setProductCategory(savedState.productCategory);
      setMainPrompt(savedState.mainPrompt);
      setVariations(savedState.variations);
      setResults(savedState.results);
      setCachedExportOverrides(savedState.cachedExportOverrides);
      setCachedDescriptionOverrides(savedState.cachedDescriptionOverrides);
      setLastLoadedTemplateId(savedState.lastLoadedTemplateId);
      setIsCategoryDirty(savedState.isCategoryDirty);
      setIsPromptDirty(savedState.isPromptDirty);
      setSkuDirectInput(savedState.skuDirectInput);
      setSavedSkuName(savedState.savedSkuName);
      setSeoEnabled(savedState.seoEnabled);
      setGeoEnabled(savedState.geoEnabled);
      setGsoEnabled(savedState.gsoEnabled);
      setTagsEnabled(savedState.tagsEnabled);
      setMetaTitleEnabled(savedState.metaTitleEnabled);
      setMetaDescriptionEnabled(savedState.metaDescriptionEnabled);
      setSeoTitleEnabled(savedState.seoTitleEnabled);
      setSeoPlatform(savedState.seoPlatform);
      setGeoPlatform(savedState.geoPlatform);
      setGsoPlatform(savedState.gsoPlatform);
      setSkuEnabled(savedState.skuEnabled);
      setSkuMode(savedState.skuMode);
      setDirectInputAddSequence(savedState.directInputAddSequence);
      setDirectInputSeqDigits(savedState.directInputSeqDigits);
      setDownloadCounter(savedState.downloadCounter);
      // Restore output settings
      setAspectRatio(savedState.aspectRatio || "1:1");
      setResolution(savedState.resolution || "1024");
      // For Import mode, always force true; for Create mode, always false (no spreadsheet in Create)
      setUseSpreadsheetProducts(targetMode === "import");
      // Restore target selection state
      setSaveTargetMode(savedState.saveTargetMode);
      setTargetConfig(savedState.targetConfig);
      // ✅ FIX: Restore separate descriptions
      setSourceDescriptions(savedState.sourceDescriptions || {});
      setTargetDescriptions(savedState.targetDescriptions || {});
      // ✅ FIX: Restore recorded generation platforms
      setSourceContentPlatform(savedState.sourceContentPlatform ?? null);
      setTargetContentPlatform(savedState.targetContentPlatform ?? null);
    } else {
      // Reset to defaults for target mode
      setSpreadsheetSelection(null);
      setMainPhotos([]);
      setRefImages([]);
      setAllSpreadsheetImageUrls([]);
      setPanelActiveImageUrls([]);
      setExportImageItems([]);
      setGenerationHiddenIds(new Set());
      setProductList([]);
      setCurrentProductIndex(-1);
      setCurrentTemplateId("");
      setCurrentSpreadsheetTemplate(null);
      setProductCategory("");
      setMainPrompt("");
      setVariations([]);
      setResults(null);
      setCachedExportOverrides({});
      setCachedDescriptionOverrides({});
      setLastLoadedTemplateId("");
      setIsCategoryDirty(false);
      setIsPromptDirty(false);
      setSkuDirectInput("");
      setSavedSkuName("");
      setSeoEnabled(false);
      setGeoEnabled(false);
      setGsoEnabled(false);
      setTagsEnabled(false);
      setMetaTitleEnabled(false);
      setMetaDescriptionEnabled(false);
      setSeoTitleEnabled(false);
      setSeoPlatform("generic");
      setGeoPlatform("generic");
      setGsoPlatform("generic");
      setSkuEnabled(false);
      setSkuMode("rule");
      setDirectInputAddSequence(false);
      setDirectInputSeqDigits(3);
      setDownloadCounter(1);
      // Reset output settings
      setAspectRatio("1:1");
      setResolution("1024");
      // Import mode: always true; Create mode: default false
      setUseSpreadsheetProducts(targetMode === "import");
      // Target selection defaults
      setSaveTargetMode(targetMode === "import" ? "original" : "default");
      setTargetConfig(null);
      // ✅ FIX: Reset separate descriptions
      setSourceDescriptions({});
      setTargetDescriptions({});
      // ✅ FIX: Reset recorded generation platforms
      setSourceContentPlatform(null);
      setTargetContentPlatform(null);
    }
    
    // 3. Set the new mode
    // ✅ FIX: Clear saved manual states to prevent cross-mode contamination.
    // Without this, Create mode's enabled states could leak into Import mode
    // (or vice versa) via the effectiveTemplate auto-sync restore path.
    savedManualEnabledStatesRef.current = null;
    setWorkMode(targetMode);
    
    console.log(`[App] Switched from ${workMode} to ${targetMode}, state ${savedState ? 'restored' : 'reset to defaults'}`);
  }, [
    workMode, isLoading, spreadsheetSelection, mainPhotos, refImages, allSpreadsheetImageUrls,
    panelActiveImageUrls, exportImageItems, generationHiddenIds, productList,
    currentProductIndex, currentTemplateId, currentSpreadsheetTemplate,
    productCategory, mainPrompt, variations, results, cachedExportOverrides,
    cachedDescriptionOverrides, lastLoadedTemplateId, isCategoryDirty, isPromptDirty, 
    skuDirectInput, savedSkuName,
    seoEnabled, geoEnabled, gsoEnabled, tagsEnabled, metaTitleEnabled,
    metaDescriptionEnabled, seoTitleEnabled, seoPlatform, geoPlatform, gsoPlatform,
    skuEnabled, skuMode, directInputAddSequence, directInputSeqDigits, downloadCounter,
    useSpreadsheetProducts, saveTargetMode, targetConfig, sourceDescriptions, targetDescriptions,
    sourceContentPlatform, targetContentPlatform
  ]);

  // ✅ Auto-expand ResultColumn when content is uploaded (Create mode) or selected (Import mode)
  useEffect(() => {
    // Create mode: expand when product images are uploaded
    if (workMode === 'create' && mainPhotos.length > 0) {
      setResultPanelCollapsed(false);
    }
    // Import mode: expand when spreadsheet product is selected
    if (workMode === 'import' && spreadsheetSelection?.templateId) {
      setResultPanelCollapsed(false);
    }
  }, [workMode, mainPhotos.length, spreadsheetSelection?.templateId]);

  // Clear spreadsheet selection (with confirmation if results exist)
  const handleClearSpreadsheetSelection = useCallback(() => {
    // Always show confirmation - clearing resets everything like a page refresh
    setAlert({
      title: "Clear Selection?",
      message: "This will reset all settings and clear any generated results, similar to refreshing the page. Continue?",
      showCancel: true,
      confirmText: "Clear All",
      cancelText: "Cancel",
      onConfirm: () => {
        performClearSpreadsheetSelection();
        setAlert({});
      },
    });
  }, [performClearSpreadsheetSelection]);

  // Stage 2.5: Handle scenario applied - update frontend overlay state
  const handleScenarioApplied = useCallback((payload: ScenarioAppliedPayload) => {
    const { finalImages, finalCategories, isCrossSave, targetTemplateId, targetProductKey } = payload;
    
    // ✅ Bug Fix: Clear image cache after save to ensure LeftPanel loads fresh images
    // This prevents using stale cached image data when the panel reloads
    clearImageCache();
    
    // Use ref to get latest index (avoids stale closure)
    const index = currentProductIndexRef.current;

    console.log(`[App] handleScenarioApplied called:`, {
      mode: payload.mode,
      finalImagesCount: finalImages.length,
      finalCategoriesCount: finalCategories.length,
      currentProductIndex: index,
      isCrossSave,
      targetTemplateId,
      targetProductKey,
      workMode,
      hasSpreadsheetSelection: !!spreadsheetSelection,
    });

    // Phase 2: For cross-save, new products, or Create mode with targetConfig, update targetConfig instead of source data
    // Note: For new products in same spreadsheet (isCrossSave=false), we still need to update targetConfig
    // Note: In Create mode without spreadsheetSelection, we use targetConfig directly
    const isNewProduct = !!(targetConfig as any)?.isNewProduct;
    const isCreateModeWithTarget = workMode === "create" && !spreadsheetSelection && !!targetConfig;
    
    if ((isCrossSave || isNewProduct || isCreateModeWithTarget) && targetConfig) {
      console.log(`[App] Cross-save/new product/create mode detected, updating targetConfig images`, {
        isCrossSave,
        isNewProduct,
        isCreateModeWithTarget,
      });
      
      // Build new targetImages from finalImages and finalCategories
      const newTargetImages = finalImages.map((url, idx) => {
        // Extract column name from category token (e.g., "col:Image Src" -> "Image Src")
        const category = finalCategories[idx] || "";
        const label = category.startsWith("col:") ? category.substring(4) : category || "Image";
        
        // Find colIndex from targetTemplateColumns
        const colIndex = targetConfig.targetTemplateColumns?.findIndex(
          col => col.name === label && col.role === "image_url"
        ) ?? -1;
        
        return { url, label, colIndex };
      });
      
      // Update targetConfig with new images
      setTargetConfig(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          targetImages: newTargetImages,
        };
      });
      
      console.log(`[App] Updated targetConfig with ${newTargetImages.length} images`);
      
      // Don't update source data for cross-save, new products, or create mode
      return;
    }

    // For PER_PRODUCT mode with finalCategories, use them directly
    // For PER_IMAGE mode, categories are empty
    const isPERProduct = spreadsheetSelection?.rowMode === "PER_PRODUCT";
    
    const allUrls = [...finalImages];
    const allCategories = isPERProduct ? [...finalCategories] : [];
    
    console.log(`[App] Using finalImages: ${allUrls.length} images, ${allCategories.length} categories`);

    // 1) Update allSpreadsheetImageUrls so LeftPanel shows correct images
    setAllSpreadsheetImageUrls(allUrls);
    
    // 1a) Clear mainPhotos to force LeftPanel to reload images from new URLs
    setMainPhotos([]);
    
    // ✅ Bug 3 Fix: Clear panelActiveImageUrls to force LeftPanel to report new images via onPanelImagesChange
    // This ensures the panel correctly reflects the new image count after save
    setPanelActiveImageUrls([]);
    
    // 1b) For PER_PRODUCT: rebuild exportImageItems (export truth) after save
    // IMPORTANT: Clear generationHiddenIds - user completed a save, show all images
    if (isPERProduct && allUrls.length > 0) {
      const productKey = spreadsheetSelection?.key || "";
      
      // Rebuild exportImageItems with new URLs/categories
      const items = buildImageItems(productKey, allUrls, allCategories);
      setExportImageItems(items);
      console.log(`[App] Rebuilt ${items.length} export image items after scenario applied`);
      
      // CLEAR hidden state after save - user completed an action, reset view
      // This ensures all images are visible after replacement
      if (generationHiddenIds.size > 0) {
        console.log(`[App] Clearing generationHiddenIds after save (was ${generationHiddenIds.size} items)`);
        setGenerationHiddenIds(new Set());
      }
    }

    // 2) Update current selection for PER_IMAGE mode
    setSpreadsheetSelection(prev => {
      if (!prev) return prev;
      
      if (prev.rowMode === "PER_PRODUCT") {
        // PER_PRODUCT: keep the original structure, actual data is in exportOverrides
        return prev;
      } else {
        // PER_IMAGE: update with new images array
        // Use first image's label or default to "Image"
        const defaultLabel = prev.images?.[0]?.label || "Image";
        const updatedImages = finalImages.map(url => ({
          url,
          label: defaultLabel,
          colIndex: -1,
        }));
        const updated = {
          ...prev,
          images: updatedImages,
        };
        console.log(`[App] Updated spreadsheetSelection (PER_IMAGE):`, {
          key: updated.key,
          imagesCount: updated.images.length,
        });
        return updated;
      }
    });

    // 3) Update productList (only for PER_IMAGE mode)
    // For PER_PRODUCT, we rely on exportOverrides, not productList
    if (!isPERProduct) {
      setProductList(prev => {
        console.log(`[App] setProductList called (PER_IMAGE):`, {
          prevLength: prev?.length,
          index,
        });
        
        if (!prev || prev.length === 0) return prev;
        if (index < 0 || index >= prev.length) return prev;

        const next = [...prev];
        const item = prev[index];
        if (!item) return prev;

        // Build unified images array from finalImages
        const defaultLabel = item.fields.images?.[0]?.label || "Image";
        const updatedImages = finalImages.map(url => ({
          url,
          label: defaultLabel,
          colIndex: -1,
        }));

        next[index] = {
          ...item,
          fields: {
            ...item.fields,
            images: updatedImages,
          },
        };
        
        return next;
      });
    }

    // 4) Update cachedExportOverrides so navigation uses the new data
    if (spreadsheetSelection) {
      // Use computeProductKey to handle groupByField correctly
      const groupByField = (currentSpreadsheetTemplate as any)?.groupByField || "product_id";
      const productKey = computeProductKey(
        spreadsheetSelection.rowMode,
        spreadsheetSelection.productId,
        spreadsheetSelection.sku,
        spreadsheetSelection.key,
        groupByField
      );
      
      if (productKey) {
        // For PER_PRODUCT: store {images, categories}
        // For PER_IMAGE: store string[] (old format)
        if (isPERProduct && allCategories.length > 0) {
          setCachedExportOverrides(prev => ({
            ...prev,
            [productKey]: { images: allUrls, categories: allCategories },
          }));
          console.log(`[App] Updated cachedExportOverrides for ${productKey}: ${allUrls.length} images with ${allCategories.length} categories`);
        } else {
          setCachedExportOverrides(prev => ({
            ...prev,
            [productKey]: allUrls,
          }));
          console.log(`[App] Updated cachedExportOverrides for ${productKey}: ${allUrls.length} URLs`);
        }
      }
    }

    console.log(`[App] Scenario applied: ${payload.mode}, total URLs: ${allUrls.length}`);
  }, [spreadsheetSelection, currentSpreadsheetTemplate, computeProductKey, targetConfig, workMode]);

  // Override images to target spreadsheet
  // This copies the current source images to the target product
  const handleOverrideToTarget = useCallback(() => {
    if (!targetConfig) {
      console.log('[App] handleOverrideToTarget: No target config');
      return;
    }

    // Get source images based on mode
    const sourceUrls = workMode === "import" 
      ? (spreadsheetSelection?.images?.map(img => img.url) || [])
      : mainPhotos.map(p => p.previewURL);

    console.log('[App] handleOverrideToTarget:', {
      workMode,
      sourceCount: sourceUrls.length,
      targetTemplate: targetConfig.targetTemplateName,
      targetProduct: targetConfig.targetProductKey,
    });

    // TODO: Implement the actual override logic
    // This would update the target product's images with the source images
    // For now, just log the action
    setAlert({
      title: "Override Images",
      message: `This will copy ${sourceUrls.length} images from the source to the target product "${targetConfig.targetSku || targetConfig.targetProductId || targetConfig.targetProductKey}". This feature is coming soon.`,
    });
  }, [workMode, spreadsheetSelection, mainPhotos, targetConfig]);

  // Handle override saved - refresh target data
  const handleOverrideSaved = useCallback(async () => {
    if (!user?.uid || !targetConfig?.targetTemplateId || !targetConfig?.targetProductKey) {
      console.log('[App] handleOverrideSaved: Missing required data');
      return;
    }

    console.log('[App] handleOverrideSaved: Refreshing target data');

    try {
      // Reload export overrides for the target template
      const exportOverrides = await getExportOverrides(user.uid, targetConfig.targetTemplateId);
      const targetOverride = exportOverrides?.[targetConfig.targetProductKey];
      
      if (targetOverride) {
        // Build new targetImages from the override using helper functions
        const images = getOverrideImages(targetOverride);
        const categories = getOverrideCategories(targetOverride);
        
        const newTargetImages = images.map((url: string, idx: number) => {
          const category = categories[idx] || "";
          const label = category.startsWith("col:") ? category.substring(4) : category || "Image";
          const colIndex = targetConfig.targetTemplateColumns?.findIndex(
            (col: any) => col.name === label && col.role === "image_url"
          ) ?? -1;
          return { url, label, colIndex };
        });

        // Update targetConfig with refreshed images
        setTargetConfig(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            targetImages: newTargetImages,
          };
        });

        console.log(`[App] handleOverrideSaved: Updated targetConfig with ${newTargetImages.length} images`);
      }
    } catch (err) {
      console.error('[App] handleOverrideSaved: Failed to refresh target data:', err);
    }
  }, [user?.uid, targetConfig?.targetTemplateId, targetConfig?.targetProductKey, targetConfig?.targetTemplateColumns]);

  // Handle target images update from OverrideModal (immediate, no network request)
  const handleTargetImagesUpdate = useCallback((images: Array<{ url: string; label: string; colIndex: number }>) => {
    console.log(`[App] handleTargetImagesUpdate: received ${images.length} images`);
    setTargetConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        targetImages: images,
      };
    });
  }, []);

  // Handle spreadsheet toggle
  // SEO toggle handler
  const handleSeoToggle = useCallback(() => {
    setSeoEnabled(prev => !prev);
  }, []);

  // GEO toggle handler
  const handleGeoToggle = useCallback(() => {
    setGeoEnabled(prev => !prev);
  }, []);

  // GSO toggle handler
  const handleGsoToggle = useCallback(() => {
    setGsoEnabled(prev => !prev);
  }, []);

  // Phase 2: New field toggle handlers
  const handleTagsToggle = useCallback(() => {
    setTagsEnabled(prev => !prev);
  }, []);

  const handleMetaTitleToggle = useCallback(() => {
    setMetaTitleEnabled(prev => !prev);
  }, []);

  const handleMetaDescriptionToggle = useCallback(() => {
    setMetaDescriptionEnabled(prev => !prev);
  }, []);

  const handleSeoTitleToggle = useCallback(() => {
    setSeoTitleEnabled(prev => !prev);
  }, []);

  // Custom field toggle handler
  const handleCustomFieldToggle = useCallback((role: string) => {
    setCustomFieldsEnabled(prev => ({
      ...prev,
      [role]: !prev[role]
    }));
  }, []);

  // Handle saving description to spreadsheet
  const handleSaveDescription = useCallback(async (
    type: DescriptionType, 
    content: string
  ): Promise<{ success: boolean; error?: string }> => {
    // Support both Import mode (spreadsheetSelection) and Create mode (targetConfig)
    const hasSpreadsheetSelection = !!spreadsheetSelection?.templateId;
    const hasTargetConfig = !!targetConfig?.targetTemplateId;
    
    if (!user?.uid || (!hasSpreadsheetSelection && !hasTargetConfig)) {
      return { success: false, error: "No product selected" };
    }

    // Determine if we're saving to a different target than the source
    // - Import mode with "Save to different": isCrossSave = true
    // - Create mode with targetConfig: always save to targetConfig (treated like cross-save)
    const isCrossSave = (saveTargetMode === "different" && targetConfig && targetSpreadsheetTemplate) ||
                        (workMode === "create" && hasTargetConfig && !hasSpreadsheetSelection);
    
    // Determine target template and product key
    let targetTemplateId: string;
    let targetProductKey: string | undefined;
    
    if (isCrossSave || (workMode === "create" && hasTargetConfig)) {
      // Save to targetConfig
      targetTemplateId = targetConfig!.targetTemplateId;
      targetProductKey = targetConfig!.targetProductKey;
    } else {
      // Save to spreadsheetSelection (Import mode, same product)
      targetTemplateId = spreadsheetSelection!.templateId;
      const groupByField = (currentSpreadsheetTemplate as any)?.groupByField || "product_id";
      targetProductKey = computeProductKey(
        spreadsheetSelection!.rowMode,
        spreadsheetSelection!.productId,
        spreadsheetSelection!.sku,
        spreadsheetSelection!.key,
        groupByField
      );
    }
    
    console.log(`[App] handleSaveDescription called:`);
    console.log(`  - workMode: ${workMode}`);
    console.log(`  - isCrossSave: ${isCrossSave}`);
    console.log(`  - targetTemplateId: ${targetTemplateId}`);
    console.log(`  - targetProductKey: ${targetProductKey}`);
    
    if (!targetProductKey) {
      return { success: false, error: "No product key found" };
    }

    try {
      await saveDescriptionOverride(
        user.uid,
        targetTemplateId,
        targetProductKey,
        type,
        content
      );
      console.log(`[App] Saved ${type} description for ${targetProductKey} in template ${targetTemplateId}`);
      
      // Stage 14: Update fieldValues to reflect the saved content
      // Use API function to convert short type names to full role names
      const fieldKey = normalizeDescriptionType(type);
      
      // Skip the next useEffect trigger to preserve immediate UI update
      skipFieldValuesEffectRef.current = true;
      
      // Update the appropriate cache based on save mode
      if (isCrossSave || (workMode === "create" && hasTargetConfig)) {
        // Update target cache
        setTargetDescriptionOverrides(prev => ({
          ...prev,
          [targetProductKey!]: {
            ...(prev[targetProductKey!] || {}),
            [fieldKey]: content,
          }
        }));
      } else {
        // Update source cache
        setCachedDescriptionOverrides(prev => ({
          ...prev,
          [targetProductKey!]: {
            ...(prev[targetProductKey!] || {}),
            [fieldKey]: content,
          }
        }));
      }
      
      // Immediately update UI
      setFieldValues(prev => ({
        ...prev,
        [fieldKey]: content
      }));
      
      return { success: true };
    } catch (err: any) {
      console.error(`[App] Failed to save ${type} description:`, err);
      return { success: false, error: err.message || "Failed to save description" };
    }
  }, [user?.uid, spreadsheetSelection, currentSpreadsheetTemplate, computeProductKey, saveTargetMode, targetConfig, targetSpreadsheetTemplate, workMode]);

  // P1a: Handlers that track dirty state
  const handleCategoryChange = useCallback((value: string) => {
    setProductCategory(value);
    setIsCategoryDirty(true);
  }, []);

  const handleMainPromptChange = useCallback((value: string) => {
    setMainPrompt(value);
    setIsPromptDirty(true);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;

    // ✅ Clear image cache at the start of each generation
    // This ensures we always use fresh images, not stale cached data from previous operations
    clearImageCache();

    if (!user?.uid) {
      setAlert({
        title: "Sign In Required",
        message: "Please sign in to generate images.",
        showLoginBtn: true,
      });
      return;
    }

    // Check if we're generating for the target panel (Different mode with cross-save)
    const isCrossSaveGeneration = saveTargetMode === "different" && targetConfig && useSpreadsheetProducts;
    
    // Filter mainPhotos to only include visible images (not hidden by user)
    // PER_PRODUCT: visibleImageItems = exportImageItems filtered by generationHiddenIds
    // PER_IMAGE: panelActiveImageUrls = URLs reported by LeftPanel after local removedUrlsForPerImage filter
    let photosForGeneration = mainPhotos;
    
    const isPERImage = spreadsheetSelection?.rowMode === "PER_IMAGE";
    const isPERProduct = spreadsheetSelection?.rowMode === "PER_PRODUCT";
    
    console.log("[App] handleGenerate debug:", {
      useSpreadsheetProducts,
      hasSelection: !!spreadsheetSelection,
      rowMode: spreadsheetSelection?.rowMode,
      mainPhotosCount: mainPhotos.length,
      visibleImageItemsCount: visibleImageItems.length,
      generationHiddenIdsSize: generationHiddenIds.size,
      panelActiveImageUrlsCount: panelActiveImageUrls.length,
      isCrossSaveGeneration,
      targetActiveImageUrlsCount: targetActiveImageUrls.length,
    });
    
    // 🔍 DEBUG: Track cross-save state
    if (isCrossSaveGeneration) {
      console.log("[App] 🔍 Cross-save state check:", {
        saveTargetMode,
        targetConfigExists: !!targetConfig,
        targetImagesCount: targetConfig?.targetImages?.length || 0,
        targetActiveUrlsCount: targetActiveImageUrls.length,
        targetProductKey: targetConfig?.targetProductKey,
        targetTemplateName: targetConfig?.targetTemplateName,
        sourcePhotosCount: mainPhotos.length,
      });
    }

    // If cross-save generation (Different mode), load and use target images instead
    if (isCrossSaveGeneration && targetActiveImageUrls.length > 0) {
      console.log("[App] Cross-save generation: loading target images for generation");
      
      // ✅ Step 1: Dedupe target URLs to avoid wasting tokens on duplicates
      const uniqueTargetUrls = [...new Set(targetActiveImageUrls)];
      const dedupedCount = targetActiveImageUrls.length - uniqueTargetUrls.length;
      if (dedupedCount > 0) {
        console.log(`[App] ✅ Deduped target URLs: ${targetActiveImageUrls.length} → ${uniqueTargetUrls.length} (removed ${dedupedCount} duplicates)`);
      }
      
      // 🔍 DEBUG: Show full URLs for verification
      console.log("[App] 🔍 Target URLs to load:");
      uniqueTargetUrls.forEach((url, i) => {
        console.log(`  [${i}] ${url}`);
      });
      
      try {
        // ✅ Skip cache for cross-save to ensure we get fresh target images
        // (not potentially stale source images from earlier operations)
        const targetImages = await loadImagesFromUrls(uniqueTargetUrls, processImageFiles, { skipCache: true });
        
        // ✅ Step 2: Filter out displayOnly images (CORS blocked, no usable aiOptimized data)
        const usableImages = targetImages.filter(img => {
          if (img.displayOnly) {
            console.warn(`[App] ⚠️ Filtering out displayOnly image (CORS blocked): ${img.sourceUrl?.substring(0, 60)}`);
            return false;
          }
          if (!img.aiOptimized || img.aiOptimized.length === 0) {
            console.warn(`[App] ⚠️ Filtering out image with empty aiOptimized: ${img.sourceUrl?.substring(0, 60)}`);
            return false;
          }
          return true;
        });
        
        const filteredCount = targetImages.length - usableImages.length;
        if (filteredCount > 0) {
          console.warn(`[App] ⚠️ Filtered out ${filteredCount} unusable images (CORS blocked or empty data)`);
        }
        
        if (usableImages.length > 0) {
          photosForGeneration = usableImages;
          console.log(`[App] ✅ Using ${usableImages.length} target images for generation`);
          console.log("[App] Loaded target image sourceUrls:", usableImages.map(img => img.sourceUrl?.substring(0, 80)));
          
          // 🔍 DEBUG: Verify loaded images
          console.log("[App] 🔍 Photo data check:");
          usableImages.forEach((img, i) => {
            console.log(`  [${i}] displayOnly=${img.displayOnly}, aiOptimized=${img.aiOptimized?.length || 0} bytes, sourceUrl=${img.sourceUrl?.substring(0, 60)}`);
          });
        } else {
          console.warn("[App] ⚠️ No usable target images after filtering, falling back to source images");
          console.warn("[App] This may happen if all target images are from CORS-blocked external CDNs");
        }
      } catch (err) {
        console.error("[App] Error loading target images:", err);
        // Fall back to source images
      }
    } else if (useSpreadsheetProducts && spreadsheetSelection) {
      // Original mode: use source panel images
      let visibleUrls: Set<string> | null = null;
      
      if (isPERProduct && generationHiddenIds.size > 0 && visibleImageItems.length > 0) {
        // PER_PRODUCT: use visibleImageItems (filtered by generationHiddenIds)
        visibleUrls = new Set(visibleImageItems.map(item => item.url));
        console.log("[App] PER_PRODUCT filter using visibleImageItems:", visibleUrls.size, "visible");
      } else if (isPERImage && panelActiveImageUrls.length > 0) {
        // PER_IMAGE: use panelActiveImageUrls (reported by LeftPanel after local hide filter)
        // Always use panelActiveImageUrls as the source of truth for which images are visible
        visibleUrls = new Set(panelActiveImageUrls);
        console.log("[App] PER_IMAGE filter using panelActiveImageUrls:", visibleUrls.size, "visible");
      }
      
      if (visibleUrls && visibleUrls.size > 0) {
        console.log("[App] Visible URLs (first 3):", Array.from(visibleUrls).slice(0, 3).map(u => u.substring(0, 60)));
        console.log("[App] MainPhotos sourceUrls (first 3):", mainPhotos.slice(0, 3).map(p => p.sourceUrl?.substring(0, 60)));
        
        // Filter mainPhotos to only include those whose sourceUrl is in visibleUrls
        const filtered = mainPhotos.filter(p => {
          if (!p.sourceUrl) return false;
          // Direct match
          if (visibleUrls!.has(p.sourceUrl)) return true;
          // Try URL-decoded match (in case of encoding differences)
          try {
            const decoded = decodeURIComponent(p.sourceUrl);
            if (visibleUrls!.has(decoded)) return true;
          } catch {}
          return false;
        });
        
        console.log("[App] handleGenerate filter result:", {
          mainPhotos: mainPhotos.length,
          visibleUrls: visibleUrls.size,
          filtered: filtered.length,
        });
        
        if (filtered.length > 0) {
          photosForGeneration = filtered;
        } else {
          console.warn("[App] Filter produced 0 results, falling back to mainPhotos");
        }
      }
    }

    // Both modes require at least one main image
    if (photosForGeneration.length === 0) {
      return setAlert({
        title: "Missing Product Image",
        message: "Please upload at least one main product image to start generation.",
      });
    }
    
    // ✅ Check if any description is enabled (text-only generation is allowed)
    const anyCustomFieldEnabled = Object.values(customFieldsEnabled || {}).some(v => v === true);
    const anyDescriptionEnabled = seoEnabled || geoEnabled || gsoEnabled || 
                                  tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled ||
                                  anyCustomFieldEnabled;
    
    // Category is auto-resolved from spreadsheet or inferred - no validation needed
    // ✅ Prompt is required only if NOT doing text-only generation
    // If descriptions are enabled but prompt is empty, allow text-only generation (no images)
    const hasPrompt = mainPrompt.trim() || variations.length > 0;
    if (!hasPrompt && !anyDescriptionEnabled) {
      return setAlert({
        title: "Missing Prompt",
        message: "Please provide a main prompt or add manual variations, or enable Product Descriptions to generate text only.",
      });
    }

    // Check if SKU is enabled but not saved (both modes)
    if (skuEnabled) {
      if (skuMode === "direct") {
        // Direct Input mode: check if there's input but no saved SKU name
        if (skuDirectInput.trim() && !savedSkuName) {
          return setAlert({
            title: "SKU Name Not Saved",
            message: "You have entered an SKU name but haven't saved it. Please click \"Save SKU Name\" before generating.",
          });
        }
      } else {
        // Rule-Based mode: check if all required variables are filled but SKU name not saved
        const currentTemplate = activeTemplate && skuTemplates[activeTemplate];
        if (currentTemplate) {
          // Check if all non-seq_num variables have values
          const nonSeqVariables = currentTemplate.variables.filter(
            v => v.id !== "seq_num" && !v.name.toLowerCase().includes("seq")
          );
          const allVariablesFilled = nonSeqVariables.every(
            v => skuVariableValues[v.id] && skuVariableValues[v.id].trim()
          );
          
          if (allVariablesFilled && !savedSkuName) {
            return setAlert({
              title: "SKU Name Not Saved",
              message: "You have filled in all SKU variables but haven't saved the SKU name. Please click \"Save SKU Name\" before generating.",
            });
          }
        }
      }
    }

    // ✅ Text-only generation warning: if no prompt but descriptions enabled, and there are existing IMAGE results
    // Show a confirmation dialog because generating text-only will clear all image results
    const isTextOnlyGeneration = !hasPrompt && anyDescriptionEnabled;
    const hasExistingImages = results?.results?.some((r: any) => r.ok && r.images?.length > 0);
    if (isTextOnlyGeneration && hasExistingImages) {
      // Use a Promise to wait for user confirmation
      const userConfirmed = await new Promise<boolean>((resolve) => {
        setAlert({
          title: "Clear Existing Images?",
          message: "Generating text fields only will clear all existing image results. Do you want to continue?",
          showCancel: true,
          cancelText: "Cancel",
          confirmText: "Go",
          onConfirm: () => {
            setAlert({});
            resolve(true);
          },
          onCancel: () => {
            setAlert({});
            resolve(false);
          },
        });
      });
      
      if (!userConfirmed) {
        return;
      }
    }

    cleanupOldResults();
    setIsLoading(true);
    setResults(null);
    setTextIsReady(false); // Reset text ready state
    setImageGenerationStage('understanding'); // Start with understanding immediately
    
    // Simulated stage progression (understanding → planning → generating)
    // Backend will override with real uploading/complete signals
    const planningTimer = setTimeout(() => {
      setImageGenerationStage(prev => 
        prev === 'understanding' ? 'planning' : prev
      );
    }, 5000); // 5 seconds for understanding
    
    const generatingTimer = setTimeout(() => {
      setImageGenerationStage(prev => 
        prev === 'planning' ? 'generating' : prev
      );
    }, 15000); // 15 seconds total (5s understanding + 10s planning)
    
    // Store timer refs for cleanup
    const cleanupTimers = () => {
      clearTimeout(planningTimer);
      clearTimeout(generatingTimer);
    };
    
    // ✅ Auto-collapse Prompt panel and expand Result panel when generation starts
    setPromptPanelCollapsed(true);
    setResultPanelCollapsed(false);
    
    // Record which images are being used for generation (for visual indicator after completion)
    // In Different mode, use targetActiveImageUrls directly (these are the URLs shown in target panel)
    // In other modes, use photosForGeneration sourceUrls (source panel images)
    if (isCrossSaveGeneration) {
      // ✅ Use targetActiveImageUrls directly - these match the URLs in renderTargetImagesSection
      setTargetUsedForGenerationUrls(new Set(targetActiveImageUrls));
      setUsedForGenerationUrls(new Set()); // Clear source panel indicators
    } else {
      const urlsForGeneration = new Set(photosForGeneration.map(p => p.sourceUrl).filter(Boolean) as string[]);
      setUsedForGenerationUrls(urlsForGeneration);
      setTargetUsedForGenerationUrls(new Set()); // Clear target panel indicators
    }

    try {
      // P1a: Build spreadsheetContext if using spreadsheet products (both modes)
      let spreadsheetContext: SpreadsheetContext | undefined;

      if (
        useSpreadsheetProducts &&
        spreadsheetSelection
      ) {
        const {
          templateId,
          rowMode,
          sku,
          productId,
          rowIndex,
          rowIndices,
          key,
        } = spreadsheetSelection;

        // Build productKey using computeProductKey to handle groupByField correctly
        const groupByField = currentSpreadsheetTemplate?.groupByField || "product_id";
        const productKey = computeProductKey(rowMode, productId, sku, key, groupByField);

        // Build row indices: prefer rowIndices (PER_IMAGE) or single rowIndex
        const sourceRowIndices =
          rowIndices && rowIndices.length > 0
            ? rowIndices
            : rowIndex !== undefined
            ? [rowIndex]
            : [];

        // Collect the URLs of the images that are actually used for this generation.
        // For spreadsheet images, ImageData.sourceUrl should be the original URL.
        // Use photosForGeneration which excludes hidden images
        const selectedImageUrls = photosForGeneration
          .map((img) => img.sourceUrl)
          .filter((u): u is string => Boolean(u));

        if (productKey && sourceRowIndices.length > 0 && selectedImageUrls.length > 0) {
          // ✅ FIX: Always use TARGET product info for description generation
          // Rule: The spreadsheet being saved to is the "target", use its product info
          // - Import + Original/Default: target = spreadsheetSelection (source IS target)
          // - Import + Different: target = targetConfig  
          // - Create + with target: target = targetConfig
          
          let productInfo: ProductInfo;
          let effectiveTemplateId: string;
          let effectiveRowMode = rowMode;
          let effectiveProductKey = productKey;
          
          // Check if we're saving to a different spreadsheet (cross-save)
          const isCrossSave = saveTargetMode === "different" && targetConfig?.targetTemplateId && targetConfig.targetTemplateId !== templateId;
          
          if (isCrossSave) {
            // Cross-save: target is a different spreadsheet
            console.log("[App] Cross-save detected, using target product info:", {
              targetProductKey: targetConfig?.targetProductKey,
              targetTitle: targetConfig?.targetTitle,
              targetCategory: targetConfig?.targetCategory,
            });
            
            productInfo = {
              title: targetConfig!.targetTitle,
              category: targetConfig!.targetCategory,
              sku: targetConfig!.targetSku,
              ...((targetConfig as any)?.targetFields || {}),
            };
            effectiveTemplateId = targetConfig!.targetTemplateId;
            effectiveRowMode = targetConfig!.targetRowMode || rowMode;
            effectiveProductKey = targetConfig!.targetProductKey || productKey;
          } else {
            // Same-table save (Original or Default): source IS the target
            // Use spreadsheetSelection as the target product info
            console.log("[App] Same-table save, using source as target:", {
              productKey,
              title: spreadsheetSelection.title,
              category: spreadsheetSelection.category,
              sku: spreadsheetSelection.sku,
              productInfo: spreadsheetSelection.productInfo,
            });
            
            // Ensure we use the actual product data from spreadsheetSelection
            // If productInfo is empty or looks like Create mode defaults, use direct fields
            const sourceProductInfo = spreadsheetSelection.productInfo;
            const hasValidProductInfo = sourceProductInfo && 
              (sourceProductInfo.title || sourceProductInfo.category || sourceProductInfo.sku);
            
            if (hasValidProductInfo) {
              productInfo = sourceProductInfo;
            } else {
              // Fallback: construct from individual fields
              productInfo = {
                title: spreadsheetSelection.title,
                category: spreadsheetSelection.category,
                sku: spreadsheetSelection.sku,
              };
            }
            effectiveTemplateId = templateId;
          }
          
          // Log the final productInfo being sent to backend
          console.log("[App] Final productInfo for generation:", productInfo);
          
          spreadsheetContext = {
            templateId: effectiveTemplateId,
            rowMode: effectiveRowMode,
            productKey: effectiveProductKey,
            sourceRowIndices,
            selectedImageUrls,
            productInfo,
          };
          console.log("[App] Built spreadsheetContext:", spreadsheetContext);
        }
      }
      
      // For Create mode with target template but no spreadsheetSelection
      // ✅ FIX: Only use targetConfig when saveTargetMode is "different"
      // This prevents using stale targetConfig when user switches back to "default" (download mode)
      if (!spreadsheetContext && workMode === "create" && saveTargetMode === "different" && targetConfig?.targetTemplateId) {
        // Create mode with target: build context for SAVING purposes only.
        // ✅ FIX: Do NOT use target product's title/category for generation.
        // The user is uploading NEW content (e.g. a lamp) to save into a target row
        // (e.g. a necklace row). Using the target's metadata would pollute the AI's
        // category resolution and prompt expansion with the wrong product type.
        // Let the server infer category from the user's prompt and uploaded image instead.
        const targetProductInfo: ProductInfo = {
          title: productCategory || undefined,
          category: productCategory || undefined,
          sku: targetConfig.targetSku,
        };
        
        console.log("[App] Create mode with target, using user category for generation:", targetProductInfo);
        
        spreadsheetContext = {
          templateId: targetConfig.targetTemplateId,
          rowMode: targetConfig.targetRowMode || "PER_IMAGE",
          productKey: targetConfig.targetProductKey || "",
          sourceRowIndices: [],
          selectedImageUrls: photosForGeneration
            .map((img) => img.sourceUrl)
            .filter((u): u is string => Boolean(u)),
          productInfo: targetProductInfo,
        };
        console.log("[App] Built spreadsheetContext for Create mode:", spreadsheetContext);
      }

      // Determine SKU name and sequence digits based on mode
      let finalSkuName = "";
      let finalSeqDigits = 3;

      if (skuEnabled) {
        if (skuMode === "direct") {
          // Direct Input mode: use skuDirectInput as the SKU name
          finalSkuName = skuDirectInput.trim();
          // Only use sequence digits if user enabled it
          if (directInputAddSequence) {
            finalSeqDigits = directInputSeqDigits;
          }
        } else {
          // Rule-Based mode: use savedSkuName and template's seqDigits
          finalSkuName = savedSkuName || "";
          finalSeqDigits = activeTemplate && skuTemplates[activeTemplate] 
            ? skuTemplates[activeTemplate].seqDigits 
            : 3;
        }
      }

      const payload = {
        uid: user.uid,
        workMode,
        productCategory,
        mainPrompt,
        // Use filtered photos (excludes hidden images)
        mainPhotosB64: photosForGeneration.map((p) => p.aiOptimized),
        refImagesB64: refImages.map((r) => r.aiOptimized),
        genStrategy,
        // ✅ If no prompt but descriptions enabled, set genCount to 0 (text-only generation)
        genCount: !hasPrompt ? 0 : (genStrategy === "auto" ? genCount : variations.length),
        variations: genStrategy === "manual" ? variations : [],
        seoEnabled,
        geoEnabled,
        gsoEnabled,
        // Phase 2: Extended description fields
        tagsEnabled,
        metaTitleEnabled,
        metaDescriptionEnabled,
        seoTitleEnabled,
        // Custom fields with enableGeneration
        customFieldsEnabled,
        // P1b: Include platform selections
        // User's manual selection in ResultColumn takes priority
        seoPlatform,
        geoPlatform,
        gsoPlatform,
        // Platform for custom field generation (use SEO platform selection)
        contentPlatform: seoPlatform,
        skuEnabled,
        skuMode,
        skuName: finalSkuName,
        seqDigits: finalSeqDigits,
        // Output settings
        aspectRatio,
        resolution,
        ...getImageDimensions(aspectRatio, resolution),  // adds { width, height } to payload
        // P1a: Include spreadsheetContext
        spreadsheetContext,
      };

      console.log("[App] Generating with", photosForGeneration.length, "images");
      console.log("[App] SKU mode:", skuMode, "SKU name:", finalSkuName, "seqDigits:", finalSeqDigits);
      console.log("[App] Output settings:", { aspectRatio, resolution, ...getImageDimensions(aspectRatio, resolution) });
      console.log("[App] Final photosForGeneration sourceUrls:", photosForGeneration.map(p => p.sourceUrl?.substring(0, 100)));
      
      // 🔍 DEBUG: Check for displayOnly images that may have degraded aiOptimized data
      console.log("[App] 🔍 Photo data check:", photosForGeneration.map((p, i) => ({
        index: i,
        sourceUrl: p.sourceUrl?.substring(0, 60),
        displayOnly: p.displayOnly,
        aiOptimizedLength: p.aiOptimized?.length || 0,
        aiOptimizedPrefix: p.aiOptimized?.substring(0, 50),
        width: p.width,
        height: p.height,
      })));
      
      // 🚨 WARN if any displayOnly images are being used
      const displayOnlyImages = photosForGeneration.filter(p => p.displayOnly);
      if (displayOnlyImages.length > 0) {
        console.warn(`[App] ⚠️ WARNING: ${displayOnlyImages.length} displayOnly images in generation!`);
        console.warn("[App] DisplayOnly images may have degraded quality due to CORS restrictions");
        displayOnlyImages.forEach((img, i) => {
          console.warn(`  [${i}] ${img.sourceUrl?.substring(0, 80)} - aiOptimized: ${img.aiOptimized?.length || 0} bytes`);
        });
      }

      const res = await generateImagesWithProgress(payload, (stage, data) => {
        console.log(`[App] Generation stage from backend: ${stage}`, data?.message || '');
        
        // Handle text_complete - text generation finished before images
        if (stage === 'text_complete') {
          console.log('[App] Text generation complete, waiting for images...');
          setTextIsReady(true);
        }
        
        // Backend sends 'uploading' and 'complete' - these override simulated stages
        if (stage === 'uploading' || stage === 'complete') {
          cleanupTimers(); // Stop simulated progression
          setImageGenerationStage(stage);
        }
      });

      if (!res || typeof res !== "object") {
        setAlert({
          title: "Server Error",
          message: "Invalid response from server. Please try again.",
        });
        setIsLoading(false);
        return;
      }

      switch (res.code) {
        case "MISSING_USER_ID":
          setAlert({
            title: "Sign In Required",
            message: "You need to sign in before generating images.",
            showLoginBtn: true,
          });
          setIsLoading(false);
          return;

        case "INSUFFICIENT_CREDITS":
          setAlert({
            title: "Out of Credits",
            message: "You've run out of credits. Please go to your Account or Pricing page to top up.",
          });
          setIsLoading(false);
          return;

        case "MISSING_CATEGORY":
        case "MISSING_MAIN_IMAGE":
        case "MISSING_PROMPT":
          setAlert({
            title: "Incomplete Input",
            message: res.error,
          });
          setIsLoading(false);
          return;

        case "PROMPT_EXPANSION_FAILED":
        case "GENERATION_INTERNAL_ERROR":
          setAlert({
            title: "Server Error",
            message: res.error || "Something went wrong. Please try again later.",
          });
          setIsLoading(false);
          return;
      }

      if (!res?.success || res?.error) {
        setAlert({
          title: "Generation Failed",
          message: res?.error || "Something went wrong. Please try again.",
        });
        setIsLoading(false);
        return;
      }

      console.log("[App] Generation success:", res.results?.length || 0, "results");
      console.log("[App] Raw response results:", JSON.stringify(res.results?.map((r: any) => ({
        ok: r.ok,
        imagesCount: r.images?.length,
        firstImage: r.images?.[0] ? {
          hasDataUrl: !!r.images[0]?.dataUrl,
          hasCdnUrl: !!r.images[0]?.cdnUrl,
          type: typeof r.images[0],
        } : null,
      })), null, 2));

      setResults({
        results: res.results?.map((r: any) => {
          if (!r.ok) return r;
          
          // Handle images - can be string or object { dataUrl, filename, skuName, seqDigits, cdnUrl, storagePath }
          // ✅ FIX: Use current mode's ref for blob URLs
          const currentResultRef = workMode === "import" ? importModeResultURLsRef : createModeResultURLsRef;
          const processedImages = r.images?.map((img: any) => {
            // Extract dataUrl - handle both string and object formats
            const dataUrl = typeof img === 'string' ? img : img?.dataUrl;
            if (!dataUrl) return null;
            
            if (dataUrl.startsWith("blob:")) return dataUrl;
            
            const arr = dataUrl.split(",");
            const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
            const bstr = atob(arr[1]);
            const n = bstr.length;
            const u8arr = new Uint8Array(n);
            for (let i = 0; i < n; i++) {
              u8arr[i] = bstr.charCodeAt(i);
            }
            const blob = new Blob([u8arr], { type: mime });
            const objUrl = URL.createObjectURL(blob);
            currentResultRef.current.push(objUrl);
            return objUrl;
          }).filter(Boolean) || [];
          
          // Extract metadata from image objects (including cdnUrl for spreadsheet saving)
          const imageMetadata = r.images?.map((img: any) => {
            if (typeof img === 'object' && img !== null) {
              return {
                filename: img.filename || null,
                skuName: img.skuName || null,
                seqDigits: img.seqDigits || 3,
                cdnUrl: img.cdnUrl || null,        // Preserve CDN URL for spreadsheet saving
                storagePath: img.storagePath || null,
              };
            }
            return null;
          }).filter(Boolean) || [];  // Filter out null values to match processedImages

          console.log("[App] Processing result:", {
            originalImagesCount: r.images?.length,
            processedImagesCount: processedImages.length,
            metadataCount: imageMetadata.length,
            hasCdnUrls: imageMetadata.filter((m: any) => m?.cdnUrl).length,
          });

          return {
            ...r,
            images: processedImages,
            // Use metadata from backend if available
            metadata: imageMetadata.length > 0 ? imageMetadata : processedImages.map(() => ({
              skuName: finalSkuName || null,
              seqDigits: finalSeqDigits,
              cdnUrl: null,
              storagePath: null,
            })),
          };
        }) || [],
        descriptions: res.descriptions || {},
        generationId: res.generationId || null,  // Store generationId for spreadsheet saving
        _timestamp: Date.now(),
      });
      
      // ✅ FIX: Save descriptions to the appropriate state based on saveTargetMode
      // This allows switching between modes without losing generated content
      const newDescriptions = res.descriptions || {};
      if (saveTargetMode === "different") {
        // Cross-save or Create with target: save to targetDescriptions
        setTargetDescriptions(newDescriptions);
        // ✅ FIX: Record the platform used for this generation
        setTargetContentPlatform(seoPlatform);
        console.log("[App] Saved descriptions to targetDescriptions:", Object.keys(newDescriptions), "platform:", seoPlatform);
      } else {
        // Original (Import) or Default (Create): save to sourceDescriptions
        setSourceDescriptions(newDescriptions);
        // ✅ FIX: Record the platform used for this generation
        setSourceContentPlatform(seoPlatform);
        console.log("[App] Saved descriptions to sourceDescriptions:", Object.keys(newDescriptions), "platform:", seoPlatform);
      }
      
      setDownloadCounter(1);
      
      // Restore all hidden images after generation completes
      setGenerationHiddenIds(new Set());
      setRestoreTrigger(prev => prev + 1);
      
      // ✅ Auto-expand ResultColumn and collapse PromptCard when content is generated
      setResultPanelCollapsed(false);
      setPromptPanelCollapsed(true);
      
      window.dispatchEvent(new Event("accountUpdate"));
    } catch (err: any) {
      console.error("[App] Generation error:", err);
      setAlert({
        title: "Generation Failed",
        message: err?.message || "Something went wrong. Please try again.",
      });
    } finally {
      cleanupTimers(); // Clean up simulated stage timers
      setIsLoading(false);
      // Reset stage after delay to show 'complete' briefly
      setTimeout(() => {
        setImageGenerationStage('idle');
      }, 2000);
    }
  }, [
    isLoading,
    user,
    workMode,
    mainPhotos,
    refImages,
    productCategory,
    mainPrompt,
    variations,
    genStrategy,
    genCount,
    seoEnabled,
    geoEnabled,
    gsoEnabled,
    // Phase 2: Additional fields
    tagsEnabled,
    metaTitleEnabled,
    metaDescriptionEnabled,
    seoTitleEnabled,
    seoPlatform,
    geoPlatform,
    gsoPlatform,
    skuEnabled,
    skuMode,
    skuDirectInput,
    directInputAddSequence,
    directInputSeqDigits,
    savedSkuName,
    activeTemplate,
    skuTemplates,
    skuVariableValues,
    cleanupOldResults,
    useSpreadsheetProducts,
    spreadsheetSelection,
    currentSpreadsheetTemplate,
    visibleImageItems,
    generationHiddenIds,
    panelActiveImageUrls,
    saveTargetMode,  // ✅ FIX: Add to correctly save descriptions by mode
    targetConfig,           // For cross-save generation
    targetActiveImageUrls,  // Target images for Different mode generation
    workMode,  // ✅ FIX: Add to use correct mode's resultURLsRef
    // Output settings - must be in deps to use latest values
    aspectRatio,
    resolution,
  ]);

  // Download with global counter for SKU sequence numbering
  const handleDownload = useCallback((dataUrl: string, filename: string, metadata?: any, index?: number) => {
    const sequenceNumber = metadata?.skuName ? downloadCounter : index;
    downloadImage(dataUrl, filename, metadata, sequenceNumber);
    
    if (metadata?.skuName) {
      setDownloadCounter(prev => prev + 1);
    }
  }, [downloadCounter]);

  const handleDownloadAll = useCallback(() => {
    const allImgs = results?.results?.flatMap((r: any) => r.images || []) || [];
    const allMetadata = results?.results?.flatMap((r: any) => r.metadata || []) || [];
    
    const startCounter = allMetadata.some((m: DownloadMetadata | null) => m?.skuName) ? downloadCounter : undefined;
    downloadMultiple(allImgs, "results", allMetadata, startCounter);
    
    if (startCounter !== undefined) {
      setDownloadCounter(prev => prev + allImgs.length);
    }
  }, [results, downloadCounter]);

  const flatImages =
    results?.results
      ?.filter((r: any) => r.ok && Array.isArray(r.images))
      ?.flatMap((r: any) => r.images) || [];

  const flatMetadata =
    results?.results
      ?.filter((r: any) => r.ok && Array.isArray(r.metadata))
      ?.flatMap((r: any) => r.metadata) || [];

  // ✅ FIX: Use descriptions based on saveTargetMode
  // This ensures switching modes shows the correct descriptions for each mode
  const descriptions = useMemo(() => {
    if (saveTargetMode === "different") {
      // Cross-save or Create with target: use targetDescriptions
      return Object.keys(targetDescriptions).length > 0 ? targetDescriptions : {};
    } else {
      // Original (Import) or Default (Create): use sourceDescriptions
      return Object.keys(sourceDescriptions).length > 0 ? sourceDescriptions : {};
    }
  }, [saveTargetMode, sourceDescriptions, targetDescriptions]);

  // ✅ FIX: Check if text-only mode (no prompt but descriptions enabled)
  // In text-only mode, expectedCount should be 0 to skip image skeleton animation
  const hasPromptForExpected = mainPrompt.trim() || variations.some(v => v.trim());
  const expectedCount = hasPromptForExpected
    ? (genStrategy === "auto" ? genCount : Math.max(1, variations.filter((v) => v.trim()).length))
    : 0;

  // Calculate navigation availability
  const canNavigatePrev = currentProductIndex > 0;
  const canNavigateNext = currentProductIndex >= 0 && currentProductIndex < productList.length - 1;

  return (
    <>
      <Page>
        <ThreeCol>
          {/* Left Panel with Toggle - highest z-index */}
          <PanelSlot style={{ zIndex: 3, position: 'relative' }}>
            <ToggleRow>
              <ToggleWrapper
                onClick={() =>
                  !isLoading && handleWorkModeChange(workMode === "create" ? "import" : "create")
                }
                style={{
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <ToggleTrack>
                  <ToggleThumb $active={workMode === "import"} />
                  <ToggleLabelLeft $active={workMode === "create"}>
                    Create
                  </ToggleLabelLeft>
                  <ToggleLabelRight $active={workMode === "import"}>
                    Import
                  </ToggleLabelRight>
                </ToggleTrack>
              </ToggleWrapper>
            </ToggleRow>
            <LeftPanel
              workMode={workMode}
              mainPhotos={mainPhotos}
              onMainPhotos={setMainPhotos}
              refImages={refImages}
              onRefImages={setRefImages}
              onPreview={setPreviewSrc}
              onGenerate={handleGenerate}
              isLoading={isLoading}
              generateDisabled={!user}
              useSpreadsheetProducts={useSpreadsheetProducts}
              spreadsheetSelection={spreadsheetSelection}
              onOpenSpreadsheetModal={() => setShowSpreadsheetModal(true)}
              onClearSpreadsheetSelection={handleClearSpreadsheetSelection}
              hasTemplates={hasTemplates}
              onNavigateProduct={handleNavigateProduct}
              canNavigatePrev={canNavigatePrev}
              canNavigateNext={canNavigateNext}
              allSpreadsheetImageUrls={allSpreadsheetImageUrls}
              onLoadMoreImages={handleLoadMoreImages}
              // PER_PRODUCT: visible items = export items minus hidden (for generation filtering)
              // × button only hides for generation, doesn't delete from export truth
              activeImageItems={visibleImageItems}
              onToggleHideItem={handleToggleHideItem}
              onRestoreAllHidden={() => setGenerationHiddenIds(new Set())}
              totalExportItemsCount={exportImageItems.length}
              // PER_IMAGE: 接收 LeftPanel 的 activeImageUrls (hide 后的真实列表)
              onPanelImagesChange={setPanelActiveImageUrls}
              // ===== Target selection props =====
              saveTargetMode={saveTargetMode}
              onSaveTargetModeChange={setSaveTargetMode}
              targetConfig={targetConfig}
              onOpenTargetModal={() => setShowTargetModal(true)}
              onOverrideToTarget={handleOverrideToTarget}
              // Target template active images (after hiding) - for cross-save
              onTargetActiveImagesChange={setTargetActiveImageUrls}
              // Visual indicator for images used in generation
              // In Different mode, source panel doesn't need to show generation indicators
              usedForGenerationUrls={saveTargetMode === "different" ? new Set<string>() : usedForGenerationUrls}
              // Visual indicator for target panel images used in generation (Different mode)
              targetUsedForGenerationUrls={targetUsedForGenerationUrls}
              // Trigger to restore hidden images after generation completes
              restoreTrigger={restoreTrigger}
              // ===== Override Modal props =====
              userId={user?.uid}
              onOverrideSaved={handleOverrideSaved}
              onTargetImagesUpdate={handleTargetImagesUpdate}
              onSuccess={(msg) => setAlert({ title: "Success", message: msg })}
              onError={(msg) => setAlert({ title: "Error", message: msg })}
            />
          </PanelSlot>

          {/* Result Panel - Collapsible with slide animation */}
          <CollapsiblePanelSlot 
            $collapsed={resultPanelCollapsed}
            $showThreeColumns={promptPanelCollapsed && !resultPanelCollapsed}
            style={{ zIndex: 2 }}
            onClick={resultPanelCollapsed ? () => setResultPanelCollapsed(false) : undefined}
          >
            <PanelSpacer />
            <CollapsiblePanelInner $collapsed={resultPanelCollapsed}>
              {!resultPanelCollapsed && (
                <CollapseButton onClick={(e) => { e.stopPropagation(); setResultPanelCollapsed(true); }} title="Collapse">
                  ◀
                </CollapseButton>
              )}
              <ResultColumn
                title="Results"
                images={flatImages}
                metadata={flatMetadata}
                descriptions={descriptions}
                onPreview={setPreviewSrc}
                onDownload={handleDownload}
                onDownloadAll={handleDownloadAll}
                isLoading={isLoading}
                expectedCount={expectedCount}
                workMode={workMode}
                seoEnabled={seoEnabled}
                geoEnabled={geoEnabled}
                gsoEnabled={gsoEnabled}
                onSeoToggle={handleSeoToggle}
                onGeoToggle={handleGeoToggle}
                onGsoToggle={handleGsoToggle}
                // Phase 2: Additional generatable fields
                tagsEnabled={tagsEnabled}
                metaTitleEnabled={metaTitleEnabled}
                metaDescriptionEnabled={metaDescriptionEnabled}
                seoTitleEnabled={seoTitleEnabled}
                onTagsToggle={handleTagsToggle}
                onMetaTitleToggle={handleMetaTitleToggle}
                onMetaDescriptionToggle={handleMetaDescriptionToggle}
                onSeoTitleToggle={handleSeoTitleToggle}
                // Custom fields with enableGeneration
                customFieldsEnabled={customFieldsEnabled}
                onCustomFieldToggle={handleCustomFieldToggle}
                // P1b: Platform selection props
                seoPlatform={seoPlatform}
                geoPlatform={geoPlatform}
                gsoPlatform={gsoPlatform}
                onSeoPlatformChange={setSeoPlatform}
                onGeoPlatformChange={setGeoPlatform}
                onGsoPlatformChange={setGsoPlatform}
                // Stage 2: Spreadsheet saving props
                spreadsheetSelection={spreadsheetSelection}
                userId={user?.uid || ""}
                generationId={results?.generationId}
                // Stage 2.5: Frontend overlay update
                onScenarioApplied={handleScenarioApplied}
                // PER_PRODUCT ID mapping: panel visible IDs for position mapping
                panelVisibleIds={panelVisibleIds}
                panelVisibleCount={panelVisibleIds.length}
                // Export truth arrays (complete, including hidden items)
                exportImages={exportImages}
                exportCategories={exportCategories}
                exportIds={exportIds}
                // PER_IMAGE: panel images truth (hide 后的真实列表, 用于 SaveTo Replace #N)
                panelImages={panelActiveImageUrls}
                // Description save props
                onSaveDescription={handleSaveDescription}
                currentTemplate={effectiveTemplate}
                // Stage 14: Field values for collapsible display
                fieldValues={fieldValues}
                // Phase 2: Cross-spreadsheet save support
                // Only pass targetConfig when in "different" mode to avoid cross-save when user switches back to "original"
                targetConfig={saveTargetMode === "different" ? targetConfig : null}
                // ✅ FIX: Also pass saveTargetMode for additional safety check in SaveToSpreadsheetModal
                saveTargetMode={saveTargetMode}
                // Target template active image URLs (after hiding) - for cross-save
                targetActiveImageUrls={saveTargetMode === "different" ? targetActiveImageUrls : []}
                // ✅ UI: Control third column visibility based on Prompt panel state
                promptPanelCollapsed={promptPanelCollapsed}
                // Generation stage for visual progress
                imageGenerationStage={imageGenerationStage}
                // Text generation complete (before images)
                textIsReady={textIsReady}
                // Current resolution for progress hint
                currentResolution={resolution}
              />
            </CollapsiblePanelInner>
          </CollapsiblePanelSlot>

          {/* Prompt Panel - Collapsible with slide animation */}
          <CollapsiblePanelSlot 
            $collapsed={promptPanelCollapsed}
            style={{ zIndex: 1 }}
            onClick={promptPanelCollapsed ? () => setPromptPanelCollapsed(false) : undefined}
          >
            <PanelSpacer />
            <CollapsiblePanelInner $collapsed={promptPanelCollapsed}>
              {!promptPanelCollapsed && (
                <CollapseButton onClick={(e) => { e.stopPropagation(); setPromptPanelCollapsed(true); }} title="Collapse">
                  ◀
                </CollapseButton>
              )}
              <PromptCard
                workMode={workMode}
                onWorkModeChange={handleWorkModeChange}
                productCategory={productCategory}
                onCategoryChange={handleCategoryChange}
                mainPrompt={mainPrompt}
                onMainChange={handleMainPromptChange}
                variations={variations}
                onVariationsChange={setVariations}
                isLoading={isLoading}
                genCount={genCount}
                onGenCountChange={setGenCount}
                genStrategy={genStrategy}
                onGenStrategyChange={setGenStrategy}
                skuEnabled={skuEnabled}
                onSkuToggle={handleSkuToggle}
                skuMode={skuMode}
                onSkuModeChange={(mode) => {
                  setSkuMode(mode);
                  setSavedSkuName(""); // Clear saved name when switching modes
                }}
                skuTemplates={skuTemplates}
                activeTemplate={activeTemplate}
                onSelectTemplate={handleSelectTemplate}
                onSkuRuleSave={handleSkuRuleSave}
                skuDirectInput={skuDirectInput}
                onSkuDirectInputChange={setSkuDirectInput}
                skuVariableValues={skuVariableValues}
                onSkuVariableChange={handleSkuVariableChange}
                onSaveSkuName={handleSaveSkuName}
                savedSkuName={savedSkuName}
                // New props for spreadsheet SKU auto-fill
                useSpreadsheetProducts={useSpreadsheetProducts}
                spreadsheetSku={
                  saveTargetMode === "different" && targetConfig?.targetSku
                    ? targetConfig.targetSku
                    : spreadsheetSelection?.sku || ""
                }
                // New props for sequence number option in Direct Input mode
                directInputAddSequence={directInputAddSequence}
                onDirectInputAddSequenceChange={setDirectInputAddSequence}
                directInputSeqDigits={directInputSeqDigits}
                onDirectInputSeqDigitsChange={setDirectInputSeqDigits}
                // New props for sequence number override in Rule-Based mode
                ruleBasedSeqDigits={ruleBasedSeqDigits}
                onRuleBasedSeqDigitsChange={setRuleBasedSeqDigits}
                // Output settings
                aspectRatio={aspectRatio}
                onAspectRatioChange={setAspectRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
              />
            </CollapsiblePanelInner>
          </CollapsiblePanelSlot>
        </ThreeCol>
      </Page>

      {previewSrc && (
        <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      )}

      {alert.message && (
        <AlertModal
          title={alert.title}
          message={alert.message}
          showCancel={alert.showCancel}
          confirmText={alert.confirmText}
          cancelText={alert.cancelText}
          onConfirm={alert.onConfirm}
          onClose={() => {
            // Note: AlertModal's handleConfirm calls onConfirm() then onClose()
            // If onConfirm already cleared alert via setAlert({}), alert.onCancel won't exist
            // This is the expected behavior - onCancel is only called when user clicks Cancel
            if (alert.onCancel) {
              alert.onCancel();
            } else if (alert.showLoginBtn) {
              navigate("/login", { state: { redirect: "/app" } });
              setAlert({});
            } else {
              setAlert({});
            }
          }}
        />
      )}

      {/* Spreadsheet Product Selection Modal */}
      {user && (
        <SpreadsheetProductModal
          isOpen={showSpreadsheetModal}
          userId={user.uid}
          onClose={() => setShowSpreadsheetModal(false)}
          onSelect={(selection, items, selectedIndex) => {
            handleSelectProduct(selection, items, selectedIndex);
          }}
          initialSelection={spreadsheetSelection}
        />
      )}

      {/* Target Spreadsheet Selection Modal */}
      {showTargetModal && user && (
        <TargetSpreadsheetModal
          isOpen={showTargetModal}
          onClose={() => setShowTargetModal(false)}
          onConfirm={(config) => {
            setTargetConfig(config);
            setSaveTargetMode("different");
          }}
          userId={user.uid}
          excludeTemplateId={
            workMode === "import" ? spreadsheetSelection?.templateId : undefined
          }
          initialConfig={targetConfig}
        />
      )}
    </>
  );
}

const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  min-height: calc(100vh - 80px);
  padding-bottom: 40px;
`;

/* Toggle row above LeftPanel */
const ToggleRow = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: center;
  height: 58px;
  flex-shrink: 0;
  
  @media (max-width: 1024px) {
    justify-content: center;
  }
`;

/* Spacer to align other panels with LeftPanel (same height as ToggleRow) */
const PanelSpacer = styled.div`
  height: 58px;
  flex-shrink: 0;
`;

/* Hidden - toggle moved to PanelSlot */
const TopBar = styled.div`
  display: none;
`;

const TopBarLeft = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: center;
`;

const TopBarCenter = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;

  @media (max-width: 1024px) {
    display: none;
  }
`;

const TopBarRight = styled.div`
  display: flex;
  justify-content: flex-end;
  align-items: center;

  @media (max-width: 1024px) {
    justify-content: flex-start;
  }
`;

const LoadingIndicator = styled.div`
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 600;
  font-size: 14px;
  animation: pulse 1.5s infinite;
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;

const ThreeCol = styled.div`
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 36px 24px 0;
  display: flex;
  justify-content: center;
  align-items: stretch; /* All panels same height */
  gap: 16px;
  height: calc(100vh - 160px); /* Fixed height based on viewport */

  @media (max-width: 1400px) {
    max-width: 100%;
    padding: 32px 16px 0;
    gap: 12px;
    height: calc(100vh - 150px);
  }
  
  @media (max-width: 1200px) {
    padding: 28px 12px 0;
    gap: 8px;
    overflow-x: auto;
    justify-content: flex-start;
    height: calc(100vh - 140px);
  }

  @media (max-width: 1024px) {
    flex-direction: column;
    align-items: center;
    max-width: 600px;
    gap: 20px;
    overflow-x: visible;
    justify-content: center;
    height: auto; /* Allow natural height on mobile */
  }
`;

/* ========== Collapsible Panel Components ========== */

/* Fixed width wrapper for each panel */
const PanelSlot = styled.div`
  width: calc((1600px - 48px - 32px) / 3);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  
  @media (max-width: 1400px) {
    width: calc((100vw - 32px - 24px) / 3);
    min-width: 300px;
  }
  
  @media (max-width: 1200px) {
    width: calc((100vw - 24px - 16px) / 3);
    min-width: 280px;
    flex-shrink: 0;
  }
  
  @media (max-width: 1024px) {
    width: 100%;
    max-width: 600px;
    min-width: unset;
    flex-shrink: 1;
  }
`;

/* Collapsible panel - slides out to the right when expanding */
const CollapsiblePanelSlot = styled.div<{ $collapsed: boolean; $showThreeColumns?: boolean }>`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  position: relative;
  cursor: ${({ $collapsed }) => $collapsed ? 'pointer' : 'default'};
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  
  /* When collapsed, width shrinks to just the visible edge (6px, expands to 14px on hover) */
  width: ${({ $collapsed, $showThreeColumns }) => 
    $collapsed 
      ? '6px'
      : $showThreeColumns 
        ? 'calc(((1600px - 48px - 32px) / 3) * 1.5)' 
        : 'calc((1600px - 48px - 32px) / 3)'};
  
  /* Allow content to overflow to the left when collapsed */
  overflow: ${({ $collapsed }) => $collapsed ? 'visible' : 'hidden'};
  
  /* Expand width on hover when collapsed */
  &:hover {
    width: ${({ $collapsed, $showThreeColumns }) => 
      $collapsed 
        ? '14px'
        : $showThreeColumns 
          ? 'calc(((1600px - 48px - 32px) / 3) * 1.5)' 
          : 'calc((1600px - 48px - 32px) / 3)'};
  }
  
  @media (max-width: 1400px) {
    width: ${({ $collapsed, $showThreeColumns }) => 
      $collapsed 
        ? '5px'
        : $showThreeColumns 
          ? 'calc(((100vw - 32px - 24px) / 3) * 1.5)' 
          : 'calc((100vw - 32px - 24px) / 3)'};
    
    &:hover {
      width: ${({ $collapsed, $showThreeColumns }) => 
        $collapsed 
          ? '12px'
          : $showThreeColumns 
            ? 'calc(((100vw - 32px - 24px) / 3) * 1.5)' 
            : 'calc((100vw - 32px - 24px) / 3)'};
    }
  }
  
  @media (max-width: 1200px) {
    width: ${({ $collapsed, $showThreeColumns }) => 
      $collapsed 
        ? '4px'
        : $showThreeColumns 
          ? 'calc(((100vw - 24px - 16px) / 3) * 1.5)' 
          : 'calc((100vw - 24px - 16px) / 3)'};
    flex-shrink: 0;
    
    &:hover {
      width: ${({ $collapsed, $showThreeColumns }) => 
        $collapsed 
          ? '10px'
          : $showThreeColumns 
            ? 'calc(((100vw - 24px - 16px) / 3) * 1.5)' 
            : 'calc((100vw - 24px - 16px) / 3)'};
    }
  }
  
  @media (max-width: 1024px) {
    width: 100%;
    max-width: 600px;
    flex-shrink: 1;
    overflow: hidden;
    
    &:hover {
      width: 100%;
    }
    
    ${({ $collapsed }) => $collapsed && `
      height: 60px;
    `}
  }
`;

/* Inner wrapper - full width, positioned to show right edge when collapsed */
const CollapsiblePanelInner = styled.div<{ $collapsed: boolean }>`
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  overflow: hidden; /* Contain children within bounds */
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  
  /* Full panel width */
  min-width: calc((1600px - 48px - 32px) / 3);
  
  /* When collapsed, shift left so only right edge shows (6px visible) */
  transform: ${({ $collapsed }) => 
    $collapsed 
      ? 'translateX(calc(-100% + 6px))' 
      : 'translateX(0)'};
  
  /* Hover: show more edge when collapsed (14px) for easier clicking */
  &:hover {
    transform: ${({ $collapsed }) => 
      $collapsed 
        ? 'translateX(calc(-100% + 14px))' 
        : 'translateX(0)'};
  }
  
  /* Overlay to tint collapsed cards with background color */
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: ${({ theme }) => theme.colors.bg};
    opacity: ${({ $collapsed }) => $collapsed ? 0.5 : 0};
    pointer-events: none;
    transition: opacity 0.4s ease;
    border-radius: ${({ theme }) => theme.radius.lg};
    z-index: 5;
  }
  
  @media (max-width: 1400px) {
    min-width: calc((100vw - 32px - 24px) / 3);
    transform: ${({ $collapsed }) => 
      $collapsed 
        ? 'translateX(calc(-100% + 5px))' 
        : 'translateX(0)'};
    
    &:hover {
      transform: ${({ $collapsed }) => 
        $collapsed 
          ? 'translateX(calc(-100% + 12px))' 
          : 'translateX(0)'};
    }
  }
  
  @media (max-width: 1200px) {
    min-width: calc((100vw - 24px - 16px) / 3);
    transform: ${({ $collapsed }) => 
      $collapsed 
        ? 'translateX(calc(-100% + 4px))' 
        : 'translateX(0)'};
    
    &:hover {
      transform: ${({ $collapsed }) => 
        $collapsed 
          ? 'translateX(calc(-100% + 10px))' 
          : 'translateX(0)'};
    }
  }
  
  @media (max-width: 1024px) {
    min-width: unset;
    transform: none;
    
    &:hover {
      transform: none;
    }
    
    &::after {
      opacity: 0;
    }
  }
`;

/* Dynamic width PanelSlot for ResultColumn - expands when showing 3 columns */
const ResultPanelSlot = styled.div<{ $showThreeColumns: boolean }>`
  width: ${({ $showThreeColumns }) => 
    $showThreeColumns 
      ? 'calc(((1600px - 48px - 32px) / 3) * 1.5)' 
      : 'calc((1600px - 48px - 32px) / 3)'};
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: width 0.3s ease;
  
  @media (max-width: 1400px) {
    width: ${({ $showThreeColumns }) => 
      $showThreeColumns 
        ? 'calc(((100vw - 32px - 24px) / 3) * 1.5)' 
        : 'calc((100vw - 32px - 24px) / 3)'};
    min-width: ${({ $showThreeColumns }) => $showThreeColumns ? '450px' : '300px'};
  }
  
  @media (max-width: 1200px) {
    width: ${({ $showThreeColumns }) => 
      $showThreeColumns 
        ? 'calc(((100vw - 24px - 16px) / 3) * 1.5)' 
        : 'calc((100vw - 24px - 16px) / 3)'};
    min-width: ${({ $showThreeColumns }) => $showThreeColumns ? '420px' : '280px'};
    flex-shrink: 0;
  }
  
  @media (max-width: 1024px) {
    width: 100%;
    max-width: ${({ $showThreeColumns }) => $showThreeColumns ? '900px' : '600px'};
    min-width: unset;
    flex-shrink: 1;
  }
`;

/* Wrapper for expanded panel */
const PanelWrapper = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  animation: expandPanel 0.25s ease-out;
  
  @keyframes expandPanel {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

/* Collapse button in top-right corner */
const CollapseButton = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.accent};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition: all 0.2s;
  opacity: 0.6;
  
  &:hover {
    background: ${({ theme }) => theme.colors.accent};
    color: ${({ theme }) => theme.colors.white};
    opacity: 1;
  }
`;

/* Collapsed panel - legacy, kept for compatibility */
const CollapsedPanel = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  cursor: pointer;
  transition: all 0.2s ease;
  align-self: flex-start;
  
  &:hover {
    background: ${({ theme }) => theme.colors.accent};
    
    span {
      color: ${({ theme }) => theme.colors.white};
    }
  }
  
  animation: collapsePanel 0.25s ease-out;
  
  @keyframes collapsePanel {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

const CollapsedIcon = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.accent};
  transition: color 0.2s;
`;

const CollapsedLabel = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  transition: color 0.2s;
`;