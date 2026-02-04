/**
 * Spreadsheet Image Loader
 * Utility functions to load images from URLs and convert them to ImageData format
 */

import { ImageData } from "../components/LeftPanel";
import { needsProxy, getProxiedImageUrl } from "./imageProxy";

// ✅ URL-based cache - keyed by exact URL to prevent cross-contamination
const imageCache = new Map<string, ImageData>();

/**
 * Clear the image cache
 * Call this when switching products or modes
 */
export function clearImageCache(): void {
  console.log(`[ImageLoader] Clearing cache (${imageCache.size} entries)`);
  imageCache.clear();
}

/**
 * Options for loading images
 */
export interface LoadImageOptions {
  skipCache?: boolean;  // Force reload, skip cache lookup
}

/**
 * Fetch an image from URL and convert to File object
 * Handles both regular URLs and Firebase Storage CDN URLs
 */
async function urlToFile(url: string, filename: string): Promise<File> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type });
}

/**
 * Load an image using Image element (fallback for CORS issues)
 * This works for any publicly accessible image URL
 */
async function urlToFileViaImage(url: string, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], filename, { type: 'image/png' }));
          } else {
            reject(new Error('Failed to convert canvas to blob'));
          }
        }, 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image via Image element: ${url}`));
    };
    
    img.src = url;
  });
}

/**
 * Smart image loader that tries fetch first, then falls back to Image element
 * For anti-hotlinking domains (alicdn, 1688, etc.), uses backend proxy
 * Returns null if both methods fail (CORS blocked)
 */
async function smartUrlToFile(url: string, filename: string): Promise<File | null> {
  // 🔑 对于需要代理的 URL（阿里巴巴等防盗链域名），使用后端代理
  const fetchUrl = needsProxy(url) ? getProxiedImageUrl(url) : url;
  
  try {
    // Try fetch first (faster, preserves original format)
    return await urlToFile(fetchUrl, filename);
  } catch (fetchError) {
    console.log(`[ImageLoader] Fetch failed for ${filename}, trying Image fallback`);
    try {
      // Fallback to Image element loading (works around some CORS issues)
      return await urlToFileViaImage(fetchUrl, filename);
    } catch (imgError) {
      console.warn(`[ImageLoader] Both methods failed for ${url} (CORS blocked)`);
      // Return null - will be handled as display-only
      return null;
    }
  }
}

/**
 * Create a display-only ImageData for URLs that can't be fetched (CORS blocked)
 * These images can be displayed but not used for AI generation
 */
function createDisplayOnlyImageData(url: string): ImageData {
  return {
    previewURL: url,      // Use original URL directly for display
    aiOptimized: "",      // Empty - can't be used for generation
    width: 0,             // Unknown
    height: 0,            // Unknown
    sourceUrl: url,
    displayOnly: true,    // Flag to indicate this can't be used for generation
  };
}

/**
 * Load images from URLs and convert to ImageData format
 * For CORS-blocked URLs, creates display-only ImageData
 * 
 * @param urls - Array of image URLs to load
 * @param processImageFiles - Function to process loaded files
 * @param options - Optional settings (skipCache, etc.)
 */
export async function loadImagesFromUrls(
  urls: string[],
  processImageFiles: (files: File[]) => Promise<ImageData[]>,
  options?: LoadImageOptions
): Promise<ImageData[]> {
  if (!urls || urls.length === 0) return [];

  const skipCache = options?.skipCache ?? false;
  
  console.log(`[ImageLoader] Loading ${urls.length} images from URLs...${skipCache ? ' (cache bypassed)' : ''}`);

  const imageDataResults: ImageData[] = [];

  // Process each URL individually to handle mixed success/failure
  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
    const filename = `spreadsheet-image-${idx}.jpg`;

    // ✅ Check cache first (unless skipCache is true)
    if (!skipCache && imageCache.has(url)) {
      const cached = imageCache.get(url)!;
      console.log(`[ImageLoader] 📦 Image ${idx} loaded from cache`);
      imageDataResults.push(cached);
      continue;
    }

    try {
      const file = await smartUrlToFile(url, filename);
      
      if (file) {
        // Successfully fetched - process through normal pipeline
        const processed = await processImageFiles([file]);
        if (processed[0]) {
          const imageData = { ...processed[0], sourceUrl: url };
          imageDataResults.push(imageData);
          
          // ✅ Cache the result by exact URL
          imageCache.set(url, imageData);
          
          console.log(`[ImageLoader] ✅ Image ${idx} loaded and processed`);
        }
      } else {
        // CORS blocked - create display-only ImageData
        console.log(`[ImageLoader] ⚠️ Image ${idx} CORS blocked, using display-only mode`);
        const displayOnly = createDisplayOnlyImageData(url);
        imageDataResults.push(displayOnly);
        
        // Don't cache display-only entries - they might work later
      }
    } catch (err) {
      console.error(`[ImageLoader] ❌ Failed to load image ${idx}:`, err);
      // Still try to display it
      const displayOnly = createDisplayOnlyImageData(url);
      imageDataResults.push(displayOnly);
    }
  }

  console.log(`[ImageLoader] Loaded ${imageDataResults.length}/${urls.length} images (some may be display-only)`);
  return imageDataResults;
}

/**
 * Load images from spreadsheet selection
 * @param urls - Array of image URLs to load
 * @param processImageFiles - Function to process loaded files
 * @param maxImages - Maximum number of images to load (default: 8)
 * @param options - Optional settings (skipCache, etc.)
 */
export async function loadSpreadsheetImages(
  urls: string[],
  processImageFiles: (files: File[]) => Promise<ImageData[]>,
  maxImages: number = 8,
  options?: LoadImageOptions
): Promise<ImageData[]> {
  const limitedUrls = urls.slice(0, maxImages);
  return loadImagesFromUrls(limitedUrls, processImageFiles, options);
}