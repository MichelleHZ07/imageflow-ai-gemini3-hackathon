import fs from "fs";
import path from "path";
import { getDB, isUsingLocal } from "../utils/firebaseAdmin.js";

const db = getDB();
const usingLocal = isUsingLocal();

console.log("🔥 subscriptionStore db ready:", !!db, "usingLocal:", usingLocal);

const LOCAL_PATH = path.join(process.cwd(), "subscriptions.local.json");
const LOCAL_CREDITS = path.join(process.cwd(), "credits.local.json");

/** 确保本地 fallback 文件存在 */
function ensureLocalFile(filePath, defaultData) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
}

/* ======================================================
   🔹 写入或更新订阅
====================================================== */
export async function upsertSubscription({
  uid = "",
  email = "",
  customerId = "",
  subscriptionId = "",
  status = "incomplete",
  cancelAtPeriodEnd = false,
  currentPeriodEnd = 0,
  planPriceId = "",
  planName = "",
  planPrice = 0,
  credits = 0,
  cycle = "Monthly",
  expired = false,
  updatedAt = Date.now(),
}) {
  if (!subscriptionId) {
    console.warn("⚠️ Missing subscriptionId, skip upsert");
    return;
  }

  if (!usingLocal && db) {
    try {
      if (uid) {
        const userSubRef = db
          .collection("users")
          .doc(uid)
          .collection("subscriptions")
          .doc(subscriptionId);

        await userSubRef.set(
          {
            uid,
            email,
            customerId,
            subscriptionId,
            status,
            cancelAtPeriodEnd,
            currentPeriodEnd,
            planPriceId,
            planName,
            planPrice,
            credits,
            cycle,
            expired,
            updatedAt,
          },
          { merge: true }
        );

        console.log(
          `✅ [Firestore] Subscription saved under user/${uid}/subscriptions/${subscriptionId}`
        );
      }
      return;
    } catch (err) {
      console.error("⚠️ Firestore upsertSubscription failed:", err.message);
    }
  }

  // 🔹 Local fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const key = `${uid}-${subscriptionId}`;
  dbFile.byUid[key] = {
    uid,
    email,
    customerId,
    subscriptionId,
    status,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    planPriceId,
    planName,
    planPrice,
    credits,
    cycle,
    expired,
    updatedAt,
  };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(dbFile, null, 2));
  console.log("📁 [Local] Subscription saved:", key);
}

/* ======================================================
   🔹 获取单个用户的最新订阅
====================================================== */
export async function getSubscriptionByUid(uid) {
  if (!uid) return null;

  if (!usingLocal && db) {
    try {
      const subsSnap = await db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .get();

      if (!subsSnap.empty) {
        const allSubs = subsSnap.docs.map((d) => d.data());
        const activeSubs = allSubs.filter((s) => !s.expired);
        return activeSubs.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
      }
      return null;
    } catch (err) {
      console.error("⚠️ Firestore getSubscriptionByUid failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const matches = Object.values(dbFile.byUid).filter(
    (v) => v.uid === uid && !v.expired
  );
  return matches.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

/* ======================================================
   🔹 获取所有订阅（Account 页面）
====================================================== */
export async function getAllSubscriptionsByUid(uid) {
  if (!uid) return [];

  if (!usingLocal && db) {
    try {
      const subsSnap = await db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .get();

      if (subsSnap.empty) return [];
      const allSubs = subsSnap.docs.map((d) => d.data());
      return allSubs.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      console.error(
        "⚠️ Firestore getAllSubscriptionsByUid failed:",
        err.message
      );
      return [];
    }
  }

  // fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  return Object.values(dbFile.byUid)
    .filter((v) => v.uid === uid)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ======================================================
   🔹 一次性购买记录（积分包）
====================================================== */
export async function addOneTimePurchase(payload) {
  const { uid, email } = payload;
  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined) delete payload[k];
  });

  if (!usingLocal && db) {
    try {
      if (uid) {
        const purchaseRef = db
          .collection("users")
          .doc(uid)
          .collection("purchases")
          .doc();
        await purchaseRef.set(payload);
        console.log(
          `✅ [Firestore] Purchase saved under user/${uid}/purchases`
        );
      }
      return;
    } catch (err) {
      console.error("⚠️ Firestore addOneTimePurchase failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  if (!Array.isArray(dbFile.purchases)) dbFile.purchases = [];
  dbFile.purchases.push(payload);
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(dbFile, null, 2));
  console.log("📁 [Local] Purchase saved:", email);
}

/* ======================================================
   🔹 用户积分管理（仍在 user 文档上）
====================================================== */
export async function getUserCredits(uid) {
  if (!uid) return 0;

  if (!usingLocal && db) {
    try {
      const ref = db.collection("users").doc(uid);
      const snap = await ref.get();
      if (snap.exists) return snap.data().credits || 0;
      return 0;
    } catch (err) {
      console.error("⚠️ Firestore getUserCredits failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_CREDITS, {});
  const data = JSON.parse(fs.readFileSync(LOCAL_CREDITS, "utf-8"));
  return data[uid] || 0;
}

export async function updateUserCredits(uid, delta) {
  if (!uid) return;

  if (!usingLocal && db) {
    try {
      const ref = db.collection("users").doc(uid);
      const snap = await ref.get();
      const current = snap.exists ? snap.data().credits || 0 : 0;
      const newCredits = Math.max(0, current + delta);
      await ref.set(
        {
          credits: newCredits,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      console.log(
        `💰 [Firestore] Credits updated for ${uid}: ${current} → ${newCredits}`
      );
      return newCredits;
    } catch (err) {
      console.error("⚠️ Firestore updateUserCredits failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_CREDITS, {});
  const data = JSON.parse(fs.readFileSync(LOCAL_CREDITS, "utf-8"));
  const current = data[uid] || 0;
  const newCredits = Math.max(0, current + delta);
  data[uid] = newCredits;
  fs.writeFileSync(LOCAL_CREDITS, JSON.stringify(data, null, 2));
  console.log(`💰 [Local] Updated credits for ${uid}: ${current} → ${newCredits}`);
  return newCredits;
}

/* ======================================================
   🆕 🔹 新增：立即取消订阅（for Switch / Upgrade）
====================================================== */
export async function markSubscriptionCancelledNow(uid, subscriptionId) {
  if (!uid || !subscriptionId) return;

  if (!usingLocal && db) {
    try {
      const subRef = db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .doc(subscriptionId);

      await subRef.set(
        {
          status: "canceled",
          expired: true,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      console.log(`🗑️ [Firestore] Marked subscription ${subscriptionId} as canceled now`);
      return true;
    } catch (err) {
      console.error("⚠️ Firestore markSubscriptionCancelledNow failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  const key = `${uid}-${subscriptionId}`;
  if (dbFile.byUid[key]) {
    dbFile.byUid[key].status = "canceled";
    dbFile.byUid[key].expired = true;
    dbFile.byUid[key].updatedAt = Date.now();
    fs.writeFileSync(LOCAL_PATH, JSON.stringify(dbFile, null, 2));
    console.log(`🗑️ [Local] Marked ${subscriptionId} canceled`);
  }
}

/* ======================================================
   🆕 🔹 新增：切换订阅（前端点击 Upgrade / Switch Now）
====================================================== */
export async function recordSwitchingSubscription(uid, previousPlan, newPlan) {
  if (!uid) return;

  if (!usingLocal && db) {
    try {
      const ref = db.collection("users").doc(uid);
      await ref.set(
        {
          previousPlan,
          switchingTo: newPlan,
          switchingAt: Date.now(),
        },
        { merge: true }
      );
      console.log(`🔁 [Firestore] User ${uid} switching from ${previousPlan} → ${newPlan}`);
    } catch (err) {
      console.error("⚠️ Firestore recordSwitchingSubscription failed:", err.message);
    }
  }

  // fallback
  ensureLocalFile(LOCAL_PATH, { byUid: {}, purchases: [] });
  const dbFile = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
  dbFile[`switch-${uid}`] = {
    previousPlan,
    newPlan,
    switchingAt: Date.now(),
  };
  fs.writeFileSync(LOCAL_PATH, JSON.stringify(dbFile, null, 2));
  console.log(`🔁 [Local] Recorded switching ${uid}: ${previousPlan} → ${newPlan}`);
}