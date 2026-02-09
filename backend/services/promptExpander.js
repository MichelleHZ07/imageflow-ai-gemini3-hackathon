import { callGeminiAPI } from "../utils/geminiClient.js";

/**
 * PromptExpander — Guided AI Reasoning for Scene Generation
 * 
 * Philosophy: Instead of hardcoding rules or keyword lists, we guide Gemini
 * through a structured reasoning chain. The AI analyzes the user's intent,
 * the product's visual identity, and photographic principles to produce
 * scene variations that are coherent, diverse, and commercially effective.
 * 
 * The reasoning chain:
 *   PERCEIVE → INTERPRET → DECIDE → COMPOSE
 * 
 * This approach lets the model leverage its multimodal understanding
 * rather than relying on brittle pattern matching.
 */

/**
 * Expand a user prompt into multiple scene variations using guided AI reasoning
 * @param {string} mainPrompt - User's text prompt describing desired output
 * @param {string} productCategory - Product category for domain context
 * @param {number} count - Number of scene variations to generate
 * @param {string[]} mainImages - Base64 image data URLs for visual context
 * @returns {{ prompts: string[], error?: string }}
 */
export async function expandPromptWithAI(mainPrompt, productCategory, count = 4, mainImages = []) {
  console.log(`🔄 [PromptExpander] Fresh generation — guided reasoning mode`);
  console.log(`📷 [PromptExpander] Visual context: ${mainImages?.length || 0} image(s)`);

  if (!mainPrompt?.trim()) {
    return {
      prompts: [],
      error: "Prompt is empty. Please describe what you want to generate.",
    };
  }

  // ──────────────────────────────────────────────────────
  // GUIDED REASONING PROMPT
  // 
  // Rather than giving Gemini a checklist of keywords to match,
  // we ask it to THINK through a structured decision framework.
  // This produces more nuanced, context-aware scene variations.
  // ──────────────────────────────────────────────────────

  const hasVisualContext = mainImages?.length > 0;

  const reasoningPrompt = `You are a professional photography director planning a product shoot.

You will reason through 4 stages, then output exactly ${count} scene descriptions.

═══ CONTEXT ═══
Product category: ${productCategory}
Creative brief from client: "${mainPrompt}"
${hasVisualContext ? "Product reference photo: [ATTACHED — study it carefully]" : "No reference photo provided — infer from the category and brief."}

═══ STAGE 1: PERCEIVE ═══
${hasVisualContext
    ? `Study the attached product image. In your mind, identify:
  - What is this product? (type, shape, material, color palette, texture)
  - What is its visual character? (delicate vs. bold, matte vs. glossy, organic vs. geometric)
  - What is its scale? (wearable, handheld, tabletop, furniture-scale)`
    : `Based on the category "${productCategory}" and the brief, imagine:
  - What does this product likely look like?
  - What are its probable materials and visual character?`}

═══ STAGE 2: INTERPRET ═══
Read the client's brief carefully: "${mainPrompt}"

Determine the VARIATION STRATEGY by reasoning about what the client wants:

Ask yourself these questions:
  a) Is the client describing ONE environment and wanting to see it from multiple viewpoints?
     → This suggests a FIXED-SCENE strategy (same setting, vary camera work)
  b) Is the client asking for the product in MULTIPLE contexts or locations?
     → This suggests a MULTI-SCENE strategy (different environments)
  c) Is the brief OPEN-ENDED with no specific scene direction?
     → Default to MULTI-SCENE to showcase the product's versatility

There is no keyword checklist — use your judgment as a creative director.

═══ STAGE 3: DECIDE ═══
Based on your interpretation, commit to ONE strategy:

FIXED-SCENE strategy:
  - Lock in ONE environment (the one described or implied)
  - Create variety through: camera angle, focal length, distance, lighting direction, depth of field
  - Think like a cinematographer: establish, medium, close-up, detail, dramatic

MULTI-SCENE strategy:
  - Design ${count} DISTINCT environments that each tell a different story
  - Consider: time of day, interior/exterior, mood, color temperature, lifestyle context
  - Think like a creative director: what settings make this product most desirable?

═══ STAGE 4: COMPOSE ═══
Write exactly ${count} scene descriptions.

Each description should:
  - Be a single line, under 15 words
  - Describe the SCENE and CAMERA, not the product itself
  - Be specific enough for an image generation model to recreate
  - Feel distinct from every other description in the set

${hasVisualContext ? "Match the visual tone and style suggested by the product's actual appearance." : ""}

═══ OUTPUT ═══
Output ONLY the ${count} descriptions, one per line.
No numbering, no labels, no commentary, no reasoning text.`;

  try {
    const model = process.env.PROMPT_MODEL || "gemini-3-flash-preview";
    console.log(`🤖 [PromptExpander] Model: ${model}`);

    // Build multimodal content — text prompt + optional product image
    const contentParts = [{ text: reasoningPrompt.trim() }];

    if (hasVisualContext) {
      const attached = attachProductImage(mainImages[0]);
      if (attached) {
        contentParts.push(attached);
        console.log(`📷 [PromptExpander] Attached product image (${attached.inlineData.mimeType}, ${Math.round(attached.inlineData.data.length / 1024)}KB)`);
      }
    }

    const resp = await callGeminiAPI(model, {
      systemInstruction: {
        parts: [{
          text: [
            "You are a photography director who thinks visually.",
            "You reason internally through the PERCEIVE → INTERPRET → DECIDE → COMPOSE stages,",
            "but you ONLY output the final scene descriptions — never your reasoning.",
            `Output exactly ${count} lines. No numbering, no commentary.`,
          ].join(" "),
        }],
      },
      contents: [{ role: "user", parts: contentParts }],
      generationConfig: {
        temperature: 0.75,   // Creative enough for variety, stable enough for coherence
        topP: 0.88,
        topK: 35,
        maxOutputTokens: 600,
        responseMimeType: "text/plain",
      },
    });

    // Extract text from response (handle multiple response formats)
    let text =
      resp?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      resp?.candidates?.[0]?.output_text?.trim() ||
      resp?.text?.trim() ||
      "";

    if (!text) {
      console.warn("⚠️ [PromptExpander] Empty response, using fallback");
      return { prompts: generateFallbackPrompts(count) };
    }

    // Parse lines, clean any accidental numbering
    let prompts = text
      .split("\n")
      .map((line) => line.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, "").trim())
      .filter((line) => line.length > 0 && line.length < 200) // Sanity: skip empty or runaway lines
      .slice(0, count);

    // Pad if AI returned fewer than requested
    if (prompts.length < count) {
      console.warn(`⚠️ [PromptExpander] Got ${prompts.length}/${count}, padding with complementary angles`);
      prompts = padWithComplementaryAngles(prompts, count);
    }

    console.log(`🎬 [PromptExpander] Generated ${prompts.length} scene descriptions:`);
    prompts.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));

    return { prompts };
  } catch (e) {
    console.error("⚠️ [PromptExpander] Generation failed:", e.message);
    return { prompts: generateFallbackPrompts(count) };
  }
}

// ──────────────────────────────────────────────────────
// Helper: Extract and format product image for Gemini
// ──────────────────────────────────────────────────────

function attachProductImage(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith("data:image")) return null;

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;

  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  };
}

// ──────────────────────────────────────────────────────
// Fallback: When API is unavailable, generate basic
// photographic angle variations as a safety net
// ──────────────────────────────────────────────────────

function generateFallbackPrompts(count) {
  // These follow standard product photography conventions:
  // hero → detail → context → lifestyle → alternate
  const standardAngles = [
    "Front-facing hero shot with soft directional lighting",
    "Close-up detail shot emphasizing texture and material",
    "Three-quarter angle view with shallow depth of field",
    "Low angle perspective with clean gradient background",
    "Overhead flat-lay arrangement with complementary props",
    "Side profile shot with dramatic rim lighting",
  ];

  const prompts = [];
  for (let i = 0; i < count; i++) {
    prompts.push(standardAngles[i % standardAngles.length]);
  }

  console.log(`🔧 [Fallback] Generated ${prompts.length} standard photography angles`);
  return prompts;
}

// ──────────────────────────────────────────────────────
// Padding: When AI returns fewer prompts than requested,
// generate complementary angles that don't duplicate
// ──────────────────────────────────────────────────────

function padWithComplementaryAngles(existingPrompts, targetCount) {
  const complementary = [
    "Alternative angle with different lighting mood",
    "Wider environmental shot showing full context",
    "Intimate close-up highlighting key details",
    "Elevated perspective with soft bokeh background",
  ];

  const prompts = [...existingPrompts];
  let idx = 0;

  while (prompts.length < targetCount) {
    prompts.push(complementary[idx % complementary.length]);
    idx++;
  }

  console.log(`🔧 [Padding] Extended from ${existingPrompts.length} to ${prompts.length} prompts`);
  return prompts;
}