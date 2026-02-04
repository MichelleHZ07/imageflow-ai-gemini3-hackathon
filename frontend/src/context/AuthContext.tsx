import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  getDoc,
} from "firebase/firestore";

const db = getFirestore();

type User = { uid: string; email: string | null; emailVerified: boolean } | null;

type Ctx = {
  user: User;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const CtxObj = createContext<Ctx>({
  user: null,
  loading: false,
  async login() {},
  async register() {},
  async logout() {},
});

export const useAuth = () => useContext(CtxObj);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const newUser = { uid: u.uid, email: u.email, emailVerified: u.emailVerified };
        setUser(newUser);

        // ✅ 初始化 Firestore 用户（首次登录创建）
        await ensureUserDoc(newUser.uid, newUser.email);

        // ✅ 实时监听 credits 变化
        subscribeUserCredits(newUser.uid);
      } else {
        setUser(null);
        window.dispatchEvent(new Event("creditsChanged"));
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  /** 创建或确保 Firestore 有用户档案 */
  const ensureUserDoc = async (uid: string, email: string | null) => {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email,
        credits: 40, // 初始赠送 40（或 0，看你规则）
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      console.log(`🌱 Created Firestore user doc for ${uid}`);
    }
  };

  /** 订阅 credits 变化并广播事件 */
  const subscribeUserCredits = (uid: string) => {
    const ref = doc(db, "users", uid);
    return onSnapshot(ref, (snap) => {
      const credits = snap.exists() ? snap.data()?.credits || 0 : 0;
      // 广播事件让 NavBar / Account 页面刷新
      window.dispatchEvent(new CustomEvent("creditsChanged", { detail: credits }));
    });
  };

  const api = {
    user,
    loading,

    async login(email: string, password: string) {
      if (!auth) throw new Error("Auth not configured");
      await signInWithEmailAndPassword(auth, email, password);
    },

    async register(email: string, password: string) {
      if (!auth) throw new Error("Auth not configured");
      await createUserWithEmailAndPassword(auth, email, password);
      console.log("✅ Account created successfully");
    },

    async logout() {
      if (!auth) return;
      await signOut(auth);
      console.log("👋 User logged out");
      window.dispatchEvent(new Event("creditsChanged"));
    },
  };

  return <CtxObj.Provider value={api}>{children}</CtxObj.Provider>;
}
