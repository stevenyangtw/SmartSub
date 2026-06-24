/**
 * 字幕合併功能相關類型定義
 */

/**
 * 字幕對齊位置 (numpad 風格的 9 宮格)
 * 7=左上, 8=中上, 9=右上
 * 4=左中, 5=居中, 6=右中
 * 1=左下, 2=中下, 3=右下
 */
export type SubtitleAlignment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * 邊框樣式
 * 1 = 邊框 + 陰影
 * 3 = 不透明背景框
 */
export type BorderStyle = 1 | 3;

/**
 * 字幕樣式配置
 * 所有顏色使用 CSS 格式 (#RRGGBB 或 rgba)
 */
export interface SubtitleStyle {
  /** 字體名稱 */
  fontName: string;
  /** 字體大小 (10-72) */
  fontSize: number;
  /** 主要顏色 (CSS 格式) */
  primaryColor: string;
  /** 邊框顏色 (CSS 格式) */
  outlineColor: string;
  /** 背景/陰影顏色 (CSS 格式) */
  backColor: string;
  /** 是否加粗 */
  bold: boolean;
  /** 是否斜體 */
  italic: boolean;
  /** 是否下劃線 */
  underline: boolean;
  /** 邊框樣式 */
  borderStyle: BorderStyle;
  /** 邊框寬度 (0-10) */
  outline: number;
  /** 陰影距離 (0-10) */
  shadow: number;
  /** 對齊位置 */
  alignment: SubtitleAlignment;
  /** 左邊距 (px) */
  marginL: number;
  /** 右邊距 (px) */
  marginR: number;
  /** 上下邊距 (px) */
  marginV: number;
}

/**
 * 預設樣式配置
 */
export interface StylePreset {
  /** 預設 ID */
  id: string;
  /** 預設名稱 */
  name: string;
  /** 國際化 key */
  nameKey: string;
  /** 樣式配置 */
  style: SubtitleStyle;
}

/**
 * 輸出方式
 * hardcode = 燒錄硬字幕（重編碼，所有播放器可見）
 * softmux = 封裝軟字幕（mkv 容器，秒級無損，播放器可開關）
 */
export type MergeOutputMode = 'hardcode' | 'softmux';

/**
 * 硬字幕燒錄的導出畫質（僅 hardcode 生效；softmux 直接流複製無損，不受此影響）。
 * 燒錄必然重編碼，畫質由 libx264 CRF 決定：值越小越接近原畫質、體積越大。
 * - original = 原畫質（CRF 18，視覺無損，體積接近源文件）
 * - high     = 高畫質（CRF 20）
 * - standard = 標準（CRF 23，等同舊版默認行為，體積更小）
 */
export type VideoQuality = 'original' | 'high' | 'standard';

/** 各畫質檔位對應的 libx264 CRF 值。 */
export const VIDEO_QUALITY_CRF: Record<VideoQuality, number> = {
  original: 18,
  high: 20,
  standard: 23,
};

/**
 * 合併配置
 */
export interface MergeConfig {
  /** 視頻文件路徑 */
  videoPath: string;
  /** 字幕文件路徑 */
  subtitlePath: string;
  /** 輸出文件路徑 */
  outputPath: string;
  /** 字幕樣式 */
  style: SubtitleStyle;
  /** 輸出方式（缺省 hardcode，向後兼容） */
  outputMode?: MergeOutputMode;
  /** 硬字幕燒錄畫質（缺省 original；僅 hardcode 生效） */
  videoQuality?: VideoQuality;
}

/**
 * 合併狀態
 */
export type MergeStatus = 'idle' | 'processing' | 'completed' | 'error';

/**
 * 合併進度信息
 */
export interface MergeProgress {
  /** 進度百分比 (0-100) */
  percent: number;
  /** 當前處理時間點 */
  timeMark: string;
  /** 目標文件大小 (KB) */
  targetSize: number;
  /** 當前狀態 */
  status: MergeStatus;
  /** 錯誤消息 */
  errorMessage?: string;
}

/**
 * 視頻信息
 */
export interface VideoInfo {
  /** 視頻路徑 */
  path: string;
  /** 文件名 */
  fileName: string;
  /** 時長 (秒) */
  duration: number;
  /** 寬度 */
  width: number;
  /** 高度 */
  height: number;
  /** 文件大小 (bytes) */
  size: number;
}

/**
 * 字幕文件信息
 */
export interface SubtitleInfo {
  /** 字幕路徑 */
  path: string;
  /** 文件名 */
  fileName: string;
  /** 字幕條數 */
  count: number;
  /** 格式 (srt, ass, vtt) */
  format: string;
}

/**
 * IPC 響應格式
 */
export interface SubtitleMergeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** 操作被用戶取消（不算失敗） */
  cancelled?: boolean;
}
