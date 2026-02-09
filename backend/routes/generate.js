import { Router } from "express";
import crypto from "crypto";
import { generateImages } from "../services/imageGenerator.js";
import { expandPromptWithAI } from "../services/promptExpander.js";
import { updateUserCredits, addGeneration } from "../services/userStore.js";
import { uploadGeneratedImagesToStorage } from "../services/cdnUploadService.js"; // CDN 图片上传
import admin from "firebase-admin";

const router = Router();
const db = admin.firestore();

// ============ SSE Progress Support ============
const STAGES = {
  UNDERSTANDING: 'understanding',
  PLANNING: 'planning',
  GENERATING: 'generating',
  TEXT_COMPLETE: 'text_complete',  // Text generation complete (before images)
  UPLOADING: 'uploading',
  COMPLETE: 'complete',
  ERROR: 'error'
};

function sendProgress(res, stage, data = {}) {
  if (!res || res.writableEnded) return;
  const event = {
    type: 'progress',
    stage,
    timestamp: Date.now(),
    ...data
  };
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  console.log(`[Progress] ${stage}`, data.message || '');
}

function sendResult(res, result) {
  if (!res || res.writableEnded) return;
  const event = {
    type: 'result',
    timestamp: Date.now(),
    ...result
  };
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
}
// ============ End SSE Support ============

function clip(text = "", max = 220) {
  const t = String(text);
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

/**
 * Calculate MD5 hash of image data for debugging
 * Uses first 2000 chars of base64 to detect if same image is being sent
 */
function calcImageHash(base64Data) {
  if (!base64Data) return "empty";
  // Use first 2000 chars for quick hash (enough to detect different images)
  const sample = base64Data.substring(0, 2000);
  return crypto.createHash('md5').update(sample).digest('hex').substring(0, 12);
}

/**
 * Log generation request details for debugging
 */
function logGenerationRequest(prompt, mainImages, requestId) {
  console.log(`\n[Generate] ========== Request ${requestId} ==========`);
  console.log(`[Generate] Full prompt:\n${prompt}`);
  console.log(`[Generate] Image hashes (${mainImages.length} images):`);
  mainImages.forEach((img, i) => {
    const hash = calcImageHash(img);
    const size = img ? Math.round(img.length / 1024) : 0;
    console.log(`  [${i}] hash=${hash}, size=${size}KB`);
  });
  console.log(`[Generate] ==========================================\n`);
}

// P1b: Helper to strip HTML tags
function stripHtml(input = "") {
  return String(input).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Resolve product category from spreadsheet
 * If not available, return "product" and let AI identify from images
 */
function resolveCategory(productCategory, productInfo) {
  // 1. Category from spreadsheet
  if (productInfo?.category?.trim()) {
    console.log(`[resolveCategory] Using spreadsheet category: ${productInfo.category}`);
    return productInfo.category.trim();
  }
  
  // 2. Default - AI will identify from images
  console.log("[resolveCategory] Using default: product (AI will identify from images)");
  return "product";
}

/**
 * Build compact product context for descriptions prompt
 * Prioritizes essential info and truncates to fit within maxChars
 */
function buildCompactProductContext({
  category,
  skuName = "",
  productInfo = null,
  maxChars = 900,
}) {
  const linesPrimary = [];   // Must keep - highest priority
  const linesSecondary = []; // Add if space allows

  const title = (productInfo && productInfo.title) || category || "";
  const brand = (productInfo && productInfo.vendor) || "";
  const productSku = (productInfo && productInfo.sku) || skuName || "";
  const attrs = (productInfo && productInfo.attributes) || {};
  const tags = productInfo && Array.isArray(productInfo.tags)
    ? productInfo.tags.join(", ")
    : "";

  // --- Primary info: always keep ---
  if (category) {
    linesPrimary.push(`Product category: ${clip(category, 80)}`);
  }
  if (title && title !== category) {
    linesPrimary.push(`Product name: ${clip(title, 140)}`);
  }
  if (brand) {
    linesPrimary.push(`Brand/Vendor: ${clip(brand, 80)}`);
  }
  if (productSku) {
    linesPrimary.push(`SKU: ${clip(productSku, 80)}`);
  }

  const attrParts = [];
  if (attrs.color) attrParts.push(`color=${clip(attrs.color, 30)}`);
  if (attrs.material) attrParts.push(`material=${clip(attrs.material, 40)}`);
  if (attrs.size) attrParts.push(`size=${clip(attrs.size, 40)}`);
  if (attrs.style) attrParts.push(`style=${clip(attrs.style, 40)}`);
  if (attrParts.length > 0) {
    linesPrimary.push(`Attributes: ${attrParts.join(", ")}`);
  }

  // --- Secondary info: add if space allows ---
  if (tags) {
    linesSecondary.push(`Tags: ${clip(tags, 200)}`);
  }

  if (productInfo && productInfo.seoDescription) {
    linesSecondary.push(
      `Existing SEO (shortened): ${clip(stripHtml(productInfo.seoDescription), 220)}`
    );
  }

  if (productInfo && productInfo.description) {
    linesSecondary.push(
      `Product description (shortened): ${clip(stripHtml(productInfo.description), 260)}`
    );
  }

  // --- Assemble & control total length ---
  const allLines = [];

  // Add primary lines first
  for (const line of linesPrimary) {
    allLines.push(line);
  }

  let context = allLines.join("\n");
  if (context.length >= maxChars) {
    return context.slice(0, maxChars) + "\n(Truncated product info.)";
  }

  // Add secondary lines if space allows
  for (const line of linesSecondary) {
    const candidate = context + "\n" + line;
    if (candidate.length > maxChars) {
      const remaining = maxChars - context.length - 1;
      if (remaining > 40) {
        context = context + "\n" + line.slice(0, remaining) + " ...(truncated)";
      }
      return context;
    }
    context = candidate;
  }

  return context;
}

/**
 * Build safe descriptions prompt with length control
 * Prioritizes instructions/rules, truncates product context if needed
 */
function buildSafeDescriptionsPrompt({
  header,
  productContext,
  rules,
  maxChars = 4200,
}) {
  const h = header.trim();
  const p = (productContext || "").trim();
  const r = rules.trim();

  let totalLen = h.length + (p ? p.length + 4 : 0) + r.length;

  if (totalLen <= maxChars) {
    return [h, p, r].filter(Boolean).join("\n\n");
  }

  // Total exceeds limit: prioritize header + rules, compress productContext
  const reserved = h.length + r.length + 4;
  let availableForProduct = maxChars - reserved;

  let safeProduct = p;

  if (availableForProduct <= 0) {
    // Extreme case: even rules don't fit
    const safeHeader = h.slice(0, 800);
    const safeRules = r.slice(0, 800);
    return [
      safeHeader,
      "(Product info truncated due to length.)",
      safeRules + "\n(Instructions truncated.)",
    ].join("\n\n");
  }

  if (p && p.length > availableForProduct) {
    safeProduct = p.slice(0, availableForProduct - 40) + "\n(Truncated product info for length.)";
  }

  return [h, safeProduct, r].filter(Boolean).join("\n\n");
}

// P1b: Platform display names
const PLATFORM_NAMES = {
  shopify: "Shopify",
  amazon: "Amazon",
  ebay: "eBay",
  etsy: "Etsy",
  walmart: "Walmart",
  aliexpress: "AliExpress",
  tiktok: "TikTok Shop",
  instagram: "Instagram Shop",
  facebook: "Facebook Marketplace",
  google_shopping: "Google Shopping",
  pinterest: "Pinterest",
  generic: "Generic E-commerce",
};

/**
 * P2: Platform-specific character limits and constraints (updated 2025)
 */
function getPlatformLimits(platform) {
  const limits = {
    shopify:         { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 70,  seoWords: '100-200', maxTags: '5-15', tagNotes: 'Use Shopify collection-compatible terms.' },
    amazon:          { metaTitleChars: 150, metaDescChars: 155, seoTitleChars: 150, seoWords: '150-200', maxTags: '5-10', tagNotes: 'Amazon: NO brand name in tags (already indexed). Each tag = unique search phrase.' },
    ebay:            { metaTitleChars: 80, metaDescChars: 155, seoTitleChars: 80,  seoWords: '100-150', maxTags: '5-12', tagNotes: 'Include item specifics: brand, MPN, condition.' },
    etsy:            { metaTitleChars: 60, metaDescChars: 160, seoTitleChars: 140, seoWords: '150-200', maxTags: '13',   tagNotes: 'Etsy: Use ALL 13 tag slots. Multi-word phrases (e.g., "gift for mom" not "gift"). Include style + occasion + recipient terms.' },
    walmart:         { metaTitleChars: 75, metaDescChars: 155, seoTitleChars: 75,  seoWords: '100-150', maxTags: '5-10', tagNotes: '' },
    aliexpress:      { metaTitleChars: 128, metaDescChars: 155, seoTitleChars: 128, seoWords: '100-200', maxTags: '5-10', tagNotes: 'Simple English for international buyers.' },
    tiktok:          { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 60,  seoWords: '80-120',  maxTags: '5-10', tagNotes: 'Include trending/viral terms where authentic.' },
    instagram:       { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 60,  seoWords: '80-150',  maxTags: '5-15', tagNotes: 'Include aesthetic/lifestyle hashtag-friendly terms.' },
    facebook:        { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 60,  seoWords: '80-120',  maxTags: '5-10', tagNotes: '' },
    google_shopping: { metaTitleChars: 150, metaDescChars: 155, seoTitleChars: 150, seoWords: '100-150', maxTags: '5-10', tagNotes: 'Use Google Product Category terms.' },
    pinterest:       { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 100, seoWords: '100-150', maxTags: '5-15', tagNotes: 'Include seasonal, event, and inspiration terms.' },
    generic:         { metaTitleChars: 60, metaDescChars: 155, seoTitleChars: 80,  seoWords: '80-120',  maxTags: '5-15', tagNotes: '' },
  };
  return limits[platform] || limits.generic;
}

/**
 * P2: Platform tone directive — SHORT, prominent instruction injected at prompt top
 * This is the KEY differentiator between platforms in the unified prompt
 */
function getPlatformToneDirective(platform) {
  const tones = {
    shopify: `PLATFORM: Shopify (DTC store). TONE: Warm, brand-friendly, customer-centric. Write like a boutique brand storyteller. Use natural language for Google SEO — no keyword stuffing. Include long-tail search phrases.`,
    
    amazon: `PLATFORM: Amazon. TONE: Factual, benefit-driven, spec-focused. Write like a product data sheet that sells. Front-load top keywords in first sentence. NO promotional language, NO "best seller/free shipping/satisfaction guaranteed", NO emojis or special chars (!, $, ?). Include exact specs: dimensions, weight, material. Structure for bullet-point extraction.`,
    
    ebay: `PLATFORM: eBay. TONE: Straightforward, detail-oriented, trustworthy. Write like a knowledgeable seller. Include condition terms, exact item specifics (brand, model, MPN), compatibility info. Mention shipping-relevant details.`,
    
    etsy: `PLATFORM: Etsy. TONE: Personal, artisanal, story-driven. Write like a craftsperson describing their creation. Emphasize uniqueness, handmade quality, materials, techniques. Include style aesthetics (boho, minimalist, cottagecore). Use gifting language ("perfect gift for her"). Front-load the most descriptive phrase in the first 40 characters.`,
    
    walmart: `PLATFORM: Walmart. TONE: Practical, value-oriented, family-friendly. Write like a helpful store associate. Focus on everyday use cases, value proposition, and practical benefits. Clear, no-frills language.`,
    
    aliexpress: `PLATFORM: AliExpress. TONE: Specification-focused, clear, internationally accessible. Write for NON-native English speakers — simple sentences, no idioms. Include exact measurements in both cm/inches, weight in g/oz. Mention size chart, color accuracy, material composition.`,
    
    tiktok: `PLATFORM: TikTok Shop. TONE: Short, punchy, trend-aware. Write like a viral product caption. Keep descriptions BRIEF (80-120 words max). Use casual, Gen-Z-friendly language where appropriate ("aesthetic", "must-have", "obsessed"). Hook the reader in the first line. Focus on visual/experiential appeal.`,
    
    instagram: `PLATFORM: Instagram Shop. TONE: Aspirational, lifestyle-driven, visually evocative. Write like a lifestyle brand post. Describe how the product fits into the customer's life. Include styling suggestions. Use hashtag-friendly terms naturally (minimalist, handmade, sustainable).`,
    
    facebook: `PLATFORM: Facebook Marketplace. TONE: Conversational, honest, community-oriented. Write like you're describing the product to a neighbor. Include condition, dimensions, practical details. Quick-fact format, 80-120 words.`,
    
    google_shopping: `PLATFORM: Google Shopping. TONE: Precise, attribute-rich, structured. Write for machine readability and comparison shopping. Include brand, GTIN/MPN, exact product type, color, size, material. Use Google Product Category taxonomy terms. Specificity wins: "Women's 14K Gold-Plated Sterling Silver Tennis Bracelet" not "Gold Bracelet".`,
    
    pinterest: `PLATFORM: Pinterest. TONE: Inspirational, aspirational, planning-oriented. Write for dreamers and planners. Include "inspiration", "how to style", seasonal/event terms (wedding, holiday, home makeover). Make the reader want to save/pin this for later.`,
    
    generic: `PLATFORM: Generic e-commerce. TONE: Professional, balanced, SEO-friendly. Write clear product descriptions with natural keyword inclusion.`,
  };
  return tones[platform] || tones.generic;
}

export async function handleGenerateRequest(req, res) {
  let deducted = false;
  let usedCredits = 0;
  const totalStartTime = Date.now(); // Track total generation time

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const {
      uid,
      workMode = "import",
      productCategory,
      mainPrompt = "",
      variations = [],
      mainPhotosB64,
      mainPhotoB64,
      refImagesB64 = [],
      genStrategy = "auto",
      genCount: rawCount = 1,
      seoEnabled = false,
      geoEnabled = false,
      gsoEnabled = false,
      // Phase 2: Additional generatable fields
      tagsEnabled = false,
      metaTitleEnabled = false,
      metaDescriptionEnabled = false,
      seoTitleEnabled = false,
      // Custom fields with enableGeneration
      customFieldsEnabled = {},
      // P1b: Platform selections
      seoPlatform = "generic",
      geoPlatform = "generic",
      gsoPlatform = "generic",
      contentPlatform = "generic",  // Platform for custom field generation
      skuEnabled = false,
      skuMode = "rule",
      skuName = "",
      seqDigits = 3,
      // P1a: Accept spreadsheetContext from request
      spreadsheetContext,
      // 🆕 Output settings (Gemini 3 image generation)
      aspectRatio,    // "1:1" | "3:4" | "16:9" etc.
      resolution,     // "1024" | "2048" | "4096"
      width,          // Computed pixel width
      height,         // Computed pixel height
    } = req.body || {};

    // Debug: Log received resolution
    console.log(`[Generate] Received resolution: ${resolution}, aspectRatio: ${aspectRatio}, width: ${width}, height: ${height}`);

    // Check if user is logged in
    if (!uid) {
      return sendResult(res, {
        success: false,
        code: "MISSING_USER_ID",
        error: "Missing user ID. Please sign in first.",
      });
    }

    // Initialize user document
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    let currentCredits = 0;

    if (!userSnap.exists) {
      // New user initialization
      await userRef.set({
        credits: 40,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      currentCredits = 40;
      console.log(`[Generate] Initialized new user ${uid} with 40 credits`);
    } else {
      const data = userSnap.data();
      currentCredits = typeof data.credits === "number" ? data.credits : 0;
    }

    // ✅ Allow genCount=0 for text-only generation (descriptions without images)
    const genCount = Math.max(0, Number(rawCount) || 0);
    const mainImages = Array.isArray(mainPhotosB64)
      ? mainPhotosB64
      : mainPhotoB64
      ? [mainPhotoB64]
      : [];

    // Extract productInfo for category resolution
    const productInfo = spreadsheetContext?.productInfo || null;
    
    // Resolve category: user input → spreadsheet → infer from title → default
    const resolvedCategory = resolveCategory(productCategory, productInfo);
    console.log(`[Generate] Resolved category: "${resolvedCategory}" (input: "${productCategory || 'none'}", spreadsheet: "${productInfo?.category || 'none'}")`);

    // Validate parameters - category is now auto-resolved, only validate images
    if (mainImages.length === 0) {
      return sendResult(res, {
        success: false,
        code: "MISSING_MAIN_IMAGE",
        error: "At least one main product image is required",
      });
    }

    // ✅ Check if any description is enabled (for text-only mode validation)
    const anyCustomFieldEnabled = Object.values(customFieldsEnabled || {}).some(v => v === true);
    const anyDescriptionEnabled = seoEnabled || geoEnabled || gsoEnabled || 
                                  tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled ||
                                  anyCustomFieldEnabled;

    // ✅ Validate: if genCount=0 (text-only), must have at least one description enabled
    if (genCount === 0 && !anyDescriptionEnabled) {
      return sendResult(res, {
        success: false,
        code: "MISSING_PROMPT",
        error: "Please provide a prompt to generate images, or enable Product Descriptions for text-only generation.",
      });
    }

    console.log(`[Generate] Request from ${uid}: ${genCount} images, ${mainImages.length} main, ${refImagesB64.length} refs`);
    console.log(`[Generate] SEO: ${seoEnabled} (${seoPlatform}) | GEO: ${geoEnabled} (${geoPlatform}) | GSO: ${gsoEnabled} (${gsoPlatform})`);

    // 🔍 DEBUG: Log detailed info about received images
    console.log(`[Generate] 🔍 mainImages data check:`);
    mainImages.forEach((img, i) => {
      const len = img?.length || 0;
      const prefix = img?.substring ? img.substring(0, 80) : 'NOT_A_STRING';
      const isValidBase64 = img?.startsWith?.('data:image/');
      console.log(`  [${i}] length=${len}, valid=${isValidBase64}, prefix=${prefix}`);
    });

    // P1a: Log spreadsheetContext if present
    if (spreadsheetContext) {
      console.log("[Generate] spreadsheetContext:", {
        templateId: spreadsheetContext.templateId,
        rowMode: spreadsheetContext.rowMode,
        productKey: spreadsheetContext.productKey,
        sourceRowIndices: spreadsheetContext.sourceRowIndices?.length || 0,
        selectedImageUrls: spreadsheetContext.selectedImageUrls?.length || 0,
        hasProductInfo: !!spreadsheetContext.productInfo,
      });
    }

    // Calculate cost for descriptions (1 product unit since we batch)
    const productCount = (seoEnabled || geoEnabled || gsoEnabled || tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled) && mainImages.length > 0 ? 1 : 0;
    
    // Credit calculation
    const costPerImage = 10;  // Base cost per generated image
    const seoCost = seoEnabled ? productCount * 20 : 0;  // 20 credits per product for SEO
    const geoCost = geoEnabled ? productCount * 40 : 0;  // 40 credits per product for GEO
    const gsoCost = gsoEnabled ? productCount * 30 : 0;  // 30 credits per product for GSO
    // Phase 2: Additional field costs
    const tagsCost = tagsEnabled ? productCount * 10 : 0;  // 10 credits for tags
    const metaTitleCost = metaTitleEnabled ? productCount * 5 : 0;  // 5 credits for meta title
    const metaDescCost = metaDescriptionEnabled ? productCount * 5 : 0;  // 5 credits for meta description
    const seoTitleCost = seoTitleEnabled ? productCount * 5 : 0;  // 5 credits for SEO title
    const skuCost = skuEnabled ? 20 : 0;  // 20 credits for SKU naming

    usedCredits = genCount * costPerImage + seoCost + geoCost + gsoCost + tagsCost + metaTitleCost + metaDescCost + seoTitleCost + skuCost;

    console.log(`[Generate] Credit breakdown: Images(${genCount * costPerImage}) + SEO(${seoCost}) + GEO(${geoCost}) + GSO(${gsoCost}) + Tags(${tagsCost}) + MetaTitle(${metaTitleCost}) + MetaDesc(${metaDescCost}) + SeoTitle(${seoTitleCost}) + SKU(${skuCost}) = ${usedCredits}`);

    // Check credits
    if (currentCredits < usedCredits) {
      console.log(`[Generate] Insufficient credits: has ${currentCredits}, needs ${usedCredits}`);
      return sendResult(res, {
        success: false,
        code: "INSUFFICIENT_CREDITS",
        error: `Not enough credits. You have ${currentCredits} but need ${usedCredits}.`,
      });
    }

    // Deduct credits
    const newCredits = Math.max(0, currentCredits - usedCredits);
    await userRef.set(
      { credits: newCredits, updatedAt: Date.now() },
      { merge: true }
    );
    deducted = true;
    console.log(`[Generate] Deducted ${usedCredits} credits from ${uid}. Remaining: ${newCredits}`);

    // ════════════════════════════════════════════════════════════
    // NOTE: Frontend will simulate understanding/planning/generating stages
    // Backend only sends UPLOADING and COMPLETE signals
    // ════════════════════════════════════════════════════════════

    // Generate descriptions ONCE before image generation loop
    // Phase 2: Extended descriptions object
    let descriptions = {
      seo: null,
      geo: null,
      gso: null,
      tags: null,
      meta_title: null,
      meta_description: null,
      seo_title: null,
    };

    // Start description generation in parallel with image generation prep
    let descriptionPromise = null;
    let descriptionStartTime = null;
    
    // Phase 2: Check if any content generation is enabled
    const anyContentEnabled = seoEnabled || geoEnabled || gsoEnabled || tagsEnabled || metaTitleEnabled || metaDescriptionEnabled || seoTitleEnabled;
    
    if (anyContentEnabled) {
      console.log(`\n[Generate] Starting product descriptions generation...`);
      console.log(`[Generate] Enabled fields: SEO=${seoEnabled}, GEO=${geoEnabled}, GSO=${gsoEnabled}, Tags=${tagsEnabled}, MetaTitle=${metaTitleEnabled}, MetaDesc=${metaDescriptionEnabled}, SeoTitle=${seoTitleEnabled}`);
      descriptionStartTime = Date.now();
      
      if (productInfo) {
        console.log(`[Generate] Using productInfo from spreadsheet:`, {
          title: productInfo.title ? clip(productInfo.title, 50) : null,
          category: productInfo.category,
          sku: productInfo.sku,
          hasDescription: !!productInfo.description,
          hasSeoTitle: !!productInfo.seoTitle,
          hasSeoDescription: !!productInfo.seoDescription,
          tagsCount: productInfo.tags?.length || 0,
          vendor: productInfo.vendor,
          attributes: productInfo.attributes,
        });
      }
      
      // P1b OPTIMIZATION: Generate all descriptions in ONE API call
      descriptionPromise = generateAllDescriptions({
        category: resolvedCategory,
        productCount,
        mainImages,
        skuName,
        productInfo,
        seoEnabled,
        geoEnabled,
        gsoEnabled,
        // Phase 2: Additional fields
        tagsEnabled,
        metaTitleEnabled,
        metaDescriptionEnabled,
        seoTitleEnabled,
        // Custom fields with enableGeneration
        customFieldsEnabled,
        seoPlatform,
        geoPlatform,
        gsoPlatform,
        contentPlatform,
      }).then(result => {
        const descTime = ((Date.now() - descriptionStartTime) / 1000).toFixed(2);
        console.log(`[Generate] ⏱️ Descriptions completed in ${descTime}s`);
        
        // Send text_complete immediately when descriptions are ready
        sendProgress(res, STAGES.TEXT_COMPLETE, {
          message: 'Text generation complete',
          descriptions: result
        });
        
        return result;
      }).catch(error => {
        console.error(`[Generate] Description generation error:`, error.message);
        return { seo: null, geo: null, gso: null, tags: null, meta_title: null, meta_description: null, seo_title: null };
      });
    }

    // Small delay to ensure understanding stage is visible
    await new Promise(resolve => setTimeout(resolve, 800));

    const results = [];
    let imageIndex = 1; // For sequential numbering
    const imageStartTime = Date.now(); // Track image generation time

    // ✅ Text-only mode: skip image generation if genCount=0
    if (genCount === 0) {
      console.log("[Generate] Text-only mode: skipping image generation (genCount=0)");
      // No images to generate, just wait for descriptions
    } else if (genStrategy === "auto" && genCount > 1) {
      console.log("[Generate] AutoPrompt - Expanding via intelligent mode...");
      // ✅ Pass mainImages so AI can SEE the product for better scene generation
      const { prompts: autoVariants = [], error: expandError } =
        await expandPromptWithAI(mainPrompt, resolvedCategory, genCount, mainImages);

      if (expandError || autoVariants.length < genCount) {
        return sendResult(res, {
          success: false,
          code: "PROMPT_EXPANSION_FAILED",
          error: expandError || "Failed to expand prompts",
        });
      }

      // 🚀 Parallel generation for speed - all variants generated simultaneously
      const parallelResults = await Promise.all(
        autoVariants.map(async (variant, i) => {
          const finalPrompt = buildPrompt(resolvedCategory, mainPrompt, variant);
          const currentImageIndex = imageIndex + i; // Pre-calculate index
          
          // 🔍 Debug: Log full prompt and image hashes
          logGenerationRequest(finalPrompt, mainImages, `auto-${i + 1}/${autoVariants.length}`);
          
          const images = await generateImages({
            prompt: finalPrompt,
            mainImages,
            refImagesB64,
            count: 1,
            skuEnabled,
            skuName,
            seqDigits,
            imageIndex: currentImageIndex,
            aspectRatio,
            resolution,
            width,
            height,
          });
          
          // Extract both dataUrl and metadata correctly
          const normalizedImages = images.map(img => 
            typeof img === 'object' && img.dataUrl ? img.dataUrl : img
          );
          const imageMetadata = images.map(img => 
            typeof img === 'object' && img.skuName ? { 
              filename: img.filename, 
              skuName: img.skuName,      // Base SKU name (no sequence)
              seqDigits: seqDigits       // For download-time numbering
            } : null
          );
          
          return {
            ok: true,
            variant: variant,
            prompt: finalPrompt,
            images: normalizedImages.map((dataUrl, idx) => ({
              dataUrl,
              filename: imageMetadata[idx]?.filename,
              skuName: imageMetadata[idx]?.skuName,
              seqDigits: imageMetadata[idx]?.seqDigits,
            })),
          };
        })
      );
      
      // Add results in order and update imageIndex
      results.push(...parallelResults);
      imageIndex += autoVariants.length;
    } else if (genStrategy === "manual" && variations.length > 0) {
      // Manual mode with explicit variations
      // 🚀 Parallel generation for speed
      const parallelResults = await Promise.all(
        variations.map(async (v, i) => {
          const finalPrompt = buildPrompt(resolvedCategory, mainPrompt, v);
          const currentImageIndex = imageIndex + i;
          
          // 🔍 Debug: Log full prompt and image hashes
          logGenerationRequest(finalPrompt, mainImages, `manual-${i + 1}/${variations.length}`);
          
          const images = await generateImages({
            prompt: finalPrompt,
            mainImages,
            refImagesB64,
            count: 1,
            skuEnabled,
            skuName,
            seqDigits,
            imageIndex: currentImageIndex,
            aspectRatio,
            resolution,
            width,
            height,
          });
          
          const normalizedImages = images.map(img => 
            typeof img === 'object' && img.dataUrl ? img.dataUrl : img
          );
          const imageMetadata = images.map(img => 
            typeof img === 'object' && img.skuName ? { 
              filename: img.filename, 
              skuName: img.skuName,
              seqDigits: seqDigits
            } : null
          );
          
          return {
            ok: true,
            variant: v,
            prompt: finalPrompt,
            images: normalizedImages.map((dataUrl, idx) => ({
              dataUrl,
              filename: imageMetadata[idx]?.filename,
              skuName: imageMetadata[idx]?.skuName,
              seqDigits: imageMetadata[idx]?.seqDigits,
            })),
          };
        })
      );
      
      results.push(...parallelResults);
      imageIndex += variations.length;
    } else if (genCount > 0) {
      // Single generation (Auto with count=1, or Manual with no variations)
      const finalPrompt = buildPrompt(resolvedCategory, mainPrompt, "");
      
      // 🔍 Debug: Log full prompt and image hashes
      logGenerationRequest(finalPrompt, mainImages, `single-1/${genCount}`);
      
      const images = await generateImages({
        prompt: finalPrompt,
        mainImages,
        refImagesB64,
        count: genCount,
        skuEnabled,
        skuName,
        seqDigits,
        imageIndex,
        aspectRatio,
        resolution,
        width,
        height,
      });
      
      const normalizedImages = images.map(img => 
        typeof img === 'object' && img.dataUrl ? img.dataUrl : img
      );
      const imageMetadata = images.map(img => 
        typeof img === 'object' && img.skuName ? { 
          filename: img.filename, 
          skuName: img.skuName,
          seqDigits: seqDigits
        } : null
      );
      
      results.push({
        ok: true,
        prompt: finalPrompt,
        images: normalizedImages.map((dataUrl, idx) => ({
          dataUrl,
          filename: imageMetadata[idx]?.filename,
          skuName: imageMetadata[idx]?.skuName,
          seqDigits: imageMetadata[idx]?.seqDigits,
        })),
      });
    }

    // Log image generation time
    const imageTime = ((Date.now() - imageStartTime) / 1000).toFixed(2);
    console.log(`[Generate] ⏱️ Images completed in ${imageTime}s (${results.length} batches)`);

    // Wait for descriptions if they were requested (running in parallel with images)
    if (descriptionPromise) {
      console.log("[Generate] Waiting for descriptions to complete...");
      descriptions = await descriptionPromise;
      console.log("[Generate] Descriptions ready:", {
        seo: descriptions.seo ? `${descriptions.seo.substring(0, 60)}...` : 'none',
        geo: descriptions.geo ? `${descriptions.geo.substring(0, 60)}...` : 'none',
        gso: descriptions.gso ? `${descriptions.gso.substring(0, 60)}...` : 'none',
      });
    }

    // Store generation in user's history
    const generationData = {
      workMode,
      productCategory: resolvedCategory,
      mainPrompt,
      genStrategy,
      genCount: results.reduce((sum, r) => sum + (r.images?.length || 0), 0),
      skuEnabled,
      skuName,
      hasImages: results.length > 0,
      // Include description info
      descriptions: {
        seoEnabled,
        geoEnabled,
        gsoEnabled,
        // Phase 2: Additional fields
        tagsEnabled,
        metaTitleEnabled,
        metaDescriptionEnabled,
        seoTitleEnabled,
        seoPlatform: seoEnabled ? seoPlatform : null,
        geoPlatform: geoEnabled ? geoPlatform : null,
        gsoPlatform: gsoEnabled ? gsoPlatform : null,
      },
    };

    // P1a: Add spreadsheetContext to generation record if present
    if (spreadsheetContext) {
      generationData.spreadsheetContext = {
        templateId: spreadsheetContext.templateId || null,
        rowMode: spreadsheetContext.rowMode || null,
        productKey: spreadsheetContext.productKey || null,
        sourceRowIndices: Array.isArray(spreadsheetContext.sourceRowIndices)
          ? spreadsheetContext.sourceRowIndices
          : [],
        selectedImageUrls: Array.isArray(spreadsheetContext.selectedImageUrls)
          ? spreadsheetContext.selectedImageUrls
          : [],
      };
      
      // P1b: Include productInfo in generation record if present
      // Filter out undefined values to avoid Firestore errors
      if (spreadsheetContext.productInfo) {
        const productInfoForStorage = {};
        const pi = spreadsheetContext.productInfo;
        
        if (pi.title) productInfoForStorage.title = clip(pi.title, 200);
        if (pi.category) productInfoForStorage.category = pi.category;
        if (pi.sku) productInfoForStorage.sku = pi.sku;
        if (pi.vendor) productInfoForStorage.vendor = pi.vendor;
        
        // Only add productInfo if it has any values
        if (Object.keys(productInfoForStorage).length > 0) {
          generationData.spreadsheetContext.productInfo = productInfoForStorage;
        }
      }
    }

    // ⭐ 修改：拿到 generationId
    const generationId = await addGeneration(uid, generationData);

    // ════════════════════════════════════════════════════════════
    // STAGE: UPLOADING
    // ════════════════════════════════════════════════════════════
    sendProgress(res, STAGES.UPLOADING, {
      message: 'Saving to cloud storage'
    });

    // ⭐ 新增：上传图片到 Cloud Storage，获取 CDN URLs
    let resultsWithCdn = results;
    if (generationId) {
      try {
        const uploadStartTime = Date.now();
        resultsWithCdn = await uploadGeneratedImagesToStorage(uid, generationId, results);
        const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        const totalImages = resultsWithCdn.reduce((sum, r) => sum + (r.images?.length || 0), 0);
        console.log(`[Generate] ⏱️ CDN upload completed in ${uploadTime}s (${totalImages} images)`);
      } catch (uploadError) {
        console.error("[Generate] CDN upload failed, using base64 fallback:", uploadError.message);
        // 上传失败时使用原始 base64 结果，不影响生成流程
        resultsWithCdn = results;
      }
    } else {
      console.warn("[Generate] No generationId, skipping CDN upload");
    }

    const totalTime = ((Date.now() - totalStartTime) / 1000).toFixed(2);
    console.log(`[Generate] Completed successfully in ${totalTime}s: ${resultsWithCdn.length} results with descriptions: ${!!descriptions.seo || !!descriptions.geo || !!descriptions.gso}`);

    // ════════════════════════════════════════════════════════════
    // STAGE: COMPLETE
    // ════════════════════════════════════════════════════════════
    sendProgress(res, STAGES.COMPLETE, {
      message: 'Generation complete',
      totalTime
    });

    return sendResult(res, {
      success: true,
      results: resultsWithCdn,  // ⭐ 返回带 cdnUrl 的结果
      descriptions,
      generationId,  // ⭐ 返回 generationId 供前端使用
    });

  } catch (err) {
    console.error("[Generate] Error:", err);

    // Refund credits if deducted but generation failed
    if (deducted && usedCredits > 0) {
      try {
        const userRef = db.collection("users").doc(req.body?.uid);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const currentCredits = userSnap.data().credits || 0;
          await userRef.set(
            { credits: currentCredits + usedCredits, updatedAt: Date.now() },
            { merge: true }
          );
          console.log(`[Generate] Refunded ${usedCredits} credits due to error`);
        }
      } catch (refundErr) {
        console.error("[Generate] Failed to refund credits:", refundErr);
      }
    }

    return sendResult(res, {
      success: false,
      code: "GENERATION_INTERNAL_ERROR",
      error: err?.message || "Internal server error",
    });
  }
}

/**
 * Parse data URI or base64 string
 */
function parseDataUriOrB64(input) {
  if (!input) return [null, null];
  if (input.startsWith("data:")) {
    const [head, data] = input.split("base64,");
    const mime = head?.slice(5, head.indexOf(";")) || "image/png";
    return [mime, data];
  }
  return ["image/png", input];
}

/**
 * Extract JSON string from raw AI response text
 * Returns the extracted JSON string (not parsed), or null if not found
 */
function extractJsonString(text) {
  if (!text) {
    console.warn("[extractJsonString] Input is empty");
    return null;
  }

  let str = String(text).trim();
  
  // Log input length for debugging
  console.log("[extractJsonString] Input length:", str.length);

  // Handle markdown code blocks if present
  if (str.includes("```")) {
    const match = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      str = match[1].trim();
      console.log("[extractJsonString] Extracted from markdown block, new length:", str.length);
    } else {
      // No closing ```, try to remove opening ```json
      str = str.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      console.log("[extractJsonString] Removed partial markdown, new length:", str.length);
    }
  }

  // Find the outermost { and }
  const start = str.indexOf("{");
  const end = str.lastIndexOf("}");

  console.log("[extractJsonString] Brace positions: start =", start, ", end =", end);

  if (start === -1) {
    console.warn("[extractJsonString] No opening brace found");
    return null;
  }

  if (end === -1) {
    console.warn("[extractJsonString] No closing brace found - JSON likely truncated");
    return null;
  }

  if (end <= start) {
    console.warn("[extractJsonString] Invalid brace positions");
    return null;
  }

  // Extract the JSON substring
  const jsonStr = str.slice(start, end + 1);
  console.log("[extractJsonString] Extracted JSON length:", jsonStr.length);
  
  return jsonStr;
}

/**
 * Rescue partial/incomplete AI responses
 * Attempts to extract usable content from truncated JSON or plain text
 * Returns: { seo, geo, gso, rescued: boolean }
 */
function rescuePartialResponse(rawText, seoEnabled, geoEnabled, gsoEnabled) {
  const result = { seo: null, geo: null, gso: null, rescued: false };
  
  if (!rawText || rawText.trim().length < 30) {
    return result;
  }
  
  const text = rawText.trim();
  
  // Strategy 1: Truncated JSON - extract individual fields
  // Pattern: { "seo": "content...", "geo": "content..." (may have no closing brace or truncated values)
  if (text.startsWith('{') && text.includes('"seo"')) {
    console.log("[Rescue] Attempting to extract from truncated JSON...");
    
    // Try to extract each field - handles both complete and truncated values
    const extractField = (fieldName) => {
      // First try: complete field with closing quote
      const completeRegex = new RegExp(`"${fieldName}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
      const completeMatch = text.match(completeRegex);
      if (completeMatch && completeMatch[1] && completeMatch[1].length > 20) {
        const content = completeMatch[1]
          .replace(/\\n/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .trim();
        return content;
      }
      
      // Second try: truncated field (no closing quote) - take content to end of string
      const truncatedRegex = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)$`);
      const truncatedMatch = text.match(truncatedRegex);
      if (truncatedMatch && truncatedMatch[1] && truncatedMatch[1].length > 20) {
        const content = truncatedMatch[1]
          .replace(/\\n/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .trim();
        console.log(`[Rescue] Found truncated ${fieldName} value (no closing quote)`);
        return content;
      }
      
      return null;
    };
    
    if (seoEnabled) {
      const seoContent = extractField('seo');
      if (seoContent) {
        result.seo = seoContent;
        result.rescued = true;
        console.log(`[Rescue] Extracted SEO (${seoContent.length} chars): "${seoContent.substring(0, 60)}..."`);
      }
    }
    
    if (geoEnabled) {
      const geoContent = extractField('geo');
      if (geoContent) {
        result.geo = geoContent;
        result.rescued = true;
        console.log(`[Rescue] Extracted GEO (${geoContent.length} chars): "${geoContent.substring(0, 60)}..."`);
      }
    }
    
    if (gsoEnabled) {
      const gsoContent = extractField('gso');
      if (gsoContent) {
        result.gso = gsoContent;
        result.rescued = true;
        console.log(`[Rescue] Extracted GSO (${gsoContent.length} chars): "${gsoContent.substring(0, 60)}..."`);
      }
    }
    
    if (result.rescued) {
      return result;
    }
  }
  
  // Strategy 2: Plain text response (not JSON at all)
  // If the response is a natural language description, use it for SEO
  if (!text.startsWith('{') && !text.startsWith('[') && text.length > 50) {
    console.log("[Rescue] Response is plain text, not JSON");
    
    // Check if it looks like a product description (not an error message)
    const looksLikeDescription = !text.toLowerCase().includes('error') &&
                                  !text.toLowerCase().includes('sorry') &&
                                  !text.toLowerCase().includes('cannot') &&
                                  !text.toLowerCase().includes('unable');
    
    if (looksLikeDescription && seoEnabled) {
      // Use the plain text as SEO description (it's usually good quality)
      const cleanText = text.replace(/\n+/g, ' ').trim();
      if (cleanText.length > 30 && cleanText.length < 2000) {
        result.seo = cleanText;
        result.rescued = true;
        console.log(`[Rescue] Using plain text as SEO (${cleanText.length} chars): "${cleanText.substring(0, 60)}..."`);
      }
    }
  }
  
  return result;
}

/**
 * P1b: Build context string from productInfo
 */
function buildProductInfoContext(productInfo) {
  if (!productInfo) return "";
  
  const contextParts = [];
  
  if (productInfo.title) {
    contextParts.push(`Product title from spreadsheet: ${productInfo.title}`);
  }
  if (productInfo.seoTitle) {
    contextParts.push(`SEO title from spreadsheet: ${productInfo.seoTitle}`);
  }
  if (productInfo.seoDescription) {
    contextParts.push(`SEO description from spreadsheet (reference): ${clip(productInfo.seoDescription, 300)}`);
  }
  if (productInfo.description) {
    contextParts.push(`Product description from spreadsheet (shortened): ${clip(stripHtml(productInfo.description), 400)}`);
  }
  if (productInfo.tags && productInfo.tags.length > 0) {
    const tagsStr = productInfo.tags.join(", ");
    contextParts.push(`Tags from spreadsheet: ${clip(tagsStr, 200)}`);
  }
  if (productInfo.vendor) {
    contextParts.push(`Vendor/brand from spreadsheet: ${productInfo.vendor}`);
  }
  if (productInfo.attributes) {
    const attrParts = [];
    if (productInfo.attributes.color) attrParts.push(`color=${productInfo.attributes.color}`);
    if (productInfo.attributes.size) attrParts.push(`size=${productInfo.attributes.size}`);
    if (productInfo.attributes.material) attrParts.push(`material=${productInfo.attributes.material}`);
    if (productInfo.attributes.style) attrParts.push(`style=${productInfo.attributes.style}`);
    if (attrParts.length > 0) {
      contextParts.push(`Attributes from spreadsheet: ${attrParts.join(", ")}`);
    }
  }
  
  return contextParts.length > 0 ? contextParts.join("\n") : "";
}

/**
 * P1b OPTIMIZATION: Generate ALL descriptions in ONE API call
 * This reduces API calls from 3 to 1 and ensures consistent context usage
 * Phase 2: Extended to support tags, meta_title, meta_description, seo_title
 */
async function generateAllDescriptions({
  category,
  productCount,
  mainImages = [],
  skuName = "",
  productInfo = null,
  seoEnabled = false,
  geoEnabled = false,
  gsoEnabled = false,
  // Phase 2: Additional fields
  tagsEnabled = false,
  metaTitleEnabled = false,
  metaDescriptionEnabled = false,
  seoTitleEnabled = false,
  // Custom fields with enableGeneration
  customFieldsEnabled = {},
  seoPlatform = "generic",
  geoPlatform = "generic",
  gsoPlatform = "generic",
  contentPlatform = "generic",
}) {
  const { callGeminiAPI } = await import("../utils/geminiClient.js");
  
  // Phase 2: Extended descriptions object
  const descriptions = { 
    seo: null, 
    geo: null, 
    gso: null,
    tags: null,
    meta_title: null,
    meta_description: null,
    seo_title: null,
  };
  
  // Add custom fields to descriptions object
  const customFieldKeys = Object.keys(customFieldsEnabled).filter(key => customFieldsEnabled[key] === true);
  customFieldKeys.forEach(key => {
    descriptions[key] = null;
  });
  
  // Build which descriptions are needed
  const enabledTypes = [];
  if (seoEnabled) enabledTypes.push({ type: 'SEO', key: 'seo', platform: seoPlatform });
  if (geoEnabled) enabledTypes.push({ type: 'GEO', key: 'geo', platform: geoPlatform });
  if (gsoEnabled) enabledTypes.push({ type: 'GSO', key: 'gso', platform: gsoPlatform });
  // Phase 2: Additional fields (use seoPlatform as default platform context)
  if (tagsEnabled) enabledTypes.push({ type: 'TAGS', key: 'tags', platform: seoPlatform });
  if (metaTitleEnabled) enabledTypes.push({ type: 'META_TITLE', key: 'meta_title', platform: seoPlatform });
  if (metaDescriptionEnabled) enabledTypes.push({ type: 'META_DESC', key: 'meta_description', platform: seoPlatform });
  if (seoTitleEnabled) enabledTypes.push({ type: 'SEO_TITLE', key: 'seo_title', platform: seoPlatform });
  
  // Add custom fields (use contentPlatform)
  customFieldKeys.forEach(key => {
    enabledTypes.push({ type: 'CUSTOM', key, platform: contentPlatform, isCustom: true });
  });
  
  if (enabledTypes.length === 0) return descriptions;
  
  // Extract key variables for prompt
  const productName = productInfo?.title || category;
  const brand = productInfo?.vendor || '';
  
  // Build compact product context (with length control)
  const productContext = buildCompactProductContext({
    category,
    skuName,
    productInfo,
    maxChars: 900, // Limit product info to prevent token overflow
  });
  
  // Determine primary platform (use seoPlatform as default, or first enabled platform)
  const primaryPlatform = seoEnabled ? seoPlatform : 
                          geoEnabled ? geoPlatform : 
                          gsoEnabled ? gsoPlatform : 
                          contentPlatform || "generic";
  const platformTone = getPlatformToneDirective(primaryPlatform);
  
  // Build description instructions for each type (COMPACT — limits only, tone is at top)
  const typeInstructions = enabledTypes.map(({ type, key, platform, isCustom }) => {
    const platformName = PLATFORM_NAMES[platform] || "e-commerce";
    const platformLimits = getPlatformLimits(platform);
    
    if (type === 'SEO') {
      const wordLimit = platformLimits.seoWords || '80-120';
      return `- "seo": Keyword-optimized description for ${platformName} (2-3 sentences, ${wordLimit} words). Start with "${productName}".${brand ? ` Include "${brand}".` : ''} Follow the PLATFORM TONE above.`;
    } else if (type === 'GEO') {
      return `- "geo": Semantic description for ${platformName} AI search engines (2-3 sentences). Define what the product IS.${brand ? ` Mention "${brand}".` : ''} Help AI categorize this product.`;
    } else if (type === 'GSO') {
      return `- "gso": Encyclopedia-style description for ${platformName} AI recommendations (3-4 sentences).${brand ? ` Include "${brand}".` : ''} Objective: category, audience, typical uses.`;
    } else if (type === 'TAGS') {
      const tagCount = platformLimits.maxTags || '5-15';
      const tagNote = platformLimits.tagNotes || '';
      return `- "tags": Array of ${tagCount} product tags for ${platformName}. Include: category, materials, colors, styles, use cases.${tagNote ? ` ${tagNote}` : ''} Do NOT invent features.`;
    } else if (type === 'META_TITLE') {
      const titleLimit = platformLimits.metaTitleChars || 60;
      return `- "meta_title": Page meta title for ${platformName} SEO (max ${titleLimit} chars). Product name + key attribute.`;
    } else if (type === 'META_DESC') {
      const descLimit = platformLimits.metaDescChars || 155;
      return `- "meta_description": Meta description for ${platformName} (max ${descLimit} chars). Summarize appeal, encourage clicks.`;
    } else if (type === 'SEO_TITLE') {
      const seoTitleLimit = platformLimits.seoTitleChars || 80;
      return `- "seo_title": Keyword-optimized product title for ${platformName} (max ${seoTitleLimit} chars).${brand ? ` Include "${brand}".` : ''}`;
    } else if (type === 'CUSTOM' && isCustom) {
      const fieldLabel = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `- "${key}": Content for "${fieldLabel}" field for ${platformName}. Infer type from field name. Concise and relevant.`;
    }
    return '';
  }).filter(Boolean).join('\n');
  
  // Build the JSON fields list for the format instruction
  const jsonFields = enabledTypes.map(({ key }) => `"${key}"`).join(', ');
  
  // === PROMPT STRUCTURE (3 parts) ===
  // Part 1: Header (role intro + PLATFORM TONE - NEVER truncated)
  const promptHeader = `You are an expert e-commerce copywriter. Write product descriptions based ONLY on the product information and images below.

=== PLATFORM TONE (MUST FOLLOW) ===
${platformTone}
===================================`;

  // Part 2: Product Context (CAN be truncated if needed)
  const promptContext = `=== PRODUCT INFO ===
${productContext}
====================
Category: "${category}"`;

  // Part 3: Rules + JSON Format (NEVER truncated - this is critical)
  const promptRules = `=== CATEGORY-SPECIFIC FOCUS ===
- JEWELRY/ACCESSORY: Focus on metal/finish, chain structure, motifs, closure, how it sits on body.
- CLOTHING/APPAREL: Focus on fabric type/weight, silhouette/fit, design elements, styling scenarios.
- SHOES: Focus on upper construction, sole type, heel height, closure, comfort features.
- BAG/LEATHER GOODS: Focus on size/compartments, strap types, closure, structure, material texture.
- HOME DECOR: Focus on materials/finishes, shape/proportions, color palette, room placement.
- ELECTRONICS: Focus on form factor, functional features, controls/ports, usage scenarios.
- BEAUTY/PERSONAL CARE: Focus on texture/finish, effect type, target area, application style.
- OTHER: Infer from category + name and describe relevant physical/functional details.

=== FIELD-SPECIFIC GUIDELINES ===
Generate a JSON object with ${jsonFields}:

${typeInstructions}

General rules:
- Always include product name "${productName}" in EACH description.
${brand ? `- Include brand "${brand}" once in GEO and GSO naturally.` : '- Do NOT invent a brand name.'}
- Use concrete, visual details (shape, proportions, textures, key components).
- GOOD: "slim bracelet with evenly spaced clover charms along a fine chain"
- BAD: "nice bracelet with beautiful design"

STRICTLY AVOID:
- Generic filler: "high-quality", "top-grade", "professional", "premium product"
- Vague phrases: "perfect for any occasion", "great for many people"
- Mentioning photography, images, or e-commerce listings

=== OUTPUT FORMAT (CRITICAL) ===
You MUST respond with ONLY a single valid JSON object containing these fields: ${jsonFields}.

Rules:
- Do NOT include any text before or after the JSON.
- Do NOT use markdown code blocks.
- Do NOT add comments or explanations.
- Use standard double quotes for all keys and string values.
- All quotes and braces must be properly closed.
- For "tags", return an array of strings, NOT a comma-separated string.

Example format (include ONLY the requested fields):
{
  "seo": "Your SEO description here...",
  "geo": "Your GEO description here...",
  "gso": "Your GSO description here...",
  "tags": ["tag1", "tag2", "tag3"],
  "meta_title": "Product Title | Category",
  "meta_description": "Brief product summary for search results...",
  "seo_title": "Optimized Product Title with Keywords"
}

Now generate the JSON:`;

  // === BUILD FINAL PROMPT WITH LENGTH CONTROL ===
  // Priority: header (with platform tone) + rules are NEVER truncated, only productContext can be truncated
  // P2: Increased limit to accommodate platform tone directive in header
  const maxPromptChars = 4200;
  const fixedLength = promptHeader.length + promptRules.length + 8; // 8 for newlines
  const availableForContext = maxPromptChars - fixedLength;
  
  let safeContext = promptContext;
  if (promptContext.length > availableForContext) {
    if (availableForContext > 100) {
      safeContext = promptContext.slice(0, availableForContext - 30) + "\n(Product info truncated.)";
    } else {
      safeContext = "(Product info omitted due to length constraints.)";
    }
    console.log(`[Generate] Product context truncated: ${promptContext.length} -> ${safeContext.length} chars`);
  }
  
  const prompt = [promptHeader, safeContext, promptRules].join("\n\n");

  console.log("[Generate] Description prompt length:", prompt.length);
  console.log("[Generate] Product context:", { productName, brand: brand || "(none)", category, contextLen: productContext.length });
  console.log("[Generate] Prompt structure: header=" + promptHeader.length + ", context=" + safeContext.length + ", rules=" + promptRules.length);
  
  const parts = [{ text: prompt }];
  
  // Include product images (max 2 for better context)
  if (mainImages.length > 0) {
    for (let i = 0; i < Math.min(mainImages.length, 2); i++) {
      const image = mainImages[i];
      const [mime, data] = parseDataUriOrB64(image);
      if (data && data.length > 100) {
        parts.push({ inline_data: { mime_type: mime || "image/png", data } });
        console.log(`[Generate] Attached image ${i + 1}: ${mime}, ${Math.round(data.length / 1024)}KB`);
      }
    }
  }
  
  // Calculate maxOutputTokens based on number of fields
  // P2: Slightly increased base for platform-aware descriptions
  const baseTokens = 2200;
  const customFieldCount = customFieldKeys.length;
  const dynamicMaxTokens = Math.min(baseTokens + (customFieldCount * 300), 4096);
  
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: dynamicMaxTokens,
    }
  };
  
  console.log(`[Generate] maxOutputTokens set to ${dynamicMaxTokens} (${customFieldCount} custom fields)`);
  
  // Try up to 2 times
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[Generate] Calling Gemini for descriptions (attempt ${attempt})...`);
      const response = await callGeminiAPI("gemini-3-flash-preview", body);
      
      // Extract token usage from response
      const usage = response?.usageMetadata;
      if (usage) {
        totalInputTokens += usage.promptTokenCount || 0;
        totalOutputTokens += usage.candidatesTokenCount || 0;
      }
      
      // Check if response exists
      if (!response) {
        console.warn(`[Generate] Attempt ${attempt}: callGeminiAPI returned null/undefined`);
        if (attempt < 2) continue;
        console.log(`[Descriptions] Completed after ${attempt} attempts. Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
        return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
      }
      
      // Check for API errors
      if (response.error) {
        console.warn(`[Generate] Attempt ${attempt}: API error:`, JSON.stringify(response.error).substring(0, 500));
        if (attempt < 2) continue;
        console.log(`[Descriptions] Completed after ${attempt} attempts. Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
        return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
      }
      
      // Extract text from response - try multiple methods
      let rawText = null;
      
      // Method 1: Direct path
      rawText = response?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      // Method 2: If Method 1 fails, try iterating parts
      if (!rawText) {
        const parts = response?.candidates?.[0]?.content?.parts || [];
        const textChunks = parts
          .filter(p => typeof p.text === "string" && p.text.length > 0)
          .map(p => p.text);
        if (textChunks.length > 0) {
          rawText = textChunks.join("\n");
        }
      }
      
      // Check if we got any text
      if (!rawText || rawText.trim().length === 0) {
        console.warn(`[Generate] Attempt ${attempt}: Empty text in response`);
        const firstCandidate = response?.candidates?.[0];
        if (firstCandidate) {
          console.warn(`[Generate] finishReason:`, firstCandidate.finishReason);
          console.warn(`[Generate] content exists:`, !!firstCandidate.content);
          console.warn(`[Generate] parts count:`, firstCandidate.content?.parts?.length || 0);
        }
        if (attempt < 2) continue;
        console.log(`[Descriptions] Completed after ${attempt} attempts. Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
        return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
      }
      
      // Trim the text
      rawText = rawText.trim();
      
      // Log preview of raw response (for debugging only, not used for parsing)
      const preview = rawText.substring(0, 500).replace(/\n/g, '\\n');
      console.log("[Generate] AI response preview:", preview);
      console.log("[Generate] AI response total length:", rawText.length);
      
      // Extract JSON string from the FULL rawText (not preview!)
      const jsonStr = extractJsonString(rawText);
      
      // Also log finishReason for debugging
      const firstCandidate = response?.candidates?.[0];
      if (firstCandidate?.finishReason && firstCandidate.finishReason !== 'STOP') {
        console.warn(`[Generate] finishReason: ${firstCandidate.finishReason}`);
      }
      
      if (!jsonStr) {
        console.warn(`[Generate] Attempt ${attempt}: Could not extract JSON from response`);
        console.warn(`[Generate] Full response was:`, rawText.substring(0, 800));
        
        // On last attempt, try rescue before falling back
        if (attempt >= 2) {
          console.log("[Generate] Attempting rescue from partial response...");
          const rescued = rescuePartialResponse(rawText, seoEnabled, geoEnabled, gsoEnabled);
          
          if (rescued.rescued) {
            // Use rescued content, fill missing with fallbacks
            if (rescued.seo) descriptions.seo = rescued.seo;
            if (rescued.geo) descriptions.geo = rescued.geo;
            if (rescued.gso) descriptions.gso = rescued.gso;
            
            // Fill in any still-missing with fallbacks
            const fallbacks = generateFallbackDescriptions(category, skuName, productInfo, 
              seoEnabled && !descriptions.seo, 
              geoEnabled && !descriptions.geo, 
              gsoEnabled && !descriptions.gso
            );
            if (seoEnabled && !descriptions.seo) descriptions.seo = fallbacks.seo;
            if (geoEnabled && !descriptions.geo) descriptions.geo = fallbacks.geo;
            if (gsoEnabled && !descriptions.gso) descriptions.gso = fallbacks.gso;
            
            console.log(`[Generate] Rescue successful: SEO=${!!rescued.seo}, GEO=${!!rescued.geo}, GSO=${!!rescued.gso}`);
            console.log(`[Descriptions] Completed after ${attempt} attempts (rescued). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
            return descriptions;
          }
          
          console.log(`[Descriptions] Completed after ${attempt} attempts (fallback). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
          return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
        }
        
        console.log("[Generate] Retrying...");
        continue;
      }
      
      // Now parse the JSON
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
        console.log("[Generate] JSON parsed successfully");
      } catch (parseErr) {
        console.warn(`[Generate] Attempt ${attempt}: JSON.parse failed:`, parseErr.message);
        console.warn(`[Generate] JSON string was:`, jsonStr.substring(0, 500));
        
        // On last attempt, try rescue before falling back
        if (attempt >= 2) {
          console.log("[Generate] Attempting rescue from malformed JSON...");
          const rescued = rescuePartialResponse(rawText, seoEnabled, geoEnabled, gsoEnabled);
          
          if (rescued.rescued) {
            if (rescued.seo) descriptions.seo = rescued.seo;
            if (rescued.geo) descriptions.geo = rescued.geo;
            if (rescued.gso) descriptions.gso = rescued.gso;
            
            const fallbacks = generateFallbackDescriptions(category, skuName, productInfo, 
              seoEnabled && !descriptions.seo, 
              geoEnabled && !descriptions.geo, 
              gsoEnabled && !descriptions.gso
            );
            if (seoEnabled && !descriptions.seo) descriptions.seo = fallbacks.seo;
            if (geoEnabled && !descriptions.geo) descriptions.geo = fallbacks.geo;
            if (gsoEnabled && !descriptions.gso) descriptions.gso = fallbacks.gso;
            
            console.log(`[Generate] Rescue successful: SEO=${!!rescued.seo}, GEO=${!!rescued.geo}, GSO=${!!rescued.gso}`);
            console.log(`[Descriptions] Completed after ${attempt} attempts (rescued). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
            return descriptions;
          }
          
          console.log(`[Descriptions] Completed after ${attempt} attempts (fallback). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
          return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
        }
        
        console.log("[Generate] Retrying...");
        continue;
      }
      
      // Successfully parsed - extract descriptions
      let successCount = 0;
      
      if (seoEnabled && parsed.seo && typeof parsed.seo === 'string' && parsed.seo.length > 20) {
        descriptions.seo = parsed.seo.trim();
        console.log(`[Generate] SEO parsed (${descriptions.seo.length} chars): "${descriptions.seo.substring(0, 80)}..."`);
        successCount++;
      }
      if (geoEnabled && parsed.geo && typeof parsed.geo === 'string' && parsed.geo.length > 20) {
        descriptions.geo = parsed.geo.trim();
        console.log(`[Generate] GEO parsed (${descriptions.geo.length} chars): "${descriptions.geo.substring(0, 80)}..."`);
        successCount++;
      }
      if (gsoEnabled && parsed.gso && typeof parsed.gso === 'string' && parsed.gso.length > 20) {
        descriptions.gso = parsed.gso.trim();
        console.log(`[Generate] GSO parsed (${descriptions.gso.length} chars): "${descriptions.gso.substring(0, 80)}..."`);
        successCount++;
      }
      
      // Phase 2: Parse additional fields
      if (tagsEnabled && parsed.tags) {
        // Tags can be array or comma-separated string
        if (Array.isArray(parsed.tags)) {
          descriptions.tags = parsed.tags
            .filter(t => typeof t === 'string' && t.trim())
            .map(t => t.trim())
            .slice(0, 20)  // Max 20 tags
            .join(', ');
        } else if (typeof parsed.tags === 'string') {
          descriptions.tags = parsed.tags.trim();
        }
        if (descriptions.tags) {
          console.log(`[Generate] Tags parsed: "${descriptions.tags.substring(0, 80)}..."`);
          successCount++;
        }
      }
      if (metaTitleEnabled && parsed.meta_title && typeof parsed.meta_title === 'string' && parsed.meta_title.length > 5) {
        const mtLimit = getPlatformLimits(seoPlatform).metaTitleChars || 60;
        descriptions.meta_title = parsed.meta_title.trim().substring(0, mtLimit);
        console.log(`[Generate] Meta Title parsed (limit ${mtLimit}): "${descriptions.meta_title}"`);
        successCount++;
      }
      if (metaDescriptionEnabled && parsed.meta_description && typeof parsed.meta_description === 'string' && parsed.meta_description.length > 10) {
        const mdLimit = getPlatformLimits(seoPlatform).metaDescChars || 155;
        descriptions.meta_description = parsed.meta_description.trim().substring(0, mdLimit);
        console.log(`[Generate] Meta Description parsed (limit ${mdLimit}): "${descriptions.meta_description.substring(0, 60)}..."`);
        successCount++;
      }
      if (seoTitleEnabled && parsed.seo_title && typeof parsed.seo_title === 'string' && parsed.seo_title.length > 5) {
        const stLimit = getPlatformLimits(seoPlatform).seoTitleChars || 80;
        descriptions.seo_title = parsed.seo_title.trim().substring(0, stLimit);
        console.log(`[Generate] SEO Title parsed (limit ${stLimit}): "${descriptions.seo_title}"`);
        successCount++;
      }
      
      // Parse custom fields
      customFieldKeys.forEach(key => {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          const value = parsed[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            descriptions[key] = value.trim();
            console.log(`[Generate] Custom field "${key}" parsed: "${descriptions[key].substring(0, 50)}..."`);
            successCount++;
          } else if (Array.isArray(value)) {
            // Handle array values (like tags)
            descriptions[key] = value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()).join(', ');
            if (descriptions[key]) {
              console.log(`[Generate] Custom field "${key}" (array) parsed: "${descriptions[key].substring(0, 50)}..."`);
              successCount++;
            }
          }
        }
      });
      
      console.log(`[Generate] Successfully parsed ${successCount}/${enabledTypes.length} descriptions from AI`);
      console.log(`[Descriptions] Completed after ${attempt} attempt(s). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
      
      // Fill in any missing with fallbacks (only for SEO/GEO/GSO - Phase 2 fields don't have fallbacks)
      const missingTypes = [];
      if (seoEnabled && !descriptions.seo) missingTypes.push('SEO');
      if (geoEnabled && !descriptions.geo) missingTypes.push('GEO');
      if (gsoEnabled && !descriptions.gso) missingTypes.push('GSO');
      
      if (missingTypes.length > 0) {
        console.log(`[Generate] Missing descriptions: ${missingTypes.join(', ')}, using fallbacks`);
        const fallbacks = generateFallbackDescriptions(category, skuName, productInfo, 
          seoEnabled && !descriptions.seo, 
          geoEnabled && !descriptions.geo, 
          gsoEnabled && !descriptions.gso
        );
        if (seoEnabled && !descriptions.seo) descriptions.seo = fallbacks.seo;
        if (geoEnabled && !descriptions.geo) descriptions.geo = fallbacks.geo;
        if (gsoEnabled && !descriptions.gso) descriptions.gso = fallbacks.gso;
      }
      
      return descriptions;
      
    } catch (error) {
      console.error(`[Generate] Description attempt ${attempt} failed:`, error.message);
      if (attempt >= 2) {
        console.log(`[Descriptions] Completed after ${attempt} attempts (error). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
        return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
      }
    }
  }
  
  console.log(`[Descriptions] Completed (all attempts failed). Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
  return generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled);
}

/**
 * Generate fallback descriptions using product info
 */
function generateFallbackDescriptions(category, skuName, productInfo, seoEnabled, geoEnabled, gsoEnabled) {
  const descriptions = { seo: null, geo: null, gso: null };
  
  const title = productInfo?.title || category;
  // Only use vendor from productInfo, don't extract from SKU (SKU prefix is collection, not brand)
  const vendor = productInfo?.vendor || '';
  const productSku = productInfo?.sku || skuName || '';
  const color = productInfo?.attributes?.color || '';
  const material = productInfo?.attributes?.material || '';
  const style = productInfo?.attributes?.style || '';
  
  const detailParts = [color, material, style].filter(Boolean);
  const details = detailParts.length > 0 ? ` Features ${detailParts.join(', ').toLowerCase()} design.` : '';
  
  console.log(`[Generate] Using fallback descriptions with vendor: ${vendor || '(none)'}, title: ${title}`);
  
  if (seoEnabled) {
    descriptions.seo = `${title} for everyday wear or special occasions.${details} Quality craftsmanship with attention to detail.${productSku ? ` Product code: ${productSku}.` : ''}`.trim();
  }
  
  if (geoEnabled) {
    // If no vendor, use generic description without brand
    if (vendor) {
      descriptions.geo = `This ${category.toLowerCase()} from ${vendor} features professional design and construction.${details} Suitable for various occasions and styling preferences.${productSku ? ` Model: ${productSku}.` : ''}`.trim();
    } else {
      descriptions.geo = `This ${category.toLowerCase()} features professional design and construction.${details} Suitable for various occasions and styling preferences.${productSku ? ` Model: ${productSku}.` : ''}`.trim();
    }
  }
  
  if (gsoEnabled) {
    // If no vendor, use generic description without brand
    if (vendor) {
      descriptions.gso = `The ${vendor} ${title} is a ${category.toLowerCase()} product featuring ${detailParts.length > 0 ? detailParts.join(' and ').toLowerCase() : 'elegant'} construction and design elements. Positioned in the mid-market segment for general consumer use. Common applications include daily wear, gifts, and personal collections.`;
    } else {
      descriptions.gso = `The ${title} is a ${category.toLowerCase()} product featuring ${detailParts.length > 0 ? detailParts.join(' and ').toLowerCase() : 'elegant'} construction and design elements. Positioned in the mid-market segment for general consumer use. Common applications include daily wear, gifts, and personal collections.`;
    }
  }
  
  return descriptions;
}

/**
 * Generate SEO-optimized description (keyword-focused for Google)
 * P1b: Now accepts productInfo and platform parameters
 */
async function generateSEODescription(category, productCount, mainImages = [], skuName = "", productInfo = null, platform = "generic") {
  const { callGeminiAPI } = await import("../utils/geminiClient.js");
  
  // Build context
  const contextParts = [`Product category: ${category}`];
  if (productCount > 1) contextParts.push(`Number of products: ${productCount}`);
  if (skuName) contextParts.push(`Product identifier: ${skuName}`);
  
  // P1b: Add productInfo context
  const productInfoContext = buildProductInfoContext(productInfo);
  if (productInfoContext) {
    contextParts.push("\n--- Spreadsheet Product Information ---");
    contextParts.push(productInfoContext);
    contextParts.push("--- End Spreadsheet Info ---\n");
  }
  
  const context = contextParts.join('\n');
  
  // P1b: Platform-specific instructions
  const platformName = PLATFORM_NAMES[platform] || "e-commerce";
  const platformInstructions = getPlatformSEOInstructions(platform);
  
  const prompt = `You are an expert SEO copywriter for ${platformName}.

Analyze the product image(s) and information:
${context}

Generate an SEO-optimized product description (2-3 sentences, max 120 words) that:

1. **Starts with the most important keywords** (e.g., "Gold floral link bracelet for women")
2. **Naturally includes high-search-volume keywords** relevant to the product
3. **Uses specific, descriptive adjectives** (e.g., "elegant", "minimalist", "adjustable", "dainty")
4. **Mentions key product features** that customers search for (material, style, size, occasion)
5. **Describes what's visibly shown in the image** - the actual product's color, design, and characteristics
${platformInstructions}

CRITICAL RULES:
- Focus on WHAT THE PRODUCT IS (the physical item shown)
- Use keywords customers would search on ${platformName}
- Be specific about what's IN the image (don't invent details)
- Natural language, not keyword stuffing
- NO generic phrases like "High-quality" or "Professional jewelry product"
- NO mentions of photography, image quality, or e-commerce listings
- If spreadsheet info is provided, incorporate relevant details (brand, material, style) naturally

Example good SEO: "Gold-plated floral link bracelet featuring delicate cubic zirconia stones arranged in flower clusters. Lightweight double-chain design with adjustable clasp fits most wrist sizes. Perfect for everyday wear, layering, or as a thoughtful gift for women who love feminine minimalist jewelry."

Respond with ONLY the product description, no titles or labels.`;

  const parts = [{ text: prompt }];
  
  // Include product images
  if (mainImages.length > 0) {
    for (let i = 0; i < Math.min(mainImages.length, 2); i++) {
      const image = mainImages[i];
      const [mime, data] = parseDataUriOrB64(image);
      if (data) {
        parts.push({ inline_data: { mime_type: mime || "image/png", data } });
      }
    }
  }
  
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 250,
    }
  };
  
  try {
    const response = await callGeminiAPI("gemini-3-flash-preview", body);
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text && text.length > 20) {
      console.log(`[Generate] SEO description generated (${text.length} chars) for ${platformName}`);
      return text;
    }
    
    return generateFallbackSEODescription(category, skuName);
  } catch (error) {
    console.warn("[Generate] SEO generation failed:", error.message);
    return generateFallbackSEODescription(category, skuName);
  }
}

/**
 * Generate GEO-optimized description (semantic for AI understanding)
 * P1b: Now accepts productInfo and platform parameters
 */
async function generateGEODescription(category, productCount, mainImages = [], skuName = "", productInfo = null, platform = "generic") {
  const { callGeminiAPI } = await import("../utils/geminiClient.js");
  
  const contextParts = [`Product category: ${category}`];
  if (productCount > 1) contextParts.push(`Number of products: ${productCount}`);
  if (skuName) contextParts.push(`Product identifier: ${skuName}`);
  
  // P1b: Add productInfo context
  const productInfoContext = buildProductInfoContext(productInfo);
  if (productInfoContext) {
    contextParts.push("\n--- Spreadsheet Product Information ---");
    contextParts.push(productInfoContext);
    contextParts.push("--- End Spreadsheet Info ---\n");
  }
  
  const context = contextParts.join('\n');
  
  // P1b: Platform-specific instructions
  const platformName = PLATFORM_NAMES[platform] || "e-commerce";
  const platformInstructions = getPlatformGEOInstructions(platform);
  
  const prompt = `You are a professional product analyst creating structured descriptions for AI search engines (Gemini, ChatGPT, Perplexity) optimized for ${platformName} products.

Analyze the product image(s) and information:
${context}

Generate a GEO-optimized description (2-4 sentences, max 150 words) with:

1. **Clear product definition** - Start with what it IS (material, type, structure)
2. **Semantic attributes** - Describe key features AI can understand:
   - Material/construction (e.g., "double-chain gold-tone metal")
   - Design elements (e.g., "floral cluster pattern with round-cut stones")
   - Physical characteristics (e.g., "lightweight, adjustable clasp")
3. **Use context** - Who it's for, what occasions, what style
4. **Structured language** - Help AI categorize and understand relationships
${platformInstructions}

Focus on SEMANTIC CLARITY over keywords. AI needs to understand:
- What category this product belongs to
- What makes it unique
- Who would want it
- How it's used

CRITICAL:
- Describe the ACTUAL product shown in the image
- Use precise, descriptive language
- NO generic marketing fluff
- NO mentions of photography or image quality
- Incorporate spreadsheet info (brand, material, style) if provided

Example GEO: "A delicate gold-tone bracelet featuring a fine double-chain structure with small round-cut stones arranged in floral cluster patterns. Lightweight construction makes it comfortable for daily wear. Adjustable clasp accommodates various wrist sizes. Suitable for minimalists or customers seeking refined, feminine jewelry that works well for layering or standalone wear."

Respond with ONLY the product description.`;

  const parts = [{ text: prompt }];
  
  if (mainImages.length > 0) {
    for (let i = 0; i < Math.min(mainImages.length, 2); i++) {
      const image = mainImages[i];
      const [mime, data] = parseDataUriOrB64(image);
      if (data) {
        parts.push({ inline_data: { mime_type: mime || "image/png", data } });
      }
    }
  }
  
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 300,
    }
  };
  
  try {
    const response = await callGeminiAPI("gemini-3-flash-preview", body);
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text && text.length > 20) {
      console.log(`[Generate] GEO description generated (${text.length} chars) for ${platformName}`);
      return text;
    }
    
    return generateFallbackGEODescription(category, skuName);
  } catch (error) {
    console.warn("[Generate] GEO generation failed:", error.message);
    return generateFallbackGEODescription(category, skuName);
  }
}

/**
 * Generate GSO-optimized description (knowledge-graph style for AI recommendations)
 * P1b: Now accepts productInfo and platform parameters
 */
async function generateGSODescription(category, productCount, mainImages = [], skuName = "", productInfo = null, platform = "generic") {
  const { callGeminiAPI } = await import("../utils/geminiClient.js");
  
  const contextParts = [`Product category: ${category}`];
  if (productCount > 1) contextParts.push(`Number of products: ${productCount}`);
  if (skuName) {
    contextParts.push(`SKU: ${skuName}`);
  }
  
  // P1b: Add productInfo context - especially useful for GSO
  const productInfoContext = buildProductInfoContext(productInfo);
  if (productInfoContext) {
    contextParts.push("\n--- Spreadsheet Product Information ---");
    contextParts.push(productInfoContext);
    contextParts.push("--- End Spreadsheet Info ---\n");
  }
  
  const context = contextParts.join('\n');
  
  // P1b: Platform-specific instructions
  const platformName = PLATFORM_NAMES[platform] || "e-commerce";
  const platformInstructions = getPlatformGSOInstructions(platform);
  
  // Use vendor from productInfo only, don't extract from SKU
  const brandName = productInfo?.vendor || '';
  const hasBrand = !!brandName;
  
  const prompt = `You are creating encyclopedia-style product descriptions for AI recommendation systems (ChatGPT, Claude, Gemini) optimized for ${platformName} marketplace.

Analyze the product image(s) and information:
${context}

Generate a GSO-optimized description (3-5 sentences, max 180 words) that:

1. **Encyclopedia-style opening** - Define what it is objectively
   Example: ${hasBrand ? `"The ${brandName} [Product] is a [category] featuring [key design]"` : '"The [Product Name] is a [category] featuring [key design]"'}

2. **Technical specifications** - Construction, materials, dimensions
   Example: "Features double-chain construction with cubic zirconia stones"

3. **Market positioning** - Compare to similar products, price segment, target audience
   Example: "Positioned in the mid-range fashion jewelry segment"

4. **Common usage patterns** - How customers typically use/style it
   Example: "Commonly purchased as a layering accessory or standalone piece"

5. **Competitive context** - What makes it notable in its category
   Example: "Distinguishes itself through lightweight design and adjustable fit"
${platformInstructions}

This helps AI systems:
- Recommend it when users ask "what are good options for X?"
- Compare it to alternatives accurately  
- Understand its place in the market

CRITICAL:
- Write like Wikipedia, not marketing copy
- Include factual, verifiable details from the image
- Use third-person objective tone
- NO superlatives or sales language
- Use spreadsheet info (brand, vendor, attributes) if provided
${hasBrand ? `- Include the brand name "${brandName}" in the description` : '- Do not invent a brand name if not provided'}

Example GSO: "${hasBrand ? `The ${brandName} Floral Gold Bracelet` : 'The Floral Gold Bracelet'} is a fashion jewelry piece${hasBrand ? " from the brand's minimalist feminine collection" : ''}. It features double-chain gold-tone construction with small cubic zirconia stones arranged in floral cluster patterns, secured by an adjustable lobster clasp. Positioned in the affordable luxury segment at approximately $30-50 retail. Commonly purchased as a layering accessory for everyday wear or as a gift. The lightweight design (under 10g) distinguishes it from heavier statement bracelets, appealing to customers seeking comfortable all-day wear options."

Respond with ONLY the description.`;

  const parts = [{ text: prompt }];
  
  if (mainImages.length > 0) {
    for (let i = 0; i < Math.min(mainImages.length, 2); i++) {
      const image = mainImages[i];
      const [mime, data] = parseDataUriOrB64(image);
      if (data) {
        parts.push({ inline_data: { mime_type: mime || "image/png", data } });
      }
    }
  }
  
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 350,
    }
  };
  
  try {
    const response = await callGeminiAPI("gemini-3-flash-preview", body);
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (text && text.length > 20) {
      console.log(`[Generate] GSO description generated (${text.length} chars) for ${platformName}`);
      return text;
    }
    
    return generateFallbackGSODescription(category, skuName);
  } catch (error) {
    console.warn("[Generate] GSO generation failed:", error.message);
    return generateFallbackGSODescription(category, skuName);
  }
}

/**
 * P2: Platform-specific SEO instructions (for standalone generator)
 * Comprehensive rules per marketplace (updated 2025)
 */
function getPlatformSEOInstructions(platform) {
  const instructions = {
    shopify: `6. **Shopify SEO Rules**: Write 100-200 words. Natural language for Google SEO — NO keyword stuffing. Include long-tail search phrases customers type on Google. Mention collection/filter-relevant terms. Tone: Warm, brand-friendly, customer-centric (DTC stores).`,
    amazon: `6. **Amazon A9 Rules (2025)**: Front-load top 2-3 keywords in FIRST sentence. Write 150-200 words. Include exact specs (dimensions, weight, material). NO promotional language ("best seller", "free shipping", "satisfaction guaranteed"). NO emojis or special chars (!, $, ?). Structure for bullet-point extraction. Tone: Factual, benefit-driven.`,
    ebay: `6. **eBay Rules**: Include condition terms (new/pre-owned/refurbished). Mention item specifics: brand, model, MPN, size, color, material. Include compatibility info if applicable. Write 100-150 words. Tone: Straightforward, trustworthy.`,
    etsy: `6. **Etsy Rules**: Etsy indexes first 160 chars — front-load keywords there. Emphasize uniqueness: handmade, custom, vintage, one-of-a-kind. Include style tags (boho, minimalist, cottagecore). Use gifting language ("perfect gift for her"). Write 150-200 words. Tone: Personal, artisanal, story-driven.`,
    walmart: `6. **Walmart Rules**: Focus on value proposition and practical everyday use. Family-friendly language. Mention size options, pack details, age appropriateness. Write 100-150 words. Tone: Practical, no-frills.`,
    aliexpress: `6. **AliExpress Rules**: Write for international buyers — simple English, no idioms. Include exact specs in both metric/imperial. Mention size chart, color accuracy. Write 100-200 words. Tone: Spec-focused, clear.`,
    tiktok: `6. **TikTok Shop Rules**: Keep SHORT (80-120 words). Casual, Gen-Z-friendly language ("aesthetic", "must-have"). Hook reader in first line. Focus on visual/experiential appeal. Tone: Punchy, trend-aware.`,
    instagram: `6. **Instagram Shop Rules**: Lifestyle-focused, describe how product fits into customer's life. Include styling suggestions. Use hashtag-friendly terms naturally. Write 80-150 words. Tone: Aspirational, visually evocative.`,
    facebook: `6. **Facebook Marketplace Rules**: Include condition, dimensions, practical details. Quick-fact format. Write 80-120 words. Tone: Conversational, community-oriented.`,
    google_shopping: `6. **Google Shopping Rules**: Include brand, GTIN/MPN, exact product type, color, size, material. Use Google Product Category terms. Be specific: "Women's 14K Gold-Plated Sterling Silver Tennis Bracelet" not "Gold Bracelet". Tone: Precise, structured.`,
    pinterest: `6. **Pinterest Rules**: Inspirational, planning-oriented copy. Include "how to style", seasonal/event terms. Make reader want to pin for later. Write 100-150 words. Tone: Aspirational, visual.`,
    generic: "",
  };
  return instructions[platform] || "";
}

/**
 * P2: Platform-specific GEO instructions (for standalone generator)
 */
function getPlatformGEOInstructions(platform) {
  const instructions = {
    shopify: `5. **Shopify GEO**: Structure for Shopify's product taxonomy/metafields. Include collection-compatible attributes. Define using Shopify category tree language.`,
    amazon: `5. **Amazon GEO**: Structure as A+ Content-ready specs. Include Amazon Browse Node categorization. Comparison-friendly attribute-value pairs. NO subjective claims.`,
    ebay: `5. **eBay GEO**: Include Item Specifics-compatible attributes (brand, MPN, UPC, condition). Structure for eBay's catalog matching. Include compatibility info.`,
    etsy: `5. **Etsy GEO**: Define within handmade/vintage/supplies taxonomy. Include artisan-process attributes (technique, tool, method). Specify customization options and material sourcing.`,
    walmart: `5. **Walmart GEO**: Structure for Walmart's department/category hierarchy. Include value-tier positioning (budget/mid-range/premium). Pack/quantity details.`,
    aliexpress: `5. **AliExpress GEO**: Include EXACT specs in metric + imperial. Structure for AliExpress categories. Shipping-relevant attributes. Mention certifications if relevant.`,
    tiktok: `5. **TikTok GEO**: Include trend-category attributes. Define audience segments (Gen Z, beauty enthusiast). Include "viral potential" attributes.`,
    instagram: `5. **Instagram GEO**: Include lifestyle-category attributes. Define aesthetic category (minimalist, boho, coastal). Structure for Instagram's product tagging.`,
    facebook: `5. **Facebook GEO**: Include local-market attributes (condition, availability, dimensions). Structure for Facebook's commerce categories.`,
    google_shopping: `5. **Google Shopping GEO**: CRITICAL: Structure for Google's Product Data Specification. Include Google Product Category terms. Required attributes: color, size, material, gender, age_group.`,
    pinterest: `5. **Pinterest GEO**: Include visual-search-compatible attributes. Define for Pinterest catalog categories. Include inspiration-board categorization.`,
    generic: "",
  };
  return instructions[platform] || "";
}

/**
 * P2: Platform-specific GSO instructions (for standalone generator)
 */
function getPlatformGSOInstructions(platform) {
  const instructions = {
    shopify: `6. **Shopify GSO**: Position within DTC ecosystem. Compare to typical Shopify store price tiers. Mention merchant type (indie brand, artisan, small business). Reference brand-story and exclusivity value.`,
    amazon: `6. **Amazon GSO**: Position relative to category Best Sellers. Mention Prime/FBA context. Compare to price segment within Amazon's ecosystem. Reference what drives 4-5 star ratings in this category. NO invented rankings or fake social proof.`,
    ebay: `6. **eBay GSO**: Position within auction vs. Buy It Now ecosystem. Reference seller-rating culture. Compare typical price ranges (new vs. used market). Include collectibility/rarity context if applicable.`,
    etsy: `6. **Etsy GSO**: Position within handmade/vintage ecosystem. Compare to similar makers/artisans. Reference the "Etsy premium" — why buyers pay more (uniqueness, customization, artisan quality). Mention gifting culture.`,
    walmart: `6. **Walmart GSO**: Position within Walmart's value-tier ecosystem. Compare to Walmart's own brands. Reference family/household shopping context. Mention everyday-use positioning.`,
    aliexpress: `6. **AliExpress GSO**: Position within global wholesale/value ecosystem. Reference supplier credibility tiers. Compare across price tiers. Include value-for-money vs. local retail alternatives.`,
    tiktok: `6. **TikTok GSO**: Position within creator-economy and influencer-driven commerce. Reference viral product culture. Compare to similar trending products. Include Gen Z/millennial purchasing context.`,
    instagram: `6. **Instagram GSO**: Position within lifestyle-brand and creator commerce. Reference "Instagram aesthetic" value. Compare to typical Instagram-native brands. Include influencer-economy price context.`,
    facebook: `6. **Facebook GSO**: Position within local-first, community-driven commerce. Reference local market dynamics. Compare to typical Marketplace seller types. Include social-commerce context.`,
    google_shopping: `6. **Google Shopping GSO**: Position for product knowledge panels and comparison shopping. Structure for Shopping Graph inclusion. Compare across multiple retailers (Google aggregates prices).`,
    pinterest: `6. **Pinterest GSO**: Position within Pinterest's inspiration-to-purchase journey. Reference planning mindset (events, spaces, outfits). Include "save-worthy" attributes. Mention seasonal purchase patterns.`,
    generic: "",
  };
  return instructions[platform] || "";
}

/**
 * Fallback generators (improved quality)
 */
function generateFallbackSEODescription(category, skuName) {
  const parts = [];
  const productType = category.toLowerCase();
  
  parts.push(`${category} for everyday wear or special occasions.`);
  parts.push(`Quality craftsmanship with attention to detail.`);
  if (skuName) parts.push(`Product code: ${skuName}.`);
  
  return parts.join(' ');
}

function generateFallbackGEODescription(category, skuName) {
  const productType = category.toLowerCase();
  const parts = [];
  
  parts.push(`This ${productType} features professional design and construction.`);
  parts.push(`Suitable for various occasions and styling preferences.`);
  if (skuName) parts.push(`Model: ${skuName}.`);
  
  return parts.join(' ');
}

function generateFallbackGSODescription(category, skuName) {
  const productType = category.toLowerCase();
  // Don't extract brand from SKU - if no brand provided, don't invent one
  return `The ${category} is a ${productType} product featuring standard industry construction and design elements. Positioned in the mid-market segment for general consumer use. Common applications include daily wear, gifts, and personal collections. Comparable to similar products in the ${productType} category.`;
}

function buildPrompt(category, mainPrompt, variation) {
  const parts = [`Product category: ${category}.`];
  if (mainPrompt?.trim()) parts.push(mainPrompt.trim());
  if (variation?.trim()) parts.push(variation.trim());
  if (!mainPrompt.trim() && !variation.trim())
    parts.push("Professional product visualization.");
  return parts.join(" ");
}

router.post("/generate", handleGenerateRequest);
export default router;