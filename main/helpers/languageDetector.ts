/**
 * 語言代碼檢測器
 * 從文件名中自動檢測語言代碼
 */

import path from 'path';
import { LanguageDetectionResult } from '../../types/proofread';

// ISO 639-1 語言代碼映射表
const LANGUAGE_MAP: Record<string, string> = {
  // 常用語言
  zh: '中文',
  en: '英語',
  ja: '日語',
  ko: '韓語',
  fr: '法語',
  de: '德語',
  es: '西班牙語',
  ru: '俄語',
  pt: '葡萄牙語',
  it: '意大利語',

  // 其他歐洲語言
  nl: '荷蘭語',
  pl: '波蘭語',
  tr: '土耳其語',
  sv: '瑞典語',
  cs: '捷克語',
  da: '丹麥語',
  fi: '芬蘭語',
  el: '希臘語',
  hu: '匈牙利語',
  no: '挪威語',
  ro: '羅馬尼亞語',
  sk: '斯洛伐克語',
  hr: '克羅地亞語',
  sr: '塞爾維亞語',
  sl: '斯洛文尼亞語',
  bg: '保加利亞語',
  uk: '烏克蘭語',
  et: '愛沙尼亞語',
  lv: '拉脫維亞語',
  lt: '立陶宛語',

  // 亞洲語言
  hi: '印地語',
  th: '泰語',
  vi: '越南語',
  id: '印度尼西亞語',
  ms: '馬來語',
  ta: '泰米爾語',
  ur: '烏爾都語',
  mr: '馬拉地語',

  // 中東語言
  ar: '阿拉伯語',
  he: '希伯來語',
  fa: '波斯語',

  // 其他語言
  af: '阿非利堪斯語',
  ca: '加泰羅尼亞語',
  gl: '加利西亞語',
  tl: '塔加洛語',
  sw: '斯瓦希里語',
  cy: '威爾士語',
  mn: '蒙古語',
};

// 語言代碼別名映射（常見變體）
const LANGUAGE_ALIASES: Record<string, string> = {
  // 中文變體
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  'zh-hk': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  chs: 'zh',
  cht: 'zh',
  chi: 'zh',
  chinese: 'zh',
  cn: 'zh',

  // 英語變體
  'en-us': 'en',
  'en-gb': 'en',
  'en-au': 'en',
  eng: 'en',
  english: 'en',

  // 日語變體
  jpn: 'ja',
  jap: 'ja',
  japanese: 'ja',
  jp: 'ja',

  // 韓語變體
  kor: 'ko',
  korean: 'ko',
  kr: 'ko',

  // 法語變體
  fra: 'fr',
  fre: 'fr',
  french: 'fr',

  // 德語變體
  ger: 'de',
  deu: 'de',
  german: 'de',

  // 西班牙語變體
  spa: 'es',
  spanish: 'es',

  // 俄語變體
  rus: 'ru',
  russian: 'ru',

  // 葡萄牙語變體
  por: 'pt',
  'pt-br': 'pt',
  portuguese: 'pt',

  // 意大利語變體
  ita: 'it',
  italian: 'it',
};

// 文件名中常見的語言標記模式
const LANGUAGE_PATTERNS = [
  // 標準後綴格式：video.en.srt, video.zh-CN.srt
  /\.([a-z]{2}(?:-[a-z]{2,4})?)\.(?:srt|vtt|ass|ssa|lrc)$/i,
  // 下劃線格式：video_en.srt, video_chinese.srt
  /_([a-z]{2,10})\.(?:srt|vtt|ass|ssa|lrc)$/i,
  // 方括號格式：video[en].srt, video[chinese].srt
  /\[([a-z]{2,10})\]\.(?:srt|vtt|ass|ssa|lrc)$/i,
  // 括號格式：video(en).srt, video(chinese).srt
  /\(([a-z]{2,10})\)\.(?:srt|vtt|ass|ssa|lrc)$/i,
  // 點分隔但在擴展名之前：video.english.srt
  /\.([a-z]{2,10})\.(?:srt|vtt|ass|ssa|lrc)$/i,
];

/**
 * 從文件名檢測語言
 */
export function detectLanguageFromFilename(
  filePath: string,
): LanguageDetectionResult | null {
  const fileName = path.basename(filePath).toLowerCase();

  for (const pattern of LANGUAGE_PATTERNS) {
    const match = fileName.match(pattern);
    if (match) {
      const detected = match[1].toLowerCase();
      const normalized = normalizeLanguageCode(detected);

      if (normalized && LANGUAGE_MAP[normalized]) {
        return {
          code: normalized,
          name: LANGUAGE_MAP[normalized],
          confidence: 90,
        };
      }
    }
  }

  return null;
}

/**
 * 標準化語言代碼
 */
export function normalizeLanguageCode(code: string): string | null {
  const lower = code.toLowerCase();

  // 直接匹配 ISO 639-1 代碼
  if (LANGUAGE_MAP[lower]) {
    return lower;
  }

  // 檢查別名
  if (LANGUAGE_ALIASES[lower]) {
    return LANGUAGE_ALIASES[lower];
  }

  // 處理帶區域的代碼（如 zh-CN -> zh）
  const baseLang = lower.split('-')[0];
  if (LANGUAGE_MAP[baseLang]) {
    return baseLang;
  }

  return null;
}

/**
 * 獲取語言名稱
 */
export function getLanguageName(code: string): string {
  const normalized = normalizeLanguageCode(code);
  return normalized ? LANGUAGE_MAP[normalized] || code : code;
}

/**
 * 獲取所有支持的語言列表
 */
export function getSupportedLanguages(): Array<{ code: string; name: string }> {
  return Object.entries(LANGUAGE_MAP).map(([code, name]) => ({
    code,
    name,
  }));
}

/**
 * 從多個字幕文件中檢測語言對
 * @param userSourceLanguage 用戶任務的源語言（可選，'auto' 視為未指定）
 * @param userTargetLanguage 用戶任務的目標語言（可選）
 */
export function detectLanguagePair(
  subtitleFiles: string[],
  userSourceLanguage?: string,
  userTargetLanguage?: string,
): {
  source?: string;
  target?: string;
} {
  const languages: Array<{ file: string; lang: LanguageDetectionResult }> = [];

  for (const file of subtitleFiles) {
    const detected = detectLanguageFromFilename(file);
    if (detected) {
      languages.push({ file, lang: detected });
    }
  }

  // 如果檢測到兩種不同的語言，嘗試確定源語言和目標語言
  if (languages.length >= 2) {
    // 優先匹配用戶任務語向：源/目標語言都在檢測結果中時直接採用
    const hasUserSource =
      userSourceLanguage &&
      userSourceLanguage !== 'auto' &&
      languages.some((l) => l.lang.code === userSourceLanguage);
    const hasUserTarget =
      userTargetLanguage &&
      languages.some((l) => l.lang.code === userTargetLanguage);

    if (hasUserSource && hasUserTarget) {
      return {
        source: userSourceLanguage,
        target: userTargetLanguage,
      };
    }

    // 回退啟發式：英語作為源語言，中文作為目標語言
    const enIndex = languages.findIndex((l) => l.lang.code === 'en');
    const zhIndex = languages.findIndex((l) => l.lang.code === 'zh');

    if (enIndex >= 0 && zhIndex >= 0) {
      return {
        source: 'en',
        target: 'zh',
      };
    }

    // 否則按檢測順序，第一個作為源語言
    return {
      source: languages[0].lang.code,
      target: languages[1].lang.code,
    };
  }

  if (languages.length === 1) {
    return {
      source: languages[0].lang.code,
    };
  }

  return {};
}

/**
 * 驗證語言代碼是否有效
 */
export function isValidLanguageCode(code: string): boolean {
  return normalizeLanguageCode(code) !== null;
}
