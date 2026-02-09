import React, { memo, useState, useMemo, useEffect, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { PlatformType, PLATFORM_OPTIONS, RowMode, DescriptionType, templatePlatformToPlatformType, GENERATABLE_FIELDS, GeneratableField } from "../lib/api";
import { SpreadsheetTemplate, SpreadsheetColumn } from "../lib/spreadsheetTemplateUtils";
import SaveToSpreadsheetModal, { SpreadsheetSelection, ScenarioAppliedPayload } from "./SaveToSpreadsheetModal";
import type { TargetSpreadsheetConfig } from "./TargetSpreadsheetModal";
import AlertModal from "./AlertModal";
import {
  PanelCard,
  PanelHeader,
  PanelTitle,
  ColumnHeader,
  ColumnTitle,
} from "../styles/collapsible";

// Generation stage types for visual progress
export type ImageGenerationStage = 
  | 'idle'
  | 'understanding'
  | 'planning'
  | 'generating'
  | 'uploading'
  | 'complete'
  | 'error';

interface StageConfig {
  iconPath: string;
  badge: string;
  hint: string;
}

const STAGE_CONFIG: Record<ImageGenerationStage, StageConfig> = {
  idle: {
    iconPath: '<rect x="3" y="3" width="18" height="14" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 9 17"/>',
    badge: 'Ready',
    hint: 'Waiting for input'
  },
  understanding: {
    iconPath: '<circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20" stroke-width="2"/><rect x="7" y="7" width="6" height="6" rx="1"/><line x1="8.5" y1="9" x2="11.5" y2="9" stroke-width="0.8"/><line x1="8.5" y1="11" x2="10.5" y2="11" stroke-width="0.8"/>',
    badge: 'Understanding...',
    hint: 'Analyzing your prompt and images'
  },
  planning: {
    iconPath: '<rect x="2" y="4" width="20" height="14" rx="2"/><circle cx="12" cy="11" r="4"/>',
    badge: 'Planning...',
    hint: 'Professional shot directions'
  },
  generating: {
    iconPath: '<rect x="3" y="3" width="18" height="14" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 9 17"/>',
    badge: 'Generating...',
    hint: 'Creating visuals'
  },
  uploading: {
    iconPath: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    badge: 'Uploading...',
    hint: 'Saving to cloud storage'
  },
  complete: {
    iconPath: '<polyline points="20 6 9 17 4 12"/>',
    badge: 'Complete',
    hint: 'All done!'
  },
  error: {
    iconPath: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    badge: 'Error',
    hint: 'Generation failed'
  }
};

interface ResultColumnProps {
  title: string;
  images: string[];
  metadata?: Array<{ filename?: string; skuName?: string; seqDigits?: number; cdnUrl?: string; storagePath?: string } | null>;
  descriptions?: {
    seo?: string | null;
    geo?: string | null;
    gso?: string | null;
    // Phase 2: Additional generated content
    tags?: string | null;
    meta_title?: string | null;
    meta_description?: string | null;
    seo_title?: string | null;
    // Custom fields with enableGeneration
    [key: string]: string | null | undefined;
  };
  onPreview: (src: string) => void;
  onDownload: (src: string, name: string, metadata?: any, index?: number) => void;
  onDownloadAll: () => void;
  isLoading?: boolean;
  expectedCount?: number;
  workMode?: "import" | "create";
  seoEnabled?: boolean;
  geoEnabled?: boolean;
  gsoEnabled?: boolean;
  onSeoToggle?: () => void;
  onGeoToggle?: () => void;
  onGsoToggle?: () => void;
  // Phase 2: Additional generatable fields
  tagsEnabled?: boolean;
  metaTitleEnabled?: boolean;
  metaDescriptionEnabled?: boolean;
  seoTitleEnabled?: boolean;
  onTagsToggle?: () => void;
  onMetaTitleToggle?: () => void;
  onMetaDescriptionToggle?: () => void;
  onSeoTitleToggle?: () => void;
  // Custom fields with enableGeneration (non-standard fields)
  customFieldsEnabled?: Record<string, boolean>;
  onCustomFieldToggle?: (role: string) => void;
  // P1b: Platform selection props
  seoPlatform?: PlatformType;
  geoPlatform?: PlatformType;
  gsoPlatform?: PlatformType;
  onSeoPlatformChange?: (platform: PlatformType) => void;
  onGeoPlatformChange?: (platform: PlatformType) => void;
  onGsoPlatformChange?: (platform: PlatformType) => void;
  // Stage 2: Spreadsheet saving props
  spreadsheetSelection?: SpreadsheetSelection | null;
  userId?: string;
  generationId?: string;
  // Stage 2.5: Callback for frontend overlay update
  onScenarioApplied?: (payload: ScenarioAppliedPayload) => void;
  // Description save callback
  onSaveDescription?: (type: DescriptionType, content: string) => Promise<{ success: boolean; error?: string }>;
  // Current template (for checking field availability)
  currentTemplate?: SpreadsheetTemplate | null;
  // PER_PRODUCT ID mapping: panel visible IDs for position mapping
  panelVisibleIds?: string[];
  panelVisibleCount?: number;
  // Export truth arrays (complete, including hidden items)
  exportImages?: string[];
  exportCategories?: string[];
  exportIds?: string[];
  // PER_IMAGE: panel images truth (hide 后的真实列表, 用于 Replace #N 映射)
  panelImages?: string[];
  // Stage 14: Original field values for collapsible display
  // Maps field role (e.g., "seo_description") to current value (original or saved)
  fieldValues?: Record<string, string>;
  // Phase 2: Cross-spreadsheet save support
  targetConfig?: TargetSpreadsheetConfig | null;
  // ✅ FIX: Save target mode - needed for SaveToSpreadsheetModal to correctly detect cross-save
  saveTargetMode?: "original" | "different" | "default";
  // Target template active image URLs (after hiding) - for cross-save
  targetActiveImageUrls?: string[];
  // ✅ UI: Control third column visibility based on Prompt panel state
  promptPanelCollapsed?: boolean;
  // Generation stage for visual progress indication
  imageGenerationStage?: ImageGenerationStage;
  // Text generation complete (before images)
  textIsReady?: boolean;
  // Current resolution for progress hint
  currentResolution?: string;
}

function ResultColumnComponent({
  title,
  images,
  metadata = [],
  descriptions = {},
  onPreview,
  onDownload,
  onDownloadAll,
  isLoading,
  expectedCount = 4,
  workMode = "import",
  seoEnabled = false,
  geoEnabled = false,
  gsoEnabled = false,
  onSeoToggle,
  onGeoToggle,
  onGsoToggle,
  // Phase 2: Additional generatable fields
  tagsEnabled = false,
  metaTitleEnabled = false,
  metaDescriptionEnabled = false,
  seoTitleEnabled = false,
  onTagsToggle,
  onMetaTitleToggle,
  onMetaDescriptionToggle,
  onSeoTitleToggle,
  // Custom fields with enableGeneration
  customFieldsEnabled = {},
  onCustomFieldToggle,
  // P1b: Platform selection
  seoPlatform = "generic",
  geoPlatform = "generic",
  gsoPlatform = "generic",
  onSeoPlatformChange,
  onGeoPlatformChange,
  onGsoPlatformChange,
  // Stage 2: Spreadsheet saving
  spreadsheetSelection,
  userId = "",
  generationId,
  // Stage 2.5: Frontend overlay update
  onScenarioApplied,
  // Description save
  onSaveDescription,
  currentTemplate,
  // PER_PRODUCT ID mapping
  panelVisibleIds,
  panelVisibleCount,
  // Export truth arrays
  exportImages,
  exportCategories,
  exportIds,
  // PER_IMAGE: panel images truth
  panelImages,
  // Stage 14: Original field values
  fieldValues = {},
  // Phase 2: Cross-spreadsheet save
  targetConfig,
  // ✅ FIX: Save target mode
  saveTargetMode = "original",
  // Target template active image URLs (after hiding) - for cross-save
  targetActiveImageUrls = [],
  // ✅ UI: Control third column visibility
  promptPanelCollapsed = true,
  // Generation stage for visual progress
  imageGenerationStage = 'idle',
  // Text generation complete (before images)
  textIsReady = false,
  // Current resolution for progress hint
  currentResolution = '1K',
}: ResultColumnProps) {
  // Compute effective selection for Create mode with targetConfig
  // This allows Create mode to save to a selected spreadsheet
  const effectiveSelection: SpreadsheetSelection | null = React.useMemo(() => {
    // If we have a regular spreadsheet selection, use it
    if (spreadsheetSelection?.templateId) {
      return spreadsheetSelection;
    }
    // In Create mode with targetConfig, build a selection from targetConfig
    if (workMode === "create" && targetConfig?.targetTemplateId) {
      return {
        templateId: targetConfig.targetTemplateId,
        templateName: targetConfig.targetTemplateName || "",
        rowMode: targetConfig.targetRowMode || "PER_IMAGE",
        key: targetConfig.targetProductKey || "",
        sku: targetConfig.targetSku,
        productId: targetConfig.targetProductId,
        title: targetConfig.targetTitle,
        category: targetConfig.targetCategory,
        images: targetConfig.targetImages || [],
        templateColumns: targetConfig.targetTemplateColumns,
      };
    }
    return null;
  }, [spreadsheetSelection, workMode, targetConfig]);

  // Copy state management
  const [copiedType, setCopiedType] = React.useState<string | null>(null);
  
  // Save description state
  const [savingType, setSavingType] = React.useState<string | null>(null);
  
  // Text generation stage for animation ('analyzing' | 'writing' | 'ready')
  const [textStage, setTextStage] = React.useState<'analyzing' | 'writing' | 'ready'>('analyzing');
  
  // Stage 14: Expanded fields state for collapsible content
  const [expandedFields, setExpandedFields] = React.useState<Set<string>>(new Set());
  const [savedType, setSavedType] = React.useState<string | null>(null);
  
  // Master toggle: controls visibility of all description cards
  const [masterEnabled, setMasterEnabled] = React.useState(false);
  
  // Track previous workMode to detect mode switch
  const prevWorkModeRef = useRef(workMode);
  
  // Track previous spreadsheetSelection to detect Clear action
  const prevSelectionRef = useRef(spreadsheetSelection);
  
  // Track if user is manually toggling - skip sync during manual operation
  const userTogglingRef = useRef(false);

  // Reset masterEnabled when spreadsheet selection changes from value to null (Clear button)
  useEffect(() => {
    const prevSelection = prevSelectionRef.current;
    prevSelectionRef.current = spreadsheetSelection;
    
    // Only reset when selection was cleared (had value, now null)
    if (prevSelection && !spreadsheetSelection) {
      setMasterEnabled(false);
    }
  }, [spreadsheetSelection]);

  // ✅ Bug Fix: Sync masterEnabled with props enabled states
  // When App.tsx restores/resets enabled states (e.g., mode switch), sync masterEnabled
  // This ensures the toggle UI matches the actual enabled state sent to backend
  const anyCustomFieldEnabledForSync = Object.values(customFieldsEnabled || {}).some(v => v === true);
  const propsAnyEnabled = seoEnabled || geoEnabled || gsoEnabled || 
                          tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled ||
                          anyCustomFieldEnabledForSync;
  
  // ✅ CRITICAL FIX: In Create mode without a template, enabled states should always be false
  // The propsAnyEnabled might be "polluted" from Import mode due to state restoration timing issues
  // So we check: if we're in Create mode AND there's no currentTemplate, ignore propsAnyEnabled
  const effectivePropsAnyEnabled = (workMode === 'create' && !currentTemplate) ? false : propsAnyEnabled;
  
  // Track if mode just switched - only sync on mode switch, not continuously
  const justSwitchedModeRef = useRef(false);
  
  // ✅ Bug Fix: Detect mode switch and force sync ONLY on mode switch
  useEffect(() => {
    const prevMode = prevWorkModeRef.current;
    if (prevMode !== workMode) {
      console.log(`[ResultColumn] ========= MODE SWITCH: ${prevMode} -> ${workMode} =========`);
      console.log(`[ResultColumn] At mode switch, effectivePropsAnyEnabled=${effectivePropsAnyEnabled}, masterEnabled=${masterEnabled}`);
      prevWorkModeRef.current = workMode;
      justSwitchedModeRef.current = true;
      
      // Force sync on mode change using effective value
      console.log(`[ResultColumn] Forcing masterEnabled to ${effectivePropsAnyEnabled}`);
      setMasterEnabled(effectivePropsAnyEnabled);
      
      // Clear the flag after a short delay to allow user operations
      setTimeout(() => {
        justSwitchedModeRef.current = false;
      }, 100);
    }
  }, [workMode, effectivePropsAnyEnabled, masterEnabled]);
  
  // ✅ Only sync when props change AND we're in Import mode with a template
  // In Create mode without template, let user control the toggle freely
  useEffect(() => {
    // Skip if we just switched modes (already handled above)
    if (justSwitchedModeRef.current) {
      return;
    }
    
    // Skip if user is manually toggling - wait for props to catch up
    if (userTogglingRef.current) {
      return;
    }
    
    // Skip sync in Create mode - user has full control of the toggle
    // Only sync in Import mode where props are managed by App.tsx
    if (workMode === 'create') {
      return;
    }
    
    // In Import mode, sync with props
    if (propsAnyEnabled && !masterEnabled) {
      console.log(`[ResultColumn] Sync effect: enabling masterEnabled because propsAnyEnabled=true`);
      setMasterEnabled(true);
    } else if (!propsAnyEnabled && masterEnabled) {
      console.log(`[ResultColumn] Sync effect: disabling masterEnabled because propsAnyEnabled=false`);
      setMasterEnabled(false);
    }
  }, [propsAnyEnabled, masterEnabled, workMode, currentTemplate]);

  // Stage 14: Reset expanded fields when product changes or toggle closes
  const prevProductKeyRef = useRef(spreadsheetSelection?.key);
  const prevMasterEnabledRef = useRef(masterEnabled);
  
  useEffect(() => {
    const prevProductKey = prevProductKeyRef.current;
    const prevMasterEnabled = prevMasterEnabledRef.current;
    
    prevProductKeyRef.current = spreadsheetSelection?.key;
    prevMasterEnabledRef.current = masterEnabled;
    
    // Reset when product changes
    if (prevProductKey && spreadsheetSelection?.key && prevProductKey !== spreadsheetSelection.key) {
      setExpandedFields(new Set());
    }
    
    // Reset when toggle closes then reopens
    if (prevMasterEnabled && !masterEnabled) {
      setExpandedFields(new Set());
    }
  }, [spreadsheetSelection?.key, masterEnabled]);

  // Toggle field expansion
  const toggleFieldExpanded = (fieldRole: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(fieldRole)) {
        next.delete(fieldRole);
      } else {
        next.add(fieldRole);
      }
      return next;
    });
  };

  // Stage 2: Save to Spreadsheet modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  // Track which image index triggered the modal (null = save all)
  const [saveImageIndex, setSaveImageIndex] = useState<number | null>(null);
  // Alert state for success/error messages
  const [alertState, setAlertState] = useState<{
    title?: string;
    message?: string;
    type?: 'success' | 'error';
  }>({});

  // Phase 2: Get auto platform from current template
  const autoPlatform = useMemo<PlatformType>(() => {
    if (!currentTemplate?.platform) return "generic";
    return templatePlatformToPlatformType(currentTemplate.platform);
  }, [currentTemplate?.platform]);

  // Phase 2: Get mapped roles from current template
  const mappedRoles = useMemo<Set<string>>(() => {
    if (!currentTemplate?.columns) return new Set();
    return new Set(
      currentTemplate.columns
        .filter((col: SpreadsheetColumn) => col.role && col.role !== "ignore")
        .map((col: SpreadsheetColumn) => col.role as string)
    );
  }, [currentTemplate?.columns]);

  // Phase 2: Get roles with enableGeneration=true from current template
  const enabledGenerationRoles = useMemo<Set<string>>(() => {
    if (!currentTemplate?.columns) return new Set();
    return new Set(
      currentTemplate.columns
        .filter((col: SpreadsheetColumn) => col.role && col.role !== "ignore" && col.enableGeneration === true)
        .map((col: SpreadsheetColumn) => col.role as string)
    );
  }, [currentTemplate?.columns]);

  // Check if any column has enableGeneration set (to detect new vs old templates)
  const hasAnyEnableGeneration = useMemo<boolean>(() => {
    if (!currentTemplate?.columns) return false;
    return currentTemplate.columns.some((col: SpreadsheetColumn) => col.enableGeneration !== undefined);
  }, [currentTemplate?.columns]);

  // Phase 2: Check if a field should be shown (based on enableGeneration or legacy behavior)
  const hasFieldRole = (requiredRoles: string[]): boolean => {
    // In Create mode without a template (Download Only), allow all description fields.
    // When a target template IS selected, currentTemplate = effectiveTemplate from App.tsx,
    // which is the full targetSpreadsheetTemplate — so fall through to check its columns.
    if (workMode === 'create' && !currentTemplate) return true;
    
    if (!currentTemplate) return true; // Show all if no template selected
    
    // If template has enableGeneration settings, use them
    if (hasAnyEnableGeneration) {
      return requiredRoles.some(role => enabledGenerationRoles.has(role));
    }
    
    // Legacy behavior: show if field is mapped (for old templates without enableGeneration)
    return requiredRoles.some(role => mappedRoles.has(role));
  };

  // Get custom fields with enableGeneration=true (excluding standard generatable fields)
  const customGenerationFields = useMemo(() => {
    if (!currentTemplate?.columns) return [];
    
    // Standard roles that are already handled by dedicated UI
    const standardRoles = new Set([
      "seo_description", "ai_seo_description",
      "geo_description", "ai_geo_description", 
      "gso_description", "ai_gso_description",
      "tags", "meta_title", "meta_description", "seo_title",
      // Identity and image fields (never show in descriptions)
      "sku", "product_id", "ignore",
      "image_url", "image_position",
    ]);
    
    // Get labels for common roles
    const fieldRoleLabels: Record<string, string> = {
      title: "Product Title",
      description: "Description",
      category: "Category / Type",
      vendor: "Vendor / Brand",
      price: "Price",
      compare_price: "Compare-at Price",
      cost: "Cost per Item",
      weight: "Weight (grams)",
      weight_unit: "Weight Unit",
      barcode: "GTIN / UPC / EAN",
      quantity: "Quantity / Stock",
      material: "Material",
      color: "Color",
      size: "Size",
      gender: "Gender",
      age_group: "Age Group",
      condition: "Condition",
      source_link: "Source Link",
      source_image: "Source Image",
    };
    
    return currentTemplate.columns
      .filter((col: SpreadsheetColumn) => 
        col.enableGeneration === true && 
        col.role && 
        !standardRoles.has(col.role)
      )
      .map((col: SpreadsheetColumn) => ({
        role: col.role as string,
        columnName: col.name,
        label: fieldRoleLabels[col.role as string] || (col.role as string).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      }));
  }, [currentTemplate?.columns]);

  // ✅ FIX: Catch any description keys that have content but aren't rendered by
  // standard field cards or customGenerationFields (from current template).
  // This happens when switching saveTargetMode — the descriptions come from
  // a different template than the current effectiveTemplate.
  const extraDescriptionFields = useMemo(() => {
    // Standard description keys already rendered by dedicated cards
    const standardKeys = new Set([
      "seo", "geo", "gso", "tags", "seo_title", "meta_title", "meta_description",
    ]);
    // Custom keys already covered by customGenerationFields
    const coveredCustomKeys = new Set(customGenerationFields.map(f => f.role));

    // Labels for common roles (same map as above)
    const fieldRoleLabels: Record<string, string> = {
      title: "Product Title",
      description: "Description",
      category: "Category / Type",
      vendor: "Vendor / Brand",
      price: "Price",
      compare_price: "Compare-at Price",
      cost: "Cost per Item",
      weight: "Weight (grams)",
      weight_unit: "Weight Unit",
      barcode: "GTIN / UPC / EAN",
      quantity: "Quantity / Stock",
      material: "Material",
      color: "Color",
      size: "Size",
      gender: "Gender",
      age_group: "Age Group",
      condition: "Condition",
      source_link: "Source Link",
      source_image: "Source Image",
    };

    const extras: Array<{ role: string; label: string }> = [];
    if (descriptions) {
      for (const key of Object.keys(descriptions)) {
        if (standardKeys.has(key)) continue;
        if (coveredCustomKeys.has(key)) continue;
        const val = descriptions[key];
        if (val && typeof val === 'string' && val.trim()) {
          extras.push({
            role: key,
            label: fieldRoleLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          });
        }
      }
    }
    return extras;
  }, [descriptions, customGenerationFields]);

  // Phase 2: Get platform display name
  const platformDisplayName = useMemo(() => {
    const opt = PLATFORM_OPTIONS.find(p => p.value === autoPlatform);
    return opt?.label || "Generic";
  }, [autoPlatform]);

  const handleCopyDescription = (type: 'seo' | 'geo' | 'gso' | 'tags' | 'seo_title' | 'meta_title' | 'meta_description') => {
    const text = descriptions[type];
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 2000);
      });
    }
  };

  // Copy field value (from spreadsheet existing data)
  const handleCopyFieldValue = (fieldKey: string) => {
    const text = fieldValues[fieldKey];
    if (text) {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedType(`field_${fieldKey}`);
        setTimeout(() => setCopiedType(null), 2000);
      });
    }
  };

  // Handle save description to spreadsheet (supports both standard and custom fields)
  const handleSaveDescription = async (type: string) => {
    const text = descriptions[type];
    if (!text) return;

    // Check if we have a spreadsheet selection (use effectiveSelection for Create mode support)
    if (!effectiveSelection?.templateId) {
      setAlertState({
        title: "No Spreadsheet Selected",
        message: "Please select a product from a spreadsheet template first.",
        type: "error",
      });
      return;
    }

    // Check if template has the corresponding field mapped
    if (currentTemplate) {
      // Standard fields have a role mapping, custom fields use the type directly as role
      const roleMap: Record<string, string> = {
        seo: "seo_description",
        geo: "geo_description",
        gso: "gso_description",
        tags: "tags",
        seo_title: "seo_title",
        meta_title: "meta_title",
        meta_description: "meta_description",
      };
      const role = roleMap[type] || type;  // Fallback to type for custom fields
      const hasField = currentTemplate.columns?.some((col: any) => col.role === role);
      
      if (!hasField) {
        const typeLabel = type.replace(/_/g, ' ').toUpperCase();
        setAlertState({
          title: `No ${typeLabel} Field Mapped`,
          message: `Your spreadsheet template doesn't have a ${typeLabel} field mapped. Please go to CSV Templates page to map the appropriate column.`,
          type: "error",
        });
        return;
      }
    }

    // Call the save callback
    if (!onSaveDescription) {
      setAlertState({
        title: "Save Not Available",
        message: "Description saving is not configured for this context.",
        type: "error",
      });
      return;
    }

    setSavingType(type);
    try {
      const result = await onSaveDescription(type, text);
      if (result.success) {
        setSavedType(type);
        setTimeout(() => setSavedType(null), 2000);
      } else {
        setAlertState({
          title: "Save Failed",
          message: result.error || "Failed to save description.",
          type: "error",
        });
      }
    } catch (err: any) {
      setAlertState({
        title: "Save Failed",
        message: err.message || "Failed to save description.",
        type: "error",
      });
    } finally {
      setSavingType(null);
    }
  };

  // Check if save is available for a description type (including custom fields)
  // Show Save button only if:
  // 1. We have a spreadsheet selection
  // 2. We have content
  // 3. If a template is selected, the field must be mapped in the template
  const canSaveDescription = (type: string) => {
    if (!effectiveSelection?.templateId || !descriptions[type]) {
      return false;
    }
    
    // If no template (shouldn't happen with effectiveSelection), allow save
    if (!currentTemplate?.columns) {
      return true;
    }
    
    // Map short type names to full role names
    const roleMap: Record<string, string[]> = {
      seo: ["seo_description", "ai_seo_description"],
      geo: ["geo_description", "ai_geo_description"],
      gso: ["gso_description", "ai_gso_description"],
      tags: ["tags"],
      seo_title: ["seo_title"],
      meta_title: ["meta_title"],
      meta_description: ["meta_description"],
    };
    
    const roles = roleMap[type] || [type];  // Fallback to type for custom fields
    
    // Check if any of the roles exist in the template
    return currentTemplate.columns.some((col: any) => 
      col.role && roles.includes(col.role)
    );
  };
  
  // Handle master toggle
  const handleMasterToggle = () => {
    const newState = !masterEnabled;
    
    // Set flag to prevent sync effect from overriding user's manual toggle
    userTogglingRef.current = true;
    
    setMasterEnabled(newState);
    
    if (newState) {
      // If turning ON, enable all available fields
      if (hasFieldRole(["seo_description", "ai_seo_description"]) && !seoEnabled && onSeoToggle) {
        onSeoToggle();
      }
      if (hasFieldRole(["geo_description", "ai_geo_description"]) && !geoEnabled && onGeoToggle) {
        onGeoToggle();
      }
      if (hasFieldRole(["gso_description", "ai_gso_description"]) && !gsoEnabled && onGsoToggle) {
        onGsoToggle();
      }
      if (hasFieldRole(["tags"]) && !tagsEnabled && onTagsToggle) {
        onTagsToggle();
      }
      if (hasFieldRole(["seo_title"]) && !seoTitleEnabled && onSeoTitleToggle) {
        onSeoTitleToggle();
      }
      if (hasFieldRole(["meta_title"]) && !metaTitleEnabled && onMetaTitleToggle) {
        onMetaTitleToggle();
      }
      if (hasFieldRole(["meta_description"]) && !metaDescriptionEnabled && onMetaDescriptionToggle) {
        onMetaDescriptionToggle();
      }
      // Enable all custom fields
      customGenerationFields.forEach(field => {
        if (!customFieldsEnabled[field.role] && onCustomFieldToggle) {
          onCustomFieldToggle(field.role);
        }
      });
    } else {
      // If turning OFF, disable all individual options
      if (seoEnabled && onSeoToggle) onSeoToggle();
      if (geoEnabled && onGeoToggle) onGeoToggle();
      if (gsoEnabled && onGsoToggle) onGsoToggle();
      if (tagsEnabled && onTagsToggle) onTagsToggle();
      if (metaTitleEnabled && onMetaTitleToggle) onMetaTitleToggle();
      if (metaDescriptionEnabled && onMetaDescriptionToggle) onMetaDescriptionToggle();
      if (seoTitleEnabled && onSeoTitleToggle) onSeoTitleToggle();
      // Disable all custom fields
      customGenerationFields.forEach(field => {
        if (customFieldsEnabled[field.role] && onCustomFieldToggle) {
          onCustomFieldToggle(field.role);
        }
      });
    }
    
    // Clear the flag after props have time to update (allow multiple render cycles)
    setTimeout(() => {
      userTogglingRef.current = false;
    }, 300);
  };

  // Check if we have any descriptions
  const hasSeoContent = descriptions.seo?.trim();
  const hasGeoContent = descriptions.geo?.trim();
  const hasGsoContent = descriptions.gso?.trim();
  // Phase 2: Check new generated content
  const hasTagsContent = descriptions.tags?.trim();
  const hasMetaTitleContent = descriptions.meta_title?.trim();
  const hasMetaDescContent = descriptions.meta_description?.trim();
  const hasSeoTitleContent = descriptions.seo_title?.trim();
  
  // Check if any custom field has content
  const hasAnyCustomFieldContent = customGenerationFields.some(field => 
    descriptions[field.role]?.trim()
  );
  
  // ✅ FIX: Also check extra description fields not covered by current template
  const hasAnyExtraFieldContent = extraDescriptionFields.length > 0;
  
  const hasAnyContent = hasSeoContent || hasGeoContent || hasGsoContent || 
                        hasTagsContent || hasMetaTitleContent || hasMetaDescContent || hasSeoTitleContent ||
                        hasAnyCustomFieldContent || hasAnyExtraFieldContent;
  
  // Check if any description is enabled (including custom fields)
  const anyCustomFieldEnabled = Object.values(customFieldsEnabled).some(v => v === true);
  const anyDescriptionEnabled = seoEnabled || geoEnabled || gsoEnabled || 
                                tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled ||
                                anyCustomFieldEnabled;

  // Text generation stage timer: analyzing (5s) → writing (only if text not ready)
  useEffect(() => {
    if (isLoading && anyDescriptionEnabled && !textIsReady) {
      setTextStage('analyzing');
      const timer = setTimeout(() => setTextStage('writing'), 5000);
      return () => clearTimeout(timer);
    }
  }, [isLoading, anyDescriptionEnabled, textIsReady]);

  // When text_complete signal received, switch to 'ready' stage
  useEffect(() => {
    if (textIsReady && isLoading) {
      setTextStage('ready');
    }
  }, [textIsReady, isLoading]);

  // Get display platform name for text generation UI
  const displayPlatform = React.useMemo(() => {
    if (seoEnabled && seoPlatform !== 'generic') {
      return PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label || seoPlatform;
    }
    if (geoEnabled && geoPlatform !== 'generic') {
      return PLATFORM_OPTIONS.find(p => p.value === geoPlatform)?.label || geoPlatform;
    }
    if (gsoEnabled && gsoPlatform !== 'generic') {
      return PLATFORM_OPTIONS.find(p => p.value === gsoPlatform)?.label || gsoPlatform;
    }
    if (seoEnabled) return PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label || 'Generic';
    if (geoEnabled) return PLATFORM_OPTIONS.find(p => p.value === geoPlatform)?.label || 'Generic';
    if (gsoEnabled) return PLATFORM_OPTIONS.find(p => p.value === gsoPlatform)?.label || 'Generic';
    return 'Generic';
  }, [seoEnabled, geoEnabled, gsoEnabled, seoPlatform, geoPlatform, gsoPlatform]);

  // Stage 2: Get CDN URLs from metadata for spreadsheet saving
  const generatedCdnUrls = metadata
    .filter((m): m is NonNullable<typeof m> => m !== null && !!m.cdnUrl)
    .map((m) => m.cdnUrl as string);

  // Debug log for CDN URLs
  if (metadata.length > 0) {
    console.log(`[ResultColumn] metadata:`, metadata);
    console.log(`[ResultColumn] generatedCdnUrls:`, generatedCdnUrls);
  }

  // Check if we can save to spreadsheet (for all images)
  const canSaveAllToSpreadsheet = 
    effectiveSelection?.templateId && 
    images.length > 0 && 
    generatedCdnUrls.length > 0 &&
    !isLoading;

  // Check if a specific image can be saved (has CDN URL)
  const canSaveImageToSpreadsheet = (index: number) => {
    return effectiveSelection?.templateId && 
           metadata[index]?.cdnUrl && 
           !isLoading;
  };

  // Handle opening the save modal for all images
  const handleOpenSaveAllModal = () => {
    if (!canSaveAllToSpreadsheet) return;
    setSaveImageIndex(null);
    setSaveModalOpen(true);
  };

  // Handle opening the save modal for a single image
  const handleOpenSaveSingleModal = (index: number) => {
    if (!canSaveImageToSpreadsheet(index)) return;
    setSaveImageIndex(index);
    setSaveModalOpen(true);
  };

  // Get the CDN URLs to save based on whether saving single or all
  const getUrlsToSave = () => {
    if (saveImageIndex !== null && metadata[saveImageIndex]?.cdnUrl) {
      return [metadata[saveImageIndex].cdnUrl as string];
    }
    return generatedCdnUrls;
  };

  return (
    <>
    <ResultCard>
      <PanelHeader>
        <PanelTitle>Result</PanelTitle>
        {isLoading && (
          <StatusBadge>
            <PulsingDot />
            <span>{STAGE_CONFIG[imageGenerationStage]?.badge || 'Generating...'}</span>
          </StatusBadge>
        )}
      </PanelHeader>

      <ResultThreeColumnBody $showThirdColumn={promptPanelCollapsed}>
        {/* ===== FIRST COLUMN: Visual (Images) ===== */}
        <LayoutColumn $position="left">
          <ColumnHeader>
            <AccentColumnTitle>Visual</AccentColumnTitle>
          </ColumnHeader>

      {/* ===== Image Section ===== */}
      {isLoading ? (
        expectedCount > 0 ? (
          <LoadingContainer>
            <LoadingGrid>
              {Array.from({ length: expectedCount }).map((_, i) => {
                const stageConfig = STAGE_CONFIG[imageGenerationStage] || STAGE_CONFIG.generating;
                const iconPath = stageConfig.iconPath;
                
                // Resolution-aware hint for generating stage
                let hint = stageConfig.hint;
                if (imageGenerationStage === 'generating') {
                  const resStr = String(currentResolution).toUpperCase();
                  if (resStr.includes('4K') || resStr === '4096') {
                    hint = 'Creating 4K visuals (takes longer)';
                  } else if (resStr.includes('2K') || resStr === '2048') {
                    hint = 'Creating 2K visuals (takes longer)';
                  }
                }
                
                const title = imageGenerationStage === 'generating' 
                  ? `Generating ${i + 1}` 
                  : stageConfig.badge.replace('...', '');
                
                return (
                  <LoadingCard key={i} $delay={i * 0.15}>
                    <ShimmerBoxWithStage>
                      <StageIcon>
                        <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: iconPath }} />
                      </StageIcon>
                      <StageHint>{hint}</StageHint>
                    </ShimmerBoxWithStage>
                    <LoadingInfo>
                      <MiniSpinner />
                      <LoadingText>{title}</LoadingText>
                    </LoadingInfo>
                  </LoadingCard>
                );
              })}
            </LoadingGrid>
          </LoadingContainer>
        ) : (
          /* Text-only mode: show empty state card with icon */
          <EmptyStateCard>
            <EmptyIcon>
              <svg viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="14" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 9 17"/>
              </svg>
            </EmptyIcon>
            <EmptyTitle>Generating Text Only</EmptyTitle>
            <EmptyText>No images will be generated. Check the Text column for your descriptions.</EmptyText>
          </EmptyStateCard>
        )
      ) : images.length === 0 ? (
        <EmptyStateCard>
          <EmptyIcon>
            <svg viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="14" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 9 17"/>
            </svg>
          </EmptyIcon>
          <EmptyTitle>Ready to Create</EmptyTitle>
          <EmptyText>Upload images or import from spreadsheet to start generating.</EmptyText>
        </EmptyStateCard>
      ) : (
        <List>
          {images.map((src, i) => {
            const imgMetadata = metadata[i];
            const defaultFilename = `${title.toLowerCase()}_${i + 1}.png`;
            const canSaveThis = canSaveImageToSpreadsheet(i);
            
            return (
              <Item key={i}>
                <ShotWrapper>
                  <Shot onClick={() => onPreview(src)} $bg={src} />
                </ShotWrapper>
                <Row>
                  <Ghost
                    onClick={() => onDownload(src, defaultFilename, imgMetadata, i)}
                  >
                    Download
                  </Ghost>
                </Row>
                {/* Save to Spreadsheet button for each image */}
                {effectiveSelection?.templateId && (
                  <SaveSingleBtn
                    onClick={() => handleOpenSaveSingleModal(i)}
                    disabled={!canSaveThis}
                  >
                    Save to Spreadsheet
                  </SaveSingleBtn>
                )}
              </Item>
            );
          })}
        </List>
      )}
      
      {/* Action buttons - inside the Results column */}
      {/* Hide when empty (no images and not loading), and hide during text-only generation */}
      {((isLoading && expectedCount > 0) || images.length > 0) && (
        <ColumnActions>
          <ActionBtn onClick={onDownloadAll} disabled={images.length === 0 || isLoading} $isLoading={isLoading}>
            Download All
          </ActionBtn>
          {/* Stage 2: Save All to Spreadsheet button - only show when spreadsheet product is selected */}
          {effectiveSelection?.templateId && (
            <ActionBtn 
              onClick={handleOpenSaveAllModal} 
              disabled={!canSaveAllToSpreadsheet}
            >
              Save All to Spreadsheet
            </ActionBtn>
          )}
        </ColumnActions>
      )}
        </LayoutColumn>

        {/* ===== SECOND COLUMN: Settings ===== */}
        <LayoutColumn $position="middle" $hideDiv={isLoading || images.length > 0 || !!hasAnyContent || masterEnabled}>
          <ColumnHeader>
            <AccentColumnTitle>Settings</AccentColumnTitle>
          </ColumnHeader>
      {/* Description Section - Always show, Save buttons controlled by canSaveDescription */}
      <DescriptionSection>
          {/* Show collapsed card when master toggle is OFF */}
          {!masterEnabled ? (
            <SettingsCenteredCard $disabled={isLoading}>
              <SettingsToggleWrapper>
                <MiniToggleWrapper 
                  $disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isLoading) {
                      handleMasterToggle();
                    }
                  }}
                >
                  <MiniToggleTrack $active={masterEnabled}>
                    <MiniToggleThumb $active={masterEnabled} />
                  </MiniToggleTrack>
                </MiniToggleWrapper>
              </SettingsToggleWrapper>
              <SettingsIcon>
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
              </SettingsIcon>
              <SettingsCenteredTitle>Product Descriptions</SettingsCenteredTitle>
              <SettingsCenteredDesc>
                Generate optimized product descriptions for different platforms.
              </SettingsCenteredDesc>
              <SettingsCenteredCost>
                Costs 20-40 credits per product
              </SettingsCenteredCost>
            </SettingsCenteredCard>
          ) : (
            <SettingsContainer $disabled={isLoading}>
              {/* Master Toggle Header with Mini Toggle */}
              <SettingsHeader>
                <SettingsTitle>Product Descriptions</SettingsTitle>
                <MiniToggleWrapper 
                  $disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isLoading) {
                      handleMasterToggle();
                    }
                  }}
                >
                  <MiniToggleTrack $active={masterEnabled}>
                    <MiniToggleThumb $active={masterEnabled} />
                  </MiniToggleTrack>
                </MiniToggleWrapper>
              </SettingsHeader>
              
              <SettingsDescription>
                Generate optimized product descriptions for different platforms.
              </SettingsDescription>
              
              {/* Content - visible when master toggle is ON */}
              <ExpandableContent>
              
              {/* Phase 2: Platform Selection - Always show editable dropdown */}
              {/* Platform affects ALL generatable fields (SEO/GEO/GSO/Tags/Meta) */}
              <PlatformSelectContainer>
                <PlatformSelectLabel>Platform:</PlatformSelectLabel>
                <PlatformSelect
                  value={seoPlatform}
                  onChange={(e) => {
                    const platform = e.target.value as PlatformType;
                    // Set all platforms to keep them in sync for all generatable fields
                    onSeoPlatformChange?.(platform);
                    onGeoPlatformChange?.(platform);
                    onGsoPlatformChange?.(platform);
                  }}
                  disabled={isLoading}
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </PlatformSelect>
              </PlatformSelectContainer>
              
              {/* Vertical Stack of Options */}
              <OptionsStack>
                {/* SEO Description Option */}
                {hasFieldRole(["seo_description", "ai_seo_description"]) && (
                <OptionCard>
                  <OptionRow onClick={onSeoToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={seoEnabled}>
                        {seoEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>SEO Description</OptionTitle>
                        <CostBadge>20 cr</CostBadge>
                      </OptionHeader>
                      {/* Collapsible current value */}
                      {fieldValues.seo_description && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('seo_description'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('seo_description')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('seo_description') && (
                                <FieldContentPreview>{fieldValues.seo_description}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('seo_description') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_seo_description'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('seo_description'); }}
                              >
                                {copiedType === 'field_seo_description' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('seo_description') && (
                            <FieldContentText>{fieldValues.seo_description}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* GEO Description Option */}
                {hasFieldRole(["geo_description", "ai_geo_description"]) && (
                <OptionCard>
                  <OptionRow onClick={onGeoToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={geoEnabled}>
                        {geoEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>GEO Description</OptionTitle>
                        <CostBadge>40 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.geo_description && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('geo_description'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('geo_description')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('geo_description') && (
                                <FieldContentPreview>{fieldValues.geo_description}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('geo_description') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_geo_description'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('geo_description'); }}
                              >
                                {copiedType === 'field_geo_description' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('geo_description') && (
                            <FieldContentText>{fieldValues.geo_description}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* GSO Description Option */}
                {hasFieldRole(["gso_description", "ai_gso_description"]) && (
                <OptionCard>
                  <OptionRow onClick={onGsoToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={gsoEnabled}>
                        {gsoEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>GSO Description</OptionTitle>
                        <CostBadge>30 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.gso_description && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('gso_description'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('gso_description')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('gso_description') && (
                                <FieldContentPreview>{fieldValues.gso_description}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('gso_description') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_gso_description'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('gso_description'); }}
                              >
                                {copiedType === 'field_gso_description' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('gso_description') && (
                            <FieldContentText>{fieldValues.gso_description}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* Tags Option - Phase 2 */}
                {hasFieldRole(["tags"]) && (
                <OptionCard>
                  <OptionRow onClick={onTagsToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={tagsEnabled}>
                        {tagsEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>Tags</OptionTitle>
                        <CostBadge>10 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.tags && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('tags'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('tags')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('tags') && (
                                <FieldContentPreview>{fieldValues.tags}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('tags') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_tags'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('tags'); }}
                              >
                                {copiedType === 'field_tags' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('tags') && (
                            <FieldContentText>{fieldValues.tags}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* SEO Title Option - Phase 2 */}
                {hasFieldRole(["seo_title"]) && (
                <OptionCard>
                  <OptionRow onClick={onSeoTitleToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={seoTitleEnabled}>
                        {seoTitleEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>SEO Title</OptionTitle>
                        <CostBadge>5 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.seo_title && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('seo_title'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('seo_title')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('seo_title') && (
                                <FieldContentPreview>{fieldValues.seo_title}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('seo_title') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_seo_title'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('seo_title'); }}
                              >
                                {copiedType === 'field_seo_title' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('seo_title') && (
                            <FieldContentText>{fieldValues.seo_title}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* Meta Title Option - Phase 2 */}
                {hasFieldRole(["meta_title"]) && (
                <OptionCard>
                  <OptionRow onClick={onMetaTitleToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={metaTitleEnabled}>
                        {metaTitleEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>Meta Title</OptionTitle>
                        <CostBadge>5 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.meta_title && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('meta_title'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('meta_title')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('meta_title') && (
                                <FieldContentPreview>{fieldValues.meta_title}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('meta_title') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_meta_title'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('meta_title'); }}
                              >
                                {copiedType === 'field_meta_title' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('meta_title') && (
                            <FieldContentText>{fieldValues.meta_title}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* Meta Description Option - Phase 2 */}
                {hasFieldRole(["meta_description"]) && (
                <OptionCard>
                  <OptionRow onClick={onMetaDescriptionToggle}>
                    <CheckboxContainer>
                      <Checkbox $checked={metaDescriptionEnabled}>
                        {metaDescriptionEnabled && <CheckIcon>&#10003;</CheckIcon>}
                      </Checkbox>
                    </CheckboxContainer>
                    <OptionContent>
                      <OptionHeader>
                        <OptionTitle>Meta Description</OptionTitle>
                        <CostBadge>5 cr</CostBadge>
                      </OptionHeader>
                      {fieldValues.meta_description && (
                        <FieldContentContainer>
                          <FieldContentHeader>
                            <FieldContentToggle 
                              onClick={(e) => { e.stopPropagation(); toggleFieldExpanded('meta_description'); }}
                            >
                              <ExpandIcon $expanded={expandedFields.has('meta_description')}>▶</ExpandIcon>
                              <FieldContentLabel>Detail:</FieldContentLabel>
                              {!expandedFields.has('meta_description') && (
                                <FieldContentPreview>{fieldValues.meta_description}</FieldContentPreview>
                              )}
                            </FieldContentToggle>
                            {expandedFields.has('meta_description') && (
                              <CopyFieldBtn 
                                $copied={copiedType === 'field_meta_description'}
                                onClick={(e) => { e.stopPropagation(); handleCopyFieldValue('meta_description'); }}
                              >
                                {copiedType === 'field_meta_description' ? '✓' : 'Copy'}
                              </CopyFieldBtn>
                            )}
                          </FieldContentHeader>
                          {expandedFields.has('meta_description') && (
                            <FieldContentText>{fieldValues.meta_description}</FieldContentText>
                          )}
                        </FieldContentContainer>
                      )}
                    </OptionContent>
                  </OptionRow>
                </OptionCard>
                )}

                {/* Custom Fields with enableGeneration */}
                {customGenerationFields.map((field) => (
                  <OptionCard key={field.role}>
                    <OptionRow onClick={() => onCustomFieldToggle?.(field.role)}>
                      <CheckboxContainer>
                        <Checkbox $checked={customFieldsEnabled[field.role] || false}>
                          {customFieldsEnabled[field.role] && <CheckIcon>&#10003;</CheckIcon>}
                        </Checkbox>
                      </CheckboxContainer>
                      <OptionContent>
                        <OptionHeader>
                          <OptionTitle>{field.label}</OptionTitle>
                          <CostBadge $custom>AI</CostBadge>
                        </OptionHeader>
                        {fieldValues[field.role] && (
                          <FieldContentContainer>
                            <FieldContentHeader>
                              <FieldContentToggle 
                                onClick={(e) => { e.stopPropagation(); toggleFieldExpanded(field.role); }}
                              >
                                <ExpandIcon $expanded={expandedFields.has(field.role)}>▶</ExpandIcon>
                                <FieldContentLabel>Detail:</FieldContentLabel>
                                {!expandedFields.has(field.role) && (
                                  <FieldContentPreview>{fieldValues[field.role]}</FieldContentPreview>
                                )}
                              </FieldContentToggle>
                              {expandedFields.has(field.role) && (
                                <CopyFieldBtn 
                                  $copied={copiedType === `field_${field.role}`}
                                  onClick={(e) => { e.stopPropagation(); handleCopyFieldValue(field.role); }}
                                >
                                  {copiedType === `field_${field.role}` ? '✓' : 'Copy'}
                                </CopyFieldBtn>
                              )}
                            </FieldContentHeader>
                            {expandedFields.has(field.role) && (
                              <FieldContentText>{fieldValues[field.role]}</FieldContentText>
                            )}
                          </FieldContentContainer>
                        )}
                      </OptionContent>
                    </OptionRow>
                  </OptionCard>
                ))}
              </OptionsStack>
              
              {/* Hint for adding more fields - only show when spreadsheet product is loaded */}
              {effectiveSelection?.templateId && (
                <MoreFieldsHint>
                  Want to generate more fields? Go to Spreadsheet Templates → Edit this template → <strong>Step 4</strong> to enable additional AI generation options, then return here.
                </MoreFieldsHint>
              )}
              
            </ExpandableContent>
            </SettingsContainer>
          )}
        </DescriptionSection>
        </LayoutColumn>

        {/* ===== THIRD COLUMN: Text (only visible when Prompt collapsed) ===== */}
        {promptPanelCollapsed && (
          <LayoutColumn $position="right" $hideDiv={isLoading || images.length > 0 || !!hasAnyContent || masterEnabled}>
            <ColumnHeader>
              <AccentColumnTitle>Text</AccentColumnTitle>
            </ColumnHeader>

            {/* Loading State - Three-stage text generation animation */}
            {isLoading && anyDescriptionEnabled && (
              <TextLoadingCenteredCard>
                <TextLoadingStage>
                  {textStage === 'analyzing' ? 'STAGE 1' : textStage === 'writing' ? 'STAGE 2' : 'STAGE 3'}
                </TextLoadingStage>
                <TextLoadingIcon $ready={textStage === 'ready'}>
                  {textStage === 'analyzing' ? (
                    /* Book icon - Learning platform rules */
                    <svg viewBox="0 0 24 24">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                      <rect x="9" y="8" width="6" height="5" rx="0.5"/>
                      <line x1="10" y1="9.5" x2="14" y2="9.5" strokeWidth="0.6"/>
                      <line x1="10" y1="11" x2="13" y2="11" strokeWidth="0.6"/>
                    </svg>
                  ) : textStage === 'writing' ? (
                    /* Pen icon - Writing content */
                    <svg viewBox="0 0 24 24">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                      <path d="m15 5 4 4"/>
                      <line x1="6" y1="18" x2="10" y2="18" strokeWidth="1" opacity="0.5"/>
                    </svg>
                  ) : (
                    /* Document with checkmark - Text ready */
                    <svg viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <polyline points="9 15 11 17 15 13" strokeWidth="2"/>
                    </svg>
                  )}
                </TextLoadingIcon>
                <TextLoadingTitle>
                  {textStage === 'analyzing' ? 'Analyzing' : textStage === 'writing' ? 'Writing' : 'Text Ready'}
                </TextLoadingTitle>
                <TextLoadingDesc>
                  {textStage === 'analyzing' 
                    ? `Learning ${displayPlatform} platform rules and best practices`
                    : textStage === 'writing'
                    ? 'Creating optimized content for your products'
                    : 'Text content generated successfully. Waiting for images to complete.'
                  }
                </TextLoadingDesc>
                <LoadingBadge $ready={textStage === 'ready'}>
                  {textStage === 'ready' ? (
                    <TextReadyCheck viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12"/>
                    </TextReadyCheck>
                  ) : (
                    <MiniSpinner />
                  )}
                  <LoadingBadgeText>
                    {textStage === 'analyzing' ? 'Analyzing...' : textStage === 'writing' ? 'Writing...' : 'Text Complete'}
                  </LoadingBadgeText>
                </LoadingBadge>
              </TextLoadingCenteredCard>
            )}

            {/* Image-only loading: show empty state with icon */}
            {isLoading && !anyDescriptionEnabled && (
              <EmptyStateCard>
                <EmptyIcon>
                  <svg viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <line x1="10" y1="9" x2="8" y2="9"/>
                  </svg>
                </EmptyIcon>
                <EmptyTitle>Generating Photos Only</EmptyTitle>
                <EmptyText>Enable descriptions in Settings to also generate text content.</EmptyText>
              </EmptyStateCard>
            )}

            {/* Empty State when no descriptions */}
            {!isLoading && !hasAnyContent && (
              <EmptyStateCard>
                <EmptyIcon>
                  <svg viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <line x1="10" y1="9" x2="8" y2="9"/>
                  </svg>
                </EmptyIcon>
                <EmptyTitle>Text Results</EmptyTitle>
                <EmptyText>Upload images and enable descriptions in Settings to generate text.</EmptyText>
              </EmptyStateCard>
            )}
      
            {/* Show generated descriptions if available */}
            {hasAnyContent && !isLoading && (
              <DescriptionsContainer>
                {hasSeoContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>SEO Description</LabelText>
                      <DescriptionActions>
                        {seoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('seo') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'seo' && handleSaveDescription('seo')}
                          >
                            {savedType === 'seo' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('seo')}>
                          {copiedType === 'seo' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.seo}</DescriptionText>
                  </DescriptionCard>
                )}

                {hasGeoContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>GEO Description</LabelText>
                      <DescriptionActions>
                        {geoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === geoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('geo') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'geo' && handleSaveDescription('geo')}
                          >
                            {savedType === 'geo' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('geo')}>
                          {copiedType === 'geo' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.geo}</DescriptionText>
                  </DescriptionCard>
                )}

                {hasGsoContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>GSO Description</LabelText>
                      <DescriptionActions>
                        {gsoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === gsoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('gso') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'gso' && handleSaveDescription('gso')}
                          >
                            {savedType === 'gso' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('gso')}>
                          {copiedType === 'gso' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.gso}</DescriptionText>
                  </DescriptionCard>
                )}

                {/* Tags */}
                {hasTagsContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>Tags</LabelText>
                      <DescriptionActions>
                        {seoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('tags') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'tags' && handleSaveDescription('tags')}
                          >
                            {savedType === 'tags' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('tags')}>
                          {copiedType === 'tags' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.tags}</DescriptionText>
                  </DescriptionCard>
                )}

                {/* SEO Title */}
                {hasSeoTitleContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>SEO Title</LabelText>
                      <DescriptionActions>
                        {seoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('seo_title') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'seo_title' && handleSaveDescription('seo_title')}
                          >
                            {savedType === 'seo_title' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('seo_title')}>
                          {copiedType === 'seo_title' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.seo_title}</DescriptionText>
                  </DescriptionCard>
                )}

                {/* Meta Title */}
                {hasMetaTitleContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>Meta Title</LabelText>
                      <DescriptionActions>
                        {seoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('meta_title') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'meta_title' && handleSaveDescription('meta_title')}
                          >
                            {savedType === 'meta_title' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('meta_title')}>
                          {copiedType === 'meta_title' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.meta_title}</DescriptionText>
                  </DescriptionCard>
                )}

                {/* Meta Description */}
                {hasMetaDescContent && (
                  <DescriptionCard>
                    <DescriptionCardHeader>
                      <LabelText>Meta Description</LabelText>
                      <DescriptionActions>
                        {seoPlatform !== "generic" && (
                          <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                        )}
                        {canSaveDescription('meta_description') && (
                          <SaveDescButton 
                            onClick={() => savingType !== 'meta_description' && handleSaveDescription('meta_description')}
                          >
                            {savedType === 'meta_description' ? 'Saved!' : 'Save'}
                          </SaveDescButton>
                        )}
                        <CopyButton onClick={() => handleCopyDescription('meta_description')}>
                          {copiedType === 'meta_description' ? 'Copied!' : 'Copy'}
                        </CopyButton>
                      </DescriptionActions>
                    </DescriptionCardHeader>
                    <DescriptionText>{descriptions.meta_description}</DescriptionText>
                  </DescriptionCard>
                )}

                {/* Custom Fields Generated Content */}
                {customGenerationFields.map((field) => {
                  const content = descriptions[field.role];
                  if (!content?.trim()) return null;
                  return (
                    <DescriptionCard key={field.role}>
                      <DescriptionCardHeader>
                        <LabelText>{field.label}</LabelText>
                        <DescriptionActions>
                          {seoPlatform !== "generic" && (
                            <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                          )}
                          {canSaveDescription(field.role) && (
                            <SaveDescButton 
                              onClick={() => savingType !== field.role && handleSaveDescription(field.role)}
                            >
                              {savedType === field.role ? 'Saved!' : 'Save'}
                            </SaveDescButton>
                          )}
                          <CopyButton onClick={() => {
                            if (content) {
                              navigator.clipboard.writeText(content);
                              setCopiedType(field.role);
                              setTimeout(() => setCopiedType(null), 2000);
                            }
                          }}>
                            {copiedType === field.role ? 'Copied!' : 'Copy'}
                          </CopyButton>
                        </DescriptionActions>
                      </DescriptionCardHeader>
                      <DescriptionText>{content}</DescriptionText>
                    </DescriptionCard>
                  );
                })}

                {/* ✅ FIX: Extra fields from descriptions not covered by current template */}
                {/* This ensures generated content is always visible even after switching scenarios */}
                {extraDescriptionFields.map((field) => {
                  const content = descriptions[field.role];
                  if (!content?.trim()) return null;
                  return (
                    <DescriptionCard key={`extra-${field.role}`}>
                      <DescriptionCardHeader>
                        <LabelText>{field.label}</LabelText>
                        <DescriptionActions>
                          {seoPlatform !== "generic" && (
                            <PlatformBadge>{PLATFORM_OPTIONS.find(p => p.value === seoPlatform)?.label}</PlatformBadge>
                          )}
                          <CopyButton onClick={() => {
                            if (content) {
                              navigator.clipboard.writeText(content);
                              setCopiedType(field.role);
                              setTimeout(() => setCopiedType(null), 2000);
                            }
                          }}>
                            {copiedType === field.role ? 'Copied!' : 'Copy'}
                          </CopyButton>
                        </DescriptionActions>
                      </DescriptionCardHeader>
                      <DescriptionText>{content}</DescriptionText>
                    </DescriptionCard>
                  );
                })}
              </DescriptionsContainer>
            )}
          </LayoutColumn>
        )}
      </ResultThreeColumnBody>
    </ResultCard>

    {/* Stage 2: Save to Spreadsheet Modal */}
    {effectiveSelection && (
      <SaveToSpreadsheetModal
        isOpen={saveModalOpen}
        onClose={() => {
          setSaveModalOpen(false);
          setSaveImageIndex(null);
        }}
        userId={userId}
        selection={effectiveSelection}
        generatedImageUrls={getUrlsToSave()}
        generationId={generationId}
        onScenarioApplied={onScenarioApplied}
        onSuccess={(message) => setAlertState({ title: "Success", message, type: "success" })}
        onError={(message) => setAlertState({ title: "Error", message, type: "error" })}
        // PER_PRODUCT ID mapping
        panelVisibleIds={panelVisibleIds}
        panelVisibleCount={panelVisibleCount}
        // Export truth arrays
        exportImages={exportImages}
        exportCategories={exportCategories}
        exportIds={exportIds}
        // PER_IMAGE: panel images truth (hide 后的真实列表)
        panelImages={panelImages}
        panelActiveImageUrls={panelImages}
        currentTemplateColumns={currentTemplate?.columns}
        // Phase 2: Cross-spreadsheet save
        targetConfig={targetConfig}
        // ✅ FIX: Pass saveTargetMode so Modal knows when to use targetConfig
        saveTargetMode={saveTargetMode}
        // Target template active image URLs (after hiding) - for cross-save
        targetActiveImageUrls={targetActiveImageUrls}
      />
    )}

    {/* Alert Modal for save feedback */}
    {alertState.message && (
      <AlertModal
        title={alertState.title || (alertState.type === "success" ? "Success" : "Error")}
        message={alertState.message}
        onClose={() => setAlertState({})}
      />
    )}
    </>
  );
}

export default memo(ResultColumnComponent);

/* ============ Animations ============ */

const shimmer = keyframes`
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
`;

const breathe = keyframes`
  0%, 100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
`;

const breatheStrong = keyframes`
  0%, 100% {
    opacity: 0.3;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.08);
  }
`;

const spin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const fadeInUp = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const dotPulse = keyframes`
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.8);
  }
`;

const slideDown = keyframes`
  from {
    opacity: 0;
    max-height: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    max-height: 800px;
    transform: translateY(0);
  }
`;

/* ============ Three Column Layout ============ */

/* ResultCard: matches LeftPanel Card responsive padding for cross-panel alignment */
const ResultCard = styled(PanelCard)`
  min-width: 0;
  
  @media (max-width: 1400px) {
    padding: 16px;
    gap: 12px;
  }
  
  @media (max-width: 1200px) {
    padding: 14px;
    gap: 10px;
  }
`;

const ResultThreeColumnBody = styled.div<{ $showThirdColumn: boolean }>`
  display: grid;
  grid-template-columns: ${({ $showThirdColumn }) => 
    $showThirdColumn ? '1fr 1fr 1fr' : '1fr 1fr'};
  gap: 16px;
  flex: 1;
  min-height: 0; /* Important for grid children to respect parent height */
  overflow: hidden;
  transition: grid-template-columns 0.3s ease;
`;

/* Accent colored column title */
const AccentColumnTitle = styled(ColumnTitle)`
  color: ${({ theme }) => theme.colors.accent};
`;

/* All columns can scroll independently */
const LayoutColumn = styled.div<{ $position: 'left' | 'middle' | 'right'; $hideDiv?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0; /* Prevent grid blowout */

  overflow-y: auto;
  
  /* Make ColumnHeader sticky at top during scroll */
  ${ColumnHeader} {
    margin-bottom: 0;
    position: sticky;
    top: 0;
    z-index: 2;
    background: ${({ theme }) => theme.colors.card};
    
    /* Extend background below the border to mask scrolling content */
    &::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -13px; /* 12px gap + 1px border */
      height: 12px;
      background: ${({ theme }) => theme.colors.card};
    }
  }
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

/* ============ Base Components ============ */

const Card = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
`;

const H1 = styled.div`
  font-weight: 800;
  font-size: 26px;
`;

const StatusBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  background: ${({ theme }) => theme.colors.inner};
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const PulsingDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
  animation: ${dotPulse} 1.5s ease-in-out infinite;
`;

/* ============ Description Section ============ */

const DescriptionSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
`;

/* ============ Settings Container (unified for both collapsed and expanded) ============ */

const SettingsContainer = styled.div<{ $disabled?: boolean }>`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  opacity: ${({ $disabled }) => $disabled ? 0.6 : 1};
  pointer-events: ${({ $disabled }) => $disabled ? 'none' : 'auto'};
  transition: opacity 0.2s ease;
`;

/* ============ Settings Centered Card (for collapsed/OFF state) ============ */

const SettingsCenteredCard = styled.div<{ $disabled?: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 24px 16px;
  text-align: center;
  position: relative;
  opacity: ${({ $disabled }) => $disabled ? 0.6 : 1};
  pointer-events: ${({ $disabled }) => $disabled ? 'none' : 'auto'};
  transition: opacity 0.2s ease;
`;

const SettingsToggleWrapper = styled.div`
  position: absolute;
  top: 14px;
  right: 14px;
`;

const SettingsIcon = styled.div`
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

const SettingsCenteredTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const SettingsCenteredDesc = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

const SettingsCenteredCost = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  width: 80%;
`;

const SettingsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SettingsTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const SettingsDescription = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.4;
`;

const SettingsDivider = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  margin: 4px 0;
`;

const SettingsCost = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;

/* Legacy components - kept for compatibility */
const CollapsedCard = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CollapsedHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const CollapsedTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const CollapsedDescription = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.4;
`;

const CollapsedCost = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
`;

const MasterToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
`;

const SectionTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const SectionDescription = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.4;
  margin-bottom: 4px;
`;

const MiniToggleWrapper = styled.div<{ $disabled?: boolean }>`
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  padding: 4px;
  opacity: ${({ $disabled }) => $disabled ? 0.5 : 1};
`;

const MiniToggleTrack = styled.div<{ $active?: boolean }>`
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.accent : theme.colors.border};
  position: relative;
  transition: background 0.2s ease;
`;

const MiniToggleThumb = styled.div<{ $active?: boolean }>`
  position: absolute;
  top: 2px;
  left: ${({ $active }) => ($active ? "20px" : "2px")};
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.white};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 0.2s ease;
`;

const ExpandableContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: ${slideDown} 0.3s ease-out;
`;

const OptionsStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const MoreFieldsHint = styled.p`
  margin: 8px 0 0 0;
  padding: 10px 12px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.sm};
  
  strong {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const OptionCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const OptionRow = styled.div`
  padding: 10px 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  transition: all 0.2s ease;
  cursor: pointer;
  user-select: none;

  &:hover {
    opacity: 0.9;
  }
`;

const CheckboxContainer = styled.div`
  padding-top: 2px;
`;

const Checkbox = styled.div<{ $checked?: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: ${({ $checked, theme }) =>
    $checked ? theme.colors.accent : theme.colors.card};
  border: 2px solid ${({ $checked, theme }) =>
    $checked ? theme.colors.accent : theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
`;

const CheckIcon = styled.span`
  color: ${({ theme }) => theme.colors.white};
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
`;

const OptionContent = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
`;

const OptionHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const OptionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  flex: 1;
  min-width: 60px;
`;

const OptionDescription = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.4;
`;

const CostBadge = styled.div<{ $custom?: boolean }>`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme, $custom }) => $custom ? theme.colors.accent : theme.colors.muted};
  background: ${({ theme, $custom }) => $custom ? `${theme.colors.accent}15` : theme.colors.inner};
  padding: 4px 8px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
`;

// Stage 14: Collapsible field content components
const FieldContentContainer = styled.div`
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  /* 扩展到 checkbox 下方区域: checkbox(20px) + gap(12px) = 32px */
  margin-left: -32px;
  width: calc(100% + 32px);
  overflow: hidden;
`;

const FieldContentToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 2px 0;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  
  &:hover {
    opacity: 0.8;
  }
`;

const ExpandIcon = styled.span<{ $expanded: boolean }>`
  font-size: 8px;
  color: ${({ theme }) => theme.colors.muted};
  transition: transform 0.2s;
  transform: rotate(${({ $expanded }) => $expanded ? '90deg' : '0deg'});
  flex-shrink: 0;
`;

const FieldContentLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
  flex-shrink: 0;
`;

const FieldContentPreview = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text};
  opacity: 0.8;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
`;

const FieldContentText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
  margin-top: 6px;
  padding: 10px 12px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.sm};
`;

/* Header row for field toggle + copy button */
const FieldContentHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  overflow: hidden;
`;

const CopyFieldBtn = styled.button<{ $copied?: boolean }>`
  background: ${({ $copied, theme }) => $copied ? theme.colors.accent : theme.colors.card};
  color: ${({ $copied, theme }) => $copied ? theme.colors.white : theme.colors.muted};
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  
  &:hover {
    background: ${({ $copied, theme }) => $copied ? theme.colors.accent : theme.colors.border};
    color: ${({ $copied, theme }) => $copied ? theme.colors.white : theme.colors.text};
  }
`;

/* ============ Phase 2: Auto Platform Badge ============ */

const AutoPlatformBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  margin-bottom: 12px;
`;

const PlatformLabel = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  
  strong {
    color: ${({ theme }) => theme.colors.accent};
    font-weight: 600;
  }
`;

const PlatformHint = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  white-space: nowrap;
`;

/* ============ Platform Selection ============ */

const PlatformSection = styled.div`
  padding: 10px 12px 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  justify-content: center;
  animation: ${fadeInUp} 0.2s ease-out;
`;

const PlatformSelectContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.md};
  margin-bottom: 8px;
`;

const PlatformSelectLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const PlatformSelect = styled.select`
  width: 100%;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.accent};
  padding: 10px 12px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.white};
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 12px;
  padding-right: 32px;
  text-align: center;
  text-align-last: center;

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  option {
    background: ${({ theme }) => theme.colors.card};
    color: ${({ theme }) => theme.colors.text};
    text-align: left;
  }
`;

const PlatformBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  background: ${({ theme }) => theme.colors.accent};
  padding: 2px 8px;
  border-radius: 10px;
  margin-left: 6px;
`;

/* ============ Description Loading State ============ */

const DescriptionLoadingContainer = styled.div`
  margin-top: 8px;
`;

const BreathingCard = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  animation: ${breathe} 2s ease-in-out infinite;
`;

const ShimmerEffect = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(249, 248, 246, 0.5) 50%,
    transparent 100%
  );
  animation: ${shimmer} 2s infinite;
`;

/* ============ Descriptions Display ============ */

const DescriptionsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ${fadeInUp} 0.4s ease-out;
`;

const DescriptionCard = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ${fadeInUp} 0.4s ease-out;
`;

const DescriptionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const DescriptionCardHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DescriptionActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const DescriptionLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const LabelText = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const DescriptionText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.6;
  white-space: pre-wrap;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
`;

const CopyButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 6px 12px;
  font-weight: 700;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const SaveDescButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 6px 12px;
  font-weight: 700;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.accent};
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* ============ Loading States ============ */

const LoadingContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex: 1;
`;

const LoadingGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`;

const LoadingCard = styled.div<{ $delay: number }>`
  flex: 1 1 calc(50% - 6px);
  min-width: 120px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: ${fadeInUp} 0.4s ease-out;
  animation-delay: ${({ $delay }) => $delay}s;
  animation-fill-mode: backwards;
`;

const ShimmerBox = styled.div`
  width: 100%;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.border};
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`;

// Extended ShimmerBox for stage display with icon + hint
const ShimmerBoxWithStage = styled(ShimmerBox)`
  flex-direction: column;
  gap: 8px;
`;

// Stage icon - 48px, breathing animation
const StageIcon = styled.div`
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
    animation: ${breatheStrong} 2s ease-in-out infinite;
  }
`;

// Stage hint text below icon
const StageHint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
  z-index: 1;
  padding: 0 12px;
  line-height: 1.4;
  max-width: 140px;
`;

const LoadingCardIcon = styled.div`
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  animation: ${breatheStrong} 2s ease-in-out infinite;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

const LoadingInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MiniSpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.accent};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const LoadingText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
`;

/* ============ Empty State ============ */

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 24px 20px 40px;
`;

const EmptyTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
  max-width: 240px;
`;

const EmptyIcon = styled.div`
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

/* ============ Empty State Card (with background) ============ */

const EmptyStateCard = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  padding: 24px 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

/* ============ Text Loading State ============ */

const TextLoadingContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
`;

const TextPlaceholderCard = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
  border: 2px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  min-height: 120px;
`;

const TextPlaceholderIcon = styled.div`
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.3;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

const TextPlaceholderText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
`;

/* ============ Text Loading Centered Card (unified style) ============ */

const TextLoadingCenteredCard = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 24px 16px;
  text-align: center;
  position: relative;
  overflow: hidden;

  /* Dark inner area matching image loading cards */
  &::before {
    content: '';
    position: absolute;
    inset: 12px;
    background: ${({ theme }) => theme.colors.border};
    border-radius: ${({ theme }) => theme.radius.md};
    z-index: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }
`;

const TextLoadingStage = styled.div`
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.5px;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 4px;
`;

const TextLoadingIcon = styled.div<{ $ready?: boolean }>`
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${({ $ready }) => $ready ? 'none' : breatheStrong} 2s ease-in-out infinite;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

const TextLoadingTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const TextLoadingDesc = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

const LoadingBadge = styled.div<{ $ready?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  background: ${({ theme }) => theme.colors.card};
  padding: 8px 14px;
  border-radius: 20px;
  margin-top: 8px;
`;

const LoadingBadgeText = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
`;

const TextReadyCheck = styled.svg`
  width: 14px;
  height: 14px;
  stroke: ${({ theme }) => theme.colors.accent};
  stroke-width: 2.5;
  fill: none;
`;

/* ============ Image Grid ============ */

const List = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  flex: 1;
`;

const Item = styled.div`
  flex: 1 1 calc(50% - 6px);
  min-width: 120px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ShotWrapper = styled.div`
  width: 100%;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadow.soft};
`;

const Shot = styled.div<{ $bg: string }>`
  width: 100%;
  height: 100%;
  background: url(${({ $bg }) => $bg}) center/cover no-repeat;
  cursor: pointer;
  transition: transform 0.2s;
  
  &:hover {
    transform: scale(1.02);
  }
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
`;

const Ghost = styled.button`
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 700;
  flex: 1;
  transition: all 0.2s ease;
  font-size: 12px;
  
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border};
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* Actions container for inside a column */
const ColumnActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const ActionBtn = styled.button<{ $isLoading?: boolean }>`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 12px 14px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
  position: relative;
  overflow: hidden;
  
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: ${({ $isLoading }) => $isLoading ? `linear-gradient(
      90deg,
      transparent 0%,
      rgba(249, 248, 246, 0.3) 50%,
      transparent 100%
    )` : 'transparent'};
    animation: ${({ $isLoading }) => $isLoading ? shimmer : 'none'} 2s infinite;
    pointer-events: none;
  }
  
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/* Stage 2: Save to Spreadsheet button for individual images */
const SaveSingleBtn = styled.button`
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 12px;
  cursor: pointer;
  font-weight: 700;
  width: 100%;
  transition: all 0.2s ease;
  font-size: 12px;
  
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border};
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;