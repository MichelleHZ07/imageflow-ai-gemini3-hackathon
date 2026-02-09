/**
 * Image Utilities for Performance Optimization
 * 
 * Triple Storage Strategy:
 * - PREVIEW (800px): Compressed Object URL for display (fastest)
 * - AI-OPTIMIZED (2048px): Balanced resolution for generation (quality + speed)
 * - ORIGINAL: Discarded after processing (no memory waste)
 * 
 * Why 2048px for AI?
 * - Gemini's optimal input size is 1024-2048px
 * - Sufficient for face recognition, jewelry details, product features
 * - 80% smaller than raw 8000px uploads
 * - Same output quality as full-resolution
 */

// heic2any import removed - using server-side conversion for better performance

interface ImageData {
  aiOptimized: string;   // 2048px base64 for AI (balanced quality + size)
  previewURL: string;    // 800px Object URL for display (fast)
  width: number;         // Original dimensions
  height: number;
}

// ── HEIC/HEIF detection & conversion ─────────────────
// iPhone/iOS cameras shoot HEIC by default.
// Chrome/Firefox/Edge cannot decode HEIC, so we convert to JPEG first.

const HEIC_EXTENSIONS = /\.(heic|heif)$/i;
const HEIC_MIMES = new Set([
  "image/heic", "image/heif",
  "image/heic-sequence", "image/heif-sequence",
]);

/**
 * Read the first 12 bytes of a file to detect actual format via magic bytes.
 * iOS often saves HEIC files with .png or .jpg extensions.
 */
async function detectActualFormat(file: File): Promise<"heic" | "png" | "jpeg" | "webp" | "unknown"> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  // PNG: 89 50 4E 47 (‰PNG)
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return "png";
  }

  // JPEG: FF D8 FF
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return "jpeg";
  }

  // WebP: RIFF....WEBP
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
      header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50) {
    return "webp";
  }

  // HEIF/HEIC: bytes 4-7 = "ftyp"
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
    return "heic";
  }

  return "unknown";
}

function isHeicByNameOrMime(file: File): boolean {
  if (file.type && HEIC_MIMES.has(file.type.toLowerCase())) return true;
  if (HEIC_EXTENSIONS.test(file.name)) return true;
  return false;
}

async function ensureDecodable(file: File): Promise<File> {
  // Detect actual format from file bytes (not extension/MIME which iOS often lies about)
  const actual = await detectActualFormat(file);
  const needsConversion = actual === "heic" || (actual === "unknown" && isHeicByNameOrMime(file));

  console.log(`🔍 Format check: "${file.name}" → declared=${file.type || "none"}, actual=${actual}, convert=${needsConversion}`);

  if (!needsConversion) return file;

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  const newName = file.name.replace(/\.(heic|heif|png|jpg|jpeg)$/i, ".jpg");

  // Server-side conversion via /api/convert-heic (sharp with native HEIF support)
  // Skip client-side heic2any - it's slow and often fails on modern HEIC files
  try {
    console.log(`📤 [server] Converting HEIC: ${file.name} (${sizeMB}MB)`);
    const formData = new FormData();
    formData.append("image", file);

    const backendUrl = (import.meta as any).env?.VITE_API_BASE || "http://localhost:8080";
    const resp = await fetch(`${backendUrl}/api/convert-heic`, { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || `Server returned ${resp.status}`);
    }

    const jpegBlob = await resp.blob();
    const converted = new File([jpegBlob], newName, { type: "image/jpeg" });
    console.log(`✅ [server] HEIC → JPEG: ${newName} (${(converted.size / 1024 / 1024).toFixed(1)}MB)`);
    return converted;
  } catch (serverErr) {
    console.error(`❌ [server] HEIC conversion failed:`, serverErr);
    throw new Error(`Cannot convert HEIC file "${file.name}". Server conversion failed: ${serverErr}`);
  }
}

/**
 * Process an image file to create optimized versions
 * @param file - Original image file (can be huge!)
 * @param previewMaxWidth - Maximum width for UI preview (default: 800px)
 * @param aiMaxWidth - Maximum width for AI generation (default: 2048px)
 * @param quality - JPEG quality 0-1 (default: 0.90 for AI, 0.85 for preview)
 * @returns Promise with AI-optimized base64 and preview Object URL
 */
export async function processImageFile(
  file: File,
  previewMaxWidth: number = 800,
  aiMaxWidth: number = 2048,
  quality: number = 0.90
): Promise<ImageData> {
  // Diagnostic: log actual file info for debugging upload issues
  console.log(`📂 File received: name="${file.name}", type="${file.type}", size=${(file.size / 1024 / 1024).toFixed(1)}MB`);

  // Convert HEIC → JPEG if needed (iPhone photos)
  const decodableFile = await ensureDecodable(file);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    // Shared handler: once we have a loaded HTMLImageElement, process it
    const processLoadedImage = async (img: HTMLImageElement, originalSizeBytes: number) => {
      try {
        // Create AI-optimized version (2048px, high quality)
        const aiOptimized = await createResizedImage(
          img, 
          aiMaxWidth, 
          quality  // 0.90 for AI quality
        );
        
        // Create preview version (800px, standard quality)
        const previewBlob = await createResizedImageBlob(
          img,
          previewMaxWidth,
          0.85  // 0.85 for preview (smaller)
        );
        
        // Create Object URL for preview (memory efficient!)
        const previewURL = URL.createObjectURL(previewBlob);
        
        // Log size savings
        const originalSizeMB = originalSizeBytes / (1024 * 1024);
        const aiSize = (aiOptimized.length * 0.75) / (1024 * 1024);
        console.log(
          `📸 Image processed: ${img.width}x${img.height}px ` +
          `(${originalSizeMB.toFixed(1)}MB) → AI: ${aiSize.toFixed(1)}MB ` +
          `(${((1 - aiSize/originalSizeMB) * 100).toFixed(0)}% smaller)`
        );
        
        resolve({
          aiOptimized,  // For AI generation
          previewURL,   // For UI display
          width: img.width,
          height: img.height,
        });
      } catch (err) {
        reject(err);
      }
    };

    // Primary path: load via Object URL (more robust for large/unusual files)
    const objectUrl = URL.createObjectURL(decodableFile);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      processLoadedImage(img, decodableFile.size);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      console.warn(`⚠️ Object URL load failed, trying readAsDataURL fallback...`);

      // Fallback path: try readAsDataURL (works for some edge cases)
      reader.onload = (e) => {
        const originalB64 = e.target?.result as string;
        console.log(`📋 Data URL prefix: ${originalB64.substring(0, 50)}...`);
        const img2 = new Image();

        img2.onload = () => {
          processLoadedImage(img2, originalB64.length * 0.75);
        };

        img2.onerror = () => {
          reject(new Error(
            `Failed to load image: "${decodableFile.name}" (type: ${decodableFile.type || "unknown"}, ` +
            `size: ${(decodableFile.size / 1024 / 1024).toFixed(1)}MB). ` +
            `The file may be corrupted or in an unsupported format.`
          ));
        };

        img2.src = originalB64;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(decodableFile);
    };

    img.src = objectUrl;
  });
}

/**
 * Create resized image as base64 string
 */
async function createResizedImage(
  img: HTMLImageElement,
  maxWidth: number,
  quality: number
): Promise<string> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  
  // Calculate dimensions (preserve aspect ratio)
  let width = img.width;
  let height = img.height;
  
  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }
  
  canvas.width = width;
  canvas.height = height;
  
  // High-quality image rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  
  // Return as base64
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Create resized image as Blob (for Object URLs)
 */
async function createResizedImageBlob(
  img: HTMLImageElement,
  maxWidth: number,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }
    
    // Calculate dimensions
    let width = img.width;
    let height = img.height;
    
    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }
    
    canvas.width = width;
    canvas.height = height;
    
    // Draw
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    
    // Convert to Blob
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create blob'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Process multiple image files
 */
export async function processImageFiles(
  files: File[],
  previewMaxWidth: number = 800,
  aiMaxWidth: number = 2048,
  quality: number = 0.90
): Promise<ImageData[]> {
  const promises = files.map(f => 
    processImageFile(f, previewMaxWidth, aiMaxWidth, quality)
  );
  return Promise.all(promises);
}

/**
 * Cleanup Object URLs to free memory
 */
export function cleanupImageURLs(images: ImageData[]): void {
  images.forEach(img => {
    if (img.previewURL.startsWith('blob:')) {
      URL.revokeObjectURL(img.previewURL);
    }
  });
}

/**
 * Convert base64 result images to Object URLs for display
 */
export function convertResultToObjectURL(base64: string): string {
  // If already an object URL, return as-is
  if (base64.startsWith('blob:')) {
    return base64;
  }
  
  // Convert base64 to blob
  const arr = base64.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  
  const blob = new Blob([u8arr], { type: mime });
  return URL.createObjectURL(blob);
}

/**
 * Get estimated memory size of base64 string
 */
export function getBase64Size(base64: string): string {
  const bytes = base64.length * 0.75; // base64 is ~33% larger than binary
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(2) + ' MB';
}