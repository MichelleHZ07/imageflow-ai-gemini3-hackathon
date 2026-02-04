#!/usr/bin/env node
/**
 * 迁移脚本：将本地 uploads/spreadsheets 文件迁移到 Firebase Storage
 * 
 * 使用方法:
 *   1. 确保 .env 文件配置正确
 *   2. node migrate-spreadsheets-to-storage.js
 *   3. 迁移成功后可以删除 uploads/spreadsheets 目录
 * 
 * 文件位置: backend/scripts/migrate-spreadsheets-to-storage.js
 */

import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// 初始化 Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();
const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 
  `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
const bucket = admin.storage().bucket(bucketName);

// 本地上传目录
const UPLOADS_DIR = path.join(__dirname, "..", "uploads", "spreadsheets");

// MIME 类型映射
const MIME_TYPES = {
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

/**
 * 获取所有用户的表格模板
 */
async function getAllSpreadsheets() {
  const usersSnapshot = await db.collection("users").get();
  const allSpreadsheets = [];

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const spreadsheetsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("spreadsheets")
      .get();

    for (const spreadsheetDoc of spreadsheetsSnapshot.docs) {
      allSpreadsheets.push({
        uid,
        id: spreadsheetDoc.id,
        ...spreadsheetDoc.data(),
      });
    }
  }

  return allSpreadsheets;
}

/**
 * 获取新的 Storage 路径（统一结构）
 * 新路径: users/{uid}/spreadsheets/{id}.csv
 */
function getNewStoragePath(uid, spreadsheetId, ext) {
  return `users/${uid}/spreadsheets/${spreadsheetId}${ext}`;
}

/**
 * 上传单个文件到 Storage
 */
async function uploadFileToStorage(localPath, storagePath, ext) {
  const file = bucket.file(storagePath);
  const contentType = MIME_TYPES[ext.toLowerCase()] || "application/octet-stream";

  const fileBuffer = fs.readFileSync(localPath);

  await file.save(fileBuffer, {
    contentType,
    metadata: {
      cacheControl: "private,max-age=3600",
      metadata: {
        migratedAt: new Date().toISOString(),
      },
    },
  });

  return fileBuffer.length;
}

/**
 * 检查文件是否已存在于 Storage
 */
async function fileExistsInStorage(storagePath) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  return exists;
}

/**
 * 更新 Firestore 中的 storagePath
 */
async function updateFirestoreStoragePath(uid, spreadsheetId, newStoragePath) {
  const docRef = db
    .collection("users")
    .doc(uid)
    .collection("spreadsheets")
    .doc(spreadsheetId);
  
  await docRef.update({
    storagePath: newStoragePath,
    updatedAt: Date.now(),
  });
}

/**
 * 主迁移函数
 */
async function migrate() {
  console.log("========================================");
  console.log("  Spreadsheet Migration to Firebase Storage");
  console.log("========================================\n");

  console.log(`📦 Storage Bucket: ${bucketName}`);
  console.log(`📁 Local Directory: ${UPLOADS_DIR}\n`);

  // 检查本地目录是否存在
  if (!fs.existsSync(UPLOADS_DIR)) {
    console.log("⚠️  Local uploads directory not found. Nothing to migrate.");
    console.log("   Path:", UPLOADS_DIR);
    return;
  }

  // 获取所有表格模板
  console.log("📋 Fetching spreadsheet templates from Firestore...\n");
  const spreadsheets = await getAllSpreadsheets();

  if (spreadsheets.length === 0) {
    console.log("⚠️  No spreadsheets found in Firestore.");
    return;
  }

  console.log(`Found ${spreadsheets.length} spreadsheet templates.\n`);

  // 统计
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let alreadyInStorage = 0;

  // 迁移每个文件
  for (const spreadsheet of spreadsheets) {
    const { uid, id, storagePath, templateName } = spreadsheet;

    if (!storagePath) {
      console.log(`⏭️  [${templateName || id}] No storagePath - skipping`);
      skipped++;
      continue;
    }

    // 构建本地文件路径（旧路径格式: spreadsheets/{uid}/{id}.csv）
    const localPath = path.join(process.cwd(), "uploads", storagePath);
    const ext = path.extname(storagePath).toLowerCase();
    
    // 新的 Storage 路径（统一格式: users/{uid}/spreadsheets/{id}.csv）
    const newStoragePath = getNewStoragePath(uid, id, ext);

    // 检查本地文件是否存在
    if (!fs.existsSync(localPath)) {
      // 检查新路径是否已在 Storage 中
      const existsInNewPath = await fileExistsInStorage(newStoragePath);
      if (existsInNewPath) {
        console.log(`✅ [${templateName || id}] Already in Storage (new path) - skipping`);
        alreadyInStorage++;
        
        // 如果 Firestore 中的路径还是旧的，更新它
        if (storagePath !== newStoragePath) {
          await updateFirestoreStoragePath(uid, id, newStoragePath);
          console.log(`   └─ Updated Firestore path to: ${newStoragePath}`);
        }
      } else {
        // 也检查旧路径
        const existsInOldPath = await fileExistsInStorage(storagePath);
        if (existsInOldPath) {
          console.log(`✅ [${templateName || id}] Already in Storage (old path) - skipping`);
          alreadyInStorage++;
        } else {
          console.log(`❌ [${templateName || id}] Local file not found: ${localPath}`);
          failed++;
        }
      }
      continue;
    }

    // 检查新路径是否已存在于 Storage
    const existsInStorage = await fileExistsInStorage(newStoragePath);
    if (existsInStorage) {
      console.log(`✅ [${templateName || id}] Already in Storage - skipping`);
      alreadyInStorage++;
      
      // 更新 Firestore 中的路径
      if (storagePath !== newStoragePath) {
        await updateFirestoreStoragePath(uid, id, newStoragePath);
        console.log(`   └─ Updated Firestore path to: ${newStoragePath}`);
      }
      continue;
    }

    // 上传到 Storage（使用新路径）
    try {
      const size = await uploadFileToStorage(localPath, newStoragePath, ext);
      console.log(`📤 [${templateName || id}] Uploaded (${(size / 1024).toFixed(1)} KB)`);
      console.log(`   └─ ${newStoragePath}`);
      
      // 更新 Firestore 中的 storagePath
      await updateFirestoreStoragePath(uid, id, newStoragePath);
      console.log(`   └─ Firestore updated`);
      
      migrated++;
    } catch (error) {
      console.error(`❌ [${templateName || id}] Upload failed: ${error.message}`);
      failed++;
    }
  }

  // 打印摘要
  console.log("\n========================================");
  console.log("  Migration Summary");
  console.log("========================================");
  console.log(`  ✅ Migrated:          ${migrated}`);
  console.log(`  ✅ Already in Storage: ${alreadyInStorage}`);
  console.log(`  ⏭️  Skipped:           ${skipped}`);
  console.log(`  ❌ Failed:            ${failed}`);
  console.log("========================================\n");

  if (migrated > 0 || alreadyInStorage > 0) {
    console.log("🎉 Migration completed!");
    console.log("\nNext steps:");
    console.log("  1. Test your application to ensure files load correctly");
    console.log("  2. If everything works, you can delete the local uploads directory:");
    console.log(`     rm -rf "${UPLOADS_DIR}"`);
    console.log("  3. Delete the old 'spreadsheets/' folder in Firebase Storage Console");
    console.log("     (The new path is 'users/{uid}/spreadsheets/')");
  }

  if (failed > 0) {
    console.log("\n⚠️  Some files failed to migrate. Please check the errors above.");
  }
}

// 运行迁移
migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});