// /backend/config/productWeights.js
/**
 * E-commerce Product Visual Focus Configuration
 * Each category defines visual priorities for three modules:
 *  - sketch: concept drawing / design draft
 *  - wearing: model or usage demonstration
 *  - scene: lifestyle or product-only photography
 */

export default {
  jewelry: {
    sketch: {
      coreFocus: "Depict accurate structure, gemstone cut, and setting proportions using line-art or pencil sketch.",
      avoid: "Avoid realistic lighting, reflections, or material rendering.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.9 },
    },
    wearing: {
      coreFocus: "Show jewelry fit and sparkle on the model naturally and elegantly.",
      avoid: "Do not include multiple jewelry pieces of the same type. Keep focus on the showcased item.",
      weights: { reflection: 0.9, lighting: 0.9, clarity: 0.8 },
    },
    scene: {
      coreFocus: "Highlight the brilliance, cut, and fire of moissanite or gemstones under refined lighting.",
      avoid: "Keep the jewelry as the sharpest and brightest focus; props and backgrounds only support the design.",
      weights: { reflection: 0.9, material: 0.9, lighting: 0.8, clarity: 0.8 },
    },
  },

  fashion: {
    sketch: {
      coreFocus: "Draw the silhouette, fabric drape, and seam lines clearly with balanced proportions.",
      avoid: "Do not depict realistic folds, lighting, or materials.",
      weights: { outline: 1.0, proportion: 0.9, symmetry: 0.8 },
    },
    wearing: {
      coreFocus: "Show texture, pattern, and fit naturally on a human model.",
      avoid: "Avoid distracting poses or complex backgrounds that overpower the garment.",
      weights: { fabric: 0.9, posture: 0.8, lighting: 0.8 },
    },
    scene: {
      coreFocus: "Highlight craftsmanship, textile texture, and styling in a clean editorial setting.",
      avoid: "Keep the garment sharp and well-lit, background minimal.",
      weights: { lighting: 0.9, texture: 0.8, realism: 0.8 },
    },
  },

  beauty: {
    sketch: {
      coreFocus: "Show product geometry and packaging layout using line or concept drawing.",
      avoid: "Do not render reflective surfaces or photo lighting.",
      weights: { shape: 1.0, proportion: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show realistic application of the product on skin, lips, or hair with natural lighting.",
      avoid: "Avoid overexposure or artificial reflections on the model.",
      weights: { lighting: 0.9, color: 0.8, realism: 0.8 },
    },
    scene: {
      coreFocus: "Emphasize packaging, surface gloss, and brand color accuracy.",
      avoid: "Keep the product clear; props only enhance brand tone.",
      weights: { lighting: 0.9, color: 0.8, texture: 0.7 },
    },
  },

  bags: {
    sketch: {
      coreFocus: "Illustrate structure, handle placement, and material stitching through precise linework.",
      avoid: "Avoid real texture or environmental lighting.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show how the bag is carried or worn, keeping attention on its design and scale.",
      avoid: "Avoid cluttered backgrounds or multiple similar bags.",
      weights: { material: 0.8, lighting: 0.8, proportion: 0.9 },
    },
    scene: {
      coreFocus: "Highlight material texture, craftsmanship, and silhouette in lifestyle context.",
      avoid: "Props can appear but should not dominate the product.",
      weights: { lighting: 0.9, material: 0.8, color: 0.8 },
    },
  },

  shoes: {
    sketch: {
      coreFocus: "Show sole shape, heel height, and structural contour through precise outlines.",
      avoid: "Avoid realistic textures or materials.",
      weights: { proportion: 1.0, contour: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Demonstrate the shoes worn naturally, highlighting fit and posture.",
      avoid: "Avoid overlapping with other footwear or dark distracting backgrounds.",
      weights: { lighting: 0.9, posture: 0.8, clarity: 0.8 },
    },
    scene: {
      coreFocus: "Display craftsmanship and material texture with natural shadows and balanced lighting.",
      avoid: "Keep the shoe as the primary visual subject.",
      weights: { lighting: 0.9, material: 0.8, colorTone: 0.8 },
    },
  },

  electronics: {
    sketch: {
      coreFocus: "Draw clear product outlines, button placement, and interface geometry.",
      avoid: "Avoid reflections, shadows, or realistic textures.",
      weights: { structure: 1.0, geometry: 0.9, clarity: 0.9 },
    },
    wearing: {
      coreFocus: "Show product being used naturally by a person, emphasizing ergonomics.",
      avoid: "Avoid unrelated props or reflections that obscure the product.",
      weights: { lighting: 0.9, proportion: 0.8, realism: 0.8 },
    },
    scene: {
      coreFocus: "Highlight sleek industrial design, surface finish, and modern minimalism.",
      avoid: "Keep reflections soft and background minimal.",
      weights: { reflection: 0.8, lighting: 0.9, composition: 0.8 },
    },
  },

  furniture: {
    sketch: {
      coreFocus: "Depict product proportions, joint structure, and materials through technical drawing.",
      avoid: "Avoid realistic textures or lighting.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show product scale with a person interacting (e.g., sitting, using).",
      avoid: "Avoid cluttered rooms or strong light that reduces shape clarity.",
      weights: { lighting: 0.8, proportion: 0.9, realism: 0.8 },
    },
    scene: {
      coreFocus: "Highlight craftsmanship, material, and color harmony within interior context.",
      avoid: "Ensure furniture is centered and remains the visual anchor.",
      weights: { lighting: 0.9, composition: 0.8, colorTone: 0.8 },
    },
  },

  food: {
    sketch: {
      coreFocus: "Show food composition, shape, and plating layout through clean outline drawings.",
      avoid: "Avoid realistic lighting or textures.",
      weights: { structure: 1.0, clarity: 0.9, proportion: 0.9 },
    },
    wearing: {
      coreFocus: "Show natural hand or dining context emphasizing food freshness and realism.",
      avoid: "Avoid complex props or excessive garnishing.",
      weights: { lighting: 0.9, color: 0.9, realism: 0.8 },
    },
    scene: {
      coreFocus: "Show freshness, moisture, and appetizing texture realism.",
      avoid: "Keep food as the sharpest focal point; props only support.",
      weights: { lighting: 0.9, color: 0.9, focus: 0.8 },
    },
  },

  appliances: {
    sketch: {
      coreFocus: "Show product outline, control interface, and ergonomic proportions via clean technical lines.",
      avoid: "Avoid material realism or reflections.",
      weights: { structure: 1.0, geometry: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show scale and usability by depicting someone operating the appliance.",
      avoid: "Avoid messy backgrounds or competing visual elements.",
      weights: { proportion: 0.9, realism: 0.8, lighting: 0.8 },
    },
    scene: {
      coreFocus: "Emphasize product design, modernity, and cleanliness under soft balanced lighting.",
      avoid: "Keep focus on the appliance; background minimal.",
      weights: { lighting: 0.9, reflection: 0.8, colorTone: 0.8 },
    },
  },

  homeDecor: {
    sketch: {
      coreFocus: "Draw shape, ornament pattern, and layout using clean line-art.",
      avoid: "Avoid realistic lighting or reflections.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show the decor piece within a styled room or hand setup naturally.",
      avoid: "Avoid too many items competing for focus.",
      weights: { lighting: 0.8, composition: 0.8, realism: 0.8 },
    },
    scene: {
      coreFocus: "Highlight craftsmanship, texture, and mood lighting harmony.",
      avoid: "Ensure decor remains visually dominant.",
      weights: { lighting: 0.9, material: 0.8, composition: 0.8 },
    },
  },

  art: {
    sketch: {
      coreFocus: "Show composition structure and subject proportions through preliminary linework.",
      avoid: "Avoid realistic lighting or color rendering.",
      weights: { structure: 1.0, composition: 0.9, proportion: 0.8 },
    },
    wearing: {
      coreFocus: "Show art being held or displayed by a person for scale context.",
      avoid: "Avoid cluttered surroundings or other artworks.",
      weights: { lighting: 0.8, realism: 0.8, proportion: 0.9 },
    },
    scene: {
      coreFocus: "Highlight texture, color balance, and framing harmony under soft lighting.",
      avoid: "Keep artwork centered and uncluttered.",
      weights: { lighting: 0.9, colorTone: 0.9, composition: 0.8 },
    },
  },

  toys: {
    sketch: {
      coreFocus: "Show overall shape, articulation joints, and dimensions clearly.",
      avoid: "Avoid photorealism or shadows.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.9 },
    },
    wearing: {
      coreFocus: "Show toy being played with naturally, capturing size and color realism.",
      avoid: "Avoid complex props or multiple toys competing for focus.",
      weights: { lighting: 0.8, realism: 0.9, color: 0.8 },
    },
    scene: {
      coreFocus: "Highlight shape, color, and material texture under playful lighting.",
      avoid: "Keep the toy as the primary focus.",
      weights: { lighting: 0.9, color: 0.9, focus: 0.8 },
    },
  },

  petSupplies: {
    sketch: {
      coreFocus: "Show shape, usability, and mechanical design through line drawings.",
      avoid: "Avoid texture realism or shadows.",
      weights: { structure: 1.0, proportion: 0.9, clarity: 0.8 },
    },
    wearing: {
      coreFocus: "Show product used naturally with a pet (collar, bed, toy, etc.).",
      avoid: "Avoid too many pets or complex backgrounds.",
      weights: { lighting: 0.9, realism: 0.9, interaction: 0.8 },
    },
    scene: {
      coreFocus: "Show material, comfort, and clean presentation in bright lighting.",
      avoid: "Keep pet as optional; product remains clear.",
      weights: { lighting: 0.9, material: 0.8, colorTone: 0.8 },
    },
  },
};