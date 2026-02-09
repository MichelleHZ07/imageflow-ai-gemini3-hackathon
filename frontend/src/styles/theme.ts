// src/styles/theme.ts
export type Colors = {
  bg: string;
  text: string;
  accent: string;
  card: string;
  inner: string;
  border: string;
  white: string;
  muted: string;
};

const lightColors: Colors = {
  bg: "#e6daccff",        // 夜间 text 反过来当背景
  text: "#2f2119",      // 夜间 bg 反过来当文字
  accent: "#6d5a4cff",    // 金色的深色版（日间要深才看得清）
  card: "#F5EDE4",      // 奶油白卡片
  inner: "#E0D3C4",     // 浅摩卡
  border: "#C9B9A8",    // 暖米边框
  white: "rgba(246, 245, 242, 1)",     // 纯白
  muted: "#6A5244",     // 夜间 white 当次要文字
};


const darkColors: Colors = {
  // 背景：深黑巧克力（偏红，不偏绿）
  // 基准色：可可粉 + 一点黑巧
  bg: "#2f2119ff",

  // 主文字：暖奶油白，压住红但不发粉
  text: "#E8DCCEff",

  // 高亮 / 顶部条：奶油摩卡（比 text 深一点）
  accent: "#f5c98bff",

  // 卡片背景：牛奶巧克力（同色相，亮一档）
  card: "#4A362Bff",

  // 卡片内部：深摩卡（介于 bg 和 card 之间）
  inner: "#35251Cff",

  // 边框：黑巧压边（保持稳定）
  border: "#241913ff",

  // 按钮底色：拿铁咖（偏红奶咖，不灰）
  white: "#6A5244ff",

  // 次要文字：暖米灰（完全去绿）
  muted: "#C4A77D",
};

export const getTheme = (mode: 'light' | 'dark') => ({
  colors: mode === 'light' ? lightColors : darkColors,
  radius: { sm: "14px", md: "14px", lg: "22px", btn: "14px" },
  shadow: { 
    soft: mode === 'light' 
      ? "0 4px 14px rgba(0,0,0,0.06)" 
      : "0 4px 14px rgba(0,0,0,0.2)" 
  },
  font: { base: `'Inter', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial` },
});

// Default light theme for compatibility
export const theme = getTheme('light');
export const THEME = theme;
export const COLORS = lightColors;