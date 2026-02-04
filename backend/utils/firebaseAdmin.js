// backend/utils/firebaseAdmin.js
import admin from "firebase-admin";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

let db = null;
let auth = null;
let usingLocal = false;

// 读取 .env 开关
const useFirebase = process.env.USE_FIREBASE === "true";

// 🔹 本地 JSON 模式文件路径
const LOCAL_DB_PATH = path.join(process.cwd(), "subscriptions.local.json");

// 🔹 确保本地文件存在
function ensureLocalFile() {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    fs.writeFileSync(
      LOCAL_DB_PATH,
      JSON.stringify({ byUid: {}, purchases: [] }, null, 2)
    );
  }
}

if (useFirebase) {
  try {
    let credential;

    // 优先使用完整的 JSON 配置
    if (process.env.FIREBASE_ADMIN_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_JSON);
      credential = admin.credential.cert(serviceAccount);
      console.log("🔑 Using FIREBASE_ADMIN_JSON for authentication");
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      credential = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      });
      console.log("🔑 Using separate env vars for authentication");
    } else {
      throw new Error("Firebase environment variables missing");
    }

    if (!admin.apps.length) {
      admin.initializeApp({ credential });
    }

    db = admin.firestore();
    auth = admin.auth();

    console.log(
      `✅ Firebase Admin initialized (${process.env.FIREBASE_PROJECT_ID || "from JSON"}) [${process.env.FIREBASE_ENV || "dev"}]`
    );
  } catch (err) {
    console.error("⚠️ Firebase initialization failed, fallback to local JSON:", err.message);
    ensureLocalFile();
    usingLocal = true;
  }
} else {
  console.log("⚠️ USE_FIREBASE not set or false — using local JSON for subscription store");
  ensureLocalFile();
  usingLocal = true;
}

// 🔹 导出静态接口（旧逻辑保持兼容）
export { admin, db, auth, usingLocal };

// 🔹 新增动态 getter（防止模块缓存）
export const getDB = () => db;
export const isUsingLocal = () => usingLocal;