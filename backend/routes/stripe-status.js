// backend/routes/stripe-status.js
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

/* ======================================================
   🔹 通用函数：获取 Stripe Plan 元数据
====================================================== */
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
      credits:
        priceObj.metadata?.credits
          ? Number(priceObj.metadata.credits)
          : PRICE_CREDIT_MAP[planPriceId] || 0,
      cycle: priceObj.recurring?.interval || "Monthly",
    };
  } catch (err) {
    console.warn("⚠️ fetchPlanMeta error:", err.message);
    return {};
  }
}

/* ======================================================
   ✅ GET /api/subscription-status?uid=...
   获取用户所有有效订阅（来自 Firestore）
====================================================== */
router.get("/subscription-status", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    // 优先从 Firestore 读取用户子集合
    const subsSnap = await db
      .collection("users")
      .doc(uid)
      .collection("subscriptions")
      .get();

    if (subsSnap.empty) {
      const single = await getSubscriptionByUid(uid);
      return res.json(single ? [single] : []);
    }

    const subscriptions = [];
    const now = Date.now();

    for (const doc of subsSnap.docs) {
      const sub = doc.data();
      if (sub.expired) continue;

      // 检查自然过期
      if (sub.currentPeriodEnd && now > sub.currentPeriodEnd) {
        await upsertSubscription({ ...sub, expired: true, status: "expired" });
        continue;
      }

      // 获取最新计划信息
      let planMeta = {
        planName: sub.planName || "Unknown Plan",
        planPrice: sub.planPrice || 0,
        credits: sub.credits || 0,
        cycle: sub.cycle || "Monthly",
      };

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
        subscriptionId: sub.subscriptionId,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd || false,
        expired: sub.expired || false,
        updatedAt: sub.updatedAt || 0,
      });
    }

    subscriptions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return res.json(subscriptions);
  } catch (err) {
    console.error("❌ subscription-status error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ✅ GET /api/invoices?uid=...
   获取用户的 Stripe 发票历史（含订阅 + 一次性购买）
====================================================== */
router.get("/invoices", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    // Firestore 查用户的 customerId
    const userDoc = await db.collection("users").doc(uid).get();
    const customerId = userDoc.exists ? userDoc.data().customerId : null;

    if (!customerId) return res.json([]);

    // 从 Stripe 拉取发票
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
    });

    const formatted = invoices.data.map((inv) => ({
      id: inv.id,
      amount: inv.amount_paid / 100,
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      hosted_invoice_url: inv.hosted_invoice_url,
      created: inv.created * 1000,
      number: inv.number,
      subscription: inv.subscription,
      period_start: inv.lines?.data?.[0]?.period?.start * 1000 || null,
      period_end: inv.lines?.data?.[0]?.period?.end * 1000 || null,
    }));

    return res.json(formatted);
  } catch (err) {
    console.error("❌ invoices error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ❌ POST /api/cancel-subscription
   标记订阅在周期末取消
====================================================== */
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

    let planPriceId = canceled.items?.data?.[0]?.price?.id || "";
    let planMeta = planPriceId ? await fetchPlanMeta(planPriceId) : {};

    if (!planMeta.planName) {
      // fallback to Firestore 旧数据
      const subDoc = await db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .doc(subscriptionId)
        .get();
      if (subDoc.exists) {
        const old = subDoc.data();
        planMeta = {
          planPriceId: old.planPriceId,
          planName: old.planName,
          planPrice: old.planPrice,
          credits: old.credits,
          cycle: old.cycle,
        };
      }
    }

    await upsertSubscription({
      uid,
      subscriptionId,
      status: canceled.status,
      cancelAtPeriodEnd: canceled.cancel_at_period_end,
      currentPeriodEnd,
      expired: false,
      updatedAt: Date.now(),
      ...planMeta,
    });

    console.log(`✅ Subscription ${subscriptionId} set to cancel at period end`);
    return res.json({
      success: true,
      status: canceled.status,
      cancelAtPeriodEnd: canceled.cancel_at_period_end,
      ...planMeta,
    });
  } catch (err) {
    console.error("❌ cancel-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   🔁 POST /api/resume-subscription
   恢复订阅
====================================================== */
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

    console.log(`🔁 Subscription ${subscriptionId} resumed`);
    return res.json({
      success: true,
      status: resumed.status,
      cancelAtPeriodEnd: resumed.cancel_at_period_end,
      ...planMeta,
    });
  } catch (err) {
    console.error("❌ resume-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;