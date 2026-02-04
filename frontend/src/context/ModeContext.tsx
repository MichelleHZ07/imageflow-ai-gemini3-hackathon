import React, { createContext, useContext, useState } from "react";

// ✅ 模式类型 (renamed: product → import, creative → create)
export type WorkMode = "import" | "create";

// ✅ Context 的类型定义
interface ModeContextType {
  workMode: WorkMode;
  setWorkMode: (mode: WorkMode) => void;
  toggleMode: () => void;
}

// ✅ 创建 Context
const ModeContext = createContext<ModeContextType | null>(null);

// ✅ Provider：全局提供状态
export const ModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [workMode, setWorkMode] = useState<WorkMode>("create");

  // ✅ 切换函数
  const toggleMode = () => {
    setWorkMode((prev) => (prev === "import" ? "create" : "import"));
  };

  // ✅ 这里导出 context 值
  return (
    <ModeContext.Provider value={{ workMode, setWorkMode, toggleMode }}>
      {children}
    </ModeContext.Provider>
  );
};

// ✅ Hook：组件内用 useMode() 调 context
export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}