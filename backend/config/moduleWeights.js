// /backend/config/moduleWeights.js
// -------------------------------------------
// 定义各模块（sketch / wearing / scene / implant）的核心视觉逻辑
// -------------------------------------------

export const MODULE_RULES = {
  /**
   * ✏️ Sketch 模块：
   * 用于生成设计草稿或构思图，强调结构清晰与设计逻辑。
   */
  sketch: {
    focus: "Line precision, clean composition, concept visibility.",
    constraints:
      "Avoid photo-realism. Use simple linework and design-based presentation. Do not generate real materials or lighting reflections.",
    weights: {
      structure: 0.9,
      design: 0.9,
      color: 0.3,
      lighting: 0.1,
    },
  },

  /**
   * 👗 Wearing 模块：
   * 用于生成模特佩戴图，强调比例、质感、人与饰品关系。
   */
  wearing: {
    focus:
      "Human model realism, proportional accuracy, natural posture, and material lighting.",
    constraints:
      "Preserve the human model's natural appearance and expression. Do not change identity, face, or ethnicity. Keep jewelry physically accurate and aligned. Maintain product as focal point; model supports clarity only.",
    weights: {
      human: 0.9,
      lighting: 0.8,
      proportion: 0.9,
      background: 0.4,
    },
  },

  /**
   * 🪞 Scene 模块：
   * 用于生成静物或环境展示图。禁止生成人物。
   */
  scene: {
    focus:
      "Product-centered composition, realistic lighting, and surface interaction.",
    constraints:
      "Do NOT include any human figure, body part, hand, or reflection of a person. Focus purely on background, environment texture, and natural shadow.",
    weights: {
      product: 1.0,
      lighting: 0.9,
      background: 0.8,
      human: 0.0,
    },
  },

  /**
   * 🧩 Implant 模块：
   * 用于将产品嵌入背景或场景中，强调光影与色调匹配。
   */
  implant: {
    focus:
      "Accurate product placement, seamless lighting and shadow integration.",
    constraints:
      "Ensure lighting direction, tone, and color temperature match between the product and background. Avoid overly bright edges or artificial glow.",
    weights: {
      product: 1.0,
      lighting: 0.9,
      shadowBlend: 0.8,
      reflectionBalance: 0.75,
      composition: 0.8,
    },
  },
};

// 默认导出，便于 promptEnhancer 引入
export default MODULE_RULES;