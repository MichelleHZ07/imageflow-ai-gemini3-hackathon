// frontend/src/lib/imageProxy.ts

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

/**
 * 需要代理的域名列表（防盗链）
 */
const PROXY_DOMAINS = [
  "alicdn.com",
  "1688.com",
  "taobao.com",
  "tbcdn.com",
  "tmall.com",
  "aliyuncs.com",
  "cbu01.alicdn.com",
];

/**
 * 检查 URL 是否需要代理
 */
export function needsProxy(url: string): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return PROXY_DOMAINS.some((domain) => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * 获取图片 URL（如需要则通过代理）
 * @param url 原始图片 URL
 * @returns 处理后的图片 URL
 */
export function getProxiedImageUrl(url: string): string {
  if (!url) return "";
  
  // 已经是代理 URL，直接返回
  if (url.includes("/api/image-proxy")) {
    return url;
  }
  
  // 需要代理的域名
  if (needsProxy(url)) {
    return `${API_BASE}/api/image-proxy?url=${encodeURIComponent(url)}`;
  }
  
  // 不需要代理，直接返回
  return url;
}

/**
 * 用于 CSS background-image 的 URL
 */
export function getProxiedBackgroundUrl(url: string): string {
  return getProxiedImageUrl(url);
}