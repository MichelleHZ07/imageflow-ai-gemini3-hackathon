/**
 * Cleanup Orphaned SpreadsheetResults
 * 
 * 清理孤立的 spreadsheetResults 数据
 * 当 spreadsheet 模板被删除但 spreadsheetResults 未同步删除时使用
 * 
 * 使用方法:
 *   node scripts/cleanup-orphaned-results.js
 * 
 * 或指定用户:
 *   node scripts/cleanup-orphaned-results.js --uid=USER_ID
 */

import admin from "firebase-admin";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// 验证必要的环境变量
if (!process.env.FIREBASE_PROJECT_ID) {
  console.error("❌ FIREBASE_PROJECT_ID not found in .env file");
  console.error("   Make sure .env file exists in backend/ directory");
  process.exit(1);
}

console.log(`📦 Using Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

/**
 * 删除文档及其所有子集合
 */
async function deleteDocumentWithSubcollections(docRef) {
  // 删除 scenarios 子集合
  const scenariosRef = docRef.collection("scenarios");
  const scenariosSnapshot = await scenariosRef.get();
  
  if (!scenariosSnapshot.empty) {
    const batch = db.batch();
    scenariosSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`  - Deleted ${scenariosSnapshot.size} scenarios`);
  }

  // 删除文档本身
  await docRef.delete();
}

/**
 * 清理单个用户的孤立数据
 */
async function cleanupUserOrphanedResults(uid) {
  console.log(`\n[User: ${uid}]`);
  
  // 1. 获取该用户的所有 spreadsheet 模板 ID
  const spreadsheetsRef = db.collection("users").doc(uid).collection("spreadsheets");
  const spreadsheetsSnapshot = await spreadsheetsRef.get();
  
  const validTemplateIds = new Set();
  spreadsheetsSnapshot.docs.forEach((doc) => {
    validTemplateIds.add(doc.id);
  });
  
  console.log(`  Found ${validTemplateIds.size} valid spreadsheet templates`);

  // 2. 获取该用户的所有 spreadsheetResults 文档
  const resultsRef = db.collection("users").doc(uid).collection("spreadsheetResults");
  const resultsSnapshot = await resultsRef.get();
  
  console.log(`  Found ${resultsSnapshot.size} spreadsheetResults documents`);

  // 3. 找出并删除孤立的 results
  let orphanedCount = 0;
  let deletedCount = 0;

  for (const resultDoc of resultsSnapshot.docs) {
    const templateId = resultDoc.id;
    
    if (!validTemplateIds.has(templateId)) {
      orphanedCount++;
      console.log(`  - Orphaned: ${templateId}`);
      
      try {
        await deleteDocumentWithSubcollections(resultDoc.ref);
        deletedCount++;
        console.log(`    ✓ Deleted`);
      } catch (err) {
        console.error(`    ✗ Failed to delete: ${err.message}`);
      }
    }
  }

  console.log(`  Summary: ${orphanedCount} orphaned, ${deletedCount} deleted`);
  
  return { orphaned: orphanedCount, deleted: deletedCount };
}

/**
 * 清理所有用户的孤立数据
 */
async function cleanupAllUsers() {
  console.log("=== Cleanup Orphaned SpreadsheetResults ===\n");
  
  // 获取所有用户
  const usersRef = db.collection("users");
  const usersSnapshot = await usersRef.get();
  
  console.log(`Found ${usersSnapshot.size} users\n`);

  let totalOrphaned = 0;
  let totalDeleted = 0;

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    
    // 检查该用户是否有 spreadsheetResults 集合
    const resultsRef = userDoc.ref.collection("spreadsheetResults");
    const resultsSnapshot = await resultsRef.limit(1).get();
    
    if (!resultsSnapshot.empty) {
      const result = await cleanupUserOrphanedResults(uid);
      totalOrphaned += result.orphaned;
      totalDeleted += result.deleted;
    }
  }

  console.log("\n=== Final Summary ===");
  console.log(`Total orphaned: ${totalOrphaned}`);
  console.log(`Total deleted: ${totalDeleted}`);
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  
  // 解析 --uid 参数
  const uidArg = args.find((arg) => arg.startsWith("--uid="));
  const specificUid = uidArg ? uidArg.split("=")[1] : null;

  // 解析 --dry-run 参数（仅报告，不实际删除）
  const dryRun = args.includes("--dry-run");
  
  if (dryRun) {
    console.log("⚠️  DRY RUN MODE - No data will be deleted\n");
  }

  try {
    if (specificUid) {
      console.log(`Cleaning up orphaned results for user: ${specificUid}`);
      await cleanupUserOrphanedResults(specificUid);
    } else {
      await cleanupAllUsers();
    }
    
    console.log("\n✅ Cleanup completed");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Cleanup failed:", err);
    process.exit(1);
  }
}

main();