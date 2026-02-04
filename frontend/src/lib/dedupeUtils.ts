/**
 * Dedupe utilities for display vs storage separation.
 * 
 * Key principle: "Display dedupe, Storage no-dedupe"
 * - UI shows deduplicated list (no repeated images)
 * - Storage (Firestore/exportOverrides) keeps the full array
 * - originIndex maps display position back to storage position
 */

/**
 * Display item with origin tracking.
 * Used to map from deduped display position to original storage position.
 */
export interface DisplayItem {
  url: string;
  originIndex: number; // Position in the original (non-deduped) array
  itemId?: string;     // Optional: PER_PRODUCT item ID for operations
  exportIndex?: number; // Optional: PER_PRODUCT export array index
}

/**
 * Dedupe images for display while tracking original indices.
 * 
 * @param urls - Array of image URLs (may contain duplicates or empty values)
 * @param options - Optional metadata to attach to each item
 * @returns Deduplicated array with originIndex for each unique URL
 * 
 * @example
 * // Input: [A, B, A, C, B, D] (6 items, A and B duplicated)
 * // Output: [
 * //   { url: A, originIndex: 0 },
 * //   { url: B, originIndex: 1 },
 * //   { url: C, originIndex: 3 },
 * //   { url: D, originIndex: 5 },
 * // ] (4 unique items)
 */
export function dedupeForDisplay(
  urls: string[],
  options?: {
    itemIds?: string[];      // PER_PRODUCT: item IDs parallel to urls
    exportIndices?: number[]; // PER_PRODUCT: export array indices parallel to urls
  }
): DisplayItem[] {
  const seen = new Set<string>();
  const result: DisplayItem[] = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    
    // Filter empty/invalid URLs
    if (!url) continue;
    
    // Skip duplicates
    if (seen.has(url)) continue;
    
    seen.add(url);
    result.push({
      url,
      originIndex: i,
      itemId: options?.itemIds?.[i],
      exportIndex: options?.exportIndices?.[i],
    });
  }
  
  return result;
}

/**
 * Get deduplicated count (number of unique non-empty URLs).
 */
export function getDedupeCount(urls: string[]): number {
  const validUrls = urls.filter(url => !!url);
  return new Set(validUrls).size;
}

/**
 * Build visible pairs for PER_PRODUCT mode.
 * Maps panel visible IDs to export array indices safely.
 * 
 * @param panelVisibleIds - IDs of visible items in panel order
 * @param exportIds - All export item IDs
 * @param exportImages - All export image URLs
 * @returns Array of {url, exportIndex} pairs (filtered: no -1 indices)
 */
export interface VisiblePair {
  url: string;
  exportIndex: number;
}

export function buildVisiblePairs(
  panelVisibleIds: string[],
  exportIds: string[],
  exportImages: string[]
): VisiblePair[] {
  const result: VisiblePair[] = [];
  
  for (const id of panelVisibleIds) {
    const exportIndex = exportIds.indexOf(id);
    
    // Skip if ID not found in export arrays
    if (exportIndex < 0) continue;
    
    const url = exportImages[exportIndex];
    
    // Skip empty URLs
    if (!url) continue;
    
    result.push({ url, exportIndex });
  }
  
  return result;
}

/**
 * Dedupe visible pairs for PER_PRODUCT Replace One.
 * Returns deduped list with both originIndex (in visible array) and exportIndex (in export array).
 */
export interface DedupedVisibleItem {
  url: string;
  originIndex: number;  // Position in visiblePairs array (before dedupe)
  exportIndex: number;  // Position in export arrays (for finalImages[realIndex])
}

export function dedupeVisiblePairs(pairs: VisiblePair[]): DedupedVisibleItem[] {
  const seen = new Set<string>();
  const result: DedupedVisibleItem[] = [];
  
  for (let i = 0; i < pairs.length; i++) {
    const { url, exportIndex } = pairs[i];
    
    // Filter empty URLs
    if (!url) continue;
    
    // Skip duplicates
    if (seen.has(url)) continue;
    
    seen.add(url);
    result.push({
      url,
      originIndex: i,
      exportIndex,
    });
  }
  
  return result;
}