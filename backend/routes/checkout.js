import express from "express";
import Stripe from "stripe";
import {
  getSubscriptionByUid,
  markSubscriptionCancelledNow,
  recordSwitchingSubscription,
} from "../services/subscriptionStore.js";
import { getDB } from "../utils/firebaseAdmin.js";
import { PRICE_CREDIT_MAP } from "../config/priceCredits.js";

const router = express.Router();
const db = getDB();
const FRONTEND_URL = process.env.FRONTEND_URL || "https://imageflow-dev.web.app";

/* ======================================================
   ✅ 辅助函数：获取价格详情（仅用于前端显示信息，不再创建临时价格）
====================================================== */
async function getPriceDetails(stripe, priceId) {
  try {
    const price = await stripe.prices.retrieve(priceId);
    const credits = price.metadata?.credits
      ? Number(price.metadata.credits)
      : PRICE_CREDIT_MAP[priceId] || 0;

    const productId =
      typeof price.product === "string" ? price.product : price.product?.id;
    const product = productId ? await stripe.products.retrieve(productId) : null;

    return {
      amount: price.unit_amount,
      currency: price.currency,
      productName: product?.name || "Credit Pack",
      credits,
      recurring: price.recurring,
    };
  } catch (err) {
    console.warn("⚠️ Error fetching price details:", err.message);
    return null;
  }
}

/* ======================================================
   ✅ 一次性购买 Checkout（Credit Packs）
====================================================== */
router.post("/create-checkout-session", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const { priceId, uid, email } = req.body;
    if (!priceId || !uid || !email)
      return res.status(400).json({ error: "Missing required fields" });

    // 复用 Stripe customer
    let customerId;
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data()?.customerId) {
      customerId = userDoc.data().customerId;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { uid },
      });
      customerId = customer.id;
      await db.collection("users").doc(uid).set({ customerId }, { merge: true });
      console.log(`👤 Created new Stripe customer for ${email}: ${customerId}`);
    }

    // 获取价格详情（用于日志显示）
    const priceDetails = await getPriceDetails(stripe, priceId);
    if (!priceDetails)
      return res.status(400).json({ error: "Invalid price ID" });

    // ✅ 使用固定 priceId，不再用 price_data 动态创建
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_intent_data: {
        description: `Purchase of ${priceDetails.credits} credits`,
        metadata: {
          uid,
          email,
          priceId,
          credits: String(priceDetails.credits),
          type: "one_time_purchase",
        },
      },
      success_url: `${FRONTEND_URL}/account?success=true`,
      cancel_url: `${FRONTEND_URL}/pricing`, // ✅ 改这里：去掉 ?cancel=true
      metadata: { uid, email, priceId, type: "one_time" },
    });

    console.log(`✅ One-time checkout created for ${email} (${priceId})`);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Checkout session error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ✅ 订阅 Checkout（使用固定 Price ID）
====================================================== */
router.post("/create-subscription-session", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });
    const { priceId, uid, email } = req.body;
    if (!priceId || !uid || !email)
      return res.status(400).json({ error: "Missing required fields" });

    // 复用 Customer
    let customerId;
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data()?.customerId) {
      customerId = userDoc.data().customerId;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { uid },
      });
      customerId = customer.id;
      await db.collection("users").doc(uid).set({ customerId }, { merge: true });
      console.log(`👤 Created new Stripe customer for ${email}: ${customerId}`);
    }

    // 获取价格详情（仅用于日志与前端显示）
    const priceDetails = await getPriceDetails(stripe, priceId);
    if (!priceDetails)
      return res.status(400).json({ error: "Invalid price ID" });

    // ✅ 使用固定 priceId，不创建新 Price
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        description: `${priceDetails.productName} - ${priceDetails.credits} credits/month`,
        metadata: {
          uid,
          email,
          priceId,
          credits: String(priceDetails.credits),
          type: "subscription",
        },
      },
      success_url: `${FRONTEND_URL}/account?success=true`,
      cancel_url: `${FRONTEND_URL}/pricing`, // ✅ 改这里
    });

    console.log(`✅ Subscription checkout created for ${email} (${priceId})`);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Subscription checkout error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ✅ 切换订阅（立即取消旧订阅 + 创建新订阅）
====================================================== */
router.post("/switch-subscription", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });
    const { uid, email, newPriceId } = req.body;
    if (!uid || !email || !newPriceId)
      return res.status(400).json({ error: "Missing fields" });

    const current = await getSubscriptionByUid(uid);
    if (!current || !current.subscriptionId)
      return res.status(400).json({ error: "No active subscription" });

    // 立即取消旧订阅（不退款）
    await stripe.subscriptions.cancel(current.subscriptionId, {
      invoice_now: false,
      prorate: false,
    });
    await markSubscriptionCancelledNow(uid, current.subscriptionId);
    console.log(`🗑️ Canceled old subscription: ${current.subscriptionId}`);

    // 记录切换计划
    await recordSwitchingSubscription(uid, current.planName, newPriceId);

    // ✅ 启动新订阅（用固定 priceId）
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: current.customerId,
      line_items: [{ price: newPriceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/account?success=true`,
      cancel_url: `${FRONTEND_URL}/pricing`, // ✅ 改这里
      metadata: { uid, email, type: "switch" },
      subscription_data: {
        metadata: { uid, email, type: "switch" }, // ✅ 确保新 subscription 直接带上 email
      },
    });

    console.log(`🔁 Switching ${email} from ${current.planName} → ${newPriceId}`);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Switch-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ✅ 客户自助 Portal
====================================================== */
router.get("/create-portal-session", async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    const sub = await getSubscriptionByUid(String(uid));
    if (!sub?.customerId)
      return res.status(404).json({ error: "No customer found" });

    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.customerId,
      return_url: `${FRONTEND_URL}/account`,
    });
    return res.json({ url: portal.url });
  } catch (err) {
    console.error("❌ Portal session error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ======================================================
   ✅ 获取当前用户订阅信息（前端 account 页面）
====================================================== */
router.get("/user-subscription", async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Missing uid" });

    const sub = await getSubscriptionByUid(uid);
    if (!sub) return res.json({});
    return res.json(sub);
  } catch (err) {
    console.error("❌ user-subscription error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;