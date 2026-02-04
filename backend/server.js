// ✅ dotenv 必须放在最顶部
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import multer from "multer";
import sharp from "sharp";

// 路由
import checkoutRoutes from "./routes/checkout.js";
import subscriptionStatusRoutes from "./routes/subscription-status.js";
import stripeStatusRoutes from "./routes/stripe-status.js";
import generateRouter from "./routes/generate.js";
import spreadsheetsRouter from "./routes/spreadsheets.js";
import spreadsheetResultsRouter from "./routes/spreadsheetResults.js";
import syncSubscriptionRouter from "./routes/sync-subscription.js";

// Webhook：必须在 express.json 之前注册
import webhookHandler, { rawBodyMiddleware } from "./routes/stripe-webhook.js";

const app = express();
const port = process.env.PORT || 8080;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY in .env");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

/* -----------------------------------------------------
   🔒 安全配置：允许的域名列表
----------------------------------------------------- */
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "https://imageflow-dev.web.app",
  "https://imageflow-dev.firebaseapp.com"
];

/* -----------------------------------------------------
   🔒 Rate Limiting - 防止 API 滥用
   简单的内存实现，生产环境可用 Redis
----------------------------------------------------- */
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 分钟
const RATE_LIMIT_MAX_REQUESTS = 120;  // 每分钟最多 120 次请求

function rateLimiter(req, res, next) {
  // 跳过 webhook（Stripe 需要不受限制）
  if (req.path.includes("webhook")) {
    return next();
  }

  // 用 IP 或 uid 作为标识
  const identifier = req.headers["x-forwarded-for"] || req.ip || "unknown";
  const now = Date.now();

  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, { count: 1, startTime: now });
    return next();
  }

  const record = rateLimitMap.get(identifier);
  
  // 窗口过期，重置
  if (now - record.startTime > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(identifier, { count: 1, startTime: now });
    return next();
  }

  // 超过限制
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ 
      error: "Too many requests, please try again later",
      retryAfter: Math.ceil((RATE_LIMIT_WINDOW - (now - record.startTime)) / 1000)
    });
  }

  record.count++;
  next();
}

// 定期清理过期记录（防止内存泄漏）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap) {
    if (now - value.startTime > RATE_LIMIT_WINDOW * 2) {
      rateLimitMap.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW);

/* -----------------------------------------------------
   1) Stripe Webhook（⚠️ 必须放在 express.json 之前）
   支持多路径：兼容旧版 /api/webhook
----------------------------------------------------- */
app.post("/api/webhook", rawBodyMiddleware, webhookHandler);
app.post("/api/stripe/webhook", rawBodyMiddleware, webhookHandler);
app.post("/api/stripe-webhook", rawBodyMiddleware, webhookHandler);
app.post("/stripe/webhook", rawBodyMiddleware, webhookHandler);

/* -----------------------------------------------------
   2) 全局中间件
----------------------------------------------------- */
// 🔒 CORS - 只允许指定域名
app.use(cors({
  origin: function (origin, callback) {
    // 允许无 origin 的请求（如服务器间调用、Postman 测试）
    // 生产环境可以改为 false 来禁止
    if (!origin) {
      return callback(null, true);
    }
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🚫 CORS blocked origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id"]
}));

// 🔒 Rate Limiting
app.use(rateLimiter);

// 🔒 安全头
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(express.json({ limit: "50mb" }));

/* -----------------------------------------------------
   3) 业务路由
----------------------------------------------------- */
app.use("/api", checkoutRoutes);
app.use("/api", subscriptionStatusRoutes);
app.use("/api", stripeStatusRoutes);
app.use("/api", generateRouter);
app.use("/api", spreadsheetsRouter);
app.use("/api", spreadsheetResultsRouter);
app.use("/api", syncSubscriptionRouter);

/* -----------------------------------------------------
   4) 图片代理 - 绕过防盗链
   用法: /api/image-proxy?url=https://cbu01.alicdn.com/...
   
   安全措施：
   - 只允许 http/https 协议
   - 验证返回的是图片类型
   - 限制图片大小（50MB，支持 4K）
   - Rate Limiting 已在全局中间件中生效
----------------------------------------------------- */
app.get("/api/image-proxy", async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  // 🔒 安全检查：只允许 http/https
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
    return res.status(400).json({ error: "Invalid URL protocol" });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "Referer": "",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch image" });
    }

    const contentType = response.headers.get("content-type");
    
    // 🔒 验证返回的是图片类型
    if (contentType && !contentType.startsWith("image/")) {
      return res.status(400).json({ error: "URL does not return an image" });
    }

    const buffer = await response.arrayBuffer();

    // 🔒 限制图片大小（50MB，支持 4K 图片）
    if (buffer.byteLength > 50 * 1024 * 1024) {
      return res.status(413).json({ error: "Image too large (max 50MB)" });
    }

    res.set({
      "Content-Type": contentType || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*"
    });

    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Image proxy error:", err.message);
    res.status(500).json({ error: "Failed to fetch image" });
  }
});

/* -----------------------------------------------------
   4b) HEIC → JPEG 转换 (iPhone 照片支持)
   Strategy: sharp first → macOS sips fallback
   - sharp: fast, works if libvips has HEIC codec
   - sips: macOS built-in, always supports HEIC natively
----------------------------------------------------- */
import { writeFile, readFile, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
const execFileAsync = promisify(execFile);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

async function convertWithSharp(buffer) {
  const jpegBuffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
  return jpegBuffer;
}

async function convertWithSips(buffer, originalName) {
  // sips is macOS built-in and natively supports HEIC
  const id = Date.now() + "_" + Math.random().toString(36).slice(2);
  const inputPath = join(tmpdir(), `heic_${id}.heic`);
  const outputPath = join(tmpdir(), `heic_${id}.jpg`);

  try {
    await writeFile(inputPath, buffer);
    await execFileAsync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", inputPath, "--out", outputPath]);
    const jpegBuffer = await readFile(outputPath);
    return jpegBuffer;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

app.post("/api/convert-heic", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const sizeMB = (req.file.size / 1024 / 1024).toFixed(1);
    console.log(`🔄 HEIC conversion: ${req.file.originalname} (${sizeMB}MB)`);

    let jpegBuffer;

    // Try 1: sharp (fast, native)
    try {
      jpegBuffer = await convertWithSharp(req.file.buffer);
      console.log(`✅ [sharp] HEIC → JPEG: ${(jpegBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    } catch (sharpErr) {
      console.warn(`⚠️ [sharp] failed: ${sharpErr.message}`);

      // Try 2: sips (macOS built-in, always supports HEIC)
      try {
        jpegBuffer = await convertWithSips(req.file.buffer, req.file.originalname);
        console.log(`✅ [sips] HEIC → JPEG: ${(jpegBuffer.length / 1024 / 1024).toFixed(1)}MB`);
      } catch (sipsErr) {
        console.error(`❌ [sips] also failed: ${sipsErr.message}`);
        throw new Error("HEIC conversion failed with both sharp and sips");
      }
    }

    res.set({
      "Content-Type": "image/jpeg",
      "Content-Length": jpegBuffer.length,
    });
    res.send(jpegBuffer);
  } catch (err) {
    console.error("HEIC conversion error:", err.message);
    res.status(500).json({ error: "Failed to convert image: " + err.message });
  }
});

/* -----------------------------------------------------
   5) Health Check
----------------------------------------------------- */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    stripeKeyLoaded: !!STRIPE_SECRET_KEY,
    frontend: FRONTEND_URL,
    now: new Date().toISOString(),
  });
});

/* -----------------------------------------------------
   6) 404 处理
----------------------------------------------------- */
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

/* -----------------------------------------------------
   7) 全局错误处理
----------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  
  // CORS 错误
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  
  res.status(500).json({ error: "Internal server error" });
});

/* -----------------------------------------------------
   8) 启动服务
----------------------------------------------------- */
app.listen(port, () => {
  console.log(`🚀 Backend running on port ${port}`);
  console.log(`🔒 CORS allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});