/**
 * 字幕預覽疊加層組件
 * 使用 CSS 模擬字幕效果
 */

import React from 'react';
import type { SubtitleStyle } from '../../../types/subtitleMerge';
import {
  subtitleStyleToCSS,
  getSubtitleContainerStyle,
} from './utils/styleUtils';

interface SubtitlePreviewOverlayProps {
  style: SubtitleStyle;
  text: string;
  /** 預覽盒縮放係數（盒高/333），用於讓 CSS 模擬字號≈燒錄後字號 */
  scale?: number;
}

export default function SubtitlePreviewOverlay({
  style,
  text,
  scale = 1,
}: SubtitlePreviewOverlayProps) {
  const containerStyle = getSubtitleContainerStyle(style, 0, 0, scale);
  const textStyle = subtitleStyleToCSS(style, scale);

  return (
    <div className="absolute inset-0 pointer-events-none">
      <div style={containerStyle}>
        <span style={textStyle}>{text}</span>
      </div>
    </div>
  );
}
