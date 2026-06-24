/**
 * 字幕校對相關類型定義
 */

// 檢測到的字幕類型
export type DetectedSubtitleType =
  | 'source'
  | 'translated'
  | 'bilingual'
  | 'unknown';

// 檢測到的字幕信息
export interface DetectedSubtitle {
  type: DetectedSubtitleType;
  filePath: string;
  language?: string;
  confidence: number; // 匹配置信度 0-100
}

// 字幕檢測結果
export interface SubtitleDetectionResult {
  videoFile: string;
  detectedSubtitles: DetectedSubtitle[];
}

// 字幕匹配規則
export interface SubtitleMatchRule {
  id: string;
  name: string;
  sourcePattern: string;
  targetPattern: string;
  priority: number;
  isDefault?: boolean;
}

// 字幕匹配結果
export interface SubtitleMatchResult {
  baseName: string;
  source?: string;
  target?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

// ============ 批量校對任務相關 ============

// 單個校對項目（一個視頻/字幕對）
export interface ProofreadItem {
  id: string;
  videoPath?: string;
  sourceSubtitlePath: string;
  targetSubtitlePath?: string;
  sourceLanguage?: string; // 自動檢測的語言
  targetLanguage?: string;
  lastPosition: number; // 上次校對到的字幕索引
  totalCount: number; // 總字幕數
  modifiedCount: number; // 修改次數
  status: 'pending' | 'in_progress' | 'completed';
  // 可選字幕列表（包含檢測到的和用戶上傳的）
  detectedSubtitles?: DetectedSubtitle[];
}

// 校對任務（包含多個項目）
export interface ProofreadTask {
  id: string;
  name: string; // 任務名稱，默認取第一個文件名
  createdAt: number;
  updatedAt: number;
  items: ProofreadItem[]; // 包含的校對項目
  currentItemIndex: number; // 當前正在校對的項目索引
  status: 'in_progress' | 'completed';
}

// 兼容舊版本的歷史記錄（將被遷移）
export interface ProofreadHistory {
  id: string;
  createdAt: number;
  updatedAt: number;
  videoPath?: string;
  sourceSubtitlePath: string;
  targetSubtitlePath?: string;
  sourceLanguage: string;
  targetLanguage: string;
  lastPosition: number;
  modifiedCount: number;
  totalCount: number;
  status: 'in_progress' | 'completed';
  displayName?: string;
}

// 獨立校對模式的字幕配置
export interface StandaloneSubtitleConfig {
  videoPath?: string;
  sourceSubtitlePath: string;
  targetSubtitlePath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

// 語言檢測結果
export interface LanguageDetectionResult {
  code: string; // ISO 639-1 代碼
  name: string; // 語言名稱
  confidence: number; // 置信度
}
