// backend/utils/geminiClient.js
import { GoogleAuth } from "google-auth-library";

const GENERATIVE_SCOPE = "https://www.googleapis.com/auth/generative-language";
const DEFAULT_VERSION = process.env.GEMINI_API_VERSION || "v1beta";
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GEMINI_HTTP_TIMEOUT_MS || "60000", 10);
const MAX_RETRIES = parseInt(process.env.GEMINI_HTTP_RETRIES || "3", 10);

// ===== 🔹 内存缓存（避免重复调用） =====
const CACHE = new Map();
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 分钟有效期

// GoogleAuth for Service Account
const auth = new GoogleAuth({ scopes: [GENERATIVE_SCOPE] });

// 解析计费项目：优先使用 Project Number
async function resolveUserProject() {
  const number = process.env.GOOGLE_CLOUD_PROJECT_NUMBER || process.env.PROJECT_NUMBER;
  const id =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.PROJECT_ID;

  if (number && /^\d+$/.test(number)) return String(number);
  if (id) return id;

  try {
    const pid = await auth.getProjectId();
    return pid || null;
  } catch {
    return null;
  }
}

// 拿 OAuth 访问令牌
async function getAccessToken() {
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain OAuth access token from service account");
  return token;
}

// 带重试机制的 fetch
async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(to);

    // 429 / 5xx 处理
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const delay = (2 ** (MAX_RETRIES - retries)) * 250 + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    return res;
  } catch (err) {
    clearTimeout(to);
    if (retries > 0) {
      const delay = (2 ** (MAX_RETRIES - retries)) * 250 + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

/**
 * 🔹 调用 Gemini（Generative Language API）
 * @param {string} model e.g. 'gemini-2.5-flash' | 'gemini-2.5-flash-image'
 * @param {object} body generateContent payload
 * @param {object} opts optional { version?: string, userProject?: string, enableCache?: boolean }
 */
export async function callGeminiAPI(model, body, opts = {}) {
  // 🚨 CACHE COMPLETELY DISABLED by default for fresh results
  const enableCache = opts.enableCache === true;
  
  if (!enableCache) {
    console.log(`🔄 [fresh-call] ${model} - cache disabled for unique results`);
  }

  // ===== 🔐 凭证与 Header =====
  const [token, userProjectAuto] = await Promise.all([getAccessToken(), resolveUserProject()]);
  const version = opts.version || DEFAULT_VERSION;
  const endpoint = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;

  console.log(`[gemini] model = ${model} version = ${version}`);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const userProject = opts.userProject || userProjectAuto;
  if (userProject) headers["X-Goog-User-Project"] = String(userProject);

  // ===== ⚙️ Set safe defaults for generationConfig =====
  // Only apply defaults if no generationConfig provided
  // If caller provides generationConfig, use it as-is
  if (!body.generationConfig) {
    body.generationConfig = {
      temperature: 0.8,
      topP: 0.9,
      maxOutputTokens: 1500, // Increased from 400 to prevent truncation
    };
  }
  // If generationConfig exists but missing maxOutputTokens, add a safe default
  else if (body.generationConfig && !body.generationConfig.maxOutputTokens) {
    body.generationConfig.maxOutputTokens = 1500;
  }
  
  // Debug: Log actual generationConfig being sent
  console.log(`[gemini] generationConfig:`, JSON.stringify(body.generationConfig));

  const res = await fetchWithRetry(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  // ===== 🚨 错误处理 =====
  if (!res.ok || data?.error) {
    const errObj = data?.error || {};
    const message = errObj.message || `HTTP ${res.status} ${res.statusText}`;
    const code = errObj.status || res.status;

    if (/USER_PROJECT_DENIED|PERMISSION_DENIED/.test(message)) {
      throw new Error(
        `${message}. Ensure the service account has 'Service Usage Consumer' role and X-Goog-User-Project header is set (${userProject || "unset"}).`
      );
    }

    throw new Error(`Gemini API error: ${code} ${message}`);
  }

  // ===== 🟢 写入缓存（仅在启用时） =====
  if (enableCache) {
    const key = JSON.stringify({ model, body });
    const now = Date.now();
    CACHE.set(key, { time: now, data });
    console.log(`💾 [cached] ${model}`);
  }
  
  return data;
}

/** 列出可用模型（调试用） */
export async function listModels(opts = {}) {
  const [token, userProject] = await Promise.all([getAccessToken(), resolveUserProject()]);
  const version = opts.version || DEFAULT_VERSION;
  const url = `https://generativelanguage.googleapis.com/${version}/models`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(userProject ? { "X-Goog-User-Project": String(userProject) } : {}),
    },
  });
  if (!res.ok) throw new Error(`List models failed: ${res.status} ${res.statusText}`);
  return res.json();
}