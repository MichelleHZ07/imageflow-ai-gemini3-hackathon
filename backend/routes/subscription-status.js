// backend/routes/subscription-status.js
import express from "express";
import Stripe from "stripe";
import { getSubscriptionByUid, upsertSubscription } from "../services/subscriptionStore.js";
import { getDB } from "../utils/firebaseAdmin.js";
import { PRICE_CREDIT_MAP } from "../config/priceCredits.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});
const db = getDB();

// 🧩 获取 Stripe Plan 元数据
async function fetchPlanMeta(planPriceId) {
  if (!planPriceId) return {};
  try {
    const priceObj = await stripe.prices.retrieve(planPriceId);
    const productId =
      typeof priceObj.product === "string" ? priceObj.product : priceObj.product.id;
    const productObj = await stripe.products.retrieve(productId);

    return {
      planPriceId,
      planName: productObj.name || priceObj.nickname || "Unknown Plan",
      planPrice: priceObj.unit_amount ? priceObj.unit_amount / 100 : 0,
      credits: priceObj.metadata?.credits
        ? Number(priceObj.metadata.credits)
        : PRICE_CREDIT_MAP[planPriceId] || 0,
      cycle: priceObj.recurring?.interval || "month",
    };
  } catch (err) {
    console.warn("⚠️ fetchPlanMeta error:", err.message);
    return {};
  }
}

/**
 * 🔄 从 Stripe 同步活跃订阅到 Firebase
 * 当 Firebase 显示无订阅但 Stripe 有活跃订阅时调用
 */
async function syncActiveSubscriptionsFromStripe(uid, customerId) {
  if (!customerId) return [];

  try {
    // 从 Stripe 获取活跃订阅
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });

    if (list.data.length === 0) {
      // 也检查 trialing 状态
      const trialingList = await stripe.subscriptions.list({
        customer: customerId,
        status: "trialing",
        limit: 10,
      });
      list.data.push(...trialingList.data);
    }

    const syncedSubs = [];

    for (const sub of list.data) {
      const planPriceId = sub.items?.data?.[0]?.price?.id || "";
      const currentPeriodEnd = sub.current_period_end
        ? sub.current_period_end * 1000
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      const planMeta = await fetchPlanMeta(planPriceId);

      // 写入 Firebase
      await upsertSubscription({
        uid,
        email: sub.metadata?.email || "",
        customerId,
        subscriptionId: sub.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
        currentPeriodEnd,
        planPriceId,
        ...planMeta,
        expired: false,
        updatedAt: Date.now(),
      });

      syncedSubs.push({
        active: true,
        status: sub.status,
        planName: planMeta.planName || "Unknown Plan",
        planPrice: planMeta.planPrice || 0,
        credits: planMeta.credits || 0,
        cycle: planMeta.cycle || "month",
        currentPeriodEnd,
        customerId,
        subscriptionId: sub.id,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
        expired: false,
        updatedAt: Date.now(),
      });

      console.log(`🔄 [Auto-Sync] Recovered subscription ${sub.id} (${planMeta.planName}) for user ${uid}`);
    }

    return syncedSubs;
  } catch (err) {
    console.error("⚠️ syncActiveSubscriptionsFromStripe error:", err.message);
    return [];
  }
}

/**
 * 🔍 验证单个订阅是否在 Stripe 中仍然有效
 */
async function verifySubscriptionWithStripe(subscriptionId) {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    return {
      valid: true,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: sub.current_period_end * 1000,
      isActive: ["active", "trialing", "past_due"].includes(sub.status),
    };
  } catch (err) {
    // 订阅在 Stripe 中不存在或已删除
    return { valid: false, status: "not_found", isActive: false };
  }
}

/* ============================================================
   ✅ GET /api/subscription-status?uid=...
   获取该用户所有订阅（从 users/{uid}/subscriptions）
   
   🆕 新增：自动检测 Firebase 与 Stripe 不同步的情况并修复
============================================================ */
router.get("/subscription-status", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    // 1. 先从 Firestore 读取用户订阅
    const subsSnap = await db.collection("users").doc(uid).collection("subscriptions").get();

    // 2. 获取用户的 customerId（用于 Stripe 验证）
    const userDoc = await db.collection("users").doc(uid).get();
    const customerId = userDoc.exists ? userDoc.data()?.customerId : null;

    // 如果完全没有订阅文档，尝试从 Stripe 同步
    if (subsSnap.empty) {
      console.log(`📭 No subscriptions in Firebase for ${uid}, checking Stripe...`);
      
      if (customerId) {
        const syncedSubs = await syncActiveSubscriptionsFromStripe(uid, customerId);
        if (syncedSubs.length > 0) {
          console.log(`✅ Recovered ${syncedSubs.length} subscription(s) from Stripe`);
          return res.json(syncedSubs);
        }
      }

      // 兜底：尝试旧数据
      const single = await getSubscriptionByUid(uid);
      return res.json(single ? [single] : []);
    }

    const subscriptions = [];
    const now = Date.now();
    let needsStripeSync = false;

    for (const doc of subsSnap.docs) {
      const sub = doc.data();

      // 🆕 如果 Firebase 标记为 expired，但 currentPeriodEnd 在未来，验证 Stripe
      if (sub.expired && sub.currentPeriodEnd && now < sub.currentPeriodEnd) {
        console.log(`🔍 Suspicious expired status for ${doc.id}, verifying with Stripe...`);
        
        const stripeCheck = await verifySubscriptionWithStripe(doc.id);
        
        if (stripeCheck.valid && stripeCheck.isActive) {
          // Stripe 显示订阅仍然有效，修复 Firebase
          console.log(`🔧 Fixing mismatched status for ${doc.id}: Firebase=expired, Stripe=${stripeCheck.status}`);
          
          const planMeta = sub.planPriceId ? await fetchPlanMeta(sub.planPriceId) : {};
          
          await upsertSubscription({
            ...sub,
            uid,
            subscriptionId: doc.id,
            status: stripeCheck.status,
            expired: false,
            cancelAtPeriodEnd: stripeCheck.cancelAtPeriodEnd,
            currentPeriodEnd: stripeCheck.currentPeriodEnd,
            ...planMeta,
            updatedAt: Date.now(),
          });

          // 使用修正后的数据
          subscriptions.push({
            active: true,
            status: stripeCheck.status,
            planName: planMeta.planName || sub.planName || "Unknown Plan",
            planPrice: planMeta.planPrice || sub.planPrice || 0,
            credits: planMeta.credits || sub.credits || 0,
            cycle: planMeta.cycle || sub.cycle || "month",
            currentPeriodEnd: stripeCheck.currentPeriodEnd,
            customerId: sub.customerId,
            subscriptionId: doc.id,
            cancelAtPeriodEnd: stripeCheck.cancelAtPeriodEnd,
            expired: false,
            updatedAt: Date.now(),
          });

          continue;
        }
      }

      // 跳过已过期的订阅
      if (sub.expired) continue;

      // 🔹 检查是否自然过期
      if (sub.currentPeriodEnd && now > sub.currentPeriodEnd) {
        // 验证 Stripe 确认是否真的过期
        const stripeCheck = await verifySubscriptionWithStripe(doc.id);
        
        if (!stripeCheck.valid || !stripeCheck.isActive) {
          await upsertSubscription({ ...sub, expired: true, status: "expired" });
          console.log(`⏰ Subscription ${doc.id} confirmed expired`);
          continue;
        } else {
          // Stripe 显示订阅续费了，更新 Firebase
          console.log(`🔄 Subscription ${doc.id} renewed in Stripe, updating Firebase...`);
          sub.currentPeriodEnd = stripeCheck.currentPeriodEnd;
          sub.status = stripeCheck.status;
          sub.cancelAtPeriodEnd = stripeCheck.cancelAtPeriodEnd;
          
          await upsertSubscription({
            ...sub,
            uid,
            subscriptionId: doc.id,
            expired: false,
            updatedAt: Date.now(),
          });
        }
      }

      // 🔹 组装 Plan 信息
      let planMeta = {
        planName: sub.planName || "Unknown Plan",
        planPrice: sub.planPrice || 0,
        credits: sub.credits || 0,
        cycle: sub.cycle || "month",
      };

      // 若缺失名称，动态从 Stripe 刷新
      if (sub.planPriceId && planMeta.planName === "Unknown Plan") {
        const fresh = await fetchPlanMeta(sub.planPriceId);
        if (fresh.planName) planMeta = fresh;
      }

      subscriptions.push({
        active: ["active", "trialing", "past_due"].includes(sub.status),
        status: sub.status,
        planName: planMeta.planName,
        planPrice: planMeta.planPrice,
        credits: planMeta.credits,
        cycle: planMeta.cycle,
        currentPeriodEnd: sub.currentPeriodEnd || null,
        customerId: sub.customerId,
        subscriptionId: sub.subscriptionId || doc.id,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        expired: sub.expired || false,
        updatedAt: sub.updatedAt || 0,
      });
    }

    // 🆕 如果 Firebase 全部是 expired 但用户有 customerId，检查 Stripe 是否有活跃订阅
    if (subscriptions.length === 0 && customerId) {
      console.log(`📭 All Firebase subscriptions expired for ${uid}, checking Stripe...`);
      const syncedSubs = await syncActiveSubscriptionsFromStripe(uid, customerId);
      if (syncedSubs.length > 0) {
        console.log(`✅ Recovered ${syncedSubs.length} active subscription(s) from Stripe`);
        return res.json(syncedSubs);
      }
    }

    subscriptions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return res.json(subscriptions);
  } catch (err) {
    console.error("subscription-status error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   ❌ POST /api/cancel-subscription
   取消订阅（更新 Firestore 同时写入用户子集合）
============================================================ */
router.post("/cancel-subscription", async (req, res) => {
  try {
    const { uid, subscriptionId } = req.body || {};
    if (!uid || !subscriptionId)
      return res.status(400).json({ error: "Missing uid or subscriptionId" });

    const canceled = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    const currentPeriodEnd =
      canceled.current_period_end * 1000 || Date.now() + 30 * 24 * 60 * 60 * 1000;

    // 🧩 从 Stripe 获取 plan 信息
    let planPriceId = canceled.items?.data?.[0]?.price?.id || "";
    let planMeta = planPriceId ? await fetchPlanMeta(planPriceId) : {};

    // ⚠️ Stripe 某些取消时不返回 price，用 Firestore 缓存兜底
    if (!planMeta.planName) {
      const subDoc = await db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .doc(subscriptionId)
        .get();
      if (subDoc.exists) {
        const old = subDoc.data();
        planMeta = {
          planPriceId: old.planPriceId || "",
          planName: old.planName || "Unknown Plan",
          planPrice: old.planPrice || 0,
          credits: old.credits || 0,
          cycle: old.cycle || "month",
        };
        console.log(`⚡ Used Firestore cache for canceled subscription ${subscriptionId}`);
      }
    }

    await upsertSubscription({
      uid,
      subscriptionId,
      status: canceled.status,
      cancelAtPeriodEnd: canceled.cancel_at_period_end,
      currentPeriodEnd,
      expired: false, // 🆕 取消但未过期
      updatedAt: Date.now(),
      ...planMeta,
    });

    console.log(`✅ Subscription ${subscriptionId} marked to cancel at period end`);
    return res.json({
      success: true,
      status: canceled.status,
      cancelAtPeriodEnd: canceled.cancel_at_period_end,
      ...planMeta,
    });
  } catch (err) {
    console.error("cancel-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   🔄 POST /api/resume-subscription
   恢复订阅（重新同步 Stripe 数据 + 更新 Firestore）
============================================================ */
router.post("/resume-subscription", async (req, res) => {
  try {
    const { uid, subscriptionId } = req.body || {};
    if (!uid || !subscriptionId)
      return res.status(400).json({ error: "Missing uid or subscriptionId" });

    const resumed = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });

    const currentPeriodEnd =
      resumed.current_period_end * 1000 || Date.now() + 30 * 24 * 60 * 60 * 1000;

    const planPriceId = resumed.items?.data?.[0]?.price?.id || "";
    const planMeta = await fetchPlanMeta(planPriceId);

    await upsertSubscription({
      uid,
      subscriptionId,
      status: resumed.status,
      cancelAtPeriodEnd: resumed.cancel_at_period_end,
      currentPeriodEnd,
      expired: false,
      updatedAt: Date.now(),
      ...planMeta,
    });

    console.log(`🔄 Subscription ${subscriptionId} resumed`);
    return res.json({
      success: true,
      status: resumed.status,
      cancelAtPeriodEnd: resumed.cancel_at_period_end,
      ...planMeta,
    });
  } catch (err) {
    console.error("resume-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;