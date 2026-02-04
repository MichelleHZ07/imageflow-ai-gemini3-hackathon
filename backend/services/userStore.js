import { db, usingLocal } from "../utils/firebaseAdmin.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const LOCAL_PATH = path.join(process.cwd(), "users.local.json");
const DEFAULT_INITIAL_CREDITS = Number(process.env.DEFAULT_INITIAL_CREDITS || 40);
const CREDIT_COST_PER_IMAGE = Number(process.env.CREDIT_COST_PER_IMAGE || 10);

function ensureLocalFile() {
  if (!fs.existsSync(LOCAL_PATH)) {
    fs.writeFileSync(LOCAL_PATH, JSON.stringify({}, null, 2));
  }
}

/* ======================================================
   🔹 获取或初始化用户档案
====================================================== */
export async function getUser(uid) {
  if (!uid) return null;

  if (!usingLocal && db) {
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // 🟢 新用户初始化
      await ref.set({
        credits: DEFAULT_INITIAL_CREDITS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      console.log(`🌱 Initialized new user ${uid} with ${DEFAULT_INITIAL_CREDITS} credits`);
      return { credits: DEFAULT_INITIAL_CREDITS };
    }

    const data = snap.data() || {};
    if (typeof data.credits !== "number") {
      // 🔧 旧用户补充缺失字段，但不给奖励
      await ref.set({ credits: 0, updatedAt: Date.now() }, { merge: true });
      console.warn(`⚠️ User ${uid} missing credits field, initialized to 0`);
      return { ...data, credits: 0 };
    }

    return data;
  }

  // --- Local fallback ---
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  if (!data[uid]) {
    data[uid] = { credits: DEFAULT_INITIAL_CREDITS, createdAt: Date.now() };
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
    console.log(`🌱 [Local] Initialized user ${uid} with ${DEFAULT_INITIAL_CREDITS} credits`);
  }
  return data[uid];
}

/* ======================================================
   🔹 更新积分（增/减）
====================================================== */
export async function updateUserCredits(uid, delta) {
  if (!uid) return;

  if (!usingLocal && db) {
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();

    let current = 0;
    if (snap.exists) {
      const data = snap.data();
      current = typeof data.credits === "number" ? data.credits : 0;
    } else {
      // 🔹 如果文档不存在，先初始化新用户
      await ref.set({
        credits: DEFAULT_INITIAL_CREDITS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      current = DEFAULT_INITIAL_CREDITS;
      console.log(`🌱 Created new user ${uid} with ${DEFAULT_INITIAL_CREDITS} credits`);
    }

    const newCredits = Math.max(0, current + delta);
    await ref.set({ credits: newCredits, updatedAt: Date.now() }, { merge: true });

    console.log(`💰 [Firestore] Credits for ${uid}: ${current} → ${newCredits} (${delta >= 0 ? "+" : ""}${delta})`);
    return newCredits;
  }

  // --- Local fallback ---
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const current = data[uid]?.credits ?? DEFAULT_INITIAL_CREDITS;
  const newCredits = Math.max(0, current + delta);
  data[uid] = { ...(data[uid] || {}), credits: newCredits, updatedAt: Date.now() };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  console.log(`💰 [Local] Credits for ${uid}: ${current} → ${newCredits}`);
  return newCredits;
}

/* ======================================================
   🔹 追加生成历史（安全写入）
   ⭐ 修改：返回 generationId 供 CDN 上传使用
====================================================== */
export async function addGeneration(uid, generation) {
  if (!uid) return null;

  const safeData = {
    prompt: generation.prompt || "",
    createdAt: generation.createdAt || Date.now(),
    productCategory: generation.productCategory || "",
    imageCount: generation.results?.length || 0,
    thumbnail: generation.results?.[0]?.images?.[0] || null,
    cost: generation.cost || 0,
    // P1a: Store spreadsheet context for later write-back / enriched export
    spreadsheetContext: generation.spreadsheetContext || null,
  };

  if (!usingLocal && db) {
    try {
      const ref = db.collection("users").doc(uid).collection("generations").doc();
      await ref.set(safeData);
      console.log(`🖼️ [Firestore] Generation metadata saved for ${uid}, id: ${ref.id}`);
      return ref.id; // ⭐ 返回 generationId
    } catch (err) {
      console.error("⚠️ Firestore generation write failed:", err.message);
      return null;
    }
  }

  // --- fallback local ---
  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  if (!data[uid]) data[uid] = { generations: [] };
  if (!data[uid].generations) data[uid].generations = [];
  
  // ⭐ 为本地模式生成一个唯一 ID
  const localId = crypto.randomUUID();
  safeData.id = localId;
  data[uid].generations.push(safeData);
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  console.log(`🖼️ [Local] Generation metadata saved for ${uid}, id: ${localId}`);
  return localId; // ⭐ 返回 generationId
}

/* ======================================================
   🔹 获取生成历史
====================================================== */
export async function getGenerations(uid, limit = 20) {
  if (!uid) return [];

  if (!usingLocal && db) {
    const ref = db
      .collection("users")
      .doc(uid)
      .collection("generations")
      .orderBy("createdAt", "desc")
      .limit(limit);
    const snap = await ref.get();
    return snap.docs.map((d) => d.data());
  }

  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  return (data[uid]?.generations || []).slice(-limit).reverse();
}

/* ======================================================
   🔹 管理员修改用户
====================================================== */
export async function adminUpdateUser(uid, updates) {
  if (!usingLocal && db) {
    const ref = db.collection("users").doc(uid);
    await ref.set({ ...updates, updatedAt: Date.now() }, { merge: true });
    console.log(`🔧 Admin updated user ${uid}`);
    return true;
  }

  ensureLocalFile();
  const data = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  data[uid] = { ...(data[uid] || {}), ...updates, updatedAt: Date.now() };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(data, null, 2));
  console.log(`🔧 [Local] Admin updated user ${uid}`);
  return true;
}