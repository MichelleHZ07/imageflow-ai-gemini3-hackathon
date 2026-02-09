import { callGeminiAPI } from "../utils/geminiClient.js";

// 🚀 Gemini Image Generation Models
// Primary: gemini-3-pro-image-preview (high-fidelity, supports up to 14 reference images, 1K/2K/4K)
// Fallback: gemini-2.5-flash-image (faster, cost-effective, 1K only)
// ⚠️ gemini-3-flash-preview is text/reasoning ONLY — cannot generate images
const IMAGE_MODELS = [
  process.env.IMAGE_MODEL || "gemini-3-pro-image-preview",
  process.env.IMAGE_MODEL_FALLBACK || "gemini-2.5-flash-image",
];

// ═══════════════════════════════════════════════════════════
// Gemini REST API image config (inside generationConfig)
// ═══════════════════════════════════════════════════════════
// Official REST field: generationConfig.imageConfig
//   aspectRatio: "1:1"|"2:3"|"3:2"|"3:4"|"4:3"|"4:5"|"5:4"|"9:16"|"16:9"|"21:9"
//   imageSize:   "1K"|"2K"|"4K"
//
// ⚠️ NOT imageGenerationConfig (wrong field name — rejected by API)
// ⚠️ NOT outputImageSize (wrong field name — correct is imageSize)
// Reference: https://ai.google.dev/gemini-api/docs/image-generation

const VALID_ASPECT_RATIOS = new Set([
  "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
]);
const VALID_IMAGE_SIZES = new Set(["1K", "2K", "4K"]);

// Flash model only supports 1K output
const MODEL_MAX_TIER = {
  "gemini-3-pro-image-preview": "4K",
  "gemini-2.5-flash-image": "1K",
};

export async function generateImages({
  prompt,
  mainImages = [],
  mainPhotoB64,
  refImagesB64 = [],
  count = 1,
  skuEnabled = false,
  skuName = "",
  seqDigits = 3,
  imageIndex = 1,
  // Image config options (from frontend via generate.js)
  // Accepts BOTH naming conventions for compatibility:
  //   imageSize:  "1K"|"2K"|"4K"         (Gemini API naming, from original generate.js)
  //   resolution: "1024"|"2048"|"4096"    (pixel naming, from modified generate.js)
  aspectRatio,
  imageSize,
  resolution,   // Alternative to imageSize — will be converted
  width,        // For logging only
  height,       // For logging only
}) {
  // Normalize: accept whichever parameter was provided
  const effectiveImageSize = imageSize || resolution;

  console.log(`\n[generateImages] Starting`);
  console.log(`   Main images = ${mainImages.length || (mainPhotoB64 ? 1 : 0)} | Ref images = ${refImagesB64.length} | Count = ${count}`);
  console.log(`   SKU: enabled=${skuEnabled}, name=${skuName}, digits=${seqDigits}, startIndex=${imageIndex}`);
  console.log(`   Output: aspectRatio=${aspectRatio}, imageSize=${effectiveImageSize}, dimensions=${width}×${height}`);

  // Validate and build imageConfig for API
  const imageConfig = buildImageConfig(aspectRatio, effectiveImageSize);
  if (imageConfig) {
    console.log(`   🖼️ API ImageConfig: ${JSON.stringify(imageConfig)}`);
  }

  // Safety settings
  const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
  ];

  // Helper functions
  const parseDataUriOrB64 = (input) => {
    if (!input) return [null, null];
    if (input.startsWith("data:")) {
      const [head, data] = input.split("base64,");
      const mime = head?.slice(5, head.indexOf(";")) || "image/png";
      return [mime, data];
    }
    return ["image/png", input];
  };

  const pushImage = (parts, b64) => {
    if (!b64) return;
    const [mime, data] = parseDataUriOrB64(b64);
    if (!data) return;
    parts.push({ inline_data: { mime_type: mime || "image/png", data } });
  };

  // Build parts
  const allMain =
    Array.isArray(mainImages) && mainImages.length > 0
      ? mainImages
      : mainPhotoB64
      ? [mainPhotoB64]
      : [];

  const refs = Array.isArray(refImagesB64) ? refImagesB64 : [];

  const desc =
    "Generate a high-quality, realistic product or fashion image based on the provided visual and textual references. " +
    "Use provided images as visual anchors for consistency (same model, same product). " +
    "Keep the product as the main focus with professional lighting and natural background." +
    "Follow the textual prompt carefully.";

  const finalText = `${desc}\n\n${prompt}`;
  const parts = [{ text: finalText }];

  for (const img of allMain) pushImage(parts, img);
  for (const ref of refs) pushImage(parts, ref);

  console.log("===============================================");
  console.log(`[Gemini Prompt] main=${allMain.length}, ref=${refs.length}`);
  console.log("Prompt:");
  console.log(finalText);
  console.log(`Attached images: ${allMain.length + refs.length}`);
  console.log("===============================================");

  // Multiple image generation tasks
  const generationTasks = [];
  for (let i = 0; i < count; i++) {
    generationTasks.push(runModelWithFallback(parts, safetySettings, i + 1, imageConfig));
  }

  const results = await Promise.allSettled(generationTasks);
  let allImages = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);

  if (allImages.length === 0)
    throw new Error("No images generated from any tasks");

  // Truncate to requested count
  if (allImages.length > count) {
    console.log(`[generateImages] Truncating ${allImages.length} images to requested ${count}`);
    allImages = allImages.slice(0, count);
  }

  console.log(`[generateImages] Total generated images: ${allImages.length}`);

  // Apply SKU naming to images
  if (skuEnabled && skuName) {
    return allImages.map((image, idx) => {
      console.log(`Applied SKU base name: ${skuName}`);
      return {
        dataUrl: image,
        filename: null,
        skuName: skuName,
      };
    });
  }

  return allImages.map(image => ({ dataUrl: image }));
}

// ── Build and validate imageConfig for Gemini REST API ──
// Returns { aspectRatio, imageSize } or null
function buildImageConfig(aspectRatio, imageSize) {
  const config = {};
  let hasConfig = false;

  if (aspectRatio) {
    const normalized = aspectRatio.trim();
    if (VALID_ASPECT_RATIOS.has(normalized)) {
      config.aspectRatio = normalized;
      hasConfig = true;
    } else {
      console.warn(`[imageGenerator] ⚠️ Invalid aspectRatio "${aspectRatio}", ignored. Valid: ${[...VALID_ASPECT_RATIOS].join(", ")}`);
    }
  }

  if (imageSize) {
    // Normalize: accept both "4K" and "4096" formats
    const normalized = String(imageSize).trim().toUpperCase();
    const sizeMap = { "1K": "1K", "2K": "2K", "4K": "4K", "1024": "1K", "2048": "2K", "4096": "4K" };
    const resolved = sizeMap[normalized] || null;

    if (resolved && VALID_IMAGE_SIZES.has(resolved)) {
      config.imageSize = resolved;
      hasConfig = true;
    } else {
      console.warn(`[imageGenerator] ⚠️ Invalid imageSize "${imageSize}", ignored. Valid: 1K, 2K, 4K (or 1024, 2048, 4096)`);
    }
  }

  return hasConfig ? config : null;
}

// ── Clamp imageSize for models with lower max resolution ──
function clampImageSize(imageConfig, model) {
  if (!imageConfig?.imageSize) return imageConfig;

  const maxTier = MODEL_MAX_TIER[model] || "1K";
  const tierOrder = ["1K", "2K", "4K"];
  const requestedIdx = tierOrder.indexOf(imageConfig.imageSize);
  const maxIdx = tierOrder.indexOf(maxTier);

  if (requestedIdx > maxIdx) {
    console.log(`[gemini] ⚠️ Resolution clamped: ${imageConfig.imageSize} → ${maxTier} for ${model}`);
    return { ...imageConfig, imageSize: maxTier };
  }
  return imageConfig;
}

// ── Actual model call with fallback ──
async function runModelWithFallback(parts, safetySettings, index = 1, imageConfig = null) {
  const systemText =
    "You are a professional visual artist and product photographer. " +
    "Use all attached images as visual reference. Keep the product appearance consistent. " +
    "If the reference shows a person/model, maintain their appearance. If product-only, do not add people.";

  for (const model of IMAGE_MODELS) {
    // Clamp resolution for Flash model (1K only)
    const effectiveConfig = clampImageSize(imageConfig, model);

    // Build generationConfig with correct REST API field names
    const generationConfig = {
      temperature: 0.9,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 8192,
    };

    // ✅ Correct REST API format: generationConfig.imageConfig
    //    (NOT imageGenerationConfig — that gets rejected)
    if (effectiveConfig) {
      generationConfig.responseModalities = ["TEXT", "IMAGE"];
      generationConfig.imageConfig = effectiveConfig;
    }

    const body = {
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts }],
      generationConfig,
      safetySettings,
    };

    try {
      console.log(`[gemini] (${index}) Using model: ${model}`);
      if (effectiveConfig) {
        console.log(`[gemini] (${index}) ImageConfig: ${JSON.stringify(effectiveConfig)}`);
      }
      const resp = await callGeminiAPI(model, body);

      const images = [];
      for (const cand of resp?.candidates || []) {
        for (const p of cand?.content?.parts || []) {
          const inline = p?.inlineData || p?.inline_data;
          const data = inline?.data;
          const mime = inline?.mimeType || inline?.mime_type;
          if (data && /^image\//.test(mime || "")) {
            images.push(`data:${mime || "image/png"};base64,${data}`);
          }
        }
      }

      if (images.length) return images;
    } catch (e) {
      console.warn(`[imageGenerator] Model ${model} failed:`, e?.message || e);
    }
  }

  throw new Error("Gemini API call failed");
}