// backend/config/priceCredits.js

/**
 * 💳 Stripe Price ID → Credits 映射表
 * 集中管理所有定价配置，方便后期维护
 * 
 * ⚠️ 重要：这个映射作为 fallback，当 Stripe metadata 中没有 credits 字段时使用
 * 如果 Stripe Dashboard 中产品的 metadata.credits 设置了值，会优先使用 Stripe 的值
 */

export const PRICE_CREDIT_MAP = {
  // 一次性购买（Credit Packs）
  "price_1SPv8NCe5koWjB0tMumOgeez": 900,   // Starter Pack - $9
  "price_1SPv9QCe5koWjB0tozRqXyv1": 3000,  // Creator Pack - $29
  "price_1SPvA6Ce5koWjB0tXOBRxa4h": 11000, // Studio Pack - $99

  // 订阅计划（Subscriptions）
  "price_1SPv8NCe5koWjB0ttiIxjMab": 1200,  // Starter Subscription - $9/month
  "price_1SPv9QCe5koWjB0tIkMtUcMf": 4000,  // Creator Subscription - $27/month ⚠️ 注意不是3000
  "price_1SPvA6Ce5koWjB0tDO3844lx": 15000, // Studio Subscription - $99/month
};

/**
 * 获取指定 Price ID 对应的积分数
 */
export function getCreditsForPrice(priceId) {
  return PRICE_CREDIT_MAP[priceId] || 0;
}

/**
 * 检查是否为订阅 Price ID
 */
export function isSubscriptionPrice(priceId) {
  const subscriptionPrices = [
    "price_1SPv8NCe5koWjB0ttiIxjMab",
    "price_1SPv9QCe5koWjB0tIkMtUcMf",
    "price_1SPvA6Ce5koWjB0tDO3844lx",
  ];
  return subscriptionPrices.includes(priceId);
}

/**
 * 检查是否为一次性购买 Price ID
 */
export function isOneTimePrice(priceId) {
  const oneTimePrices = [
    "price_1SPv8NCe5koWjB0tMumOgeez",
    "price_1SPv9QCe5koWjB0tozRqXyv1",
    "price_1SPvA6Ce5koWjB0tXOBRxa4h",
  ];
  return oneTimePrices.includes(priceId);
}