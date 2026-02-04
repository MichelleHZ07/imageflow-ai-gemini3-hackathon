import fetch from "node-fetch";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "ImageFlow <noreply@yourdomain.com>";

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY || !to) {
    console.warn("Skipping email (missing RESEND_API_KEY or to)");
    return;
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("Resend error:", text);
  }
}

/** 一次性购买通知 */
export async function sendPurchaseEmail({ to, amount, currency }) {
  const amountFixed = typeof amount === "number" ? (amount / 100).toFixed(2) : amount;
  const subject = "Your ImageFlow purchase is confirmed";
  const html = `
    <div style="font-family:system-ui,Arial">
      <h2>Thanks for your purchase 🎉</h2>
      <p>We've received your payment of <b>${amountFixed} ${currency?.toUpperCase() || ""}</b>.</p>
      <p>Your credits will be available in your account shortly.</p>
      <p style="color:#888">If you didn’t make this purchase, please contact support.</p>
    </div>
  `;
  await sendEmail({ to, subject, html });
}

/** 订阅开通/更新通知 */
export async function sendSubscriptionEmail({ to, status, currentPeriodEnd }) {
  const dateStr = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleString() : "N/A";
  const subject = "Your ImageFlow subscription is active";
  const html = `
    <div style="font-family:system-ui,Arial">
      <h2>Subscription updated ✅</h2>
      <p>Status: <b>${status}</b></p>
      <p>Renews on: <b>${dateStr}</b></p>
      <p>You can manage your plan anytime in your Account page.</p>
    </div>
  `;
  await sendEmail({ to, subject, html });
}