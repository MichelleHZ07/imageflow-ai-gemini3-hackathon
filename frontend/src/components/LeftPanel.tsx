import React, { useRef, useCallback, memo, useState, useEffect, useMemo } from "react";
import styled from "styled-components";
import { processImageFiles, cleanupImageURLs } from "../lib/imageUtils";
import { dedupeForDisplay, DisplayItem } from "../lib/dedupeUtils";
import { getProxiedImageUrl } from "../lib/imageProxy";
import type { ProductInfo } from "../lib/api";
import type { TargetSpreadsheetConfig } from "./TargetSpreadsheetModal";
import OverrideModal from "./OverrideModal";
import AlertModal from "./AlertModal";
import { InfoTooltip, TitleWithInfo } from "./InfoTooltip";
import {
  ThreeColumnBody,
  LeftColumn,
  RightColumn,
  MiddleColumn,
  ColumnSectionTitle,
  ColumnHeader as ColHeader,
  ColumnTitle as ColTitle,
  CollapsibleSection,
  CollapsibleHeader,
  CollapsibleTitle,
  CollapsibleBody,
  ExpandIcon,
} from "../styles/collapsible";

type WorkMode = "import" | "create";
type SaveTargetMode = "original" | "different" | "default";

// Helper function to create blob URL from base64 data
function base64ToBlobUrl(base64: string): string {
  try {
    // Handle data URL format: "data:image/jpeg;base64,..."
    const parts = base64.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const byteString = atob(parts[1]);
    
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    
    const blob = new Blob([uint8Array], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error("Failed to convert base64 to blob URL:", err);
    return base64; // Fallback to original
  }
}

// 💾 Triple storage: AI-optimized for generation + preview for display
export interface ImageData {
  aiOptimized: string;   // 2048px base64 for AI generation
  previewURL: string;    // 800px Object URL for display
  width: number;
  height: number;
  sourceUrl?: string;    // Track original URL for caching
  displayOnly?: boolean; // True if image can only be displayed (CORS blocked)
}

export interface SpreadsheetSelection {
  templateId: string;
  templateName: string;
  rowMode: "PER_PRODUCT" | "PER_IMAGE";
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

// Image item with stable unique ID (for PER_PRODUCT mode)
export interface SpreadsheetImageItem {
  id: string;           // Stable unique ID: `${productKey}|${categoryToken}|${indexInCategory}`
  url: string;
  categoryToken: string;
}

interface LeftPanelProps {
  workMode: WorkMode;
  mainPhotos: ImageData[];
  onMainPhotos: (arr: ImageData[]) => void;
  refImages: ImageData[];
  onRefImages: (arr: ImageData[]) => void;
  onPreview: (src: string) => void;
  onGenerate: () => void;
  isLoading?: boolean;
  generateDisabled?: boolean;
  useSpreadsheetProducts?: boolean;
  spreadsheetSelection?: SpreadsheetSelection | null;
  onOpenSpreadsheetModal?: () => void;
  onClearSpreadsheetSelection?: () => void;
  hasTemplates?: boolean;
  // Navigation between products
  onNavigateProduct?: (direction: "prev" | "next") => void;
  canNavigatePrev?: boolean;
  canNavigateNext?: boolean;
  // All image URLs from spreadsheet (for PER_IMAGE mode)
  allSpreadsheetImageUrls?: string[];
  onLoadMoreImages?: (urls: string[]) => Promise<ImageData[]>;
  // Bump to force clear caches and reload after save
  imageRefreshKey?: number;
  // PER_PRODUCT: visible items (export items minus hidden for generation)
  // × button only hides for generation, doesn't delete from export truth
  activeImageItems?: SpreadsheetImageItem[];
  onToggleHideItem?: (itemId: string) => void;
  // PER_PRODUCT: restore all hidden items
  onRestoreAllHidden?: () => void;
  // Total export items count (including hidden) for showing restore button
  totalExportItemsCount?: number;
  /** PER_IMAGE: report full panel image urls (truth list after hides) to parent */
  onPanelImagesChange?: (urls: string[]) => void;
  // ===== Target selection props =====
  saveTargetMode?: SaveTargetMode;
  onSaveTargetModeChange?: (mode: SaveTargetMode) => void;
  targetConfig?: TargetSpreadsheetConfig | null;
  onOpenTargetModal?: () => void;
  onOverrideToTarget?: () => void;
  // Callback to report active target image URLs (after hiding) to parent
  onTargetActiveImagesChange?: (urls: string[]) => void;
  // Visual indicator for images used in generation (source panel)
  usedForGenerationUrls?: Set<string>;
  // Visual indicator for images used in generation (target panel - Different mode)
  targetUsedForGenerationUrls?: Set<string>;
  // Trigger to restore all hidden images (increments when generation completes)
  restoreTrigger?: number;
  // ===== Override Modal props =====
  userId?: string;
  onOverrideSaved?: () => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
  // Callback to update target images in parent component (from OverrideModal)
  onTargetImagesUpdate?: (images: Array<{ url: string; label: string; colIndex: number }>) => void;
}

// Show all images without pagination - users can scroll to see more
// Setting a high value effectively disables pagination
const IMAGES_PER_PAGE = 1000;

function LeftPanelComponent({
  workMode,
  mainPhotos,
  onMainPhotos,
  refImages,
  onRefImages,
  onPreview,
  onGenerate,
  isLoading,
  generateDisabled = false,
  useSpreadsheetProducts = false,
  spreadsheetSelection,
  onOpenSpreadsheetModal,
  onClearSpreadsheetSelection,
  hasTemplates = false,
  onNavigateProduct,
  canNavigatePrev = false,
  canNavigateNext = false,
  allSpreadsheetImageUrls = [],
  onLoadMoreImages,
  imageRefreshKey = 0,
  activeImageItems = [],
  onToggleHideItem,
  onRestoreAllHidden,
  totalExportItemsCount = 0,
  onPanelImagesChange,
  // ===== Target selection props =====
  saveTargetMode = "original",
  onSaveTargetModeChange,
  targetConfig,
  onOpenTargetModal,
  onOverrideToTarget,
  onTargetActiveImagesChange,
  usedForGenerationUrls = new Set(),
  targetUsedForGenerationUrls = new Set(),
  restoreTrigger = 0,
  // ===== Override Modal props =====
  userId,
  onOverrideSaved,
  onSuccess,
  onError,
  onTargetImagesUpdate,
}: LeftPanelProps) {
  const mainRef = useRef<HTMLInputElement>(null);
  const refsRef = useRef<HTMLInputElement>(null);

  // Image page state for spreadsheet images
  const [currentImagePage, setCurrentImagePage] = useState(0);
  // Loading state for image pagination
  const [loadingImages, setLoadingImages] = useState(false);
  // Track removed URLs (only for PER_IMAGE mode)
  const [removedUrlsForPerImage, setRemovedUrlsForPerImage] = useState<Set<string>>(new Set());
  // Track if images have been loaded (for smooth hide operations)
  const [hasLoadedImages, setHasLoadedImages] = useState(false);
  // Cache version to trigger re-render after silent loading (not used in deps, just for forcing update)
  const [, setCacheVersion] = useState(0);
  // Drag state for reference drop zone
  const [isDraggingOverRef, setIsDraggingOverRef] = useState(false);
  // Collapsible state for Reference Images section
  const [refImagesExpanded, setRefImagesExpanded] = useState(false);
  // Override Modal state
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  // Image upload processing state (for HEIC conversion feedback)
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [processingFileName, setProcessingFileName] = useState<string>("");
  // Simple cache: URL -> ImageData (cleared on product change)
  const imageCacheRef = useRef<Map<string, ImageData>>(new Map());
  // Cache: itemId -> ImageData (for PER_PRODUCT mode, keyed by stable ID)
  const itemImageCacheRef = useRef<Map<string, ImageData>>(new Map());
  
  // ===== Target template image hiding state =====
  // Track hidden target image URLs (for cross-save)
  const [removedTargetUrls, setRemovedTargetUrls] = useState<Set<string>>(new Set());

  // ===== Navigation warning state =====
  const [showNavigationWarning, setShowNavigationWarning] = useState(false);
  const [pendingNavigationPath, setPendingNavigationPath] = useState<string | null>(null);

  // Handle safe navigation with unsaved changes check
  const handleSafeNavigate = useCallback((path: string) => {
    // Check if we have unsaved changes (uses the global function exposed by App.tsx)
    const hasUnsavedChanges = (window as any).__imageflowHasUnsavedChanges?.();
    if (hasUnsavedChanges) {
      setPendingNavigationPath(path);
      setShowNavigationWarning(true);
      return;
    }
    // No unsaved changes, navigate directly
    window.location.href = path;
  }, []);

  // Handle navigation warning confirm
  const handleNavigationConfirm = useCallback(() => {
    setShowNavigationWarning(false);
    if (pendingNavigationPath) {
      // Set flag to skip beforeunload confirmation (user already confirmed via AlertModal)
      (window as any).__imageflowSkipBeforeUnload = true;
      window.location.href = pendingNavigationPath;
      setPendingNavigationPath(null);
    }
  }, [pendingNavigationPath]);

  // Handle navigation warning cancel
  const handleNavigationCancel = useCallback(() => {
    setShowNavigationWarning(false);
    setPendingNavigationPath(null);
  }, []);

  // Determine if we're in PER_PRODUCT mode
  const isPERProduct = spreadsheetSelection?.rowMode === "PER_PRODUCT";
  const isPERImage = spreadsheetSelection?.rowMode === "PER_IMAGE";

  // For PER_PRODUCT: derive URLs from activeImageItems
  // For PER_IMAGE: filter removedUrls from allSpreadsheetImageUrls
  // Active URLs (may have duplicates - this is the full list)
  const activeImageUrls = useMemo(() => {
    if (isPERProduct) {
      // PER_PRODUCT: URLs come from items (single source of truth)
      return activeImageItems.map(item => item.url);
    } else {
      // PER_IMAGE: use old removedUrls logic
      return allSpreadsheetImageUrls.filter(url => !removedUrlsForPerImage.has(url));
    }
  }, [isPERProduct, activeImageItems, allSpreadsheetImageUrls, removedUrlsForPerImage]);

  // PER_IMAGE: report truth list (after hides) to parent for SaveToSpreadsheetModal
  useEffect(() => {
    if (useSpreadsheetProducts && isPERImage) {
      onPanelImagesChange?.(activeImageUrls);
    }
  }, [useSpreadsheetProducts, isPERImage, activeImageUrls, onPanelImagesChange]);

  // Deduped display items (for UI rendering)
  // Uses shared dedupeForDisplay utility for consistency
  const dedupedDisplayItems = useMemo((): DisplayItem[] => {
    if (isPERProduct) {
      const urls = activeImageItems.map(item => item.url);
      const itemIds = activeImageItems.map(item => item.id);
      return dedupeForDisplay(urls, { itemIds });
    } else {
      return dedupeForDisplay(activeImageUrls);
    }
  }, [isPERProduct, activeImageItems, activeImageUrls]);

  // ===== Target template image processing =====
  // Active target image URLs (filtering out hidden ones)
  const activeTargetImageUrls = useMemo(() => {
    if (!targetConfig?.targetImages) return [];
    return targetConfig.targetImages
      .map(img => img.url)
      .filter(url => !removedTargetUrls.has(url));
  }, [targetConfig?.targetImages, removedTargetUrls]);

  // Deduped target display items (for UI rendering)
  const dedupedTargetDisplayItems = useMemo((): DisplayItem[] => {
    return dedupeForDisplay(activeTargetImageUrls);
  }, [activeTargetImageUrls]);

  // Hide a target image by URL
  const hideTargetImageByUrl = useCallback((url: string) => {
    console.log(`[LeftPanel] Hide target image: ${url.substring(0, 50)}...`);
    setRemovedTargetUrls(prev => new Set([...prev, url]));
  }, []);

  // Restore all hidden target images
  const restoreAllTargetImages = useCallback(() => {
    console.log("[LeftPanel] Restore all hidden target images");
    setRemovedTargetUrls(new Set());
  }, []);

  // Report active target image URLs to parent (for SaveToSpreadsheetModal)
  useEffect(() => {
    onTargetActiveImagesChange?.(activeTargetImageUrls);
  }, [activeTargetImageUrls, onTargetActiveImagesChange]);

  // Calculate total pages based on DEDUPED items (what user sees)
  const totalImagePages = useMemo(() => {
    return Math.ceil(dedupedDisplayItems.length / IMAGES_PER_PAGE);
  }, [dedupedDisplayItems.length]);

  // Get deduped items for current page
  const currentPageDisplayItems = useMemo(() => {
    const start = currentImagePage * IMAGES_PER_PAGE;
    return dedupedDisplayItems.slice(start, start + IMAGES_PER_PAGE);
  }, [dedupedDisplayItems, currentImagePage]);

  // Legacy: currentPageItems for backward compatibility (used by some effects)
  const currentPageItems = useMemo(() => {
    const start = currentImagePage * IMAGES_PER_PAGE;
    return activeImageItems.slice(start, start + IMAGES_PER_PAGE);
  }, [activeImageItems, currentImagePage]);

  const currentPageUrls = useMemo(() => {
    const start = currentImagePage * IMAGES_PER_PAGE;
    return activeImageUrls.slice(start, start + IMAGES_PER_PAGE);
  }, [activeImageUrls, currentImagePage]);

  // Track previous URLs to detect overlay updates
  const prevUrlsRef = useRef<string[]>([]);

  // Reset state when product changes
  useEffect(() => {
    setCurrentImagePage(0);
    setRemovedUrlsForPerImage(new Set());
    setRemovedTargetUrls(new Set()); // Reset target image hiding
    setHasLoadedImages(false); // Reset for new product
    imageCacheRef.current = new Map(); // Clear cache for new product
    itemImageCacheRef.current = new Map(); // Clear item cache
    prevUrlsRef.current = []; // Reset URL tracking
  }, [spreadsheetSelection?.key]);

  // Reset target image hiding when targetConfig changes
  useEffect(() => {
    setRemovedTargetUrls(new Set());
  }, [targetConfig?.targetProductKey]);

  // Force clear caches and reload when parent bumps imageRefreshKey (after save)
  const prevRefreshKeyRef = useRef(imageRefreshKey);
  useEffect(() => {
    if (imageRefreshKey !== prevRefreshKeyRef.current) {
      prevRefreshKeyRef.current = imageRefreshKey;
      console.log("[LeftPanel] imageRefreshKey changed, clearing caches for reload");
      imageCacheRef.current.clear();
      itemImageCacheRef.current.clear();
      setHasLoadedImages(false);
    }
  }, [imageRefreshKey]);

  // For PER_PRODUCT: detect item changes (including URL replacements) and clear cache
  // Track both IDs and URLs to detect replacements properly
  const prevItemIdsRef = useRef<string[]>([]);
  const prevItemUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!isPERProduct) return;
    
    const currentIds = activeImageItems.map(item => item.id);
    const currentUrls = activeImageItems.map(item => item.url);
    const prevUrlsSet = new Set(prevItemUrlsRef.current);
    
    // Check if there are NEW URLs (not in previous list) - this indicates replacement
    const hasNewUrls = currentUrls.some(url => !prevUrlsSet.has(url));
    
    // Only clear cache if there are NEW URLs (replacement scenario)
    // Don't clear cache for hide operations (hasRemovedUrls only) - cached images are still valid
    if (hasNewUrls && prevItemIdsRef.current.length > 0) {
      // New URLs detected - clear cache to force reload of new images
      console.log("[LeftPanel] PER_PRODUCT new URLs detected, clearing cache for reload", {
        hasNewUrls,
        prevCount: prevItemIdsRef.current.length,
        currentCount: currentIds.length,
      });
      itemImageCacheRef.current.clear();
      setHasLoadedImages(false); // Reset to trigger reload
      // Also clear mainPhotos to force reload
      onMainPhotos([]);
    }
    
    prevItemIdsRef.current = currentIds;
    prevItemUrlsRef.current = currentUrls;
  }, [isPERProduct, activeImageItems, onMainPhotos]);

  // Detect overlay updates (URLs changed, not just removed) - for PER_IMAGE mode
  useEffect(() => {
    const prevUrls = new Set(prevUrlsRef.current);
    const currentUrls = allSpreadsheetImageUrls || [];
    
    // Check if there are NEW URLs (not in previous list) - this indicates replacement
    const hasNewUrls = currentUrls.some(url => !prevUrls.has(url));
    
    // Only clear cache if there are NEW URLs (replacement scenario)
    // Don't clear cache for remove operations - cached images are still valid
    if (hasNewUrls && prevUrlsRef.current.length > 0) {
      console.log("[LeftPanel] Overlay update: new URLs detected, clearing cache", {
        hasNewUrls,
        prevCount: prevUrlsRef.current.length,
        currentCount: currentUrls.length,
      });
      imageCacheRef.current.clear();
      setHasLoadedImages(false); // Reset to trigger reload
      // Also clear mainPhotos to force LeftPanel to show loading state and trigger reload
      onMainPhotos([]);
    }
    
    // Update tracking ref
    prevUrlsRef.current = currentUrls;
  }, [allSpreadsheetImageUrls, onMainPhotos]);

  // Load images for current page (with caching)
  // For PER_PRODUCT: uses item-based caching with stable IDs
  // For PER_IMAGE: uses URL-based caching
  useEffect(() => {
    if (!useSpreadsheetProducts || !spreadsheetSelection || !onLoadMoreImages) {
      return;
    }
    
    // PER_PRODUCT: load based on currentPageDisplayItems (deduped)
    if (isPERProduct) {
      console.log("[LeftPanel] PER_PRODUCT load effect:", {
        currentImagePage,
        currentPageDisplayItemsCount: currentPageDisplayItems.length,
        totalDedupedItems: dedupedDisplayItems.length,
      });
      
      if (currentPageDisplayItems.length === 0) {
        console.log("[LeftPanel] No display items to load, clearing photos");
        onMainPhotos([]);
        return;
      }

      const cache = itemImageCacheRef.current;
      
      // Check which display items need loading (not in cache)
      // Use originIndex to get the original item for ID
      const itemsToLoad = currentPageDisplayItems.filter(displayItem => {
        const originalItem = activeImageItems[displayItem.originIndex];
        return originalItem && !cache.has(originalItem.id);
      });
      const urlsToLoad = itemsToLoad.map(displayItem => displayItem.url);
      
      console.log("[LeftPanel] PER_PRODUCT cache status (deduped):", {
        cacheSize: cache.size,
        itemsToLoad: itemsToLoad.length,
        cachedItems: currentPageDisplayItems.length - itemsToLoad.length,
      });
      
      // Build page images from cache (preserving deduped display order)
      const buildPageImages = () => {
        const pageImages: ImageData[] = [];
        for (const displayItem of currentPageDisplayItems) {
          const originalItem = activeImageItems[displayItem.originIndex];
          if (originalItem) {
            const cached = cache.get(originalItem.id);
            if (cached) {
              pageImages.push(cached);
            }
          }
        }
        console.log("[LeftPanel] Built page images from deduped items:", pageImages.length);
        return pageImages;
      };
      
      if (itemsToLoad.length === 0) {
        // All cached - for hide operations, rendering will be instant via getGroupedItems
        // Just mark as loaded, no need to call onMainPhotos (avoids parent re-render)
        if (!hasLoadedImages) {
          setHasLoadedImages(true);
          // Initial load - need to update mainPhotos for backward compatibility
          const pageImages = buildPageImages();
          onMainPhotos(pageImages);
        }
        // For hide operations, skip onMainPhotos call entirely
        // getGroupedItems() will read from cache directly
        console.log("[LeftPanel] All cached, hasLoadedImages:", hasLoadedImages);
      } else if (itemsToLoad.length <= 2 && hasLoadedImages) {
        // Small number of new items (likely from pagination scroll-in after hide)
        // Silent load - don't show loading state, don't trigger parent re-render
        console.log("[LeftPanel] PER_PRODUCT silent loading:", itemsToLoad.length, "items");
        onLoadMoreImages(urlsToLoad).then((newImages) => {
          // Add to cache silently
          itemsToLoad.forEach((displayItem, idx) => {
            const originalItem = activeImageItems[displayItem.originIndex];
            if (newImages[idx] && originalItem) {
              cache.set(originalItem.id, { ...newImages[idx], sourceUrl: displayItem.url });
            }
          });
          // Trigger local re-render to show newly cached images
          setCacheVersion(v => v + 1);
          console.log("[LeftPanel] PER_PRODUCT silent load complete");
        }).catch(err => {
          console.error("[LeftPanel] Silent load failed:", err);
        });
      } else {
        // Need to load some images
        console.log("[LeftPanel] Loading item URLs:", urlsToLoad);
        setLoadingImages(true);
        setHasLoadedImages(false);
        onLoadMoreImages(urlsToLoad).then((newImages) => {
          console.log("[LeftPanel] Loaded images:", newImages.length);
          // Add to cache with original item.id as key
          itemsToLoad.forEach((displayItem, idx) => {
            const originalItem = activeImageItems[displayItem.originIndex];
            if (newImages[idx] && originalItem) {
              cache.set(originalItem.id, { ...newImages[idx], sourceUrl: displayItem.url });
            }
          });
          // Build and display
          const pageImages = buildPageImages();
          onMainPhotos(pageImages);
          setLoadingImages(false);
          setHasLoadedImages(true);
        }).catch(err => {
          console.error("[LeftPanel] Failed to load images:", err);
          setLoadingImages(false);
        });
      }
      return;
    }
    
    // PER_IMAGE mode: use deduped currentPageDisplayItems
    console.log("[LeftPanel] PER_IMAGE load effect:", {
      currentImagePage,
      currentPageDisplayItemsCount: currentPageDisplayItems.length,
      totalDedupedItems: dedupedDisplayItems.length,
    });
    
    if (currentPageDisplayItems.length === 0) {
      console.log("[LeftPanel] No URLs to load, clearing photos");
      onMainPhotos([]);
      return;
    }

    const cache = imageCacheRef.current;
    
    // Check which URLs need to be loaded (not in cache)
    const urlsToLoad = currentPageDisplayItems
      .map(item => item.url)
      .filter(url => !cache.has(url));
    
    console.log("[LeftPanel] PER_IMAGE cache status (deduped):", {
      cacheSize: cache.size,
      urlsToLoad: urlsToLoad.length,
      cachedUrls: currentPageDisplayItems.length - urlsToLoad.length,
    });
    
    // Build page images from cache (preserving deduped display order)
    const buildPageImages = () => {
      const pageImages: ImageData[] = [];
      for (const displayItem of currentPageDisplayItems) {
        const cached = cache.get(displayItem.url);
        if (cached) {
          pageImages.push(cached);
        }
      }
      console.log("[LeftPanel] Built page images:", pageImages.length);
      return pageImages;
    };
    
    if (urlsToLoad.length === 0) {
      // All cached - for hide operations, rendering will be instant via direct cache access
      // Just mark as loaded, no need to call onMainPhotos (avoids parent re-render)
      if (!hasLoadedImages) {
        setHasLoadedImages(true);
        // Initial load - need to update mainPhotos for backward compatibility
        const pageImages = buildPageImages();
        onMainPhotos(pageImages);
      }
      // For hide operations, skip onMainPhotos call entirely
      console.log("[LeftPanel] PER_IMAGE all cached, hasLoadedImages:", hasLoadedImages);
    } else if (urlsToLoad.length <= 2 && hasLoadedImages) {
      // Small number of new images (likely from pagination scroll-in after hide)
      // Silent load - don't show loading state, don't trigger parent re-render
      console.log("[LeftPanel] PER_IMAGE silent loading:", urlsToLoad.length, "URLs");
      onLoadMoreImages(urlsToLoad).then((newImages) => {
        // Add to cache silently
        urlsToLoad.forEach((url, idx) => {
          if (newImages[idx]) {
            cache.set(url, { ...newImages[idx], sourceUrl: url });
          }
        });
        // Trigger local re-render to show newly cached images
        setCacheVersion(v => v + 1);
        console.log("[LeftPanel] PER_IMAGE silent load complete");
      }).catch(err => {
        console.error("[LeftPanel] Silent load failed:", err);
      });
    } else {
      // Need to load some images
      console.log("[LeftPanel] Loading URLs:", urlsToLoad);
      setLoadingImages(true);
      setHasLoadedImages(false);
      onLoadMoreImages(urlsToLoad).then((newImages) => {
        console.log("[LeftPanel] Loaded images:", newImages.length);
        // Add to cache
        urlsToLoad.forEach((url, idx) => {
          if (newImages[idx]) {
            cache.set(url, { ...newImages[idx], sourceUrl: url });
          }
        });
        // Build and display
        const pageImages = buildPageImages();
        onMainPhotos(pageImages);
        setLoadingImages(false);
        setHasLoadedImages(true);
      }).catch(err => {
        console.error("[LeftPanel] Failed to load images:", err);
        setLoadingImages(false);
      });
    }
  }, [
    // Trigger on page change, product change, or item/URL list change
    currentImagePage,
    spreadsheetSelection?.key,
    useSpreadsheetProducts,
    isPERProduct,
    hasLoadedImages,
    // For deduped display items
    JSON.stringify(currentPageDisplayItems.map(i => i.url)),
  ]);

  const pickMain = useCallback(() => mainRef.current?.click(), []);
  const pickRefs = useCallback(() => refsRef.current?.click(), []);

  const onMain = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;

    const files = Array.from(list).slice(0, 8 - mainPhotos.length);

    try {
      // Show processing status for user feedback
      const hasHeic = files.some(f => 
        f.name.toLowerCase().endsWith('.heic') || 
        f.name.toLowerCase().endsWith('.heif') ||
        f.type.includes('heic') || 
        f.type.includes('heif')
      );
      if (hasHeic) {
        setIsProcessingUpload(true);
        setProcessingFileName(files.find(f => 
          f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
        )?.name || "iPhone photo");
      }

      console.log(`📸 Processing ${files.length} main images (triple storage)...`);
      const processedImages = await processImageFiles(files);
      onMainPhotos([...mainPhotos, ...processedImages].slice(0, 8));
      mainRef.current && (mainRef.current.value = "");
    } catch (error) {
      console.error("❌ Failed to process main images:", error);
      alert("Failed to process images. Please try again.");
    } finally {
      setIsProcessingUpload(false);
      setProcessingFileName("");
    }
  }, [mainPhotos, onMainPhotos]);

  const onRefs = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) return;

    const files = Array.from(list).slice(0, 4 - refImages.length);

    try {
      // Show processing status for user feedback
      const hasHeic = files.some(f => 
        f.name.toLowerCase().endsWith('.heic') || 
        f.name.toLowerCase().endsWith('.heif') ||
        f.type.includes('heic') || 
        f.type.includes('heif')
      );
      if (hasHeic) {
        setIsProcessingUpload(true);
        setProcessingFileName(files.find(f => 
          f.name.toLowerCase().endsWith('.heic') || f.name.toLowerCase().endsWith('.heif')
        )?.name || "iPhone photo");
      }

      console.log(`📸 Processing ${files.length} reference images (triple storage)...`);
      const processedImages = await processImageFiles(files);
      onRefImages([...refImages, ...processedImages].slice(0, 4));
      refsRef.current && (refsRef.current.value = "");
    } catch (error) {
      console.error("❌ Failed to process reference images:", error);
      alert("Failed to process images. Please try again.");
    } finally {
      setIsProcessingUpload(false);
      setProcessingFileName("");
    }
  }, [refImages, onRefImages]);

  // Both modes now have the same product-focused features
  // Keep variable for potential future differentiation
  const isImportMode = workMode === "import";
  const isCreateMode = workMode === "create";

  // Determine if Override button should be visible
  // Only visible in Import mode when saveTargetMode is "different" and targetConfig exists
  // Create mode: Override button is not needed
  const showOverrideButton = useMemo(() => {
    if (isImportMode) {
      return saveTargetMode === "different" && !!targetConfig;
    }
    // Create mode: no Override button
    return false;
  }, [isImportMode, saveTargetMode, targetConfig]);

  // Remove image by item ID (for PER_PRODUCT mode)
  // Hide image by item ID (for PER_PRODUCT mode)
  // This does NOT delete from export truth - just hides for generation input
  const hideByItemId = useCallback((itemId: string) => {
    // Just notify parent to toggle hidden state
    // The image will disappear from visibleImageItems, and load effect will update mainPhotos
    onToggleHideItem?.(itemId);
    
    // Also remove from item cache so it won't be displayed
    itemImageCacheRef.current.delete(itemId);
    
    console.log(`[LeftPanel] Hide item ${itemId} (for generation filtering, not deleting from export)`);
  }, [onToggleHideItem]);

  // PER_IMAGE: hide by URL (do NOT splice mainPhotos)
  const hidePerImageByUrl = useCallback((url: string) => {
    setRemovedUrlsForPerImage(prev => new Set([...prev, url]));
    imageCacheRef.current.delete(url);
    // Don't call onMainPhotos here; the load effect will rebuild mainPhotos from activeImageUrls
    console.log(`[LeftPanel] PER_IMAGE hide URL: ${url}`);
  }, []);

  // Remove image by index (for manual upload only, NOT for PER_IMAGE spreadsheet)
  const removeMain = useCallback((index: number) => {
    const newArr = [...mainPhotos];
    const removed = newArr.splice(index, 1);
    cleanupImageURLs(removed);
    onMainPhotos(newArr);
  }, [mainPhotos, onMainPhotos]);

  const removeRef = useCallback((index: number) => {
    const newArr = [...refImages];
    const removed = newArr.splice(index, 1);
    cleanupImageURLs(removed);
    onRefImages(newArr);
  }, [refImages, onRefImages]);

  // Drag and drop handlers for reference images
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRef(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Check if we're leaving the actual drop zone (not just a child element)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDraggingOverRef(false);
    }
  }, []);

  const handleDropOnRef = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRef(false);

    // Check if dropping image from product grid (via data transfer)
    const imageData = e.dataTransfer.getData('application/json');
    if (imageData) {
      try {
        const droppedImage = JSON.parse(imageData) as ImageData;
        if (refImages.length < 4) {
          // Create a NEW blob URL from base64 to avoid stale URL issues
          // The original previewURL might be revoked or invalid
          const newPreviewURL = droppedImage.aiOptimized 
            ? base64ToBlobUrl(droppedImage.aiOptimized)
            : droppedImage.previewURL; // Fallback if no base64
          
          const newImageData: ImageData = {
            ...droppedImage,
            previewURL: newPreviewURL,
          };
          
          onRefImages([...refImages, newImageData].slice(0, 4));
        }
        return;
      } catch (err) {
        console.log('Not a valid image data transfer');
      }
    }

    // Handle file drop from system
    const files = e.dataTransfer.files;
    if (files?.length) {
      const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length > 0) {
        const filesToProcess = imageFiles.slice(0, 4 - refImages.length);
        if (filesToProcess.length > 0) {
          try {
            const processedImages = await processImageFiles(filesToProcess);
            onRefImages([...refImages, ...processedImages].slice(0, 4));
          } catch (error) {
            console.error("Failed to process dropped images:", error);
          }
        }
      }
    }
  }, [refImages, onRefImages]);

  // Create drag preview image ref (reusable)
  const dragImageRef = useRef<HTMLCanvasElement | null>(null);

  // Handler for starting drag from main photos
  const handleDragStart = useCallback((e: React.DragEvent, imgData: ImageData) => {
    e.dataTransfer.setData('application/json', JSON.stringify(imgData));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Use a small offset for better UX
    const size = 70;
    
    // Create canvas for drag image if not exists
    if (!dragImageRef.current) {
      dragImageRef.current = document.createElement('canvas');
      dragImageRef.current.style.position = 'fixed';
      dragImageRef.current.style.top = '-9999px';
      dragImageRef.current.style.left = '-9999px';
      document.body.appendChild(dragImageRef.current);
    }
    
    const canvas = dragImageRef.current;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Draw background
      ctx.fillStyle = '#e8e0d8';
      ctx.fillRect(0, 0, size, size);
      
      // Try to draw the image
      const img = new Image();
      img.src = imgData.previewURL;
      
      if (img.complete && img.naturalWidth > 0) {
        // Image already loaded - draw it
        const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;
        ctx.drawImage(img, x, y, w, h);
      }
      
      e.dataTransfer.setDragImage(canvas, size / 2, size / 2);
    }
  }, []);

  // Track if we're dragging to prevent click after drag
  const dragStartPosRef = useRef<{x: number, y: number} | null>(null);
  
  const handleDragStartWithTracking = useCallback((e: React.DragEvent, imgData: ImageData) => {
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    handleDragStart(e, imgData);
  }, [handleDragStart]);

  const handleDragEnd = useCallback(() => {
    // Reset after a short delay
    setTimeout(() => {
      dragStartPosRef.current = null;
    }, 50);
  }, []);

  const handleImageClick = useCallback((e: React.MouseEvent, previewURL: string) => {
    // If we just finished dragging, don't trigger click
    if (dragStartPosRef.current) {
      const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
      const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
      // If mouse moved more than 5px, it was a drag, not a click
      if (dx > 5 || dy > 5) {
        return;
      }
    }
    onPreview(previewURL);
  }, [onPreview]);

  // Navigate image pages
  const handlePrevImagePage = useCallback(() => {
    if (currentImagePage > 0) {
      setCurrentImagePage(prev => prev - 1);
    }
  }, [currentImagePage]);

  const handleNextImagePage = useCallback(() => {
    if (currentImagePage < totalImagePages - 1) {
      setCurrentImagePage(prev => prev + 1);
    }
  }, [currentImagePage, totalImagePages]);

  // Check if target panel has images (for Different mode Generate button state)
  const targetHasImages = useMemo(() => {
    if (saveTargetMode !== "different" || !targetConfig) return true; // Not relevant
    const targetImages = targetConfig.targetImages || [];
    // Check active images (after hiding)
    const activeCount = targetImages.filter(img => !removedTargetUrls.has(img.url)).length;
    return activeCount > 0;
  }, [saveTargetMode, targetConfig, removedTargetUrls]);

  // Determine if Override button should pulse (when target is empty and user needs to override)
  const overrideButtonShouldPulse = useMemo(() => {
    if (!showOverrideButton) return false;
    // Pulse when target has no images (user needs to override before generating)
    return !targetHasImages;
  }, [showOverrideButton, targetHasImages]);

  // Determine if Generate button should be in target column
  const generateInTargetColumn = saveTargetMode === "different" && useSpreadsheetProducts;

  // Generate button is disabled if:
  // 1. Loading or user not signed in
  // 2. In Different mode and target panel is empty (need to override first)
  const generateDisabledByEmptyTarget = generateInTargetColumn && !targetHasImages;
  const disabled = isLoading || generateDisabled || generateDisabledByEmptyTarget;
  
  const generateLabel = generateDisabled
    ? "Sign in to Generate"
    : isLoading
    ? "Generating..."
    : generateDisabledByEmptyTarget
    ? "Override images first"
    : "Generate";

  // Total active images depends on mode
  const totalActiveImages = isPERProduct ? activeImageItems.length : activeImageUrls.length;

  // Check if there are hidden images that can be restored
  // PER_PRODUCT: uses generationHiddenIds (managed by App.tsx, passed via totalExportItemsCount)
  // PER_IMAGE: uses removedUrlsForPerImage (local state)
  const hiddenCount = isPERProduct 
    ? totalExportItemsCount - activeImageItems.length 
    : removedUrlsForPerImage.size;
  const hasHiddenImages = hiddenCount > 0;

  // Handle restore for both modes
  const handleRestoreAll = useCallback(() => {
    if (isPERProduct) {
      // PER_PRODUCT: call parent to clear generationHiddenIds
      onRestoreAllHidden?.();
    } else {
      // PER_IMAGE: clear local removedUrlsForPerImage state
      setRemovedUrlsForPerImage(new Set());
      console.log('[LeftPanel] PER_IMAGE: Restored all hidden URLs');
    }
  }, [isPERProduct, onRestoreAllHidden]);

  // Watch for restoreTrigger changes to auto-restore hidden images after generation
  useEffect(() => {
    if (restoreTrigger > 0) {
      console.log('[LeftPanel] restoreTrigger changed, restoring all hidden images');
      // For PER_IMAGE mode, clear local state
      if (!isPERProduct) {
        setRemovedUrlsForPerImage(new Set());
      }
      // For PER_PRODUCT mode, the parent already handles it via setGenerationHiddenIds
      
      // Also restore target panel images
      setRemovedTargetUrls(new Set());
    }
  }, [restoreTrigger, isPERProduct]);

  // Helper to extract readable category name from token
  const getCategoryDisplayName = (token: string): string => {
    if (token.startsWith('col:')) {
      return token.substring(4);
    }
    return token;
  };

  // Group current page items by category for PER_PRODUCT display
  const getGroupedItems = () => {
    const groups: { category: string; items: Array<{ displayItem: DisplayItem; imgData: ImageData | null; originalItem: SpreadsheetImageItem | undefined; index: number }> }[] = [];
    const categoryMap = new Map<string, typeof groups[0]>();
    const cache = itemImageCacheRef.current;
    
    currentPageDisplayItems.forEach((displayItem, i) => {
      const originalItem = activeImageItems[displayItem.originIndex];
      if (!originalItem) return;
      
      // Read from cache first, fallback to mainPhotos
      const imgData = cache.get(originalItem.id) || mainPhotos[i] || null;
      
      const category = originalItem.categoryToken;
      let group = categoryMap.get(category);
      if (!group) {
        group = { category, items: [] };
        categoryMap.set(category, group);
        groups.push(group);
      }
      group.items.push({ displayItem, imgData, originalItem, index: i });
    });
    
    return groups;
  };

  // Helper to group target images by category (same pattern as source getGroupedItems)
  // Used for both existing products and new products in target panel
  const getTargetGroupedImages = useCallback((): { 
    groups: Array<{ category: string; images: Array<{ url: string; label: string; colIndex: number }> }>; 
    orderedLabels: string[]; 
    totalActive: number;
  } => {
    if (!targetConfig) return { groups: [], orderedLabels: [], totalActive: 0 };
    
    // Get all image columns from target template (for showing categories in order)
    const templateColumns = (targetConfig as any).targetTemplateColumns || [];
    const allImageColumns: string[] = templateColumns
      .filter((col: any) => col.role === "image_url")
      .map((col: any) => col.name);
    
    // Get active (non-hidden) images
    const activeImages = (targetConfig.targetImages || []).filter(
      (img) => !removedTargetUrls.has(img.url)
    );
    
    // Group active images by label (category)
    const groupedImages: Record<string, typeof activeImages> = {};
    for (const img of activeImages) {
      const label = img.label || "Image";
      if (!groupedImages[label]) groupedImages[label] = [];
      groupedImages[label].push(img);
    }
    
    // Use template order if available, otherwise use data order
    const dataLabels = Object.keys(groupedImages);
    const orderedLabels = allImageColumns.length > 0 ? allImageColumns : dataLabels;
    
    // GLOBAL seen set for deduplication across ALL categories
    const globalSeen = new Set<string>();
    
    // Build groups with deduplication
    const groups = orderedLabels.map((label: string) => {
      const images = groupedImages[label] || [];
      // Dedupe using global seen set
      const dedupedImages = images.filter((img) => {
        if (globalSeen.has(img.url)) return false;
        globalSeen.add(img.url);
        return true;
      });
      return { category: label, images: dedupedImages };
    });
    
    return { groups, orderedLabels, totalActive: activeImages.length };
  }, [targetConfig, removedTargetUrls]);

  // Render target images section - reusable for both Import and Create modes
  // showInteractive: if false, hides X buttons and "for generation" text (used in create mode)
  const renderTargetImagesSection = useCallback((keyPrefix: string, showInteractive: boolean = true) => {
    const { groups, orderedLabels, totalActive } = getTargetGroupedImages();
    
    // If no template columns, don't render
    if (orderedLabels.length === 0) return null;
    
    // Calculate total deduped count
    const totalDeduped = groups.reduce((sum: number, g) => sum + g.images.length, 0);
    
    // Header text - In Different mode, these images are used for generation (only show "for generation" if interactive)
    const actionText = showInteractive && saveTargetMode === "different" ? "for generation" : "";
    const headerText = totalActive > 0 
      ? actionText ? `${totalDeduped} images ${actionText}` : `${totalDeduped} images`
      : (targetConfig as any)?.isNewProduct 
        ? `New product · ${orderedLabels.length} image categories`
        : `0 images`;
    
    // If only one category with images, show flat grid
    if (orderedLabels.length <= 1 && totalActive > 0) {
      const allImages = groups.flatMap(g => g.images);
      return (
        <ImageGridSection>
          <PageInfo>
            {headerText}
            {showInteractive && (
              <InfoTooltip content="Tip: Using 1-2 images often produces better results" />
            )}
          </PageInfo>
          <MainGrid>
            {allImages.map((img, i: number) => (
              <ThumbWrapper key={`${keyPrefix}-${img.url}-${i}`}>
                <Thumb
                  $bg={img.url}
                  $usedForGeneration={targetUsedForGenerationUrls.has(img.url)}
                  onClick={() => onPreview(img.url)}
                  title="Click to preview"
                />
                {showInteractive && (
                  <RemoveBtn onClick={() => hideTargetImageByUrl(img.url)} disabled={isLoading}>×</RemoveBtn>
                )}
                <ImageNumberBadge>{i + 1}</ImageNumberBadge>
              </ThumbWrapper>
            ))}
          </MainGrid>
        </ImageGridSection>
      );
    }
    
    // Multiple categories - render in template order (same pattern as source panel)
    return (
      <ImageGridSection>
        <PageInfo>
          {headerText}
          {showInteractive && (
            <InfoTooltip content="Tip: Using 1-2 images often produces better results" />
          )}
        </PageInfo>
        {groups.map(({ category, images }) => {
          if (images.length === 0) {
            // Empty category - show placeholder (same as source panel)
            return (
              <CategorySection key={`${keyPrefix}-empty-${category}`}>
                <CategoryHeader>{category} (0)</CategoryHeader>
                <MainGrid>
                  <EmptySlotSmall>Empty</EmptySlotSmall>
                </MainGrid>
              </CategorySection>
            );
          }
          
          // Has images - render normally (same as source panel)
          return (
            <CategorySection key={`${keyPrefix}-${category}`}>
              <CategoryHeader>
                {category} ({images.length})
              </CategoryHeader>
              <MainGrid>
                {images.map((img, i: number) => (
                  <ThumbWrapper key={`${keyPrefix}-${category}-${img.url}-${i}`}>
                    <Thumb
                      $bg={img.url}
                      $usedForGeneration={targetUsedForGenerationUrls.has(img.url)}
                      onClick={() => onPreview(img.url)}
                      title="Click to preview"
                    />
                    {showInteractive && (
                      <RemoveBtn onClick={() => hideTargetImageByUrl(img.url)} disabled={isLoading}>×</RemoveBtn>
                    )}
                    <ImageNumberBadge>{i + 1}</ImageNumberBadge>
                  </ThumbWrapper>
                ))}
              </MainGrid>
            </CategorySection>
          );
        })}
      </ImageGridSection>
    );
  }, [getTargetGroupedImages, targetConfig, onPreview, hideTargetImageByUrl, saveTargetMode, targetUsedForGenerationUrls]);

  return (
    <Card>
      <Title>Upload</Title>

      {/* ========== Import Mode Empty State: Two Column Layout (no divider) ========== */}
      {isImportMode && !spreadsheetSelection && (
        <ImportEmptyTwoColumns>
          {/* Original Column */}
          <ImportEmptyColumn>
            <ImportEmptyHeader>Original</ImportEmptyHeader>
            <ImportEmptyCard>
              <ImportEmptyIcon>
                <svg viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <polyline points="9 15 12 12 15 15"/>
                </svg>
              </ImportEmptyIcon>
              <ImportEmptyTitle>Select Source</ImportEmptyTitle>
              <ImportEmptyDesc>Import a spreadsheet to edit product info.</ImportEmptyDesc>
              <ImportEmptyButton 
                onClick={() => hasTemplates ? onOpenSpreadsheetModal?.() : handleSafeNavigate("/account/csv-templates?new=1")}
                disabled={isLoading}
              >
                {hasTemplates ? "Select spreadsheet" : "Connect spreadsheet"}
              </ImportEmptyButton>
            </ImportEmptyCard>
          </ImportEmptyColumn>

          {/* Different Column */}
          <ImportEmptyColumn>
            <ImportEmptyHeader $dim>Different</ImportEmptyHeader>
            <ImportEmptyCard $inactive>
              <ImportEmptyIcon $dim>
                <svg viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="12" x2="12" y2="18"/>
                  <polyline points="9 15 12 18 15 15"/>
                </svg>
              </ImportEmptyIcon>
              <ImportEmptyTitle $dim>Export Target</ImportEmptyTitle>
              <ImportEmptyDesc $dim>Save results to a different spreadsheet.</ImportEmptyDesc>
            </ImportEmptyCard>
          </ImportEmptyColumn>
        </ImportEmptyTwoColumns>
      )}

      {/* ========== Normal Layout (ThreeColumnBody) ========== */}
      {!(isImportMode && !spreadsheetSelection) && (
      <ThreeColumnBody>
        {/* ===== LEFT COLUMN: Source Images/Products ===== */}
        <LeftColumnStyled>
          {/* ========== Import Mode: Spreadsheet Products ========== */}
          {isImportMode && (
        <>
          {/* Source Header with template name */}
          {useSpreadsheetProducts && spreadsheetSelection && (
            <>
              <SourceHeader>
                <SourceTemplateName>{spreadsheetSelection.templateName}</SourceTemplateName>
              </SourceHeader>
              {/* Original Tab Button - below divider */}
              <TargetOptionCompact
                $selected={saveTargetMode === "original"}
                onClick={() => !isLoading && onSaveTargetModeChange?.("original")}
                style={{ 
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <TargetRadio $selected={saveTargetMode === "original"}>
                  {saveTargetMode === "original" && <TargetRadioDot />}
                </TargetRadio>
                <TargetLabelCompact $selected={saveTargetMode === "original"}>
                  Original
                </TargetLabelCompact>
              </TargetOptionCompact>
            </>
          )}
          
        <SpreadsheetCard $hasSelection={!!spreadsheetSelection}>
          {/* Only show header and description when no product selected */}
          {!spreadsheetSelection && (
            <>
              <SpreadsheetHeader>
                <TitleWithInfo>
                  <SpreadsheetTitle>Spreadsheet Products</SpreadsheetTitle>
                  <InfoTooltip content="Select a product from your spreadsheet and load its images." />
                </TitleWithInfo>
              </SpreadsheetHeader>
            </>
          )}

          <SpreadsheetContent>
            {!hasTemplates ? (
              <NoTemplatesSection>
                <NoTemplatesText>
                  You haven't connected any spreadsheet yet.
                </NoTemplatesText>
                <ConnectButton
                  onClick={() => {
                    handleSafeNavigate("/account/csv-templates?new=1");
                  }}
                  disabled={isLoading}
                >
                  Connect spreadsheet
                </ConnectButton>
              </NoTemplatesSection>
            ) : !spreadsheetSelection ? (
              <SelectionSection>
                <SpreadsheetIcon>
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                </SpreadsheetIcon>
                <SelectionText>No product selected</SelectionText>
                <SelectButton 
                  onClick={() => onOpenSpreadsheetModal?.()}
                  disabled={isLoading}
                >
                  Select product
                </SelectButton>
              </SelectionSection>
            ) : (
              <>
                <SelectedProductSection>
                  {/* Simplified: Only Change/Restore buttons */}
                  <ProductActions>
                    <SecondaryButton 
                      onClick={() => onOpenSpreadsheetModal?.()}
                      disabled={isLoading}
                      style={{ opacity: isLoading ? 0.5 : 1 }}
                    >
                      Change
                    </SecondaryButton>
                    <SecondaryButton 
                      onClick={handleRestoreAll}
                      disabled={!hasHiddenImages || isLoading}
                      style={{ opacity: (hasHiddenImages && !isLoading) ? 1 : 0.4 }}
                    >
                      Restore{hasHiddenImages ? ` (${hiddenCount})` : ''}
                    </SecondaryButton>
                  </ProductActions>
                </SelectedProductSection>

                {/* Image grid when product is selected */}
                {(hasLoadedImages || loadingImages) && (
                  <ImageGridSection>
                    {/* In Different mode, source panel images are not used for generation */}
                    {saveTargetMode !== "different" && (
                      <PageInfo>
                        {totalActiveImages} images for generation
                        <InfoTooltip content="Tip: Using 1-2 images often produces better results" />
                      </PageInfo>
                    )}

                    {loadingImages ? (
                      <LoadingGridPlaceholder>
                        <LoadingSpinner />
                        <LoadingText>Loading images...</LoadingText>
                      </LoadingGridPlaceholder>
                    ) : (
                      <>
                        {isPERProduct ? (
                          /* PER_PRODUCT: Group by category - render in template order */
                          (() => {
                            const groups = getGroupedItems();
                            
                            // Get all image columns from template for showing categories in order
                            const templateColumns = spreadsheetSelection?.templateColumns || [];
                            const allImageColumns = templateColumns
                              .filter((col: any) => col.role === "image_url")
                              .map((col: any) => `col:${col.name}`);
                            
                            // Create a map of category -> group for quick lookup
                            const groupMap = new Map(groups.map(g => [g.category, g]));
                            
                            // ✅ FIX: When paginating, only show categories that have items on the CURRENT page
                            // Don't show empty placeholders for categories whose images are on other pages
                            // Empty placeholders should only appear on page 0 when category truly has no images
                            
                            // Get categories that have items on current page, sorted by template order
                            const currentPageCategories = groups.map(g => g.category);
                            
                            // Sort by template order if available
                            if (allImageColumns.length > 0) {
                              currentPageCategories.sort((a, b) => {
                                const aIndex = allImageColumns.indexOf(a);
                                const bIndex = allImageColumns.indexOf(b);
                                // If both are in template, use template order
                                if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
                                // If only one is in template, it comes first
                                if (aIndex !== -1) return -1;
                                if (bIndex !== -1) return 1;
                                // Neither in template, keep original order
                                return 0;
                              });
                            }
                            
                            // Only show empty placeholders on page 0 (first page) for categories with no images at all
                            const showEmptyPlaceholders = currentImagePage === 0;
                            
                            // Build orderedCategories: current page categories + empty categories (only on page 0)
                            let orderedCategories: string[];
                            if (showEmptyPlaceholders && allImageColumns.length > 0) {
                              // On first page: show all template categories in order
                              // But only show empty placeholder for categories that truly have no images (not just on different page)
                              const allCategoriesWithImages = new Set(activeImageItems.map(item => item.categoryToken));
                              orderedCategories = allImageColumns.filter(cat => {
                                // Show if: has items on current page OR is truly empty (no images anywhere)
                                return groupMap.has(cat) || !allCategoriesWithImages.has(cat);
                              });
                            } else {
                              // On later pages: only show categories with items on current page
                              orderedCategories = currentPageCategories;
                            }
                            
                            // Render categories
                            return orderedCategories.map((colToken: string) => {
                              const group = groupMap.get(colToken);
                              
                              if (group && group.items.length > 0) {
                                // Has images - render normally
                                return (
                                  <CategorySection key={group.category}>
                                    <CategoryHeader>
                                      {getCategoryDisplayName(group.category)} ({group.items.length})
                                    </CategoryHeader>
                                    <MainGrid>
                                      {group.items.map(({ displayItem, imgData, originalItem }, indexInCategory) => {
                                        if (!imgData) return null;
                                        return (
                                          <ThumbWrapper 
                                            key={displayItem.itemId || displayItem.url}
                                            draggable
                                            onDragStart={(e) => handleDragStartWithTracking(e, imgData)}
                                            onDragEnd={handleDragEnd}
                                          >
                                            <Thumb
                                              onClick={(e) => handleImageClick(e, imgData.previewURL)}
                                              $bg={imgData.previewURL}
                                              $usedForGeneration={usedForGenerationUrls.has(displayItem.url)}
                                              title="Click to preview · Drag to add as reference"
                                            />
                                            <RemoveBtn onClick={() => originalItem && hideByItemId(originalItem.id)} disabled={isLoading}>×</RemoveBtn>
                                            <ImageNumberBadge>{indexInCategory + 1}</ImageNumberBadge>
                                          </ThumbWrapper>
                                        );
                                      })}
                                    </MainGrid>
                                  </CategorySection>
                                );
                              } else {
                                // Empty category - only render placeholder if truly empty (not just on different page)
                                // This should only happen on page 0
                                return (
                                  <CategorySection key={`empty-${colToken}`}>
                                    <CategoryHeader>
                                      {getCategoryDisplayName(colToken)} (0)
                                    </CategoryHeader>
                                    <MainGrid>
                                      <EmptySlotSmall>Empty</EmptySlotSmall>
                                    </MainGrid>
                                  </CategorySection>
                                );
                              }
                            });
                          })()
                        ) : (
                          /* PER_IMAGE: Flat grid - read from cache for smooth hide */
                          <MainGrid>
                            {currentPageDisplayItems.map((displayItem, i) => {
                              // Read from cache first, fallback to mainPhotos
                              const imgData = imageCacheRef.current.get(displayItem.url) || mainPhotos[i];
                              if (!imgData) return null;
                              // Global index for PER_IMAGE mode (1-based)
                              const globalIndex = currentImagePage * IMAGES_PER_PAGE + i + 1;
                              return (
                                <ThumbWrapper 
                                  key={displayItem.url}
                                  draggable
                                  onDragStart={(e) => handleDragStartWithTracking(e, imgData)}
                                  onDragEnd={handleDragEnd}
                                >
                                  <Thumb
                                    onClick={(e) => handleImageClick(e, imgData.previewURL)}
                                    $bg={imgData.previewURL}
                                    $usedForGeneration={usedForGenerationUrls.has(displayItem.url)}
                                    title="Click to preview · Drag to add as reference"
                                  />
                                  <RemoveBtn onClick={() => hidePerImageByUrl(displayItem.url)} disabled={isLoading}>×</RemoveBtn>
                                  <ImageNumberBadge>{globalIndex}</ImageNumberBadge>
                                </ThumbWrapper>
                              );
                            })}
                          </MainGrid>
                        )}

                        {totalImagePages > 1 && (
                          <ImagePaginationRow>
                            <PageArrow 
                              onClick={handlePrevImagePage}
                              disabled={currentImagePage === 0 || isLoading}
                            >
                              ◀
                            </PageArrow>
                            <PageArrow 
                              onClick={handleNextImagePage}
                              disabled={currentImagePage >= totalImagePages - 1 || isLoading}
                            >
                              ▶
                            </PageArrow>
                          </ImagePaginationRow>
                        )}

                        {totalImagePages > 1 && saveTargetMode !== "different" && (
                          <PageHint>
                            These {mainPhotos.length} images will be used for generation
                          </PageHint>
                        )}
                      </>
                    )}
                  </ImageGridSection>
                )}
              </>
            )}
          </SpreadsheetContent>
        </SpreadsheetCard>
        </>
      )}

      {/* ========== Create Mode: Manual Upload Section ========== */}
      {isCreateMode && (
        <>
          <ColHeader>
            <AccentColTitle>Product Images</AccentColTitle>
          </ColHeader>
          
          {/* Hidden file inputs */}
          <Hidden
            ref={mainRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onMain}
            disabled={isLoading}
          />
          <Hidden
            ref={refsRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onRefs}
            disabled={isLoading}
          />

          <CreateModeContainer>
            {/* Upload Images: Empty state card OR compact layout */}
            {mainPhotos.length === 0 ? (
              <RefImagesCard>
                {/* Processing status inline */}
                {isProcessingUpload ? (
                  <ProcessingInline>
                    <ProcessingSpinner />
                    <ProcessingInlineText>
                      <span>Converting iPhone photo...</span>
                      <ProcessingFileName>{processingFileName}</ProcessingFileName>
                    </ProcessingInlineText>
                  </ProcessingInline>
                ) : (
                  <RefDropZoneInCard
                    onClick={() => !isLoading && pickMain()}
                    style={{ opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
                  >
                    <EmptyStateCardIcon>
                      <svg viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    </EmptyStateCardIcon>
                    <EmptyStateCardTitle>Upload images</EmptyStateCardTitle>
                    <EmptyStateCardSubtitle>Up to 8 images</EmptyStateCardSubtitle>
                  </RefDropZoneInCard>
                )}
              </RefImagesCard>
            ) : (
              <>
                {/* Product Images Grid */}
                <ProductImagesContainer $hasContent={true}>
                  <ScrollableImageGrid>
                    <MainGrid>
                      {mainPhotos.map((imgData, i) => (
                        <ThumbWrapper 
                          key={i}
                          draggable
                          onDragStart={(e) => handleDragStartWithTracking(e, imgData)}
                          onDragEnd={handleDragEnd}
                        >
                          <Thumb
                            onClick={(e) => handleImageClick(e, imgData.previewURL)}
                            $bg={imgData.previewURL}
                            $usedForGeneration={imgData.sourceUrl ? usedForGenerationUrls.has(imgData.sourceUrl) : false}
                            title="Click to preview · Drag to add as reference"
                          />
                          <RemoveBtn onClick={() => removeMain(i)} disabled={isLoading}>×</RemoveBtn>
                        </ThumbWrapper>
                      ))}
                    </MainGrid>
                  </ScrollableImageGrid>
                  {/* Choose Files Button - shows processing state when converting */}
                  <ChooseFilesCard 
                    onClick={pickMain} 
                    disabled={isLoading || isProcessingUpload}
                    $isProcessing={isProcessingUpload}
                  >
                    {isProcessingUpload ? (
                      <ProcessingInlineSmall>
                        <ProcessingSpinnerSmall />
                        <span>Converting {processingFileName}...</span>
                      </ProcessingInlineSmall>
                    ) : (
                      <ChooseFilesCardLabel>Choose Files</ChooseFilesCardLabel>
                    )}
                  </ChooseFilesCard>
                </ProductImagesContainer>
              </>
            )}

            {/* Reference Images: Always expanded, dashed drop zone inside */}
            <RefImagesCard>
              <RefDropZoneInCard
                onClick={() => !isLoading && pickRefs()}
                onDragOver={!isLoading ? handleDragOver : undefined}
                onDragLeave={!isLoading ? handleDragLeave : undefined}
                onDrop={!isLoading ? handleDropOnRef : undefined}
                $isDragging={isDraggingOverRef}
                $hasImages={refImages.length > 0}
                style={{ opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
              >
                {refImages.length === 0 ? (
                  <>
                    <EmptyStateCardIcon>
                      <svg viewBox="0 0 24 24">
                        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </EmptyStateCardIcon>
                    <EmptyStateCardTitle>Reference images</EmptyStateCardTitle>
                    <EmptyStateCardSubtitle>
                      {isDraggingOverRef ? "Drop images here" : "(optional) Drag or click"}
                    </EmptyStateCardSubtitle>
                  </>
                ) : (
                  <>
                    <RefGrid>
                      {refImages.map((imgData, i) => (
                        <ThumbWrapper key={i}>
                          <Thumb
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreview(imgData.previewURL);
                            }}
                            $bg={imgData.previewURL}
                          />
                          <RemoveBtn 
                            disabled={isLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRef(i);
                            }}
                          >×</RemoveBtn>
                        </ThumbWrapper>
                      ))}
                    </RefGrid>
                    {refImages.length < 4 && (
                      <RefAddHint $isDragging={isDraggingOverRef}>
                        {isDraggingOverRef ? "Drop to add" : "Drag to add more"}
                      </RefAddHint>
                    )}
                  </>
                )}
              </RefDropZoneInCard>
            </RefImagesCard>
          </CreateModeContainer>
        </>
      )}
        
        {/* Generate button for Original/Default mode (source column) */}
        {/* In Create mode: show when there's any content (mainPhotos or refImages) */}
        {/* In Import mode: always show */}
        {!generateInTargetColumn && (!isCreateMode || mainPhotos.length > 0 || refImages.length > 0) && (
          <Generate
            onClick={!disabled ? onGenerate : undefined}
            disabled={disabled}
            title={generateDisabled ? "Please sign in to generate images" : ""}
          >
            {generateLabel}
          </Generate>
        )}
        </LeftColumnStyled>

        {/* ===== MIDDLE COLUMN: Empty spacer for grid layout ===== */}
        <MiddleColumn $visible={false} />

        {/* ===== RIGHT COLUMN: Target Section ===== */}
        <RightColumnStyled>
          {/* ========== Save Target Section - Import Mode ========== */}
          {workMode === "import" && useSpreadsheetProducts && spreadsheetSelection && (
        <>
          {/* Target Header with template name */}
          <SourceHeader>
            <SourceTemplateName>
              {targetConfig ? targetConfig.targetTemplateName : "Select spreadsheet..."}
            </SourceTemplateName>
          </SourceHeader>
          
          {/* Different Tab Button - below divider */}
          <TargetOptionCompact
            $selected={saveTargetMode === "different"}
            onClick={() => {
              if (isLoading) return;
              if (!targetConfig) {
                onOpenTargetModal?.();
              } else {
                onSaveTargetModeChange?.("different");
              }
            }}
            style={{ 
              opacity: isLoading ? 0.5 : 1,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              pointerEvents: isLoading ? 'none' : 'auto'
            }}
          >
            <TargetRadio $selected={saveTargetMode === "different"}>
              {saveTargetMode === "different" && <TargetRadioDot />}
            </TargetRadio>
            <TargetLabelCompact $selected={saveTargetMode === "different"}>
              Different
            </TargetLabelCompact>
            {showOverrideButton && (
              <TargetChangeBtn
                $pulse={overrideButtonShouldPulse}
                disabled={isLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOverrideModalOpen(true);
                }}
              >
                Override
              </TargetChangeBtn>
            )}
          </TargetOptionCompact>

          {/* Target Product Display - Show selected target product info and images */}
          {targetConfig && saveTargetMode === "different" && (
            <TargetProductDisplay>
              {/* Simplified: Only Change/Restore buttons */}
              <ProductActions>
                <SecondaryButton 
                  onClick={() => onOpenTargetModal?.()}
                  disabled={isLoading}
                  style={{ opacity: isLoading ? 0.5 : 1 }}
                >
                  Change
                </SecondaryButton>
                <SecondaryButton 
                  onClick={restoreAllTargetImages}
                  disabled={removedTargetUrls.size === 0 || isLoading}
                  style={{ opacity: (removedTargetUrls.size > 0 && !isLoading) ? 1 : 0.4 }}
                >
                  Restore{removedTargetUrls.size > 0 ? ` (${removedTargetUrls.size})` : ''}
                </SecondaryButton>
              </ProductActions>

              {/* Target Product Images - Uses shared renderTargetImagesSection helper */}
              {(targetConfig as any).targetTemplateColumns && renderTargetImagesSection("target-import")}
            </TargetProductDisplay>
          )}

          {/* Empty state placeholder when Different mode content is not active */}
          {!(targetConfig && saveTargetMode === "different") && (
            <TargetEmptyPlaceholder>
              <ImportEmptyIcon $dim>
                <svg viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="12" x2="12" y2="18"/>
                  <polyline points="9 15 12 18 15 15"/>
                </svg>
              </ImportEmptyIcon>
              <ImportEmptyTitle $dim>Export Target</ImportEmptyTitle>
              <ImportEmptyDesc $dim>You can also save results to a different spreadsheet.</ImportEmptyDesc>
            </TargetEmptyPlaceholder>
          )}
        </>
      )}

      {/* ========== Export Target Section - Create Mode ========== */}
      {workMode === "create" && (
        <>
          <ColHeader>
            <TitleWithInfo>
              <AccentColTitle>Export Images</AccentColTitle>
              <InfoTooltip content="Choose where to save your generated images." />
            </TitleWithInfo>
          </ColHeader>

          {/* Show card style when NOT using spreadsheet target, compact style when using spreadsheet */}
          {!(targetConfig && saveTargetMode === "different") ? (
            <EmptyStateColumn>
              {/* Download Only Card */}
              <EmptyStateCard 
                $clickable 
                onClick={() => !isLoading && onSaveTargetModeChange?.("default")}
                style={{
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <EmptyStateCardIcon>
                  <svg viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </EmptyStateCardIcon>
                <EmptyStateCardTitle>Download Only</EmptyStateCardTitle>
                <EmptyStateRadio $selected={saveTargetMode === "default"}>
                  {saveTargetMode === "default" && <EmptyStateRadioDot />}
                </EmptyStateRadio>
              </EmptyStateCard>

              {/* Save to Spreadsheet Card */}
              <EmptyStateCard 
                $clickable 
                onClick={() => {
                  if (isLoading) return;
                  if (!userId) {
                    handleSafeNavigate("/login");
                    return;
                  }
                  if (!hasTemplates) {
                    handleSafeNavigate("/account/csv-templates?new=1");
                    return;
                  }
                  if (!targetConfig) {
                    onOpenTargetModal?.();
                  } else {
                    onSaveTargetModeChange?.("different");
                  }
                }}
                style={{
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <EmptyStateCardIcon>
                  <svg viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="3" y1="15" x2="21" y2="15"/>
                    <line x1="9" y1="3" x2="9" y2="21"/>
                    <line x1="15" y1="3" x2="15" y2="21"/>
                  </svg>
                </EmptyStateCardIcon>
                <EmptyStateCardTitle>
                  {targetConfig ? targetConfig.targetTemplateName : "Save to Spreadsheet"}
                </EmptyStateCardTitle>
                <EmptyStateCardSubtitle>
                  {targetConfig ? "Export directly to your sheet" : "Connect a spreadsheet"}
                </EmptyStateCardSubtitle>
                <EmptyStateRadio $selected={saveTargetMode === "different"}>
                  {saveTargetMode === "different" && <EmptyStateRadioDot />}
                </EmptyStateRadio>
              </EmptyStateCard>
            </EmptyStateColumn>
          ) : (
            /* Using spreadsheet target: Compact layout with target images */
            <TargetSection>
              <TargetOptionCompact
                $selected={false}
                onClick={() => !isLoading && onSaveTargetModeChange?.("default")}
                style={{
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <TargetRadio $selected={false}>
                </TargetRadio>
                <TargetLabelCompact $selected={false}>
                  Download Only
                </TargetLabelCompact>
              </TargetOptionCompact>

              <TargetOptionCompact
                $selected={true}
                onClick={() => {
                  if (isLoading) return;
                  onSaveTargetModeChange?.("different");
                }}
                style={{
                  marginTop: 8,
                  opacity: isLoading ? 0.5 : 1,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  pointerEvents: isLoading ? 'none' : 'auto'
                }}
              >
                <TargetRadio $selected={true}>
                  <TargetRadioDot />
                </TargetRadio>
                <TargetLabelCompact $selected={true}>
                  Save to: {targetConfig.targetTemplateName}
                </TargetLabelCompact>
                <TargetChangeBtn
                  disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTargetModal?.();
                  }}
                >
                  Change
                </TargetChangeBtn>
              </TargetOptionCompact>

              {/* Target Product Display - Show selected target product info and images */}
              <TargetProductDisplay>
                {/* Target Product Images - Uses shared renderTargetImagesSection helper */}
                {/* In create mode, hide X buttons and "for generation" text */}
                {(targetConfig as any).targetTemplateColumns && renderTargetImagesSection("target-create", false)}
              </TargetProductDisplay>
            </TargetSection>
          )}
        </>
      )}
        
        {/* Generate button for Different mode (target column) */}
        {generateInTargetColumn && (
          <Generate
            onClick={!disabled ? onGenerate : undefined}
            disabled={disabled}
            title={
              generateDisabledByEmptyTarget 
                ? "Please override images to target panel first" 
                : generateDisabled 
                ? "Please sign in to generate images" 
                : ""
            }
          >
            {generateLabel}
          </Generate>
        )}
        </RightColumnStyled>
      </ThreeColumnBody>
      )}

      {/* Override Modal */}
      {spreadsheetSelection && targetConfig && userId && (
        <OverrideModal
          isOpen={isOverrideModalOpen}
          onClose={() => setIsOverrideModalOpen(false)}
          userId={userId}
          sourceTemplateName={spreadsheetSelection.templateName}
          sourceTemplateId={spreadsheetSelection.templateId}
          sourceProductKey={spreadsheetSelection.key}
          sourceProductTitle={spreadsheetSelection.title}
          sourceSku={spreadsheetSelection.sku}
          sourceRowMode={spreadsheetSelection.rowMode}
          sourceImages={spreadsheetSelection.images}
          sourceTemplateColumns={spreadsheetSelection.templateColumns}
          targetConfig={targetConfig}
          onSuccess={onSuccess}
          onError={onError}
          onSaved={() => {
            onOverrideSaved?.();
            // Note: Don't call onOverrideToTarget here - OverrideModal already handles the save
          }}
          onPreview={onPreview}
          onTargetImagesUpdate={onTargetImagesUpdate}
        />
      )}

      {/* Navigation Warning Modal */}
      {showNavigationWarning && (
        <AlertModal
          title="Leave this page?"
          message="You have unsaved changes that will be lost if you leave. Are you sure you want to continue?"
          onClose={handleNavigationCancel}
          onConfirm={handleNavigationConfirm}
          showCancel={true}
          confirmText="Leave"
          cancelText="Cancel"
        />
      )}
    </Card>
  );
}

export default memo(LeftPanelComponent);

/* ============ Styled Components ============ */

const Card = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  overflow: hidden;
  min-width: 0; /* Allow flexbox shrinking */
  
  @media (max-width: 1400px) {
    padding: 16px;
    gap: 12px;
  }
  
  @media (max-width: 1200px) {
    padding: 14px;
    gap: 10px;
  }
`;

/* LeftColumn - disable scrolling, let ImageGridSection scroll instead */
const LeftColumnStyled = styled(LeftColumn)`
  overflow: hidden;
`;

/* RightColumn - disable scrolling, let ImageGridSection scroll instead */
const RightColumnStyled = styled(RightColumn)`
  overflow: hidden;
`;

/* Centered Header - override ColHeader for centered titles */
const CenteredColHeader = styled(ColHeader)`
  justify-content: center;
`;

/* Accent colored section title */
const AccentColTitle = styled(ColTitle)`
  color: ${({ theme }) => theme.colors.accent};
`;

const Title = styled.div`
  font-weight: 800;
  font-size: 24px;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

const SectionTitle = styled.div`
  font-weight: 800;
  font-size: 16px;
  margin-top: 4px;
`;

const SmallTip = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const Hidden = styled.input`
  display: none;
`;

const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  padding: 16px 16px 20px;
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  cursor: pointer;
  transition: all 0.2s;
`;

const UploadHeroIcon = styled.div`
  width: 40px;
  height: 40px;
  background: ${({ theme }) => theme.colors.white};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  svg {
    width: 20px;
    height: 20px;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 2;
    fill: none;
  }
`;

const UploadHeroTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const UploadHeroSubtitle = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const UploadHeroFormats = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: 4px;
`;

const DropZone = styled.div<{ $isDragging?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  height: 120px;
  background: ${({ theme, $isDragging }) => 
    $isDragging ? `${theme.colors.accent}15` : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 13px;
  color: ${({ theme, $isDragging }) => 
    $isDragging ? theme.colors.text : theme.colors.muted};
  font-weight: ${({ $isDragging }) => $isDragging ? '600' : '400'};
  cursor: pointer;
  transition: all 0.2s;
  &:hover {
    opacity: 0.8;
  }
`;

const RefDropZone = styled.div<{ $isDragging?: boolean; $hasImages?: boolean }>`
  position: relative;
  flex: 1;
  min-height: ${({ $hasImages }) => $hasImages ? '0' : '80px'};
  padding: ${({ $hasImages }) => $hasImages ? '8px' : '16px'};
  border: 2px dashed ${({ theme, $isDragging }) => 
    $isDragging ? theme.colors.accent : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: transparent;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: ${({ $hasImages }) => $hasImages ? 'stretch' : 'center'};
  justify-content: ${({ $hasImages }) => $hasImages ? 'flex-start' : 'center'};
  overflow-y: auto;
  overflow-x: hidden;
  
  &:hover {
    border-color: ${({ theme }) => theme.colors.accent};
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

const RefDropzoneIcon = styled.div`
  width: 36px;
  height: 36px;
  background: ${({ theme }) => theme.colors.white};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
  
  svg {
    width: 18px;
    height: 18px;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 2;
    fill: none;
  }
`;

const RefEmptyText = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

const RefAddHint = styled.div<{ $isDragging?: boolean }>`
  text-align: center;
  font-size: 11px;
  color: ${({ theme, $isDragging }) => $isDragging ? theme.colors.text : theme.colors.muted};
  font-weight: ${({ $isDragging }) => $isDragging ? '600' : '400'};
  padding-top: 8px;
`;

const RefHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const RefTip = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  flex: 1;
`;

const RefHeaderRowClickable = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
  border-radius: ${({ theme }) => theme.radius.sm};
  transition: opacity 0.2s;
  
  &:hover {
    opacity: 0.8;
  }
`;

const ChooseBtnSmall = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/* Content wrapper for Reference Images collapsible with proper spacing */
const RefImagesContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DropHint = styled.div`
  position: absolute;
  bottom: -24px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.text};
  font-weight: 600;
`;

const ChooseBtn = styled.button`
  width: 100%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadow.soft};
  transition: all 0.2s;
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const ChooseBtnRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
`;

const MainGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
`;

const RefGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  width: 100%;
`;

const ThumbWrapper = styled.div`
  position: relative;
  width: 100%;
  
  &[draggable="true"] {
    cursor: grab;
    
    &:active {
      cursor: grabbing;
    }
  }
`;

const Thumb = styled.div<{ $bg: string; $usedForGeneration?: boolean }>`
  width: 100%;
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.md};
  background: url(${(p) => getProxiedImageUrl(p.$bg)}) center/cover no-repeat;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.2s ease;
  /* Use inset box-shadow so it doesn't get clipped by overflow:hidden */
  box-shadow: ${({ $usedForGeneration, theme }) => 
    $usedForGeneration ? `inset 0 0 0 3px ${theme.colors.text}` : 'none'};
  &:hover {
    transform: scale(1.03);
  }
`;

const RemoveBtn = styled.button`
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
  
  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    pointer-events: none;
  }
`;

// Image number badge for identifying position in save dialog
const ImageNumberBadge = styled.div`
  position: absolute;
  bottom: 6px;
  right: 6px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.65);
  color: white;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
`;

const Generate = styled.button`
  margin-top: auto;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 12px 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* ========== Spreadsheet Section ========== */
const SpreadsheetCard = styled.div<{ $hasSelection?: boolean }>`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* When no selection, auto height; when selected, take flexible space */
  flex: ${({ $hasSelection }) => $hasSelection ? '1' : '0 0 auto'};
  min-height: 0;
  overflow: hidden;
`;

const SpreadsheetHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const SpreadsheetTitle = styled.div`
  font-size: 15px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
`;

const SpreadsheetDescription = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  line-height: 1.5;
`;

const SpreadsheetContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0; /* Allow shrinking for flex children to scroll */
  overflow: hidden;
`;

/* ========== Toggle ========== */
const ToggleWrapper = styled.div`
  position: relative;
  width: 44px;
  height: 24px;
  cursor: pointer;
  user-select: none;
`;

const ToggleTrack = styled.div<{ $active?: boolean }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.accent : theme.colors.border};
  border-radius: 9999px;
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 2px;
  transition: background 0.25s ease;
`;

const ToggleThumb = styled.div<{ $active?: boolean }>`
  position: absolute;
  left: ${({ $active }) => ($active ? "calc(100% - 22px)" : "2px")};
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.white};
  transition: all 0.25s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

/* ========== Inner sections ========== */
const NoTemplatesSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
  padding: 8px 0;
`;

const NoTemplatesText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const ConnectButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 700;
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

const SelectionSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  padding: 24px 16px;
`;

/* ========== Import Mode Empty State - Two Column Layout (no divider) ========== */
const ImportEmptyTwoColumns = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const ImportEmptyColumn = styled.div`
  display: flex;
  flex-direction: column;
`;

const ImportEmptyHeader = styled.div<{ $dim?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-bottom: 12px;
  flex-shrink: 0;
  
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: ${({ theme, $dim }) => $dim ? theme.colors.muted : theme.colors.accent};
`;

const ImportEmptyCard = styled.div<{ $inactive?: boolean }>`
  flex: 1;
  background: ${({ theme, $inactive }) => $inactive ? theme.colors.bg : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 24px 16px;
  padding-bottom: ${({ $inactive }) => $inactive ? '80px' : '24px'};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  opacity: ${({ $inactive }) => $inactive ? 0.7 : 1};
`;

const ImportEmptyIcon = styled.div<{ $dim?: boolean }>`
  width: 48px;
  height: 48px;
  
  svg {
    width: 100%;
    height: 100%;
    stroke: ${({ theme, $dim }) => $dim ? theme.colors.muted : theme.colors.accent};
    stroke-width: 1.5;
    fill: none;
  }
`;

const ImportEmptyTitle = styled.div<{ $dim?: boolean }>`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme, $dim }) => $dim ? theme.colors.muted : theme.colors.text};
`;

const ImportEmptyDesc = styled.div<{ $dim?: boolean }>`
  font-size: 13px;
  color: ${({ theme, $dim }) => $dim ? theme.colors.muted : theme.colors.muted};
  line-height: 1.5;
`;

const ImportEmptyButton = styled.button`
  margin-top: 8px;
  padding: 12px 24px;
  background: ${({ theme }) => theme.colors.accent};
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.white};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const SpreadsheetIcon = styled.div`
  width: 40px;
  height: 40px;
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

const SelectionTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const SelectionText = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const SelectButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 700;
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

const SelectedProductSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ProductInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ProductSKU = styled.div`
  font-weight: 800;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const ProductTitle = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
`;

const ProductMeta = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

/* Previous/Next Product Navigation - Primary (accent color) */
const ProductNavigation = styled.div`
  display: flex;
  gap: 8px;
`;

const PrimaryNavButton = styled.button`
  flex: 1;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/* Change/Clear - Secondary (white background) */
const ProductActions = styled.div`
  display: flex;
  gap: 8px;
`;

const SecondaryButton = styled.button`
  flex: 1;
  background: ${({ theme }) => theme.colors.white};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.8;
  }
  
  &:disabled {
    cursor: not-allowed;
  }
`;

/* ========== Image Grid Section ========== */
const ImageGridSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0; /* Allow shrinking */
  overflow-y: auto;
  padding-right: 4px; /* Space for scrollbar */
  
  /* Remove any borders or outlines */
  border: none;
  outline: none;
  
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

/* Arrows below images - centered, NO shadow */
const ImagePaginationRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 4px;
`;

const PageArrow = styled.button`
  background: ${({ theme }) => theme.colors.card};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: 4px;
  width: 32px;
  height: 32px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.accent};
    color: ${({ theme }) => theme.colors.white};
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
`;

/* Page info above images */
const PageInfo = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
`;

const PageHint = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
  font-style: italic;
`;

/* Category-based image display */
const CategorySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const CategoryHeader = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const ImageTip = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
  padding: 4px 0;
`;

const LoadingGridPlaceholder = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 120px;
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.md};
`;

const LoadingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 3px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.accent};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const LoadingText = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
`;

/* ========== Create Mode Containers ========== */
const CreateModeContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 12px;
  overflow: hidden;
`;

/* ========== Processing Inline for HEIC conversion ========== */
const ProcessingInline = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 16px;
  height: 100%;
`;

const ProcessingSpinner = styled.div`
  width: 24px;
  height: 24px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.accent};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const ProcessingInlineText = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  
  span {
    font-size: 13px;
    font-weight: 500;
    color: ${({ theme }) => theme.colors.text};
  }
`;

const ProcessingFileName = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ProductImagesContainer = styled.div<{ $hasContent?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: ${({ $hasContent }) => $hasContent ? '1.2 1 0' : '0 0 auto'};
  min-height: 0;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
  overflow: hidden;
  transition: all 0.3s ease;
`;

const ScrollableImageGrid = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  
  /* Remove any borders or outlines */
  border: none;
  outline: none;
  
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

const ReferenceImagesContainer = styled.div<{ $collapsed?: boolean }>`
  display: flex;
  flex-direction: column;
  /* When collapsed, auto height; when expanded, take flexible space */
  flex: ${({ $collapsed }) => $collapsed ? '0 0 auto' : '1 1 0'};
  min-height: 0;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  overflow: hidden;
  transition: all 0.3s ease;
`;

const RefImagesScrollable = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0 16px 16px;
`;

const RefSectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  background: transparent;
`;

const RefHeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const RefIcon = styled.div`
  width: 32px;
  height: 32px;
  background: ${({ theme }) => theme.colors.white};
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  svg {
    width: 16px;
    height: 16px;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 2;
    fill: none;
  }
`;

const RefSectionTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const RefOptionalTag = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 500;
  margin-left: 4px;
`;

const RefExpandIcon = styled.span<{ $expanded?: boolean }>`
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.muted};
  font-size: 10px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: 6px;
  transition: transform 0.2s;
  transform: ${({ $expanded }) => $expanded ? 'rotate(180deg)' : 'rotate(0)'};
`;

const ManualUploadSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

/* ========== Target Section ========== */
const TargetSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const TargetSectionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const TargetOptionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TargetOption = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    opacity: 0.9;
  }
`;

const TargetOptionIcon = styled.div<{ $selected?: boolean }>`
  width: 40px;
  height: 40px;
  background: ${({ $selected, theme }) => 
    $selected ? theme.colors.white : theme.colors.white};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  svg {
    width: 20px;
    height: 20px;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 2;
    fill: none;
  }
`;

/* Choose Files Card - matches Generate button style */
const ChooseFilesCard = styled.button<{ $isProcessing?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 14px;
  background: ${({ theme, $isProcessing }) => $isProcessing ? theme.colors.inner : theme.colors.accent};
  color: ${({ theme, $isProcessing }) => $isProcessing ? theme.colors.text : theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  &:disabled {
    opacity: ${({ $isProcessing }) => $isProcessing ? 1 : 0.5};
    cursor: ${({ $isProcessing }) => $isProcessing ? 'default' : 'not-allowed'};
  }
`;

/* Small inline processing indicator */
const ProcessingInlineSmall = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  
  span {
    font-size: 12px;
    font-weight: 500;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ProcessingSpinnerSmall = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.accent};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
`;

const ChooseFilesCardIcon = styled.div`
  width: 40px;
  height: 40px;
  background: ${({ theme }) => theme.colors.white};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  svg {
    width: 20px;
    height: 20px;
    stroke: ${({ theme }) => theme.colors.accent};
    stroke-width: 2;
    fill: none;
  }
`;

const ChooseFilesCardLabel = styled.span`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.white};
`;

/* ========== Create Mode Empty State - 4-Grid Card Layout ========== */
const EmptyStateColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
`;

const EmptyStateCard = styled.div<{ $clickable?: boolean; $isHoverable?: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 12px;
  text-align: center;
  cursor: ${({ $clickable }) => $clickable ? 'pointer' : 'default'};
  transition: all 0.2s;
  min-height: 140px;
  
  &:hover {
    opacity: ${({ $clickable }) => $clickable ? 0.85 : 1};
    background: ${({ $clickable, theme }) => $clickable ? theme.colors.border : theme.colors.inner};
  }
`;

/* Dropzone card with dashed border for upload areas */
const EmptyStateCardDropzone = styled.div<{ $isDragging?: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: ${({ $isDragging, theme }) => 
    $isDragging ? `${theme.colors.accent}15` : theme.colors.inner};
  border: 2px dashed ${({ $isDragging, theme }) => 
    $isDragging ? theme.colors.accent : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 12px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 140px;
  
  &:hover {
    border-color: ${({ theme }) => theme.colors.accent};
    background: ${({ theme }) => `${theme.colors.accent}08`};
  }
`;

/* Reference Images container - no centering to allow proper grid display */
const RefImagesCard = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 12px;
  min-height: 140px;
  overflow: hidden;
`;

const EmptyStateCardDashed = styled(EmptyStateCard)<{ $isDragging?: boolean }>`
  border: 2px dashed ${({ $isDragging, theme }) => 
    $isDragging ? theme.colors.accent : theme.colors.border};
  background: ${({ $isDragging, theme }) => 
    $isDragging ? `${theme.colors.accent}15` : theme.colors.inner};
`;

const RefDropZoneInCard = styled.div<{ $isDragging?: boolean; $hasImages?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: ${({ $hasImages }) => $hasImages ? 'flex-start' : 'center'};
  gap: 10px;
  width: 100%;
  flex: 1;
  min-height: 0;
  border: 2px dashed ${({ $isDragging, theme }) => 
    $isDragging ? theme.colors.accent : theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px;
  background: ${({ $isDragging, theme }) => 
    $isDragging ? `${theme.colors.accent}10` : 'transparent'};
  transition: all 0.2s;
  cursor: pointer;
  overflow: auto;
  
  &:hover {
    border-color: ${({ theme }) => theme.colors.accent};
    background: ${({ theme }) => `${theme.colors.accent}08`};
  }
`;

const EmptyStateCardIcon = styled.div`
  width: 40px;
  height: 40px;
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

const EmptyStateCardTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const EmptyStateCardSubtitle = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin-top: -4px;
`;

const EmptyStateRadio = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : theme.colors.border};
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.accent : "transparent"};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
`;

const EmptyStateRadioDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.white};
`;

const TargetOptionContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
`;

const TargetRadio = styled.div<{ $selected: boolean }>`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.border};
  background: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : "transparent"};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s;
  margin-top: 2px;
`;

const TargetRadioDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.accent};
`;

const TargetLabel = styled.div<{ $selected?: boolean }>`
  font-size: 14px;
  font-weight: 700;
  color: ${({ $selected, theme }) => $selected ? theme.colors.white : theme.colors.text};
`;

const TargetDescription = styled.div<{ $selected?: boolean }>`
  font-size: 12px;
  color: ${({ $selected, theme }) => $selected ? 'rgba(255,255,255,0.8)' : theme.colors.muted};
  line-height: 1.4;
`;

const TargetHint = styled.span<{ $selected?: boolean }>`
  font-weight: 400;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.muted};
  font-size: 12px;
`;

const TargetChangeBtn = styled.button<{ $pulse?: boolean }>`
  background: ${({ theme, $pulse }) => $pulse ? theme.colors.accent : theme.colors.white};
  color: ${({ theme, $pulse }) => $pulse ? theme.colors.white : theme.colors.accent};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;

  ${({ $pulse }) => $pulse && `
    animation: overridePulse 1.5s ease-in-out infinite;
    
    @keyframes overridePulse {
      0%, 100% {
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(139, 90, 43, 0.4);
      }
      50% {
        transform: scale(1.05);
        box-shadow: 0 0 0 8px rgba(139, 90, 43, 0);
      }
    }
  `}

  &:hover:not(:disabled) {
    opacity: 0.8;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    animation: none;
  }
`;

/* ========== Target Product Display ========== */
const TargetProductDisplay = styled.div`
  padding: 16px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0; /* Allow shrinking for flex children to scroll */
  overflow: hidden;
`;

/* ========== Target Empty Placeholder (shown when Different not active) ========== */
const TargetEmptyPlaceholder = styled.div`
  flex: 1;
  background: ${({ theme }) => theme.colors.bg};
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  opacity: 0.7;
`;

const TargetProductInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const TargetProductSKU = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.accent};
`;

const TargetProductTitle = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TargetProductMeta = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
`;

const TargetImagesSection = styled.div`
  margin-top: 12px;
`;

const TargetImagesHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const TargetImagesCount = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
`;

const TargetHiddenCount = styled.span`
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 400;
`;

const TargetRestoreBtn = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.inner};
    color: ${({ theme }) => theme.colors.text};
  }
`;

const TargetCategoryGroup = styled.div`
  margin-bottom: 12px;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const TargetCategoryLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
`;

const TargetImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
`;

const TargetThumbWrapper = styled.div`
  position: relative;
`;

const TargetImageThumb = styled.div<{ $bg: string }>`
  aspect-ratio: 1;
  background: url(${({ $bg }) => getProxiedImageUrl($bg)}) center/cover no-repeat;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: transform 0.15s ease;

  &:hover {
    transform: scale(1.03);
  }
`;

const TargetRemoveBtn = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 2;

  ${TargetThumbWrapper}:hover & {
    opacity: 1;
  }

  &:hover {
    background: rgba(220, 53, 69, 0.9);
  }
`;

// Stage 20: Empty slot for new product category
const TargetEmptySlot = styled.div`
  aspect-ratio: 1;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.sm};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

// Small empty slot that fits in MainGrid (same size as image thumbnails)
const EmptySlotSmall = styled.div`
  aspect-ratio: 1;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

/* ========== T-Layout for Save Target (both columns shown side by side) ========== */
const TargetTLayout = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
`;

const TargetTColumn = styled.div<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  background: ${({ theme, $selected }) => $selected ? theme.colors.accent + '15' : theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  border: 2px solid ${({ theme, $selected }) => 
    $selected ? theme.colors.accent : 'transparent'};
  transition: all 0.2s ease;
`;

const TargetTHeader = styled.button<{ $selected: boolean }>`
  background: ${({ theme, $selected }) => 
    $selected ? theme.colors.accent : 'transparent'};
  color: ${({ theme, $selected }) => 
    $selected ? theme.colors.white : theme.colors.text};
  border: none;
  padding: 6px 8px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  
  &:hover {
    background: ${({ theme, $selected }) => 
      $selected ? theme.colors.accent : theme.colors.border};
  }
`;

const TargetTContent = styled.div`
  padding: 8px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 80px;
`;

const TargetTEmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 6px;
  text-align: center;
  gap: 6px;
  flex: 1;
`;

const TargetTEmptyText = styled.div`
  font-size: 9px;
  color: ${({ theme }) => theme.colors.muted};
`;

const TargetTSelectBtn = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 4px 8px;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  
  &:hover {
    opacity: 0.9;
  }
`;

const TargetTChangeBtn = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.accent};
  border: 1px solid ${({ theme }) => theme.colors.accent};
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 2px 6px;
  font-size: 8px;
  font-weight: 700;
  cursor: pointer;
  margin-top: 2px;
  align-self: flex-start;

  &:hover {
    background: ${({ theme }) => theme.colors.accent}15;
  }
`;

const TargetTInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const TargetTSKU = styled.div`
  font-size: 9px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.accent};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TargetTTitle = styled.div`
  font-size: 8px;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TargetTMeta = styled.div`
  font-size: 7px;
  color: ${({ theme }) => theme.colors.muted};
`;

const TargetTImages = styled.div`
  margin-top: 3px;
`;

const TargetTImgCount = styled.div`
  font-size: 7px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.muted};
  margin-bottom: 2px;
`;

const TargetTImgGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 2px;
`;

const TargetTImgThumb = styled.div<{ $bg: string }>`
  aspect-ratio: 1;
  background: url(${({ $bg }) => getProxiedImageUrl($bg)}) center/cover no-repeat;
  border-radius: 3px;
  cursor: pointer;
  
  &:hover {
    opacity: 0.85;
  }
`;

const TargetTMoreCount = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  background: ${({ theme }) => theme.colors.border};
  border-radius: 3px;
  font-size: 7px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.muted};
`;

/* ========== Compact Target Option (for horizontal layout) ========== */
const TargetOptionCompact = styled.div<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
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

const TargetLabelCompact = styled.div<{ $selected?: boolean }>`
  flex: 1;
  font-size: 13px;
  font-weight: 700;
  color: ${({ $selected, theme }) =>
    $selected ? theme.colors.white : theme.colors.text};
`;

/* ========== Source/Target Header (matches ResultColumn's ColumnHeader style) ========== */
const SourceHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-bottom: 4px;
  flex-shrink: 0;
`;

const SourceLabel = styled.span`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.muted};
`;

const SourceTemplateName = styled.h3`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;