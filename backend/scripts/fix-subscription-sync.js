// scripts/fix-subscription-sync.js
// 
// 🔧 一次性修复脚本：修复 Firebase 中与 Stripe 不同步的订阅数据
// 
// 使用方法：
// 1. 确保环境变量已设置 (STRIPE_SECRET_KEY, Firebase credentials)
// 2. 运行: node scripts/fix-subscription-sync.js
//
// 该脚本会：
// - 扫描所有用户的订阅
// - 对比 Stripe 中的实际状态
// - 修复 Firebase 中错误的 expired 状态

import Stripe from "stripe";
import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// 初始化 Firebase Admin
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

// Price ID 到 Credits 的映射
const PRICE_CREDIT_MAP = {
  "price_1SPv8NCe5koWjB0tMumOgeez": 900,
  "price_1SPv9QCe5koWjB0tozRqXyv1": 3000,
  "price_1SPvA6Ce5koWjB0tXOBRxa4h": 11000,
  "price_1SPv8NCe5koWjB0ttiIxjMab": 1200,
  "price_1SPv9QCe5koWjB0tIkMtUcMf": 4000,
  "price_1SPvA6Ce5koWjB0tDO3844lx": 15000,
};

async function fetchPlanMeta(planPriceId) {
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
    console.warn(`⚠️ fetchPlanMeta error for ${planPriceId}:`, err.message);
    return {};
  }
}

async function fixUserSubscription(uid, customerId) {
  console.log(`\n🔍 Checking user ${uid}...`);

  // 获取 Firebase 中的订阅
  const subsSnap = await db
    .collection("users")
    .doc(uid)
    .collection("subscriptions")
    .get();

  if (subsSnap.empty) {
    console.log(`  📭 No subscriptions in Firebase`);
  }

  // 获取 Stripe 中的订阅
  let stripeSubscriptions = [];
  if (customerId) {
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      stripeSubscriptions = list.data;
      console.log(`  📋 Found ${stripeSubscriptions.length} subscription(s) in Stripe`);
    } catch (err) {
      console.warn(`  ⚠️ Failed to fetch Stripe subscriptions: ${err.message}`);
    }
  }

  // 创建 Stripe 订阅的 Map
  const stripeSubMap = new Map();
  for (const sub of stripeSubscriptions) {
    stripeSubMap.set(sub.id, sub);
  }

  // 检查并修复 Firebase 中的订阅
  for (const doc of subsSnap.docs) {
    const fbData = doc.data();
    const subscriptionId = doc.id;
    const stripeSub = stripeSubMap.get(subscriptionId);

    console.log(`\n  📄 Subscription: ${subscriptionId}`);
    console.log(`     Firebase: status=${fbData.status}, expired=${fbData.expired}`);

    if (stripeSub) {
      console.log(`     Stripe:   status=${stripeSub.status}, cancel_at_period_end=${stripeSub.cancel_at_period_end}`);

      const currentPeriodEnd = stripeSub.current_period_end * 1000;
      const now = Date.now();

      // 判断是否真正过期
      const isExpired =
        stripeSub.status === "canceled" ||
        stripeSub.status === "incomplete_expired";

      // 检查是否需要修复
      if (fbData.expired !== isExpired) {
        console.log(`     🔧 FIXING: expired ${fbData.expired} → ${isExpired}`);

        const planMeta = await fetchPlanMeta(stripeSub.items?.data?.[0]?.price?.id);

        await db
          .collection("users")
          .doc(uid)
          .collection("subscriptions")
          .doc(subscriptionId)
          .set(
            {
              status: isExpired ? "expired" : stripeSub.status,
              expired: isExpired,
              currentPeriodEnd,
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
              ...planMeta,
              updatedAt: Date.now(),
            },
            { merge: true }
          );

        console.log(`     ✅ Fixed!`);
      } else {
        console.log(`     ✓ Status matches, no fix needed`);
      }
    } else {
      console.log(`     ⚠️ Not found in Stripe`);
      if (!fbData.expired) {
        console.log(`     🔧 FIXING: marking as expired (not in Stripe)`);
        await db
          .collection("users")
          .doc(uid)
          .collection("subscriptions")
          .doc(subscriptionId)
          .set(
            {
              status: "expired",
              expired: true,
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        console.log(`     ✅ Fixed!`);
      }
    }
  }

  // 检查 Stripe 中有但 Firebase 中没有的订阅
  for (const [subId, stripeSub] of stripeSubMap) {
    const fbExists = subsSnap.docs.some((d) => d.id === subId);
    if (!fbExists && ["active", "trialing", "past_due"].includes(stripeSub.status)) {
      console.log(`\n  🆕 Found active subscription in Stripe but not in Firebase: ${subId}`);

      const planPriceId = stripeSub.items?.data?.[0]?.price?.id || "";
      const planMeta = await fetchPlanMeta(planPriceId);
      const currentPeriodEnd = stripeSub.current_period_end * 1000;

      await db
        .collection("users")
        .doc(uid)
        .collection("subscriptions")
        .doc(subId)
        .set({
          uid,
          customerId,
          subscriptionId: subId,
          status: stripeSub.status,
          expired: false,
          currentPeriodEnd,
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
          planPriceId,
          ...planMeta,
          updatedAt: Date.now(),
        });

      console.log(`  ✅ Created subscription record in Firebase`);
    }
  }
}

async function main() {
  console.log("🚀 Starting subscription sync fix...\n");

  // 获取所有有 customerId 的用户
  const usersSnap = await db
    .collection("users")
    .where("customerId", "!=", null)
    .get();

  console.log(`Found ${usersSnap.size} user(s) with Stripe customers\n`);

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    await fixUserSubscription(userDoc.id, userData.customerId);
  }

  console.log("\n\n✅ Sync fix completed!");
}

main().catch(console.error);