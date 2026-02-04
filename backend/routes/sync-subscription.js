// backend/routes/sync-subscription.js
import express from "express";
import Stripe from "stripe";
import { upsertSubscription } from "../services/subscriptionStore.js";
import { getDB } from "../utils/firebaseAdmin.js";
import { PRICE_CREDIT_MAP } from "../config/priceCredits.js";

const router = express.Router();
const db = getDB();

/**
 * 🔹 从 Stripe 获取 Plan 元数据
 */
async function fetchPlanMeta(stripe, planPriceId) {
  if (!planPriceId) return {};
  try {
    const priceObj = await stripe.prices.retrieve(planPriceId);
    const productId =
      typeof priceObj.product === "string" ? priceObj.product : priceObj.product?.id;
    const productObj = productId ? await stripe.products.retrieve(productId) : null;

    return {
      planPriceId,
      planName: productObj?.name || priceObj.nickname || "Unknown Plan",
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
 * ✅ POST /api/sync-subscription
 * 强制从 Stripe 同步订阅状态到 Firebase
 * 
 * Body: { uid: string, subscriptionId?: string }
 * - 如果提供 subscriptionId，只同步该订阅
 * - 如果不提供，同步该用户的所有订阅
 */
router.post("/sync-subscription", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const { uid, subscriptionId } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "Missing uid" });
    }

    // 1. 获取用户的 customerId
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const customerId = userDoc.data()?.customerId;
    if (!customerId) {
      return res.status(404).json({ error: "No Stripe customer found for user" });
    }

    // 2. 从 Stripe 获取订阅列表
    let stripeSubscriptions;
    if (subscriptionId) {
      // 只获取特定订阅
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        stripeSubscriptions = [sub];
      } catch (err) {
        console.warn(`⚠️ Subscription ${subscriptionId} not found in Stripe:`, err.message);
        stripeSubscriptions = [];
      }
    } else {
      // 获取该客户的所有订阅
      const list = await stripe.subscriptions.list({
        customer: customerId,
        limit: 100,
        status: "all", // 包括已取消的
      });
      stripeSubscriptions = list.data;
    }

    console.log(`🔄 Syncing ${stripeSubscriptions.length} subscription(s) for user ${uid}`);

    const syncResults = [];

    // 3. 遍历 Stripe 订阅并更新 Firebase
    for (const sub of stripeSubscriptions) {
      const planPriceId = sub.items?.data?.[0]?.price?.id || "";
      const currentPeriodEnd = sub.current_period_end
        ? sub.current_period_end * 1000
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      const planMeta = await fetchPlanMeta(stripe, planPriceId);

      // 判断是否真正过期
      const now = Date.now();
      const isExpired =
        sub.status === "canceled" ||
        sub.status === "incomplete_expired" ||
        (sub.status === "canceled" && now > currentPeriodEnd);

      // 更新 Firebase
      await upsertSubscription({
        uid,
        email: sub.metadata?.email || userDoc.data()?.email || "",
        customerId,
        subscriptionId: sub.id,
        status: isExpired ? "expired" : sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end || false,
        currentPeriodEnd,
        planPriceId,
        ...planMeta,
        expired: isExpired,
        updatedAt: Date.now(),
      });

      syncResults.push({
        subscriptionId: sub.id,
        stripeStatus: sub.status,
        firebaseStatus: isExpired ? "expired" : sub.status,
        expired: isExpired,
        planName: planMeta.planName,
        currentPeriodEnd: new Date(currentPeriodEnd).toISOString(),
      });

      console.log(
        `✅ Synced ${sub.id}: Stripe=${sub.status} → Firebase=${isExpired ? "expired" : sub.status}`
      );
    }

    // 4. 检查 Firebase 中是否有 Stripe 中不存在的订阅（清理脏数据）
    const firebaseSubs = await db
      .collection("users")
      .doc(uid)
      .collection("subscriptions")
      .get();

    const stripeSubIds = new Set(stripeSubscriptions.map((s) => s.id));

    for (const doc of firebaseSubs.docs) {
      const fbSubId = doc.id;
      if (!stripeSubIds.has(fbSubId)) {
        // 这个订阅在 Stripe 中不存在，标记为过期
        const fbData = doc.data();
        if (!fbData.expired) {
          console.log(`🗑️ Marking orphan subscription ${fbSubId} as expired`);
          await upsertSubscription({
            ...fbData,
            uid,
            subscriptionId: fbSubId,
            status: "expired",
            expired: true,
            updatedAt: Date.now(),
          });
          syncResults.push({
            subscriptionId: fbSubId,
            stripeStatus: "not_found",
            firebaseStatus: "expired",
            expired: true,
            note: "Marked as expired (not found in Stripe)",
          });
        }
      }
    }

    return res.json({
      success: true,
      synced: syncResults.length,
      results: syncResults,
    });
  } catch (err) {
    console.error("❌ sync-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * ✅ GET /api/sync-subscription?uid=...
 * 自动同步（用于前端在检测到数据异常时调用）
 */
router.get("/sync-subscription", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const { uid } = req.query;
    if (!uid) {
      return res.status(400).json({ error: "Missing uid" });
    }

    // 获取用户的 customerId
    const userDoc = await db.collection("users").doc(String(uid)).get();
    if (!userDoc.exists) {
      return res.json({ synced: 0, message: "User not found" });
    }

    const customerId = userDoc.data()?.customerId;
    if (!customerId) {
      return res.json({ synced: 0, message: "No Stripe customer" });
    }

    // 从 Stripe 获取活跃订阅
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });

    if (list.data.length === 0) {
      return res.json({ synced: 0, message: "No active subscriptions in Stripe" });
    }

    const syncResults = [];

    for (const sub of list.data) {
      const planPriceId = sub.items?.data?.[0]?.price?.id || "";
      const currentPeriodEnd = sub.current_period_end
        ? sub.current_period_end * 1000
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      const planMeta = await fetchPlanMeta(stripe, planPriceId);

      await upsertSubscription({
        uid: String(uid),
        email: sub.metadata?.email || userDoc.data()?.email || "",
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

      syncResults.push({
        subscriptionId: sub.id,
        status: sub.status,
        planName: planMeta.planName,
      });
    }

    console.log(`🔄 Auto-synced ${syncResults.length} subscription(s) for ${uid}`);

    return res.json({
      success: true,
      synced: syncResults.length,
      subscriptions: syncResults,
    });
  } catch (err) {
    console.error("❌ auto-sync error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;