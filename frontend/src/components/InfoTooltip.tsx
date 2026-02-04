// src/components/InfoTooltip.tsx
import React, { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  InfoTooltipWrapper,
  InfoTooltipButton,
  InfoTooltipBox,
  InfoTooltipArrow,
  InfoTooltipContent,
  TitleWithInfo,
} from "../styles/collapsible";

/* ===========================
   ℹ️ InfoTooltip Component
   点击显示，鼠标移开关闭
   使用 Portal 确保 tooltip 不受父元素 transform 影响
   =========================== */

interface InfoTooltipProps {
  content: string | React.ReactNode;
  maxWidth?: number;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  maxWidth = 220,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const iconRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 10,
        left: rect.left + rect.width / 2,
      });
    }
    setIsVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
  }, []);

  return (
    <InfoTooltipWrapper onMouseLeave={handleMouseLeave}>
      <InfoTooltipButton 
        ref={iconRef}
        type="button"
        onClick={handleClick}
        $isOpen={isVisible}
      >
        i
      </InfoTooltipButton>
      {isVisible && createPortal(
        <InfoTooltipBox 
          $maxWidth={maxWidth} 
          $top={position.top} 
          $left={position.left}
        >
          <InfoTooltipArrow />
          <InfoTooltipContent>{content}</InfoTooltipContent>
        </InfoTooltipBox>,
        document.body
      )}
    </InfoTooltipWrapper>
  );
};

// Re-export TitleWithInfo for convenience
export { TitleWithInfo };

export default InfoTooltip;