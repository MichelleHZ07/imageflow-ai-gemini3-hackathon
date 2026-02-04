// backend/routes/stripe-webhook.js
import express from "express";
import Stripe from "stripe";
import {
  upsertSubscription,
  addOneTimePurchase,
  updateUserCredits,
} from "../services/subscriptionStore.js";
import {
  sendPurchaseEmail,
  sendSubscriptionEmail,
} from "../services/emailService.js";
import { getDB } from "../utils/firebaseAdmin.js";
import { PRICE_CREDIT_MAP } from "../config/priceCredits.js";

// 🔒 Credits 开关：测试阶段设为 false 防止白嫖，正式上线后设为 true
const CREDITS_ENABLED = process.env.CREDITS_ENABLED === 'true';

export const rawBodyMiddleware = express.raw({ type: "application/json" });

export async function webhookHandler(req, res) {
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });
  const db = getDB();

  /** 从 Stripe 获取订阅计划元数据 */
  async function extractPlanMeta(priceId) {
    if (!priceId) return {};
    try {
      const price = await stripe.prices.retrieve(priceId);
      const productId = typeof price.product === "string" ? price.product : price.product?.id;
      let planName = price.nickname || price.metadata?.name || "";
      if (!planName && productId) {
        const product = await stripe.products.retrieve(productId);
        planName = product.name || "Unknown Plan";
      }
      return {
        planProductId: productId || "",
        planName: planName || "Unknown Plan",
        planPrice: price.unit_amount ? price.unit_amount / 100 : 0,
        credits: price.metadata?.credits ? Number(price.metadata.credits) : (PRICE_CREDIT_MAP[priceId] || 0),
        cycle: price.recurring?.interval || "month",
      };
    } catch (e) {
      console.warn("⚠️ extractPlanMeta failed:", e.message);
      return {};
    }
  }

  /** 从 customerId 反查 uid（兜底） */
  async function resolveUid({ uid, customerId }) {
    if (uid) return uid;
    if (!customerId) return "";
    const snap = await db.collection("users").where("customerId", "==", customerId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
    return "";
  }

  /**
   * 🆕 判断订阅是否真正过期
   * - canceled 状态 + 已过 currentPeriodEnd = 真正过期
   * - incomplete_expired = 真正过期
   * - 其他情况 = 不过期
   */
  function isSubscriptionExpired(status, currentPeriodEnd) {
    const now = Date.now();
    
    // 这些状态直接视为过期
    if (status === "incomplete_expired") return true;
    
    // canceled 状态需要检查是否已过周期末
    if (status === "canceled") {
      return now > currentPeriodEnd;
    }
    
    // active, trialing, past_due, incomplete 等都不算过期
    return false;
  }

  // ✅ Stripe 验证事件签名
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, endpointSecret);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      /* ==========================================================
         ✅ checkout.session.completed
         - one-time：积分包购买，加分并写入 user/{uid}/purchases
         - subscription：订阅，加分并写入 user/{uid}/subscriptions
      =========================================================== */
      case "checkout.session.completed": {
        const session = event.data.object;
        const mode = session.mode;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const priceId =
          session.metadata?.priceId ||
          session.display_items?.[0]?.price?.id ||
          session.line_items?.[0]?.price?.id ||
          null;

        let uid = session.metadata?.uid || "";
        const email = session.metadata?.email || session.customer_details?.email || "";

        /* ----- 一次性购买积分包 ----- */
        if (mode === "payment") {
          await addOneTimePurchase({
            uid,
            email,
            customerId,
            sessionId: session.id,
            amount_total: session.amount_total,
            currency: session.currency,
            created: session.created,
          });

          const addedCredits = PRICE_CREDIT_MAP[priceId] || 0;
          if (CREDITS_ENABLED && addedCredits > 0 && uid) {
            await updateUserCredits(uid, addedCredits);
            console.log(`✅ [One-time] +${addedCredits} credits to ${email}`);
          } else if (!uid) {
            console.warn("⚠️ One-time purchase missing uid; credits not added");
          }

          await sendPurchaseEmail({
            to: email,
            amount: session.amount_total,
            currency: session.currency,
          });
          break;
        }

        /* ----- 订阅计划：立即落库 + 加分 ----- */
        if (mode === "subscription") {
          console.log("📥 checkout.session.completed (subscription) triggered");

          // 兜底获取 uid
          uid = await resolveUid({ uid, customerId });
          if (!uid) {
            console.warn("⚠️ Subscription checkout has no uid (metadata & lookup both failed).");
          }

          // expand 订阅对象
          const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ["subscription"] });
          const subObj = fullSession.subscription;
          const subscriptionId = typeof subObj === "object" ? subObj.id : (fullSession.subscription || "");
          if (!subscriptionId) {
            console.warn("⚠️ No subscription id on checkout session yet");
            return res.json({ received: true });
          }

          const sub =
            typeof subObj === "object" ? subObj : await stripe.subscriptions.retrieve(subscriptionId);

          const planPriceId = sub.items?.data?.[0]?.price?.id || "";
          const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
          const planMeta = await extractPlanMeta(planPriceId);

          // 🆕 使用改进的过期判断
          const expired = isSubscriptionExpired(sub.status, currentPeriodEnd);

          // ✅ 写入 user/{uid}/subscriptions/{subId}
          await upsertSubscription({
            uid,
            email,
            customerId,
            subscriptionId,
            status: sub.status,
            currentPeriodEnd,
            planPriceId,
            ...planMeta,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            expired,
            updatedAt: Date.now(),
          });

          // ✅ 加分（仅新订阅）
          const addedCredits = planMeta.credits || PRICE_CREDIT_MAP[planPriceId] || 0;
          console.log(`🔎 PlanPriceId: ${planPriceId} → Credits: ${addedCredits}`);
          if (CREDITS_ENABLED && addedCredits > 0 && uid) {
            await updateUserCredits(uid, addedCredits);
            console.log(`💳 [New Subscription Checkout] +${addedCredits} credits (${planPriceId}) for ${email}`);
          }

          await sendSubscriptionEmail({
            to: email,
            status: sub.status,
            currentPeriodEnd,
          });
        }
        break;
      }

      /* ==========================================================
         ✅ invoice.* 自动续费加分
         仅在 subscription_create / subscription_cycle 时加分
      =========================================================== */
      case "invoice.payment_succeeded":
      case "invoice.paid":
      case "invoice_payment.paid": {
        const invoice = event.data.object;
        if (!invoice.subscription) break;

        const reason = invoice.billing_reason;
        if (reason !== "subscription_create" && reason !== "subscription_cycle") break;

        const subscriptionId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription.id;

        // ✅ 通过 collectionGroup 查询找到 user/{uid}/subscriptions/{subId}
        const subQuery = await db
          .collectionGroup("subscriptions")
          .where("subscriptionId", "==", subscriptionId)
          .limit(1)
          .get();

        if (subQuery.empty) break;

        const subDoc = subQuery.docs[0];
        const subData = subDoc.data();
        const uid = subData.uid;
        const planPriceId = subData.planPriceId || "";
        if (!uid || !planPriceId) break;

        const planMeta = await extractPlanMeta(planPriceId);
        const creditsToAdd = planMeta.credits || PRICE_CREDIT_MAP[planPriceId] || 0;

        if (CREDITS_ENABLED && creditsToAdd > 0) {
          await updateUserCredits(uid, creditsToAdd);
          console.log(`💰 [Subscription Renewed] +${creditsToAdd} credits for ${uid}`);
        }

        // 🆕 同时更新订阅状态确保不被误标为 expired
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const newPeriodEnd = stripeSub.current_period_end * 1000;
        
        await upsertSubscription({
          ...subData,
          uid,
          subscriptionId,
          status: stripeSub.status,
          currentPeriodEnd: newPeriodEnd,
          expired: false, // 续费成功，肯定不过期
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
          updatedAt: Date.now(),
        });

        break;
      }

      /* ==========================================================
         ✅ 状态同步（取消、过期、恢复）
      =========================================================== */
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const subscriptionId = sub.id;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const planPriceId = sub.items?.data?.[0]?.price?.id || "";
        const currentPeriodEnd = sub.current_period_end ? sub.current_period_end * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;

        let uid = sub.metadata?.uid || "";
        uid = await resolveUid({ uid, customerId });

        const planMeta = await extractPlanMeta(planPriceId);

        // 🆕 使用改进的过期判断逻辑
        let expired = false;
        let finalStatus = sub.status;

        if (event.type === "customer.subscription.deleted") {
          // deleted 事件表示订阅已被完全删除
          expired = true;
          finalStatus = "canceled";
        } else {
          // 其他情况使用标准判断
          expired = isSubscriptionExpired(sub.status, currentPeriodEnd);
        }

        console.log(`📋 [${event.type}] ${subscriptionId}: status=${sub.status}, expired=${expired}`);

        // ✅ 更新 user/{uid}/subscriptions/{subId}
        await upsertSubscription({
          uid,
          email: sub.metadata?.email || "",
          customerId,
          subscriptionId,
          status: expired ? "expired" : finalStatus,
          expired,
          currentPeriodEnd,
          planPriceId,
          ...planMeta,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          updatedAt: Date.now(),
        });
        break;
      }

      default:
        console.log(`ℹ️ [Unhandled Event] ${event.type}`);
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("⚠️ Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
}

export default webhookHandler;