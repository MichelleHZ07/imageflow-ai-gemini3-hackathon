import styled from "styled-components";

/* ===========================
   🧱 基础布局组件
   =========================== */

export const PageWrapper = styled.div<{ theme: any }>`
  display: flex;
  flex-direction: column;
  margin-top: 12px;
  background: ${({ theme }) => theme.colors.bg};
  color: ${({ theme }) => theme.colors.text};
  font-family: ${({ theme }) => theme.font.base};
`;

export const Card = styled.div<{ theme: any }>`
  background: ${({ theme }) => theme.colors.card};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: 16px;
  box-shadow: ${({ theme }) => theme.shadow.soft};
`;

export const GenerateButton = styled.button<{ theme: any }>`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: ${({ theme }) => theme.shadow.soft};
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

/* ===========================
   🌙 通用滑动式切换按钮（ON/OFF）
   =========================== */
/**
 * 用法示例：
 * <ToggleWrapper onClick={toggle}>
 *   <ToggleTrack>
 *     <ToggleThumb $active={isRightActive} />
 *     <ToggleLabelLeft $active={!isRightActive}>Product</ToggleLabelLeft>
 *     <ToggleLabelRight $active={isRightActive}>Creative</ToggleLabelRight>
 *   </ToggleTrack>
 * </ToggleWrapper>
 */

export const ToggleWrapper = styled.div`
  position: relative;
  width: 220px;
  height: 42px;
  cursor: pointer;
  user-select: none;

  @media (max-width: 768px) {
    width: 180px;
    height: 38px;
  }
`;

export const ToggleTrack = styled.div<{ theme: any }>`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: 9999px;
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  box-shadow: ${({ theme }) => theme.shadow.soft};
  grid-template-columns: 1fr 1fr; /* ✅ 两个格子对称分布 */
  align-items: center;
  justify-items: center;
  padding: 2px; /* ✅ 留出滑块边距 */
  transition: background 0.25s ease;
`;

export const ToggleThumb = styled.div<{ $active?: boolean; theme: any }>`
  position: absolute;
  top: 2px;
  left: ${({ $active }) => ($active ? "calc(50% + 1px)" : "2px")};
  width: calc(50% - 3px);
  height: calc(100% - 4px);
  border-radius: 9999px;
  background: ${({ theme }) => theme.colors.accent};
  transition: all 0.25s ease;
  z-index: 1;
  pointer-events: none;
  transform: ${({ $active }) => ($active ? "translateX(-0.5px)" : "translateX(0.5px)")};

  ${ToggleWrapper}:hover & {
    filter: brightness(0.96);
  }
`;

export const ToggleLabelBase = styled.div<{ $active?: boolean; theme: any }>`
  z-index: 2;
  font-weight: 700;
  font-size: 14px;
  text-align: center;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  line-height: 1;
  transition: color 0.25s ease;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.white : theme.colors.text};
`;

export const ToggleLabelLeft = styled(ToggleLabelBase)``;
export const ToggleLabelRight = styled(ToggleLabelBase)``;

/* ===========================
   🌟 通用圆角按钮（用于 Mode / Auto / Manual 等）
   =========================== */
export const PillButton = styled.button<{ $active?: boolean; theme: any }>`
  background: ${({ $active, theme }) =>
    $active ? theme.colors.accent : theme.colors.white};
  color: ${({ $active, theme }) =>
    $active ? theme.colors.white : theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 8px 16px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;