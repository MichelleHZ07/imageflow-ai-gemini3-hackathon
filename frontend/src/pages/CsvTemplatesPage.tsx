import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import styled from "styled-components";
import { useAuth } from "../context/AuthContext";
import AlertModal from "../components/AlertModal";
import SpreadsheetResultsModal from "../components/SpreadsheetResultsModal";
import {
  getUserSpreadsheets,
  uploadSpreadsheet,
  updateSpreadsheetMappings,
  updateSpreadsheet,
  deleteSpreadsheet as deleteSpreadsheetApi,
  SpreadsheetTemplate,
  SpreadsheetColumn,
  FIELD_ROLE_GROUPS,
  FieldRole,
  SpreadsheetStatus,
  RowMode,
  isImageColumn,
  validatePerImageMode,
  SpreadsheetApiError,
  autoMapColumns,
} from "../lib/spreadsheetTemplateUtils";
import {
  getSubscriptionStatus,
  getSpreadsheetLimit,
  SubscriptionInfo,
  GENERATABLE_FIELDS,
} from "../lib/api";

// ============ Constants ============
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".csv", ".xls", ".xlsx"];

// Spreadsheet limits by plan
const SPREADSHEET_LIMITS = {
  free: 3,
  starter: 5,
  creator: 10,
  studio: 30,
};

// Groups to exclude from AI generation selection (identity, images, other)
const EXCLUDED_GENERATION_GROUPS = ["identity", "images", "other"];

// ============ Component ============
export default function CsvTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<SpreadsheetTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [fieldMappings, setFieldMappings] = useState<SpreadsheetColumn[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<SpreadsheetTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Row mode state
  const [rowMode, setRowMode] = useState<RowMode>("PER_PRODUCT");
  const [rowModeValidationError, setRowModeValidationError] = useState<string | null>(null);
  const [groupByField, setGroupByField] = useState<"sku" | "product_id">("product_id");

  // AI Generation fields state
  const [enabledGenerations, setEnabledGenerations] = useState<Set<string>>(new Set());

  // Platform dropdown state
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const [platformTouchedInStep2, setPlatformTouchedInStep2] = useState(false);
  const [platformInputValue, setPlatformInputValue] = useState("");
  const platformInputRef = useRef<HTMLInputElement>(null);
  const platformDropdownRef = useRef<HTMLDivElement>(null);

  // Alert modal state
  const [alertModal, setAlertModal] = useState<{
    title?: string;
    message?: string;
    showCancel?: boolean;
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
  } | null>(null);

  // Results modal state
  const [resultsModalTemplate, setResultsModalTemplate] = useState<SpreadsheetTemplate | null>(null);

  // Platform tab state for filtering templates
  const [activePlatformTab, setActivePlatformTab] = useState<string>("all");

  // Subscription and limits state
  const [subscriptions, setSubscriptions] = useState<SubscriptionInfo[]>([]);
  const [spreadsheetLimit, setSpreadsheetLimit] = useState(SPREADSHEET_LIMITS.free);
  const [planName, setPlanName] = useState("Free");

  // Default platforms
  const DEFAULT_PLATFORMS = ["Shopify", "Amazon", "TikTok Shop","Etsy", "eBay", "Walmart"];

  // Derive all platforms from default + existing templates (stored in Firebase)
  const allPlatforms = useMemo(() => {
    const platformSet = new Set(DEFAULT_PLATFORMS);
    templates.forEach((t) => {
      if (t.platform && t.platform.trim()) {
        platformSet.add(t.platform.trim());
      }
    });
    return Array.from(platformSet);
  }, [templates]);

  // Filter platforms for dropdown - always show matching options, or all if no matches
  const filteredPlatforms = useMemo(() => {
    const inputLower = platformInputValue.toLowerCase().trim();
    if (!inputLower) {
      return allPlatforms;
    }
    // Filter platforms that contain the input
    const filtered = allPlatforms.filter((p) =>
      p.toLowerCase().includes(inputLower)
    );
    // If no matches, show all platforms so user can still select from list
    return filtered.length > 0 ? filtered : allPlatforms;
  }, [allPlatforms, platformInputValue]);

  // Check if input is a new custom platform (not in the list)
  const isCustomPlatform = useMemo(() => {
    const inputLower = platformInputValue.toLowerCase().trim();
    if (!inputLower) return false;
    return !allPlatforms.some(p => p.toLowerCase() === inputLower);
  }, [allPlatforms, platformInputValue]);

  // Get sorted unique platforms for tabs (alphabetically)
  const sortedPlatforms = useMemo(() => {
    const platformSet = new Set<string>();
    templates.forEach((t) => {
      if (t.platform && t.platform.trim()) {
        platformSet.add(t.platform.trim());
      }
    });
    return Array.from(platformSet).sort((a, b) => 
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [templates]);

  // Filter and sort templates based on active tab (sorted by updatedAt, most recent first)
  const displayedTemplates = useMemo(() => {
    // First, filter by platform if a specific tab is selected
    let filtered = templates;
    if (activePlatformTab !== "all") {
      filtered = templates.filter(t => t.platform === activePlatformTab);
    }
    
    // Then sort by updatedAt (most recent first)
    return [...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [templates, activePlatformTab]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        platformDropdownRef.current &&
        !platformDropdownRef.current.contains(e.target as Node) &&
        platformInputRef.current &&
        !platformInputRef.current.contains(e.target as Node)
      ) {
        setPlatformDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync platformInputValue with selectedPlatform
  useEffect(() => {
    setPlatformInputValue(selectedPlatform);
  }, [selectedPlatform]);

  // Load templates and subscription info from backend
  const loadTemplates = useCallback(async () => {
    if (!user?.uid) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Load templates and subscription info in parallel
      const [templatesData, subsData] = await Promise.all([
        getUserSpreadsheets(user.uid),
        getSubscriptionStatus(user.uid),
      ]);
      
      setTemplates(templatesData);
      setSubscriptions(subsData);
      
      // Calculate limit based on subscription
      const limit = getSpreadsheetLimit(subsData);
      setSpreadsheetLimit(limit);
      
      // Determine plan name
      const activeSub = subsData.find(s => s.active);
      setPlanName(activeSub?.planName || "Free");
      
    } catch (error) {
      console.error("Failed to load templates:", error);
      setAlertModal({
        title: "Error",
        message: "Failed to load spreadsheet templates. Please refresh the page.",
      });
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // Validate PER_IMAGE mode when mappings or rowMode change
  useEffect(() => {
    if (rowMode === "PER_IMAGE") {
      const validation = validatePerImageMode(fieldMappings);
      setRowModeValidationError(validation.valid ? null : validation.error || null);
    } else {
      setRowModeValidationError(null);
    }
  }, [rowMode, fieldMappings]);

  // Reset modal state
  const resetModal = () => {
    setCurrentStep(1);
    setUploadedFile(null);
    setSelectedPlatform("");
    setPlatformInputValue("");
    setTemplateName("");
    setFieldMappings([]);
    setEditingTemplate(null);
    setFileError(null);
    setRowMode("PER_PRODUCT");
    setRowModeValidationError(null);
    setGroupByField("product_id");
    setEnabledGenerations(new Set());
    setPlatformDropdownOpen(false);
    setPlatformTouchedInStep2(false);
  };

  // Check if there are unsaved changes in the modal
  const hasUnsavedChanges = useCallback((): boolean => {
    // For new template (no editingTemplate), check if user has started filling in
    if (!editingTemplate) {
      return !!(uploadedFile || templateName.trim() || selectedPlatform.trim());
    }
    
    // For editing existing template, check if anything changed
    // Step 2 changes
    if (selectedPlatform !== editingTemplate.platform) return true;
    if (rowMode !== (editingTemplate.rowMode || "PER_PRODUCT")) return true;
    if (rowMode === "PER_IMAGE" && groupByField !== ((editingTemplate as any).groupByField || "product_id")) return true;
    
    // Step 3 changes - compare field mappings
    const originalMappings = editingTemplate.columns;
    if (fieldMappings.length !== originalMappings.length) return true;
    for (let i = 0; i < fieldMappings.length; i++) {
      if (fieldMappings[i].role !== originalMappings[i].role) return true;
      if (fieldMappings[i].multiValue !== originalMappings[i].multiValue) return true;
      if (fieldMappings[i].separator !== originalMappings[i].separator) return true;
    }
    
    // Step 4 changes - compare enabledGenerations
    const originalGenerations = new Set<string>();
    editingTemplate.columns.forEach(col => {
      if (col.enableGeneration && col.role) {
        originalGenerations.add(col.role);
      }
    });
    if (enabledGenerations.size !== originalGenerations.size) return true;
    for (const role of enabledGenerations) {
      if (!originalGenerations.has(role)) return true;
    }
    
    return false;
  }, [editingTemplate, uploadedFile, templateName, selectedPlatform, rowMode, groupByField, fieldMappings, enabledGenerations]);

  // Handle close with unsaved changes check
  const handleCloseModal = useCallback(() => {
    if (uploading || saving) return;
    
    if (hasUnsavedChanges()) {
      setAlertModal({
        title: "Unsaved Changes",
        message: "You have unsaved changes. Are you sure you want to close? Your changes will be lost.",
        showCancel: true,
        confirmText: "Discard Changes",
        cancelText: "Keep Editing",
        onConfirm: () => {
          setShowNewTemplateModal(false);
          resetModal();
        },
      });
    } else {
      setShowNewTemplateModal(false);
      resetModal();
    }
  }, [uploading, saving, hasUnsavedChanges]);

  // Open new template modal with limit check
  const handleNewTemplate = () => {
    // Check if user has reached their limit
    if (templates.length >= spreadsheetLimit) {
      setAlertModal({
        title: "Template Limit Reached",
        message: `You have reached the maximum of ${spreadsheetLimit} spreadsheet templates for your ${planName} plan.\n\nTo add more templates, please delete an existing one or upgrade your subscription.`,
        showCancel: false,
      });
      return;
    }
    
    resetModal();
    setShowNewTemplateModal(true);
  };

  // Open results/export modal
  const handleOpenResults = (template: SpreadsheetTemplate) => {
    setResultsModalTemplate(template);
  };

  // Update template's updatedAt when products are saved in ResultsModal
  // This ensures the template list is sorted correctly
  const handleTemplateUpdated = useCallback(() => {
    if (!resultsModalTemplate) return;
    
    const now = Date.now();
    setTemplates(prev => 
      prev.map(t => 
        t.id === resultsModalTemplate.id 
          ? { ...t, updatedAt: now } 
          : t
      )
    );
    // Also update the resultsModalTemplate so it stays in sync
    setResultsModalTemplate(prev => 
      prev ? { ...prev, updatedAt: now } : null
    );
  }, [resultsModalTemplate]);

  // Validate file type and size
  const validateFile = (file: File): string | null => {
    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    
    if (!hasValidExtension) {
      return `This file type is not supported.\nPlease upload a CSV (.csv) or Excel file (.xls, .xlsx).`;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
      return `This file is too large (${fileSizeMB} MB).\nMax allowed size is ${MAX_FILE_SIZE_MB} MB. Please split very large catalogs into smaller files (for example by category or season) and upload again.`;
    }

    return null;
  };

  // Handle file selection with validation
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFileError(null);

    if (file) {
      const error = validateFile(file);
      
      if (error) {
        setFileError(error);
        setUploadedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }

      setUploadedFile(file);
      if (!templateName) {
        setTemplateName(file.name.replace(/\.(csv|xlsx?|xls)$/i, ""));
      }
    }
  };

  // Proceed to mapping step - upload file to backend
  const handleProceedToMapping = async () => {
    if (!uploadedFile || !templateName.trim() || !user?.uid) return;

    const error = validateFile(uploadedFile);
    if (error) {
      setFileError(error);
      return;
    }

    try {
      setUploading(true);

      const result = await uploadSpreadsheet(
        user.uid,
        uploadedFile,
        templateName.trim(),
        selectedPlatform
      );

      // Apply auto-mapping to the uploaded columns
      const autoMappedColumns = autoMapColumns(
        result.columns,
        selectedPlatform,
        templates
      );

      setFieldMappings(autoMappedColumns);
      setEditingTemplate(result);
      setRowMode(result.rowMode || "PER_PRODUCT");
      setCurrentStep(2);
    } catch (error: any) {
      console.error("Upload failed:", error);
      
      // Check for specific error codes
      if (error instanceof SpreadsheetApiError && error.code === "SPREADSHEET_LIMIT_REACHED") {
        setAlertModal({
          title: "Template Limit Reached",
          message: error.message,
        });
      } else {
        setAlertModal({
          title: "Upload Failed",
          message: error.message || "Could not upload file. Please try again.",
        });
      }
    } finally {
      setUploading(false);
    }
  };

  // Update field mapping locally
  const handleMappingChange = (columnIndex: number, role: FieldRole | null) => {
    // Check for duplicate role (excluding "ignore", null, and image_url which can have multiple)
    if (role && role !== "ignore" && role !== "image_url") {
      const existingIndex = fieldMappings.findIndex(
        (m, idx) => idx !== columnIndex && m.role === role
      );
      
      if (existingIndex !== -1) {
        // Show alert about the duplicate
        setAlertModal({
          title: "Duplicate Field",
          message: `This field role is already assigned to column "${fieldMappings[existingIndex].name}". Each field can only be mapped once.`,
          showCancel: false,
        });
        return; // Don't allow the change
      }
    }
    
    setFieldMappings((prev) =>
      prev.map((m, idx) => {
        if (idx !== columnIndex) return m;
        
        const isNowImageColumn = isImageColumn(role);
        
        return {
          ...m,
          role,
          multiValue: isNowImageColumn ? m.multiValue : false,
          separator: isNowImageColumn ? (m.separator || ",") : ",",
        };
      })
    );
  };

  // Update multiValue toggle - default to comma when enabling, but allow changes
  const handleMultiValueChange = (columnIndex: number, enabled: boolean) => {
    setFieldMappings((prev) =>
      prev.map((m, idx) =>
        idx === columnIndex
          ? { ...m, multiValue: enabled, separator: enabled ? (m.separator || ",") : "" }
          : m
      )
    );
  };

  // Update separator - allow empty, validate on save
  const handleSeparatorChange = (columnIndex: number, separator: string) => {
    setFieldMappings((prev) =>
      prev.map((m, idx) =>
        idx === columnIndex ? { ...m, separator } : m
      )
    );
  };

  // Toggle AI generation for a field
  const handleToggleGeneration = (role: string) => {
    setEnabledGenerations((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  // Get all mapped fields that can be used for AI generation (excluding identity, images, other)
  const getGeneratableFieldMappings = () => {
    return fieldMappings
      .filter((m) => {
        if (!m.role || m.role === "ignore") return false;
        const group = FIELD_ROLE_GROUPS.find((g) =>
          g.options.some((opt) => opt.role === m.role)
        );
        return group && !EXCLUDED_GENERATION_GROUPS.includes(group.id);
      })
      .map((m) => {
        const group = FIELD_ROLE_GROUPS.find((g) =>
          g.options.some((opt) => opt.role === m.role)
        );
        const option = group?.options.find((opt) => opt.role === m.role);
        const generatableField = GENERATABLE_FIELDS.find((gf) =>
          gf.requiredRoles.includes(m.role!)
        );
        return {
          columnName: m.name,
          role: m.role!,
          roleLabel: option?.label || m.role!,
          isRecommended: !!generatableField,
          cost: generatableField?.cost,
        };
      });
  };

  // Count selected generation fields
  const countSelectedGenerations = () => {
    return getGeneratableFieldMappings().filter((f) =>
      enabledGenerations.has(f.role)
    ).length;
  };

  // Calculate estimated credits (only for recommended fields)
  const calculateEstimatedCredits = () => {
    return getGeneratableFieldMappings()
      .filter((f) => enabledGenerations.has(f.role) && f.cost)
      .reduce((sum, f) => sum + (f.cost || 0), 0);
  };

  // Handle Step 2 to Step 3 transition - save platform and structure settings
  const handleProceedToStep3 = async () => {
    if (!user?.uid || !editingTemplate?.id) {
      setCurrentStep(3);
      return;
    }

    try {
      setSaving(true);
      
      const platformChanged = selectedPlatform !== editingTemplate.platform;

      // Save platform and rowMode changes
      const updates: any = {
        rowMode,
        groupByField: rowMode === "PER_IMAGE" ? groupByField : "product_id",
      };
      
      // Update platform if changed
      if (platformChanged) {
        updates.platform = selectedPlatform;
      }

      await updateSpreadsheet(user.uid, editingTemplate.id, updates);
      
      // Only re-run auto-mapping if user interacted with platform dropdown in Step 2
      if (platformTouchedInStep2) {
        // Reload templates to get fresh data for auto-mapping
        const freshTemplates = await getUserSpreadsheets(user.uid);
        setTemplates(freshTemplates);
        
        // Exclude current template from auto-mapping source
        const otherTemplates = freshTemplates.filter(t => t.id !== editingTemplate.id);
        const autoMappedColumns = autoMapColumns(
          fieldMappings,
          selectedPlatform,
          otherTemplates
        );
        setFieldMappings(autoMappedColumns);
      }

      setCurrentStep(3);
    } catch (error: any) {
      console.error("Failed to save Step 2 settings:", error);
      setAlertModal({
        title: "Save Failed",
        message: error.message || "Could not save settings. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Save template mappings
  const handleSaveTemplate = async () => {
    if (!user?.uid || !editingTemplate) return;

    const mappedCount = fieldMappings.filter((m) => m.role && m.role !== "ignore").length;

    if (mappedCount === 0) {
      setAlertModal({
        title: "No Fields Mapped",
        message: "Please map at least one column to a field role before saving.",
      });
      return;
    }

    if (rowMode === "PER_IMAGE") {
      const validation = validatePerImageMode(fieldMappings);
      if (!validation.valid) {
        setAlertModal({
          title: "Validation Error",
          message: validation.error || "PER_IMAGE mode requires SKU or Product ID to be mapped.",
        });
        return;
      }
    }

    // Validate separator for multiValue columns
    const invalidSeparatorColumn = fieldMappings.find(
      (m) => m.multiValue && (!m.separator || m.separator.trim() === "")
    );
    if (invalidSeparatorColumn) {
      setAlertModal({
        title: "Missing Separator",
        message: `Column "${invalidSeparatorColumn.name}" has "Contains multiple URLs" enabled but no separator specified. Please enter a separator or disable the toggle.`,
      });
      return;
    }

    try {
      setSaving(true);

      // Add enableGeneration flag to mappings based on enabledGenerations
      const mappingsWithGeneration = fieldMappings.map((m) => ({
        ...m,
        enableGeneration: m.role ? enabledGenerations.has(m.role) : false,
      }));

      // Update mappings, rowMode, and groupByField
      await updateSpreadsheetMappings(
        user.uid, 
        editingTemplate.id, 
        mappingsWithGeneration, 
        rowMode,
        rowMode === "PER_IMAGE" ? groupByField : "product_id"
      );
      
      // Update platform if changed
      if (selectedPlatform !== editingTemplate.platform) {
        await updateSpreadsheet(user.uid, editingTemplate.id, { platform: selectedPlatform });
      }

      await loadTemplates();

      setShowNewTemplateModal(false);
      resetModal();
      setAlertModal({
        title: "Template Saved",
        message: `"${editingTemplate.templateName}" has been saved successfully.`,
      });
    } catch (error: any) {
      console.error("Save failed:", error);
      setAlertModal({
        title: "Save Failed",
        message: error.message || "Could not save template. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // Edit template (open mapping step)
  const handleEditTemplate = (template: SpreadsheetTemplate) => {
    setEditingTemplate(template);
    setTemplateName(template.templateName);
    setSelectedPlatform(template.platform);
    setPlatformInputValue(template.platform);
    setFieldMappings(template.columns);
    setRowMode(template.rowMode || "PER_PRODUCT");
    setGroupByField((template as any).groupByField || "product_id");
    setPlatformTouchedInStep2(false);
    
    // Restore enabledGenerations from saved mappings
    const savedGenerations = new Set<string>();
    template.columns.forEach((col) => {
      if (col.enableGeneration && col.role) {
        savedGenerations.add(col.role);
      }
    });
    setEnabledGenerations(savedGenerations);
    
    // Check if template is truly ready (passes Step 3 validation)
    const hasImageUrl = template.columns.some(col => col.role === "image_url");
    const hasProductId = template.columns.some(col => col.role === "product_id");
    const hasSku = template.columns.some(col => col.role === "sku");
    
    let isReady = hasImageUrl;
    if (isReady) {
      if (template.rowMode === "PER_IMAGE") {
        isReady = hasProductId && hasSku;
      } else {
        isReady = hasProductId;
      }
    }
    
    // For ready templates, jump to Step 4 (AI Generation)
    // For unmapped templates, start from Step 2 (Structure)
    setCurrentStep(isReady ? 4 : 2);
    setShowNewTemplateModal(true);
  };

  // Show delete confirmation
  const handleDeleteClick = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    setAlertModal({
      title: "Delete Template",
      message: `Are you sure you want to delete template "${template?.templateName}"?`,
      showCancel: true,
      onConfirm: () => confirmDelete(templateId),
    });
  };

  // Confirm delete
  const confirmDelete = async (templateId: string) => {
    if (!user?.uid) return;

    const template = templates.find((t) => t.id === templateId);
    setAlertModal(null);

    try {
      await deleteSpreadsheetApi(user.uid, templateId);
      await loadTemplates();
      setAlertModal({
        title: "Template Deleted",
        message: `"${template?.templateName}" has been removed.`,
      });
    } catch (error: any) {
      console.error("Delete failed:", error);
      setAlertModal({
        title: "Delete Failed",
        message: error.message || "Could not delete template. Please try again.",
      });
    }
  };

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Count mapped fields
  const countMappedFields = (columns: SpreadsheetColumn[]) => {
    return columns.filter((c) => c.role && c.role !== "ignore").length;
  };

  // Get status badge info (check if template passes Step 3 validation)
  const getStatusBadge = (template: SpreadsheetTemplate) => {
    // Must have image_url mapped
    const hasImageUrl = template.columns.some(col => col.role === "image_url");
    if (!hasImageUrl) {
      return { label: "Mapping required", type: "warning" as const };
    }
    
    const hasProductId = template.columns.some(col => col.role === "product_id");
    const hasSku = template.columns.some(col => col.role === "sku");
    
    if (template.rowMode === "PER_IMAGE") {
      // PER_IMAGE mode: require BOTH product_id AND sku
      if (!hasProductId || !hasSku) {
        return { label: "Mapping required", type: "warning" as const };
      }
    } else {
      // PER_PRODUCT mode: require only product_id
      if (!hasProductId) {
        return { label: "Mapping required", type: "warning" as const };
      }
    }
    
    return { label: "Ready", type: "success" as const };
  };

  // Get row mode label
  const getRowModeLabel = (mode: RowMode) => {
    return mode === "PER_IMAGE" ? "1 Row = 1 Image" : "1 Row = Multi-Image";
  };

  const showEmptyState = !loading && templates.length === 0;

  return (
    <Container>
      <PageHeader>
        <TitleSection>
          <PageTitle>Spreadsheet Templates</PageTitle>
          <PageSubtitle>
            Connect your product spreadsheets from Shopify, Amazon, ERPs, and more.
          </PageSubtitle>
          {/* Template quota hint */}
          {!loading && (
            <QuotaHint>
              Templates: {templates.length} / {spreadsheetLimit} ({planName} plan)
              {templates.length >= spreadsheetLimit - 1 && templates.length < spreadsheetLimit && (
                <span> · Almost at limit</span>
              )}
              {templates.length >= spreadsheetLimit && (
                <span> · Limit reached</span>
              )}
              {spreadsheetLimit < SPREADSHEET_LIMITS.studio && (
                <UpgradeLink href="/pricing">Upgrade for more</UpgradeLink>
              )}
            </QuotaHint>
          )}
        </TitleSection>
        {!showEmptyState && !loading && (
          <HeaderActions>
            <CreateButton onClick={handleNewTemplate}>
              + New Template
            </CreateButton>
          </HeaderActions>
        )}
      </PageHeader>

      {loading ? (
        <LoadingCard>Loading your templates...</LoadingCard>
      ) : showEmptyState ? (
        <EmptyCard>
          <EmptyIcon>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </EmptyIcon>
          <EmptyTitle>No spreadsheet templates yet</EmptyTitle>
          <EmptyText>
            Upload a CSV or Excel file and map its columns once. We'll reuse it for bulk image and description generation later.
          </EmptyText>
          <CreateButton onClick={handleNewTemplate}>
            + Upload your first file
          </CreateButton>
        </EmptyCard>
      ) : (
        <TemplateListCard>
          {/* Platform Tabs */}
          <PlatformTabsContainer>
            <PlatformTab
              $active={activePlatformTab === "all"}
              onClick={() => setActivePlatformTab("all")}
            >
              All
              <PlatformTabCount>({templates.length})</PlatformTabCount>
            </PlatformTab>
            {sortedPlatforms.map((platform) => {
              const count = templates.filter(t => t.platform === platform).length;
              return (
                <PlatformTab
                  key={platform}
                  $active={activePlatformTab === platform}
                  onClick={() => setActivePlatformTab(platform)}
                >
                  {platform}
                  <PlatformTabCount>({count})</PlatformTabCount>
                </PlatformTab>
              );
            })}
          </PlatformTabsContainer>
          
          {displayedTemplates.length === 0 && activePlatformTab !== "all" ? (
            <EmptyFilterMessage>
              No templates for "{activePlatformTab}" platform.
              <EmptyFilterButton onClick={() => setActivePlatformTab("all")}>
                View all templates
              </EmptyFilterButton>
            </EmptyFilterMessage>
          ) : (
            <TemplateList>
              {displayedTemplates.map((template) => {
                const statusBadge = getStatusBadge(template);
                const isReady = statusBadge.type === "success";
                return (
                  <TemplateCard key={template.id}>
                    <TemplateInfo>
                      <TemplateNameRow>
                        <TemplateName>{template.templateName}</TemplateName>
                        <StatusBadge $type={statusBadge.type}>
                          {statusBadge.label}
                        </StatusBadge>
                      </TemplateNameRow>
                      <TemplateMeta>
                        <MetaBadge>{template.platform}</MetaBadge>
                        <MetaBadge>{template.fileType}</MetaBadge>
                        <MetaBadge>{getRowModeLabel(template.rowMode)}</MetaBadge>
                        <MetaText>{template.rowCount.toLocaleString()} rows</MetaText>
                        <MetaText>
                          {countMappedFields(template.columns)} / {template.columns.length} fields
                        </MetaText>
                        <MetaText>{formatDate(template.updatedAt)}</MetaText>
                      </TemplateMeta>
                    </TemplateInfo>
                    <TemplateActions>
                      {isReady && (
                        <ExportBtn onClick={() => handleOpenResults(template)}>
                          Export
                        </ExportBtn>
                      )}
                      <EditBtn onClick={() => handleEditTemplate(template)}>
                        {isReady ? "Edit" : "Continue Mapping"}
                      </EditBtn>
                      <DeleteBtn onClick={() => handleDeleteClick(template.id)}>Delete</DeleteBtn>
                    </TemplateActions>
                  </TemplateCard>
                );
              })}
            </TemplateList>
          )}
        </TemplateListCard>
      )}

      {/* Results/Export Modal */}
      {resultsModalTemplate && user?.uid && (
        <SpreadsheetResultsModal
          isOpen={!!resultsModalTemplate}
          onClose={() => setResultsModalTemplate(null)}
          template={resultsModalTemplate}
          userId={user.uid}
          onTemplateUpdated={handleTemplateUpdated}
        />
      )}

      {/* New Template Modal */}
      {showNewTemplateModal && (
        <Overlay onClick={handleCloseModal}>
          <Modal onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>
                {editingTemplate && currentStep >= 2 ? "Edit Template" : "New Spreadsheet Template"}
              </ModalTitle>
              <CloseBtn 
                onClick={handleCloseModal}
                disabled={uploading || saving}
              >
                ×
              </CloseBtn>
            </ModalHeader>

            <StepIndicator>
              <StepItem $active={currentStep === 1} $completed={currentStep > 1}>
                <StepNumber $active={currentStep === 1} $completed={currentStep > 1}>
                  {currentStep > 1 ? "✓" : "1"}
                </StepNumber>
                <StepLabel>Upload</StepLabel>
              </StepItem>
              <StepConnector $active={currentStep > 1} />
              <StepItem $active={currentStep === 2} $completed={currentStep > 2}>
                <StepNumber $active={currentStep === 2} $completed={currentStep > 2}>
                  {currentStep > 2 ? "✓" : "2"}
                </StepNumber>
                <StepLabel>Structure</StepLabel>
              </StepItem>
              <StepConnector $active={currentStep > 2} />
              <StepItem $active={currentStep === 3} $completed={currentStep > 3}>
                <StepNumber $active={currentStep === 3} $completed={currentStep > 3}>
                  {currentStep > 3 ? "✓" : "3"}
                </StepNumber>
                <StepLabel>Map Fields</StepLabel>
              </StepItem>
              <StepConnector $active={currentStep > 3} />
              <StepItem $active={currentStep === 4}>
                <StepNumber $active={currentStep === 4}>4</StepNumber>
                <StepLabel>AI Generation</StepLabel>
              </StepItem>
            </StepIndicator>

            <ModalBody>
              {currentStep === 1 && (
                <Step1Content>
                  <FormGroup>
                    <FormLabel>Template Name</FormLabel>
                    <FormInputBorderless
                      type="text"
                      placeholder="e.g., Shopify Products Export"
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      disabled={uploading}
                    />
                  </FormGroup>

                  <FormGroup>
                    <FormLabel>Platform</FormLabel>
                    <PlatformComboWrapper>
                      <PlatformInput
                        ref={platformInputRef}
                        type="text"
                        placeholder="Type or select..."
                        value={platformInputValue}
                        onChange={(e) => {
                          setPlatformInputValue(e.target.value);
                          setSelectedPlatform(e.target.value);
                          setPlatformDropdownOpen(true);
                        }}
                        onFocus={() => setPlatformDropdownOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setSelectedPlatform(platformInputValue);
                            setPlatformDropdownOpen(false);
                          }
                        }}
                        disabled={uploading}
                      />
                      <PlatformDropdownIcon 
                        $disabled={uploading}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </PlatformDropdownIcon>
                      {platformDropdownOpen && (
                        <PlatformDropdown ref={platformDropdownRef}>
                          {filteredPlatforms.map((platform) => (
                            <PlatformOption
                              key={platform}
                              onClick={() => {
                                setSelectedPlatform(platform);
                                setPlatformInputValue(platform);
                                setPlatformDropdownOpen(false);
                              }}
                              $selected={platform.toLowerCase() === platformInputValue.toLowerCase()}
                            >
                              {platform.toLowerCase() === platformInputValue.toLowerCase() && <span style={{ marginRight: 6 }}>✓</span>}
                              {platform}
                            </PlatformOption>
                          ))}
                          {isCustomPlatform && platformInputValue.trim() && (
                            <PlatformOptionHint
                              onClick={() => {
                                setSelectedPlatform(platformInputValue);
                                setPlatformDropdownOpen(false);
                              }}
                              
                            >
                              Press Enter to add "{platformInputValue}"
                            </PlatformOptionHint>
                          )}
                        </PlatformDropdown>
                      )}
                    </PlatformComboWrapper>
                    <PlatformHintText>
                      Select from list or type a custom platform name. Fields will <strong>auto-map</strong> based on the <strong>most recently updated template</strong> with the <strong>same platform</strong>.
                    </PlatformHintText>
                  </FormGroup>

                  <FormGroup>
                    <FormLabel>Upload Spreadsheet</FormLabel>
                    <UploadArea
                      onClick={() => !uploading && fileInputRef.current?.click()}
                      $hasFile={!!uploadedFile}
                      $hasError={!!fileError}
                      $disabled={uploading}
                    >
                      {uploadedFile ? (
                        <>
                          <UploadedFileIcon>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </UploadedFileIcon>
                          <UploadedFileName>{uploadedFile.name}</UploadedFileName>
                          <UploadHint>Click to change file</UploadHint>
                        </>
                      ) : (
                        <>
                          <UploadIcon>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                          </UploadIcon>
                          <UploadText>
                            Click to upload or drag and drop
                          </UploadText>
                          <UploadHint>CSV, XLS, or XLSX files</UploadHint>
                        </>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xls,.xlsx"
                        onChange={handleFileChange}
                        style={{ display: "none" }}
                        disabled={uploading}
                      />
                    </UploadArea>

                    {fileError && (
                      <FileErrorMessage>
                        {fileError.split("\n").map((line, i) => (
                          <span key={i}>{line}</span>
                        ))}
                      </FileErrorMessage>
                    )}

                    <FileHelperText>
                      <span>
                        Supported formats: <strong>CSV (.csv)</strong> and <strong>Excel (.xls, .xlsx)</strong>
                      </span>
                      <span>
                        Max file size: <strong>{MAX_FILE_SIZE_MB} MB</strong> (enough for tens of thousands of rows in most catalogs).
                      </span>
                      <span>
                        For very large catalogs, we recommend splitting by category or season for better performance.
                      </span>
                    </FileHelperText>
                  </FormGroup>
                </Step1Content>
              )}

              {currentStep === 2 && (
                <Step2Content>
                  {/* Platform Selection */}
                  <FormGroup>
                    <FormLabel>Platform</FormLabel>
                    <PlatformComboWrapper>
                      <PlatformInput
                        type="text"
                        placeholder="Type or select..."
                        value={platformInputValue}
                        onChange={(e) => {
                          setPlatformInputValue(e.target.value);
                          setSelectedPlatform(e.target.value);
                          setPlatformDropdownOpen(true);
                          setPlatformTouchedInStep2(true);
                        }}
                        onFocus={() => setPlatformDropdownOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            setSelectedPlatform(platformInputValue);
                            setPlatformDropdownOpen(false);
                            setPlatformTouchedInStep2(true);
                          }
                        }}
                        disabled={saving}
                      />
                      <PlatformDropdownIcon 
                        $disabled={saving}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </PlatformDropdownIcon>
                      {platformDropdownOpen && (
                        <PlatformDropdown ref={platformDropdownRef}>
                          {filteredPlatforms.map((platform) => (
                            <PlatformOption
                              key={platform}
                              onClick={() => {
                                setSelectedPlatform(platform);
                                setPlatformInputValue(platform);
                                setPlatformDropdownOpen(false);
                                setPlatformTouchedInStep2(true);
                              }}
                              $selected={platform.toLowerCase() === platformInputValue.toLowerCase()}
                            >
                              {platform.toLowerCase() === platformInputValue.toLowerCase() && <span style={{ marginRight: 6 }}>✓</span>}
                              {platform}
                            </PlatformOption>
                          ))}
                          {isCustomPlatform && platformInputValue.trim() && (
                            <PlatformOptionHint
                              onClick={() => {
                                setSelectedPlatform(platformInputValue);
                                setPlatformDropdownOpen(false);
                                setPlatformTouchedInStep2(true);
                              }}
                              
                            >
                              Press Enter to add "{platformInputValue}"
                            </PlatformOptionHint>
                          )}
                        </PlatformDropdown>
                      )}
                    </PlatformComboWrapper>
                    <PlatformHintText>
                      Select from list or type a custom platform name. If you make <strong>any changes</strong> to this dropdown, fields will <strong>auto-map</strong> based on the <strong>most recently updated template</strong> with the <strong>same platform</strong>.
                    </PlatformHintText>
                  </FormGroup>

                  {/* Row Structure Selection - Guided Questions */}
                  <RowModeSection>
                    <RowModeLabel>How are images organized in your spreadsheet?</RowModeLabel>
                    <RowModeOptions>
                      {/* Multiple images per row (PER_PRODUCT) - Default, on top */}
                      <RowModeOption
                        $active={rowMode === "PER_PRODUCT"}
                        onClick={() => setRowMode("PER_PRODUCT")}
                      >
                        <RowModeRadio $active={rowMode === "PER_PRODUCT"} />
                        <RowModeContent>
                          <RowModeTitle $active={rowMode === "PER_PRODUCT"}>Multiple images per row</RowModeTitle>
                          <RowModeDesc $active={rowMode === "PER_PRODUCT"}>Each row has multiple image columns or comma-separated URLs</RowModeDesc>
                        </RowModeContent>
                      </RowModeOption>
                      {/* One image per row (PER_IMAGE) */}
                      <RowModeOption
                        $active={rowMode === "PER_IMAGE"}
                        onClick={() => setRowMode("PER_IMAGE")}
                      >
                        <RowModeRadio $active={rowMode === "PER_IMAGE"} />
                        <RowModeContent>
                          <RowModeTitle $active={rowMode === "PER_IMAGE"}>One image per row</RowModeTitle>
                          <RowModeDesc $active={rowMode === "PER_IMAGE"}>Each row has one image URL (e.g. Shopify product export)</RowModeDesc>
                        </RowModeContent>
                      </RowModeOption>
                    </RowModeOptions>
                    
                    {/* Group By Field Selection - only show for PER_IMAGE mode */}
                    {rowMode === "PER_IMAGE" && (
                      <GroupBySection>
                        <GroupByLabel>How should rows be grouped into products?</GroupByLabel>
                        <GroupByOptions>
                          <GroupByOption
                            $active={groupByField === "product_id"}
                            onClick={() => setGroupByField("product_id")}
                          >
                            <GroupByRadio $active={groupByField === "product_id"} />
                            <GroupByText $active={groupByField === "product_id"}>By Product ID / Handle</GroupByText>
                          </GroupByOption>
                          <GroupByOption
                            $active={groupByField === "sku"}
                            onClick={() => setGroupByField("sku")}
                          >
                            <GroupByRadio $active={groupByField === "sku"} />
                            <GroupByText $active={groupByField === "sku"}>By SKU (each variant separate)</GroupByText>
                          </GroupByOption>
                        </GroupByOptions>
                        <GroupByHint>
                          {groupByField === "product_id" 
                            ? "All rows with the same Product ID will be grouped as one product"
                            : "Each unique SKU will be shown as a separate product"}
                        </GroupByHint>
                      </GroupBySection>
                    )}
                  </RowModeSection>
                </Step2Content>
              )}

              {currentStep === 3 && (
                <Step2Content>
                  <MappingHelperSection>
                    <MappingHelperTitle>
                      Map each column to a product field so we can use your spreadsheet consistently across platforms.
                    </MappingHelperTitle>
                    <MappingHelperHint>
                      Fields are auto-mapped based on the most recently updated template with the same platform. You can adjust mappings below.
                    </MappingHelperHint>
                    <MappingHelperHint>
                      Only map the essentials: <strong>Product ID</strong>, <strong>SKU</strong>, <strong>all Image URLs</strong>, 
                      and <strong>any fields you want AI</strong> to generate content for in this app.
                    </MappingHelperHint>
                  </MappingHelperSection>

                  <MappingList>
                    {fieldMappings.map((mapping, idx) => (
                      <MappingItem key={idx}>
                        <MappingRow $hasMultiValue={isImageColumn(mapping.role)}>
                          <ColumnInfo>
                            <ColumnName>{mapping.name}</ColumnName>
                            {mapping.sampleValues.length > 0 && (
                              <ColumnSample>
                                e.g. {mapping.sampleValues.slice(0, 2).join(", ")}
                              </ColumnSample>
                            )}
                          </ColumnInfo>
                          <MappingArrow>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="5" y1="12" x2="19" y2="12" />
                              <polyline points="12 5 19 12 12 19" />
                            </svg>
                          </MappingArrow>
                          <RoleSelect
                            value={mapping.role || ""}
                            onChange={(e) =>
                              handleMappingChange(idx, (e.target.value as FieldRole) || null)
                            }
                            $hasValue={!!mapping.role}
                            disabled={saving}
                          >
                            <option value="">Select field role...</option>
                            {FIELD_ROLE_GROUPS.map((group) => (
                              <optgroup key={group.id} label={group.label}>
                                {group.options.map((opt) => (
                                  <option key={opt.role} value={opt.role}>
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </RoleSelect>
                        </MappingRow>

                        {/* Multi-value options for image columns */}
                        {isImageColumn(mapping.role) && (
                          <MultiValueSection>
                            <MultiValueRow>
                              <MultiValueToggle
                                onClick={() => handleMultiValueChange(idx, !mapping.multiValue)}
                              >
                                <ToggleTrack $active={mapping.multiValue || false}>
                                  <ToggleThumb $active={mapping.multiValue || false} />
                                </ToggleTrack>
                                <MultiValueLabel>Contains multiple URLs</MultiValueLabel>
                              </MultiValueToggle>
                              {mapping.multiValue && (
                                <SeparatorGroup>
                                  <SeparatorLabel>Separator</SeparatorLabel>
                                  <SeparatorField
                                    type="text"
                                    value={mapping.separator || ","}
                                    onChange={(e) => handleSeparatorChange(idx, e.target.value)}
                                    placeholder=","
                                    maxLength={5}
                                  />
                                </SeparatorGroup>
                              )}
                            </MultiValueRow>
                          </MultiValueSection>
                        )}
                      </MappingItem>
                    ))}
                  </MappingList>

                  {rowModeValidationError && (
                    <RowModeError>{rowModeValidationError}</RowModeError>
                  )}

                  <RecommendedHint>
                    Recommended: map at least Product Title, Main Image URL, Category, Price, and any size / weight fields you want to show in product content and exports.
                    {rowMode === "PER_IMAGE" && " For one-image-per-row format, SKU or Product ID is required for grouping."}
                  </RecommendedHint>
                </Step2Content>
              )}

              {/* Step 4: AI Generation */}
              {currentStep === 4 && (
                <Step4Content>
                  <Step4Header>
                    <Step4Title>Select AI-Generated Fields</Step4Title>
                    <Step4Desc>
                      Choose which fields should be auto-generated. Fields marked with ✦ have optimized prompts for best results.
                    </Step4Desc>
                  </Step4Header>

                  <GenerationList>
                    {getGeneratableFieldMappings().map((field) => {
                      const isEnabled = enabledGenerations.has(field.role);

                      return (
                        <GenerationItem 
                          key={field.role}
                          onClick={() => handleToggleGeneration(field.role)}
                        >
                          <GenerationCheckbox $checked={isEnabled}>
                            {isEnabled && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </GenerationCheckbox>
                          <GenerationInfo>
                            <GenerationName>
                              {field.roleLabel}
                              {field.isRecommended && <RecommendedBadge>✦ Recommended</RecommendedBadge>}
                            </GenerationName>
                            <GenerationMapped>← "{field.columnName}"</GenerationMapped>
                          </GenerationInfo>
                          {field.isRecommended && field.cost && (
                            <GenerationCost>~{field.cost} cr</GenerationCost>
                          )}
                        </GenerationItem>
                      );
                    })}
                  </GenerationList>

                  {getGeneratableFieldMappings().length === 0 && (
                    <EmptyGenerationHint>
                      No content fields mapped yet. Go back to Step 3 to map fields like Title, Description, Tags, etc.
                    </EmptyGenerationHint>
                  )}

                  <GenerationSummary>
                    Selected: {countSelectedGenerations()} fields
                    {calculateEstimatedCredits() > 0 && ` · Est. ~${calculateEstimatedCredits()} credits per product`}
                  </GenerationSummary>
                </Step4Content>
              )}
            </ModalBody>

            <ModalFooter>
              {currentStep === 2 && !editingTemplate?.id && (
                <SecondaryBtn onClick={() => setCurrentStep(1)} disabled={saving}>
                  Back
                </SecondaryBtn>
              )}
              {currentStep === 3 && (
                <SecondaryBtn onClick={() => setCurrentStep(2)} disabled={saving}>
                  Back
                </SecondaryBtn>
              )}
              {currentStep === 4 && (
                <SecondaryBtn onClick={() => setCurrentStep(3)} disabled={saving}>
                  Back
                </SecondaryBtn>
              )}
              <FooterSpacer />
              <SecondaryBtn 
                onClick={handleCloseModal}
                disabled={uploading || saving}
              >
                Cancel
              </SecondaryBtn>
              {currentStep === 1 && (
                <PrimaryBtn
                  onClick={handleProceedToMapping}
                  disabled={!uploadedFile || !templateName.trim() || !selectedPlatform.trim() || uploading || !!fileError}
                >
                  {uploading ? "Uploading..." : "Continue"}
                </PrimaryBtn>
              )}
              {currentStep === 2 && (
                <PrimaryBtn
                  onClick={handleProceedToStep3}
                  disabled={saving || !selectedPlatform.trim()}
                >
                  {saving ? "Saving..." : "Next Step"}
                </PrimaryBtn>
              )}
              {currentStep === 3 && (
                <PrimaryBtn
                  onClick={() => {
                    // Check for duplicate roles (excluding ignore, null, and image_url which can have multiple)
                    const roleCount: Record<string, number[]> = {};
                    fieldMappings.forEach((m, idx) => {
                      if (m.role && m.role !== "ignore" && m.role !== "image_url") {
                        if (!roleCount[m.role]) roleCount[m.role] = [];
                        roleCount[m.role].push(idx);
                      }
                    });
                    
                    const duplicates = Object.entries(roleCount).filter(([_, indices]) => indices.length > 1);
                    if (duplicates.length > 0) {
                      const duplicateNames = duplicates.map(([role]) => {
                        const fieldLabel = FIELD_ROLE_GROUPS
                          .flatMap(g => g.options)
                          .find(o => o.role === role)?.label || role;
                        return fieldLabel;
                      });
                      setAlertModal({
                        title: "Duplicate Fields Detected",
                        message: `The following fields are mapped more than once: ${duplicateNames.join(", ")}. Each field role can only be assigned once.`,
                        showCancel: false,
                      });
                      return;
                    }
                    
                    // Validate required fields based on rowMode
                    const hasProductId = fieldMappings.some(m => m.role === "product_id");
                    const hasSku = fieldMappings.some(m => m.role === "sku");
                    const hasImageUrl = fieldMappings.some(m => m.role === "image_url");
                    
                    // Check image URL mapping for both modes
                    if (!hasImageUrl) {
                      setAlertModal({
                        title: "Image URL Required",
                        message: "You must map at least one Image URL column so we can process your product images.",
                        showCancel: false,
                      });
                      return;
                    }
                    
                    if (rowMode === "PER_IMAGE") {
                      // One image per row: require BOTH product_id AND sku
                      if (!hasProductId || !hasSku) {
                        const missing: string[] = [];
                        if (!hasProductId) missing.push("Product ID / Handle");
                        if (!hasSku) missing.push("SKU");
                        setAlertModal({
                          title: "Required Fields Missing",
                          message: `For "One image per row" mode, you must map both ${missing.join(" and ")} to identify and group your products.`,
                          showCancel: false,
                        });
                        return;
                      }
                    } else {
                      // Multiple images per row (PER_PRODUCT): require only product_id
                      if (!hasProductId) {
                        setAlertModal({
                          title: "Required Field Missing",
                          message: `For "Multiple images per row" mode, you must map Product ID / Handle to identify your products.`,
                          showCancel: false,
                        });
                        return;
                      }
                    }
                    
                    setCurrentStep(4);
                  }}
                  disabled={saving || !!rowModeValidationError}
                >
                  Next Step
                </PrimaryBtn>
              )}
              {currentStep === 4 && (
                <PrimaryBtn 
                  onClick={handleSaveTemplate} 
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Template"}
                </PrimaryBtn>
              )}
            </ModalFooter>
          </Modal>
        </Overlay>
      )}

      {/* Alert Modal */}
      {alertModal && (
        <AlertModal
          title={alertModal.title}
          message={alertModal.message}
          showCancel={alertModal.showCancel}
          onClose={() => setAlertModal(null)}
          onConfirm={alertModal.onConfirm}
          confirmText={alertModal.confirmText}
          cancelText={alertModal.cancelText}
        />
      )}
    </Container>
  );
}

/* ============ Styles ============ */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const PageHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
`;

const TitleSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const PageTitle = styled.h1`
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  letter-spacing: -0.5px;
`;

const PageSubtitle = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
`;

const HeaderActions = styled.div`
  display: flex;
  gap: 12px;
`;

const CreateButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 18px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

// Template quota hint
const QuotaHint = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  
  span {
    color: ${({ theme }) => theme.colors.accent};
    font-weight: 600;
  }
`;

const UpgradeLink = styled.a`
  margin-left: 8px;
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 600;
  text-decoration: none;
  
  &:hover {
    text-decoration: underline;
  }
`;

const LoadingCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 60px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

/* Empty State */
const EmptyCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 60px 40px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
`;

const EmptyIcon = styled.div`
  color: ${({ theme }) => theme.colors.muted};
  opacity: 0.5;
`;

const EmptyTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyText = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.muted};
  max-width: 400px;
  line-height: 1.6;
`;

/* Template List */
const TemplateListCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 20px;
`;

/* Platform Tabs */
const PlatformTabsContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  margin-bottom: 16px;
  overflow-x: auto;
  flex-wrap: wrap;
  
  /* Hide scrollbar but allow scrolling */
  &::-webkit-scrollbar {
    height: 0;
  }
`;

const PlatformTab = styled.button<{ $active?: boolean }>`
  padding: 8px 16px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  
  background: ${({ $active, theme }) => 
    $active ? theme.colors.accent : 'transparent'};
  color: ${({ $active, theme }) => 
    $active ? theme.colors.white : theme.colors.text};
  
  &:hover {
    background: ${({ $active, theme }) => 
      $active ? theme.colors.accent : theme.colors.bg};
  }
`;

const PlatformTabCount = styled.span`
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.8;
`;

const EmptyFilterMessage = styled.div`
  text-align: center;
  padding: 40px 20px;
  color: ${({ theme }) => theme.colors.muted};
  font-size: 14px;
`;

const EmptyFilterButton = styled.button`
  display: block;
  margin: 12px auto 0;
  padding: 8px 16px;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  
  &:hover {
    opacity: 0.9;
  }
`;

const TemplateList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const TemplateCard = styled.div`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  transition: all 0.2s;

  &:hover {
    background: ${({ theme }) => theme.colors.bg};
  }

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
`;

const TemplateInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
`;

const TemplateNameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const TemplateName = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

/* Status badge using theme colors */
const StatusBadge = styled.span<{ $type: "success" | "warning" }>`
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: ${({ $type, theme }) => 
    $type === "success" ? theme.colors.accent : theme.colors.border};
  color: ${({ $type, theme }) => 
    $type === "success" ? theme.colors.white : theme.colors.text};
`;

const TemplateMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const MetaBadge = styled.span`
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
`;

const MetaText = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const TemplateActions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
`;

// Export button - accent color
const ExportBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const EditBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const DeleteBtn = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

/* Modal */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  width: 100%;
  max-width: 680px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
`;

const ModalHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const ModalTitle = styled.h2`
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const CloseBtn = styled.button<{ disabled?: boolean }>`
  background: none;
  border: none;
  font-size: 28px;
  color: ${({ theme }) => theme.colors.muted};
  cursor: ${({ disabled }) => (disabled ? "not-allowed" : "pointer")};
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
  opacity: ${({ disabled }) => (disabled ? 0.5 : 1)};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const ModalBody = styled.div`
  padding: 24px 28px;
  overflow-y: auto;
  flex: 1;
`;

const ModalFooter = styled.div`
  display: flex;
  gap: 12px;
  padding: 20px 28px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;

const FooterSpacer = styled.div`
  flex: 1;
`;

const PrimaryBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 18px;
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

const SecondaryBtn = styled.button`
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 18px;
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

/* Step Indicator */
const StepIndicator = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 20px 28px;
  background: ${({ theme }) => theme.colors.inner};
`;

const StepItem = styled.div<{ $active?: boolean; $completed?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: ${({ $active, $completed }) => ($active || $completed ? 1 : 0.5)};
`;

const StepNumber = styled.div<{ $active?: boolean; $completed?: boolean }>`
  width: 28px;
  height: 28px;
  min-width: 28px;
  min-height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  background: ${({ $active, $completed, theme }) =>
    $active || $completed ? theme.colors.accent : theme.colors.border};
  color: ${({ $active, $completed, theme }) =>
    $active || $completed ? theme.colors.white : theme.colors.muted};
`;

const StepLabel = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const StepConnector = styled.div<{ $active?: boolean }>`
  width: 40px;
  height: 2px;
  background: ${({ $active, theme }) =>
    $active ? theme.colors.accent : theme.colors.border};
  margin: 0 8px;
`;

/* Step 1: Upload */
const Step1Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const FormLabel = styled.label`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const FormInputBorderless = styled.input`
  padding: 12px 16px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  transition: all 0.15s;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.accent}40;
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const PlatformSelect = styled.select`
  padding: 10px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.accent};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  cursor: pointer;
  transition: opacity 0.15s;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;

  &:focus {
    outline: none;
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  option {
    background: ${({ theme }) => theme.colors.card};
    color: ${({ theme }) => theme.colors.text};
  }
`;

/* Platform Combo Input */
const PlatformComboWrapper = styled.div`
  position: relative;
  width: 100%;
`;

const PlatformInput = styled.input`
  width: 100%;
  padding: 10px 36px 10px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.accent};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  transition: opacity 0.15s;
  cursor: text;
  box-sizing: border-box;

  &:focus {
    outline: none;
    opacity: 0.9;
  }

  &::placeholder {
    color: ${({ theme }) => theme.colors.white};
    opacity: 0.7;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  &:hover:not(:disabled) {
    opacity: 0.95;
  }
`;

const PlatformDropdownIcon = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: ${({ theme }) => theme.colors.white};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  display: flex;
  align-items: center;
  pointer-events: none;
`;

const PlatformDropdown = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.md};
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
`;

const PlatformOption = styled.div<{ $selected?: boolean }>`
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  background: ${({ theme, $selected }) => ($selected ? theme.colors.inner : "transparent")};
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
  }
`;

const PlatformOptionHint = styled.div`
  padding: 10px 14px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  font-style: italic;
  cursor: pointer;
  transition: background 0.15s;
  border-top: 1px solid ${({ theme }) => theme.colors.border};

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const PlatformHintText = styled.p`
  margin: 8px 0 0 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
  
  strong {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const UploadArea = styled.div<{ $hasFile?: boolean; $hasError?: boolean; $disabled?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 24px;
  border: 2px dashed ${({ theme, $hasFile }) =>
    $hasFile ? theme.colors.accent : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  transition: all 0.2s;
  opacity: ${({ $disabled }) => ($disabled ? 0.6 : 1)};

  &:hover {
    border-color: ${({ theme, $disabled }) => 
      !$disabled && theme.colors.accent};
  }
`;

const UploadIcon = styled.div`
  color: ${({ theme }) => theme.colors.accent};
  opacity: 0.7;
`;

const UploadedFileIcon = styled.div`
  color: ${({ theme }) => theme.colors.accent};
`;

const UploadedFileName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const UploadText = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const UploadHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const FileErrorMessage = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  background: ${({ theme }) => theme.colors.accent}20;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.5;
`;

const FileHelperText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;

  strong {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.text};
  }
`;

/* Step 2: Mapping */
const Step2Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

/* Row Mode Section */
const RowModeSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const RowModeLabel = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const RowModeOptions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const RowModeOption = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: ${({ theme, $active }) => ($active ? theme.colors.accent : theme.colors.bg)};
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    opacity: 0.9;
  }
`;

const RowModeRadio = styled.div<{ $active?: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ theme, $active }) => ($active ? theme.colors.white : theme.colors.border)};
  background: ${({ theme, $active }) => ($active ? theme.colors.white : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;

  &::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.accent};
    opacity: ${({ $active }) => ($active ? 1 : 0)};
  }
`;

const RowModeContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RowModeTitle = styled.div<{ $active?: boolean }>`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.text};
`;

const RowModeDesc = styled.div<{ $active?: boolean }>`
  font-size: 12px;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.muted};
`;

const RowModeError = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  padding: 10px 14px;
  background: ${({ theme }) => theme.colors.accent}20;
  border-radius: ${({ theme }) => theme.radius.sm};
`;

const GroupBySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.sm};
  margin-top: 4px;
`;

const GroupByLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const GroupByOptions = styled.div`
  display: flex;
  gap: 8px;
`;

const GroupByOption = styled.div<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: ${({ theme, $active }) => ($active ? theme.colors.accent : theme.colors.inner)};
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  transition: all 0.15s;
  flex: 1;

  &:hover {
    opacity: 0.9;
  }
`;

const GroupByRadio = styled.div<{ $active?: boolean }>`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid ${({ theme, $active }) => ($active ? theme.colors.white : theme.colors.border)};
  background: ${({ theme, $active }) => ($active ? theme.colors.white : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &::after {
    content: "";
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.accent};
    opacity: ${({ $active }) => ($active ? 1 : 0)};
  }
`;

const GroupByText = styled.div<{ $active?: boolean }>`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme, $active }) => $active ? theme.colors.white : theme.colors.text};
`;

const GroupByHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: 4px;
  padding-left: 2px;
`;

const MappingHelperSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
`;

const MappingHelperTitle = styled.p`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  line-height: 1.5;
`;

const MappingHelperHint = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
  
  strong {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const MappingList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const MappingItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0;
`;

const MappingRow = styled.div<{ $hasMultiValue?: boolean }>`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme, $hasMultiValue }) => 
    $hasMultiValue ? `${theme.radius.md} ${theme.radius.md} 0 0` : theme.radius.md};
`;

const ColumnInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const ColumnName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ColumnSample = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
`;

const MappingArrow = styled.div`
  color: ${({ theme }) => theme.colors.muted};
  flex-shrink: 0;
`;

/* Native select with optgroup support */
const RoleSelect = styled.select<{ $hasValue?: boolean }>`
  flex: 1;
  min-width: 200px;
  padding: 10px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.accent};
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  cursor: pointer;
  transition: opacity 0.15s;

  &:focus {
    outline: none;
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  option {
    background: ${({ theme }) => theme.colors.card};
    color: ${({ theme }) => theme.colors.text};
    padding: 8px;
  }

  optgroup {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
    font-weight: 700;
    font-style: normal;
  }
`;

/* Multi-value Section - Clean toggle design */
const MultiValueSection = styled.div`
  padding: 10px 16px;
  background: ${({ theme }) => theme.colors.bg};
  border-radius: 0 0 ${({ theme }) => theme.radius.md} ${({ theme }) => theme.radius.md};
`;

const MultiValueRow = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
`;

const MultiValueToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
`;

/* Toggle Switch */
const ToggleTrack = styled.div<{ $active?: boolean }>`
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: ${({ theme, $active }) => ($active ? theme.colors.accent : theme.colors.border)};
  position: relative;
  transition: background 0.2s;
`;

const ToggleThumb = styled.div<{ $active?: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.white};
  position: absolute;
  top: 2px;
  left: ${({ $active }) => ($active ? "18px" : "2px")};
  transition: left 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
`;

const MultiValueLabel = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const SeparatorGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SeparatorLabel = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const SeparatorField = styled.input`
  width: 48px;
  padding: 6px 10px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.colors.white};
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  text-align: center;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.accent}40;
  }
`;

const RecommendedHint = styled.p`
  margin: 0;
  padding: 12px 16px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;

/* Step 4: AI Generation */
const Step4Content = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const Step4Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Step4Title = styled.h3`
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const Step4Desc = styled.p`
  margin: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

const GenerationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const GenerationItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    opacity: 0.9;
  }
`;

const GenerationCheckbox = styled.div<{ $checked?: boolean }>`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 2px solid ${({ theme, $checked }) => ($checked ? theme.colors.accent : theme.colors.border)};
  background: ${({ theme, $checked }) => ($checked ? theme.colors.accent : "transparent")};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  color: ${({ theme }) => theme.colors.white};
  transition: all 0.15s;
`;

const GenerationInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const GenerationName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const GenerationMapped = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const GenerationCost = styled.div`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
  padding: 4px 8px;
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.sm};
  flex-shrink: 0;
`;

const GenerationSummary = styled.div`
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  text-align: center;
`;

const RecommendedBadge = styled.span`
  margin-left: 8px;
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.accent};
`;

const EmptyGenerationHint = styled.div`
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
`;