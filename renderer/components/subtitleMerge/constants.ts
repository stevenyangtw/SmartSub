/**
 * 字幕合併功能常量和預設樣式
 */

import type { SubtitleStyle, StylePreset } from '../../../types/subtitleMerge';

/**
 * 按平臺返回 CJK 友好的預設字體。
 * Arial 不含 CJK 字形，中文字幕燒錄時會退化到 libass 的隨機回退字體。
 */
export const getPlatformDefaultFont = (): string => {
  if (typeof navigator === 'undefined') return 'Arial';
  const ua = `${navigator.platform || ''} ${navigator.userAgent || ''}`;
  if (/mac/i.test(ua)) return 'PingFang SC';
  if (/win/i.test(ua)) return 'Microsoft YaHei';
  return 'Noto Sans CJK SC';
};

/**
 * 預設字幕樣式
 */
export const DEFAULT_STYLE: SubtitleStyle = {
  fontName: 'Arial',
  fontSize: 24,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  backColor: '#000000',
  bold: false,
  italic: false,
  underline: false,
  borderStyle: 1,
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 20,
  marginR: 20,
  marginV: 20,
};

/**
 * 預設字幕樣式（字體按運行平臺動態決定）
 */
export const getDefaultStyle = (): SubtitleStyle => ({
  ...DEFAULT_STYLE,
  fontName: getPlatformDefaultFont(),
});

/**
 * 預設樣式列表
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'classic',
    name: '經典白字黑邊',
    nameKey: 'presetClassic',
    style: {
      fontName: 'Arial',
      fontSize: 24,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      backColor: '#000000',
      bold: false,
      italic: false,
      underline: false,
      borderStyle: 1,
      outline: 2,
      shadow: 1,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 20,
    },
  },
  {
    id: 'movie',
    name: '電影字幕',
    nameKey: 'presetMovie',
    style: {
      fontName: 'Georgia',
      fontSize: 28,
      primaryColor: '#FFFFC8',
      outlineColor: '#000000',
      backColor: '#000000',
      bold: false,
      italic: false,
      underline: false,
      borderStyle: 1,
      outline: 2,
      shadow: 2,
      alignment: 2,
      marginL: 30,
      marginR: 30,
      marginV: 30,
    },
  },
  {
    id: 'youtube',
    name: 'YouTube風格',
    nameKey: 'presetYoutube',
    style: {
      fontName: 'Roboto',
      fontSize: 22,
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      backColor: '#000000',
      bold: false,
      italic: false,
      underline: false,
      borderStyle: 3,
      outline: 0,
      shadow: 0,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 15,
    },
  },
  {
    id: 'clean',
    name: '清新簡約',
    nameKey: 'presetClean',
    style: {
      fontName: 'Helvetica Neue',
      fontSize: 22,
      primaryColor: '#FFFFFF',
      outlineColor: '#333333',
      backColor: '#000000',
      bold: false,
      italic: false,
      underline: false,
      borderStyle: 1,
      outline: 1,
      shadow: 0,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 25,
    },
  },
  {
    id: 'bold_impact',
    name: '醒目加粗',
    nameKey: 'presetBoldImpact',
    style: {
      fontName: 'Impact',
      fontSize: 26,
      primaryColor: '#FFFF00',
      outlineColor: '#000000',
      backColor: '#000000',
      bold: true,
      italic: false,
      underline: false,
      borderStyle: 1,
      outline: 3,
      shadow: 2,
      alignment: 2,
      marginL: 20,
      marginR: 20,
      marginV: 20,
    },
  },
];

/**
 * 常用字體列表
 */
export const FONT_LIST = [
  // 系統通用字體
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Impact', label: 'Impact' },
  // 中文字體
  { value: 'Microsoft YaHei', label: '微軟雅黑' },
  { value: 'SimHei', label: '黑體' },
  { value: 'SimSun', label: '宋體' },
  { value: 'KaiTi', label: '楷體' },
  { value: 'PingFang SC', label: '蘋方' },
  { value: 'Noto Sans SC', label: 'Noto Sans SC' },
  { value: 'Noto Sans CJK SC', label: 'Noto Sans CJK SC' },
  { value: 'Source Han Sans SC', label: '思源黑體' },
];

/**
 * 字號範圍
 */
export const FONT_SIZE_RANGE = {
  min: 12,
  max: 72,
  default: 24,
};

/**
 * 邊框寬度範圍
 */
export const OUTLINE_RANGE = {
  min: 0,
  max: 10,
  default: 2,
};

/**
 * 陰影距離範圍
 */
export const SHADOW_RANGE = {
  min: 0,
  max: 10,
  default: 1,
};

/**
 * 邊距範圍
 */
export const MARGIN_RANGE = {
  min: 0,
  max: 200,
  default: 20,
};

/**
 * 邊框樣式選項
 */
export const BORDER_STYLE_OPTIONS = [
  { value: 1, label: '邊框+陰影', labelKey: 'borderStyleOutline' },
  { value: 3, label: '背景框', labelKey: 'borderStyleBox' },
];
