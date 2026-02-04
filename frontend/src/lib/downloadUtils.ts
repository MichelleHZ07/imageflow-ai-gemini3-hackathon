/**
 * Download utilities for images
 * Handles downloads with SKU naming support
 * From V1, adapted for V2 with metadata support
 */

/**
 * Metadata interface for SKU naming
 */
export interface DownloadMetadata {
  filename?: string;
  skuName?: string;     // Base SKU name (without sequence number)
  seqDigits?: number;   // Number of digits for sequence (e.g., 2 for "01", 3 for "001")
}

/**
 * Download a single image with optional SKU metadata
 * @param dataUrl - Base64 data URL of the image
 * @param filename - Default filename if no metadata provided
 * @param metadata - Optional metadata containing SKU filename
 * @param sequenceNumber - Optional sequence number for SKU (global counter or index)
 */
export function downloadImage(
  dataUrl: string, 
  filename: string,
  metadata?: DownloadMetadata | null,
  sequenceNumber?: number
): void {
  try {
    let finalFilename: string;
    
    // ✅ If SKU mode with base name and sequence number, generate sequenced filename
    if (metadata?.skuName && typeof sequenceNumber === 'number') {
      const seqDigits = metadata.seqDigits || 2;
      const seqNum = String(sequenceNumber).padStart(seqDigits, '0');
      finalFilename = `${metadata.skuName}-${seqNum}.png`;
      console.log(`📦 SKU: ${metadata.skuName} + seq#${sequenceNumber} = ${finalFilename}`);
    } 
    // ✅ Otherwise use provided filename or default
    else {
      finalFilename = metadata?.filename || filename || 'image.png';
    }
    
    // ✅ Ensure PNG format
    const pngFilename = finalFilename.replace(/\.(jpg|jpeg)$/i, '.png');
    
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = pngFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`📥 Downloaded: ${pngFilename}`);
  } catch (error) {
    console.error('Download failed:', error);
    alert('Download failed. Please try again.');
  }
}

/**
 * Download multiple images as individual files with optional metadata
 * @param images - Array of base64 data URLs
 * @param baseName - Default base name for files
 * @param metadata - Optional array of metadata objects for each image
 * @param startCounter - Optional starting counter for SKU mode (global download counter)
 */
export function downloadMultiple(
  images: string[],
  baseName: string,
  metadata?: Array<DownloadMetadata | null>,
  startCounter?: number
): void {
  if (images.length === 0) {
    alert('No images to download');
    return;
  }

  console.log(`📥 Downloading ${images.length} images`);
  if (startCounter !== undefined) {
    console.log(`📦 SKU mode: starting from counter ${startCounter}`);
  }

  images.forEach((src, index) => {
    const meta = metadata?.[index];
    
    // ✅ Determine filename based on mode
    let filename: string;
    let sequenceNumber: number | undefined;
    
    if (meta?.skuName && startCounter !== undefined) {
      // ✅ SKU mode: Use global counter
      sequenceNumber = startCounter + index;
      const seqDigits = meta.seqDigits || 2;
      const seqNum = String(sequenceNumber).padStart(seqDigits, '0');
      filename = `${meta.skuName}-${seqNum}.png`;
      console.log(`📦 SKU batch [${index + 1}/${images.length}]: counter#${sequenceNumber} = ${filename}`);
    } else if (meta?.filename) {
      // ✅ Use provided filename
      filename = meta.filename;
    } else {
      // ✅ Use default naming with sequential numbering
      filename = `${baseName}_${index + 1}.png`;
    }
    
    // ✅ Ensure PNG format
    filename = filename.replace(/\.(jpg|jpeg)$/i, '.png');
    
    // Add small delay between downloads for browser stability
    setTimeout(() => {
      downloadImage(src, filename, meta, sequenceNumber);
    }, index * 200);
  });
}

/**
 * Convert data URL to blob for file operations
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  
  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  
  return new Blob([u8arr], { type: mime });
}

/**
 * Get file size in MB from data URL
 */
export function getImageSize(dataUrl: string): number {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  return Math.round((bstr.length / (1024 * 1024)) * 100) / 100;
}