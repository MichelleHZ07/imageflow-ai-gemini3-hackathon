import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

console.log("ENV:", import.meta.env);
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export let auth: ReturnType<typeof getAuth> | null = null;
export let db: ReturnType<typeof getFirestore> | null = null;

try {
  if (cfg.apiKey && cfg.authDomain && cfg.projectId) {
    const app = initializeApp(cfg);
    auth = getAuth(app);
    db = getFirestore(app);

    // ✅ 新增这一段日志，用于确认连接成功
    console.log("✅ Firebase initialized successfully!");
    console.log("Project ID:", cfg.projectId);
  }
} catch (e) {
  console.warn("⚠️ Firebase not initialized (missing config). Running in demo mode.", e);
}
