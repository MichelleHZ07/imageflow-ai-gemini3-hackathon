/**
 * CDN Image Upload Service
 * 上传生成的图片到 Cloud Storage，返回 CDN URLs
 * 
 * 文件位置: backend/services/cdnUploadService.js
 */
import admin from "firebase-admin";

/**
 * Parse data URI or base64 string
 * @param {string} input - Data URI or base64 string
 * @returns {[string|null, string|null]} - [mimeType, base64Data]
 */
function parseDataUriOrB64(input) {
  if (!input) return [null, null];
  if (input.startsWith("data:")) {
    const [head, data] = input.split("base64,");
    const mime = head?.slice(5, head.indexOf(";")) || "image/png";
    return [mime, data];
  }
  return ["image/png", input];
}

/**
 * 上传生成的图片到 Cloud Storage
 * 
 * @param {string} uid - 用户ID
 * @param {string} generationId - 生成记录ID
 * @param {Array} results - 生成结果数组，每个元素包含 images 数组
 * @returns {Promise<Array>} - 带有 cdnUrl 的更新后结果数组
 * 
 * 结构：results[].images[].dataUrl / filename / skuName / seqDigits
 * 输出：results[].images[] 增加 cdnUrl 和 storagePath
 */
export async function uploadGeneratedImagesToStorage(uid, generationId, results) {
  // 获取 bucket - 从环境变量或使用默认值
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'imageflow-dev.firebasestorage.app';
  const bucket = admin.storage().bucket(bucketName);
  
  console.log(`[CDN Upload] Using bucket: ${bucketName}`);
  
  const updatedResults = [];
  let globalIndex = 1;
  let uploadedCount = 0;
  let failedCount = 0;

  console.log(`\n[CDN Upload] Starting upload for user ${uid}, generation ${generationId}`);
  console.log(`[CDN Upload] Total batches: ${results.length}`);

  for (let batchIndex = 0; batchIndex < results.length; batchIndex++) {
    const batch = results[batchIndex];
    const updatedImages = [];

    for (let imageIndex = 0; imageIndex < (batch.images || []).length; imageIndex++) {
      const img = batch.images[imageIndex];
      const dataUrl = img.dataUrl || img; // 兼容旧格式（直接是 string）

      if (!dataUrl || typeof dataUrl !== 'string') {
        console.warn(`[CDN Upload] Skipping invalid image at batch ${batchIndex}, index ${imageIndex}`);
        updatedImages.push(img);
        continue;
      }

      try {
        // 解析 base64 数据
        const [mime, b64] = parseDataUriOrB64(dataUrl);
        if (!b64) {
          console.warn(`[CDN Upload] Failed to parse base64 for image ${globalIndex}`);
          updatedImages.push(img);
          globalIndex++;
          failedCount++;
          continue;
        }

        // 确定文件扩展名
        const ext = mime === "image/png" ? "png"
          : mime === "image/webp" ? "webp"
          : "jpg";

        // 构建存储路径：users/{uid}/generations/{generationId}/{001}.jpg
        const paddedIndex = String(globalIndex).padStart(3, "0");
        const filePath = `users/${uid}/generations/${generationId}/${paddedIndex}.${ext}`;

        const file = bucket.file(filePath);

        // 写入文件，带长缓存
        await file.save(Buffer.from(b64, "base64"), {
          contentType: mime || "image/jpeg",
          metadata: {
            cacheControl: "public,max-age=31536000", // 1年缓存
          },
        });

        // 设置为公开可访问（前端预览用）
        await file.makePublic();

        // 生成 Firebase 格式 URL（Shopify/外部服务用，Firebase Rules 生效）
        const encodedPath = encodeURIComponent(filePath);
        const cdnUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media`;

        console.log(`[CDN Upload] Uploaded image ${globalIndex}: ${cdnUrl}`);

        updatedImages.push({
          ...img,
          dataUrl,          // 保留 base64，前端立即预览用
          cdnUrl,           // Firebase 格式 URL（Shopify 兼容）
          storagePath: filePath,
        });

        uploadedCount++;
        globalIndex++;
      } catch (uploadError) {
        console.error(`[CDN Upload] Failed to upload image ${globalIndex}:`, uploadError.message);
        // 上传失败时保留原始数据，不中断流程
        updatedImages.push(img);
        globalIndex++;
        failedCount++;
      }
    }

    updatedResults.push({
      ...batch,
      images: updatedImages,
    });
  }

  console.log(`[CDN Upload] ========================================`);
  console.log(`[CDN Upload] Upload Summary:`);
  console.log(`[CDN Upload]   Uploaded: ${uploadedCount}`);
  console.log(`[CDN Upload]   Failed: ${failedCount}`);
  console.log(`[CDN Upload] ========================================\n`);
  
  return updatedResults;
}

/**
 * 删除用户某次生成的所有图片
 * 用于清理或用户删除生成记录时
 * 
 * @param {string} uid - 用户ID
 * @param {string} generationId - 生成记录ID
 */
export async function deleteGenerationImages(uid, generationId) {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'imageflow-dev.firebasestorage.app';
  const bucket = admin.storage().bucket(bucketName);
  const prefix = `users/${uid}/generations/${generationId}/`;

  try {
    const [files] = await bucket.getFiles({ prefix });
    
    if (files.length === 0) {
      console.log(`[CDN Delete] No files found for ${prefix}`);
      return { deleted: 0 };
    }

    await Promise.all(files.map(file => file.delete()));
    console.log(`[CDN Delete] Deleted ${files.length} files from ${prefix}`);
    
    return { deleted: files.length };
  } catch (error) {
    console.error(`[CDN Delete] Failed to delete files for ${prefix}:`, error.message);
    throw error;
  }
}