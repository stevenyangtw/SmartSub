/**
 * 字幕樣式工具函數
 * 用於前端 CSS 預覽模擬
 */

import type {
  SubtitleStyle,
  SubtitleAlignment,
} from '../../../../types/subtitleMerge';

/**
 * libass 燒錄字幕的「等效腳本高度」：FontSize 以它為基準，再等比縮放到影片實際高度。
 * 預覽裡把「預覽盒高 / 該值」作為縮放係數，CSS 模擬字號即≈燒錄後字號，
 * 與預覽框大小、影片分辨率均無關地保持所見即所得。
 *
 * 該值由「字形墨跡高度」實測標定（比按 em 反推更可靠，整塊字符 █ 會超出 em 導致偏差）：
 *   - libass：Hiragino「中/字」FontSize=72、幀高 720 → 墨跡高 ≈141px，佔幀高 ≈19.6%；
 *   - 瀏覽器 canvas measureText：CJK 字形墨跡高 ≈ 0.91·font-size（中文字體幾乎填滿 em）。
 *   令兩者佔比相等 → 等效高度 = 72 × 0.91 / 0.196 ≈ 333（與字體、分辨率基本無關）。
 * 實測 K=333 時預覽(PingFang)與燒錄(Hiragino)字號在 24/72 檔均吻合（偏差 <1%）。
 */
export const LIBASS_SRT_PLAYRES_Y = 333;

/**
 * 將字幕樣式轉換為 CSS 樣式對象
 * 用於前端實時預覽
 * @param scale 預覽盒相對 libass 腳本高度的縮放係數（盒高/288），預設 1
 */
export function subtitleStyleToCSS(
  style: SubtitleStyle,
  scale: number = 1,
): React.CSSProperties {
  const s = scale > 0 ? scale : 1;
  const css: React.CSSProperties = {
    fontFamily: style.fontName,
    fontSize: `${style.fontSize * s}px`,
    color: style.primaryColor,
    fontWeight: style.bold ? 'bold' : 'normal',
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textAlign: getTextAlign(style.alignment),
    padding: `${4 * s}px ${8 * s}px`,
    // libass 行距≈1.2em，預覽與之對齊，避免多行字幕預覽比燒錄結果偏高
    lineHeight: 1.2,
    // 折行行為對齊 libass（force_style 未設 WrapStyle，預設僅在空格處斷行）：
    //   - pre-wrap：保留顯式換行與空格，並在空格處提供軟換行點（英文/含空格文本會折行）；
    //   - word-break: keep-all：禁止在 CJK 字符間斷行，純中文（無空格）長行不折行而是
    //     溢出幀、由預覽框 overflow-hidden 居中裁剪；
    //   - overflow-wrap: normal：不強制打斷長串。
    // 效果：僅中文不換行、含空格按空格換行，與燒錄結果一致（所見即所得）。
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    overflowWrap: 'normal',
  };

  // 根據邊框樣式處理
  if (style.borderStyle === 3) {
    // 背景框模式
    css.backgroundColor = hexToRgba(style.backColor, 0.7);
    css.borderRadius = `${4 * s}px`;
  } else {
    // 邊框 + 陰影模式
    const shadows: string[] = [];

    // 文字描邊效果（描邊偏移按比例縮放，保持與字號一致的視覺粗細）
    if (style.outline > 0) {
      const outlineSize = Math.min(style.outline, 4);
      for (let x = -outlineSize; x <= outlineSize; x++) {
        for (let y = -outlineSize; y <= outlineSize; y++) {
          if (x !== 0 || y !== 0) {
            shadows.push(`${x * s}px ${y * s}px 0 ${style.outlineColor}`);
          }
        }
      }
    }

    // 陰影效果
    if (style.shadow > 0) {
      shadows.push(
        `${style.shadow * s}px ${style.shadow * s}px ${style.shadow * s}px ${style.backColor}`,
      );
    }

    if (shadows.length > 0) {
      css.textShadow = shadows.join(', ');
    }
  }

  return css;
}

/**
 * 獲取字幕容器的定位樣式
 * @param scale 預覽盒相對 libass 腳本高度的縮放係數（盒高/288），預設 1
 */
export function getSubtitleContainerStyle(
  style: SubtitleStyle,
  containerWidth: number,
  containerHeight: number,
  scale: number = 1,
): React.CSSProperties {
  const s = scale > 0 ? scale : 1;
  const css: React.CSSProperties = {
    position: 'absolute',
    display: 'flex',
    justifyContent: getJustifyContent(style.alignment),
    alignItems: getAlignItems(style.alignment),
    padding: `${style.marginV * s}px ${style.marginR * s}px ${style.marginV * s}px ${style.marginL * s}px`,
    boxSizing: 'border-box',
    width: '100%',
    pointerEvents: 'none',
  };

  // 根據垂直對齊設置位置
  const verticalPosition = getVerticalPosition(style.alignment);
  if (verticalPosition === 'top') {
    css.top = 0;
  } else if (verticalPosition === 'middle') {
    css.top = '50%';
    css.transform = 'translateY(-50%)';
  } else {
    css.bottom = 0;
  }

  return css;
}

/**
 * 根據對齊方式獲取文本對齊
 */
function getTextAlign(
  alignment: SubtitleAlignment,
): 'left' | 'center' | 'right' {
  // 1,4,7 = 左
  // 2,5,8 = 中
  // 3,6,9 = 右
  const col = (alignment - 1) % 3;
  if (col === 0) return 'left';
  if (col === 1) return 'center';
  return 'right';
}

/**
 * 獲取水平 flex 對齊
 */
function getJustifyContent(
  alignment: SubtitleAlignment,
): 'flex-start' | 'center' | 'flex-end' {
  const col = (alignment - 1) % 3;
  if (col === 0) return 'flex-start';
  if (col === 1) return 'center';
  return 'flex-end';
}

/**
 * 獲取垂直 flex 對齊
 */
function getAlignItems(
  alignment: SubtitleAlignment,
): 'flex-start' | 'center' | 'flex-end' {
  const row = Math.floor((alignment - 1) / 3);
  if (row === 0) return 'flex-end'; // 1,2,3 底部
  if (row === 1) return 'center'; // 4,5,6 中間
  return 'flex-start'; // 7,8,9 頂部
}

/**
 * 獲取垂直位置
 */
function getVerticalPosition(
  alignment: SubtitleAlignment,
): 'top' | 'middle' | 'bottom' {
  // 1,2,3 = 底部
  // 4,5,6 = 中間
  // 7,8,9 = 頂部
  const row = Math.floor((alignment - 1) / 3);
  if (row === 0) return 'bottom';
  if (row === 1) return 'middle';
  return 'top';
}

/**
 * 十六進制顏色轉 rgba
 */
function hexToRgba(hex: string, alpha: number = 1): string {
  // 移除 # 前綴
  const cleanHex = hex.replace('#', '');

  // 解析 RGB 值
  const r = parseInt(cleanHex.substr(0, 2), 16);
  const g = parseInt(cleanHex.substr(2, 2), 16);
  const b = parseInt(cleanHex.substr(4, 2), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 格式化時長
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
