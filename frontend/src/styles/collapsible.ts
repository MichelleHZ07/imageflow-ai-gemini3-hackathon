// src/styles/collapsible.ts
// Clean two-column panel layout system
import styled from "styled-components";

/* ===========================
   📐 Layout Constants
   =========================== */

export const COLLAPSED_WIDTH = 52;

/* ===========================
   📝 Panel Card - Two Column Layout
   =========================== */

export const PanelCard = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0; /* Allow flex children to shrink for scrolling */
  overflow: hidden;
`;

export const PanelHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
`;

export const PanelTitle = styled.h2`
  font-weight: 800;
  font-size: 24px;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

export const PanelBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 4px;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

export const PanelFooter = styled.div`
  padding-top: 16px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
  margin-top: auto;
`;

/* ===========================
   📦 Two Column Body
   =========================== */

export const TwoColumnBody = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  
  /* Center divider line using pseudo-element */
  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: ${({ theme }) => theme.colors.border};
    transform: translateX(-50%);
  }
`;

export const ColumnLeft = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 8px;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

export const ColumnRight = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 0;
  padding-left: 8px;
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

/* Column with title header */
export const ColumnHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-bottom: 4px;
  flex-shrink: 0;
`;

export const ColumnTitle = styled.h3`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

/* ===========================
   📦 Three Column Body (with Override button in middle)
   =========================== */

export const ThreeColumnBody = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

export const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 0;
  padding-right: 8px;
  min-width: 0; /* Prevent overflow */
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

export const MiddleColumn = styled.div<{ $visible?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${({ $visible }) => ($visible ? "56px" : "1px")};
  min-width: ${({ $visible }) => ($visible ? "56px" : "1px")};
  transition: width 0.2s ease, min-width 0.2s ease;
  flex-shrink: 0;
  margin: 0 8px;
  background: transparent;
`;

export const RightColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  min-height: 0;
  padding-left: 8px;
  min-width: 0; /* Prevent overflow */
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.colors.border};
    border-radius: 2px;
  }
`;

export const OverrideButton = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  
  &:hover:not(:disabled) {
    opacity: 0.9;
    transform: scale(1.02);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const OverrideArrow = styled.span`
  font-size: 12px;
  line-height: 1;
`;

export const ColumnSectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0 0 8px 0;
`;

/* ===========================
   📦 Section Components
   =========================== */

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const SectionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

export const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin: 0;
`;

export const SectionHint = styled.p`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  line-height: 1.4;
`;

export const SectionContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

/* ===========================
   🎯 Collapsible Section
   =========================== */

export const CollapsibleSection = styled.div<{ $collapsed?: boolean }>`
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  transition: all 0.2s ease;
`;

export const CollapsibleHeader = styled.div<{ $clickable?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  cursor: ${({ $clickable }) => ($clickable !== false ? "pointer" : "default")};
  
  &:hover {
    background: ${({ theme, $clickable }) => 
      $clickable !== false ? theme.colors.border + "30" : "transparent"};
  }
`;

export const CollapsibleTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

export const CollapsibleBody = styled.div<{ $collapsed?: boolean }>`
  padding: ${({ $collapsed }) => ($collapsed ? "0 14px" : "0 14px 14px")};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "1000px")};
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  transition: all 0.2s ease;
  overflow: hidden;
`;

export const ExpandIcon = styled.span<{ $expanded?: boolean }>`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.muted};
  transition: transform 0.2s ease;
  transform: rotate(${({ $expanded }) => ($expanded ? "90deg" : "0deg")});
`;

/* ===========================
   🔘 Action Buttons
   =========================== */

export const PrimaryButton = styled.button`
  width: 100%;
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: opacity 0.2s ease;
  
  &:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const SecondaryButton = styled.button`
  background: ${({ theme }) => theme.colors.inner};
  color: ${({ theme }) => theme.colors.text};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 10px 14px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border};
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const GhostButton = styled.button`
  background: transparent;
  color: ${({ theme }) => theme.colors.accent};
  border: 1px solid ${({ theme }) => theme.colors.accent};
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 8px 12px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.accent}10;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

/* ===========================
   📋 List Components
   =========================== */

export const OptionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

export const OptionItem = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: ${({ theme, $selected }) => 
    $selected ? theme.colors.accent + "15" : theme.colors.inner};
  border: 1px solid ${({ theme, $selected }) => 
    $selected ? theme.colors.accent : "transparent"};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: all 0.15s ease;
  
  &:hover {
    background: ${({ theme, $selected }) => 
      $selected ? theme.colors.accent + "20" : theme.colors.border + "50"};
  }
`;

export const RadioDot = styled.div<{ $selected?: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid ${({ theme, $selected }) => 
    $selected ? theme.colors.accent : theme.colors.muted};
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
  
  &::after {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ theme }) => theme.colors.accent};
    opacity: ${({ $selected }) => ($selected ? 1 : 0)};
    transform: scale(${({ $selected }) => ($selected ? 1 : 0)});
    transition: all 0.15s ease;
  }
`;

export const OptionLabel = styled.div<{ $selected?: boolean }>`
  font-size: 13px;
  font-weight: ${({ $selected }) => ($selected ? 600 : 500)};
  color: ${({ theme }) => theme.colors.text};
  flex: 1;
`;

export const OptionHint = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 400;
`;

/* ===========================
   🖼️ Image Grid
   =========================== */

export const ImageGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
  gap: 8px;
`;

export const ImageThumb = styled.div<{ $bg?: string }>`
  aspect-ratio: 1;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ $bg }) => ($bg ? `url(${$bg})` : "#ddd")};
  background-size: cover;
  background-position: center;
  cursor: pointer;
  position: relative;
  
  &:hover {
    opacity: 0.9;
  }
`;

export const ImageRemoveBtn = styled.button`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
  
  ${ImageThumb}:hover & {
    opacity: 1;
  }
`;

/* ===========================
   📊 Divider
   =========================== */

export const Divider = styled.div`
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin: 4px 0;
`;

/* ===========================
   🏷️ Badge & Tag
   =========================== */

export const Badge = styled.span<{ $variant?: "default" | "accent" | "muted" }>`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  background: ${({ theme, $variant }) => {
    switch ($variant) {
      case "accent": return theme.colors.accent + "20";
      case "muted": return theme.colors.inner;
      default: return theme.colors.inner;
    }
  }};
  color: ${({ theme, $variant }) => {
    switch ($variant) {
      case "accent": return theme.colors.accent;
      default: return theme.colors.muted;
    }
  }};
`;

/* ===========================
   🔄 Toggle Components
   =========================== */

export const MiniToggleWrapper = styled.div`
  cursor: pointer;
  padding: 4px;
`;

export const MiniToggleTrack = styled.div<{ $active?: boolean }>`
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: ${({ theme, $active }) => 
    $active ? theme.colors.accent : theme.colors.border};
  position: relative;
  transition: background 0.2s ease;
`;

export const MiniToggleThumb = styled.div<{ $active?: boolean }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: ${({ $active }) => ($active ? "18px" : "2px")};
  transition: left 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
`;

/* ===========================
   📦 Empty State
   =========================== */

export const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: ${({ theme }) => theme.colors.muted};
`;

export const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: 8px;
`;

export const EmptyText = styled.div`
  font-size: 13px;
  line-height: 1.5;
`;

/* ===========================
   ℹ️ InfoTooltip Components
   =========================== */

export const InfoTooltipWrapper = styled.span`
  position: relative;
  z-index: 10;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
`;

export const InfoTooltipButton = styled.button<{ $isOpen?: boolean }>`
  position: relative;
  z-index: 10;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid ${({ theme, $isOpen }) => $isOpen ? theme.colors.accent : theme.colors.muted};
  background: ${({ theme, $isOpen }) => $isOpen ? `${theme.colors.accent}15` : 'transparent'};
  color: ${({ theme, $isOpen }) => $isOpen ? theme.colors.accent : theme.colors.muted};
  font-size: 10px;
  font-weight: 700;
  font-style: italic;
  font-family: "Georgia", serif;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  margin: 0;
  line-height: 1;
  transition: all 0.2s ease;
  flex-shrink: 0;
  
  &:hover {
    border-color: ${({ theme }) => theme.colors.text};
    color: ${({ theme }) => theme.colors.text};
  }
  
  &:focus {
    outline: none;
  }
`;

export const InfoTooltipBox = styled.div<{ $maxWidth: number; $top: number; $left: number }>`
  position: fixed;
  z-index: 99999;
  width: max-content;
  max-width: ${({ $maxWidth }) => $maxWidth}px;
  top: ${({ $top }) => $top}px;
  left: ${({ $left }) => $left}px;
  transform: translateX(-50%) translateY(-100%);
  pointer-events: none;
`;

export const InfoTooltipArrow = styled.div`
  position: absolute;
  width: 8px;
  height: 8px;
  background: ${({ theme }) => theme.colors.card};
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
`;

export const InfoTooltipContent = styled.div`
  background: ${({ theme }) => theme.colors.card}ee;
  color: ${({ theme }) => theme.colors.text};
  padding: 10px 12px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(8px);
`;

export const TitleWithInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;