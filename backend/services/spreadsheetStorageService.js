/**
 * Spreadsheet Storage Service
 * 将表格文件存储到 Firebase Storage（替代本地文件系统）
 * 
 * 文件位置: backend/services/spreadsheetStorageService.js
 */
import admin from "firebase-admin";

const db = admin.firestore();

/**
 * 获取 Storage bucket
 */
function getBucket() {
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 
    `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return admin.storage().bucket(bucketName);
}

/**
 * 上传表格文件到 Firebase Storage
 * 
 * 路径结构: users/{uid}/spreadsheets/{spreadsheetId}.csv
 * 与 generations 保持一致: users/{uid}/generations/...
 * 
 * @param {string} uid - 用户ID
 * @param {string} spreadsheetId - 表格ID
 * @param {Buffer} fileBuffer - 文件内容
 * @param {string} ext - 文件扩展名 (.csv, .xlsx, .xls)
 * @returns {Promise<string>} - Storage 路径
 */
export async function uploadSpreadsheetToStorage(uid, spreadsheetId, fileBuffer, ext) {
  const bucket = getBucket();
  const storagePath = `users/${uid}/spreadsheets/${spreadsheetId}${ext}`;
  const file = bucket.file(storagePath);

  // 确定 MIME 类型
  const mimeTypes = {
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
  };
  const contentType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';

  try {
    await file.save(fileBuffer, {
      contentType,
      metadata: {
        cacheControl: 'private,max-age=3600', // 1小时缓存，私有
        metadata: {
          uploadedAt: new Date().toISOString(),
          userId: uid,
        },
      },
    });

    console.log(`[Storage] ✅ Spreadsheet uploaded: ${storagePath} (${fileBuffer.length} bytes)`);
    return storagePath;
  } catch (error) {
    console.error(`[Storage] ❌ Failed to upload spreadsheet:`, error.message);
    throw error;
  }
}

/**
 * 从 Firebase Storage 下载表格文件
 * 
 * @param {string} storagePath - Storage 路径
 * @returns {Promise<Buffer>} - 文件内容
 */
export async function downloadSpreadsheetFromStorage(storagePath) {
  if (!storagePath) {
    throw new Error("Storage path is required");
  }

  const bucket = getBucket();
  const file = bucket.file(storagePath);

  try {
    // 检查文件是否存在
    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Spreadsheet file not found: ${storagePath}`);
    }

    // 下载文件内容
    const [buffer] = await file.download();
    console.log(`[Storage] ✅ Spreadsheet downloaded: ${storagePath} (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    console.error(`[Storage] ❌ Failed to download spreadsheet:`, error.message);
    throw error;
  }
}

/**
 * 从 Firebase Storage 删除表格文件
 * 
 * @param {string} storagePath - Storage 路径
 */
export async function deleteSpreadsheetFromStorage(storagePath) {
  if (!storagePath) {
    console.warn("[Storage] ⚠️ No storage path provided for deletion");
    return;
  }

  const bucket = getBucket();
  const file = bucket.file(storagePath);

  try {
    const [exists] = await file.exists();
    if (exists) {
      await file.delete();
      console.log(`[Storage] ✅ Spreadsheet deleted: ${storagePath}`);
    } else {
      console.log(`[Storage] ⚠️ File already deleted or not found: ${storagePath}`);
    }
  } catch (error) {
    // 不抛出错误，只记录警告（删除失败不应阻断主流程）
    console.warn(`[Storage] ⚠️ Failed to delete spreadsheet:`, error.message);
  }
}

/**
 * 检查文件是否存在于 Storage
 * 
 * @param {string} storagePath - Storage 路径
 * @returns {Promise<boolean>}
 */
export async function spreadsheetExistsInStorage(storagePath) {
  if (!storagePath) return false;
  
  const bucket = getBucket();
  const file = bucket.file(storagePath);
  
  try {
    const [exists] = await file.exists();
    return exists;
  } catch (error) {
    console.warn(`[Storage] ⚠️ Error checking file existence:`, error.message);
    return false;
  }
}

/**
 * 获取文件的签名 URL（用于临时访问）
 * 
 * @param {string} storagePath - Storage 路径
 * @param {number} expiresInMinutes - URL 有效期（分钟）
 * @returns {Promise<string>} - 签名 URL
 */
export async function getSpreadsheetSignedUrl(storagePath, expiresInMinutes = 60) {
  if (!storagePath) {
    throw new Error("Storage path is required");
  }

  const bucket = getBucket();
  const file = bucket.file(storagePath);

  try {
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });
    
    console.log(`[Storage] ✅ Signed URL generated for: ${storagePath}`);
    return url;
  } catch (error) {
    console.error(`[Storage] ❌ Failed to generate signed URL:`, error.message);
    throw error;
  }
}

/**
 * 删除单个 spreadsheetResults 文档及其子集合
 * 
 * @param {string} uid - 用户ID
 * @param {string} templateId - 模板ID
 */
async function deleteSpreadsheetResultsDoc(uid, templateId) {
  const resultsDocRef = db
    .collection("users")
    .doc(uid)
    .collection("spreadsheetResults")
    .doc(templateId);

  // 1. 删除 scenarios 子集合
  const scenariosRef = resultsDocRef.collection("scenarios");
  const scenariosSnapshot = await scenariosRef.get();
  
  if (!scenariosSnapshot.empty) {
    const batch = db.batch();
    scenariosSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }

  // 2. 删除文档本身
  await resultsDocRef.delete();
}

/**
 * 删除用户的所有表格文件和关联数据
 * 用于用户账号删除时的清理
 * 
 * ✅ 更新: 同时删除 Storage 文件和 Firestore 中的 spreadsheetResults
 * 
 * @param {string} uid - 用户ID
 * @returns {Promise<{deletedFiles: number, deletedResults: number}>}
 */
export async function deleteAllUserSpreadsheets(uid) {
  if (!uid) return { deletedFiles: 0, deletedResults: 0 };

  let deletedFiles = 0;
  let deletedResults = 0;

  // 1. 删除 Storage 中的所有表格文件
  const bucket = getBucket();
  const prefix = `users/${uid}/spreadsheets/`;

  try {
    const [files] = await bucket.getFiles({ prefix });
    
    if (files.length > 0) {
      await Promise.all(files.map(file => file.delete()));
      deletedFiles = files.length;
      console.log(`[Storage] ✅ Deleted ${deletedFiles} spreadsheet files for user: ${uid}`);
    } else {
      console.log(`[Storage] No spreadsheet files found for user: ${uid}`);
    }
  } catch (error) {
    console.error(`[Storage] ❌ Failed to delete user spreadsheet files:`, error.message);
    // 继续执行，不阻断
  }

  // 2. 删除 Firestore 中的所有 spreadsheetResults
  try {
    const resultsRef = db
      .collection("users")
      .doc(uid)
      .collection("spreadsheetResults");
    
    const resultsSnapshot = await resultsRef.get();
    
    if (!resultsSnapshot.empty) {
      for (const doc of resultsSnapshot.docs) {
        await deleteSpreadsheetResultsDoc(uid, doc.id);
        deletedResults++;
      }
      console.log(`[Storage] ✅ Deleted ${deletedResults} spreadsheetResults for user: ${uid}`);
    } else {
      console.log(`[Storage] No spreadsheetResults found for user: ${uid}`);
    }
  } catch (error) {
    console.error(`[Storage] ❌ Failed to delete user spreadsheetResults:`, error.message);
    // 继续执行，不阻断
  }

  return { deletedFiles, deletedResults };
}