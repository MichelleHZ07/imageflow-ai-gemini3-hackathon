import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

type ThemeMode = 'light' | 'dark';
type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// 获取系统当前主题
function getSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 用户偏好：'light', 'dark', 或 'system'（跟随系统）
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('theme-preference');
    // 如果有保存的偏好，使用它
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
    // 向后兼容：检查旧的 theme-mode 设置
    const oldSaved = localStorage.getItem('theme-mode');
    if (oldSaved === 'light' || oldSaved === 'dark') {
      return oldSaved;
    }
    // 默认跟随系统
    return 'system';
  });

  // 系统当前主题
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(getSystemTheme);

  // 实际使用的主题：如果偏好是 'system'，则跟随系统；否则使用用户选择
  const mode: ThemeMode = preference === 'system' ? systemTheme : preference;

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // 初始化时也检测一次
    handleChange(mediaQuery);

    // 添加监听器
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // 兼容旧版浏览器
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  // 保存偏好到 localStorage
  useEffect(() => {
    localStorage.setItem('theme-preference', preference);
    // 同时保存当前实际 mode，保持向后兼容
    localStorage.setItem('theme-mode', mode);
  }, [preference, mode]);

  // 更新 body 背景色以匹配 navbar（使用 card 颜色）
  useEffect(() => {
    // Card colors from theme.ts - matches navbar background
    const cardColor = mode === 'light' ? '#F5F0EA' : '#4A362B';
    document.body.style.backgroundColor = cardColor;
    
    // Also update CSS variables for consistency
    const root = document.documentElement;
    if (mode === 'light') {
      root.style.setProperty('--bg', '#F5F0EA');
      root.style.setProperty('--card', '#F5F0EA');
      root.style.setProperty('--ink', '#5B4B3F');
      root.style.setProperty('--muted', '#6e5a4e99');
      root.style.setProperty('--accent', '#49392D');
      root.style.setProperty('--border', '#C8BBAF');
      root.style.setProperty('--white', '#F9F8F6');
    } else {
      root.style.setProperty('--bg', '#4A362B');
      root.style.setProperty('--card', '#4A362B');
      root.style.setProperty('--ink', '#E8DCCE');
      root.style.setProperty('--muted', '#D1C4B6');
      root.style.setProperty('--accent', '#D7C3AB');
      root.style.setProperty('--border', '#241913');
      root.style.setProperty('--white', '#6A5244');
    }
  }, [mode]);

  // 切换主题
  const toggleTheme = useCallback(() => {
    setPreference(prev => {
      if (prev === 'system') {
        // 如果当前是跟随系统，切换到与当前系统主题相反的模式
        return systemTheme === 'light' ? 'dark' : 'light';
      }
      // 否则在 light 和 dark 之间切换
      return prev === 'light' ? 'dark' : 'light';
    });
  }, [systemTheme]);

  return (
    <ThemeContext.Provider value={{ mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeProvider');
  }
  return context;
}