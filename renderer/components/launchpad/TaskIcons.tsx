import React from 'react';

/**
 * 啟動臺任務卡片專屬圖標。
 * 手繪雙色調 SVG：統一 1.6 圓頭描邊 + currentColor 低透明度填充，
 * 跟隨卡片配色與明暗主題，比通用圖標庫更精緻統一。
 */
type IconProps = { className?: string };

const base = {
  viewBox: '0 0 28 28',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** 影片 → 雙語字幕：影片幀 + 雙行字幕卡（原文實、譯文虛） */
export function GenerateTranslateIcon({ className }: IconProps) {
  return (
    <svg className={className} {...base}>
      <rect x="3" y="4" width="15" height="11.5" rx="2.5" />
      <path
        d="M9.2 7.6v4.3l3.6-2.15z"
        fill="currentColor"
        fillOpacity="0.85"
        stroke="none"
      />
      <rect
        x="10"
        y="14"
        width="15"
        height="10"
        rx="2.5"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M13.2 18h8.6" />
      <path d="M13.2 21h5.4" opacity="0.45" />
    </svg>
  );
}

/** 影片 → 原文字幕：影片幀內嵌單行字幕條 */
export function GenerateIcon({ className }: IconProps) {
  return (
    <svg className={className} {...base}>
      <rect x="3.5" y="5" width="21" height="18" rx="3" />
      <path
        d="M12.2 9.2v5l4.2-2.5z"
        fill="currentColor"
        fillOpacity="0.85"
        stroke="none"
      />
      <rect
        x="7.5"
        y="17.5"
        width="13"
        height="2.6"
        rx="1.3"
        fill="currentColor"
        fillOpacity="0.6"
        stroke="none"
      />
    </svg>
  );
}

/** 翻譯已有字幕：A / 文 雙語面板 */
export function TranslateIcon({ className }: IconProps) {
  return (
    <svg className={className} {...base}>
      <rect x="3" y="3" width="13.5" height="13.5" rx="3" />
      <path d="M7 12.4 9.85 5.6l2.85 6.8" />
      <path d="M7.95 10.2h3.8" />
      <rect
        x="11.5"
        y="11.5"
        width="13.5"
        height="13.5"
        rx="3"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="M18.25 13.6v1.3" />
      <path d="M14.9 16.2h6.7" />
      <path d="M20.6 17.6c-1 2.6-2.7 4.4-5.4 5.6" />
      <path d="M15.9 17.6c1 2.6 2.7 4.4 5.4 5.6" opacity="0.45" />
    </svg>
  );
}

/** 校對字幕：字幕稿 + 圈選對勾 */
export function ProofreadIcon({ className }: IconProps) {
  return (
    <svg className={className} {...base}>
      <rect x="4" y="3.5" width="14.5" height="20" rx="3" />
      <path d="M7.5 8.5h7.5" />
      <path d="M7.5 12h7.5" />
      <path d="M7.5 15.5h4.5" opacity="0.45" />
      <circle
        cx="19.5"
        cy="19"
        r="5.5"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path d="m17.1 19 1.7 1.7 3.2-3.4" />
    </svg>
  );
}

/** 合成到影片：字幕壓入畫面底部 */
export function MergeIcon({ className }: IconProps) {
  return (
    <svg className={className} {...base}>
      <rect x="3.5" y="5" width="21" height="18" rx="3" />
      <path d="M14 8.5v4.6" />
      <path d="m11.6 11 2.4 2.4 2.4-2.4" />
      <rect
        x="7.5"
        y="16.8"
        width="13"
        height="3"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.6"
        stroke="none"
      />
    </svg>
  );
}

/**
 * 卡片角落的淡線條裝飾：同心圓弧 + 網格點，隨卡片色調染色。
 * 父級用 text-*-500/[0.x] 控制顏色與強度。
 */
export function CardDecor({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden
    >
      <circle cx="96" cy="0" r="28" />
      <circle cx="96" cy="0" r="46" />
      <circle cx="96" cy="0" r="64" />
      <circle cx="96" cy="0" r="82" />
      <circle cx="30" cy="62" r="1" fill="currentColor" stroke="none" />
      <circle cx="46" cy="78" r="1" fill="currentColor" stroke="none" />
      <path d="M20 80h6M23 77v6" strokeOpacity="0.8" />
    </svg>
  );
}
