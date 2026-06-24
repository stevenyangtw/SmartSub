import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  DEFAULT_DOWNLOAD_ENDPOINTS,
  type DownloadEndpointConfig,
} from '../../types/downloadConfig';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ModelInfo {
  name: string;
  size: string;
  needsCoreML: boolean;
  isQuantized?: boolean;
  isEnglishOnly?: boolean;
}

export interface ModelCategory {
  id: string;
  speed: number;
  quality: number;
  minRAM: number;
  models: ModelInfo[];
}

export const modelCategories: ModelCategory[] = [
  {
    id: 'tiny',
    speed: 5,
    quality: 2,
    minRAM: 2,
    models: [
      { name: 'tiny', size: '75 MB', needsCoreML: true },
      {
        name: 'tiny-q5_1',
        size: '32.2 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'tiny-q8_0',
        size: '43.5 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'tiny.en',
        size: '77.7 MB',
        needsCoreML: true,
        isEnglishOnly: true,
      },
      {
        name: 'tiny.en-q5_1',
        size: '32.2 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
      {
        name: 'tiny.en-q8_0',
        size: '43.6 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
    ],
  },
  {
    id: 'base',
    speed: 4,
    quality: 3,
    minRAM: 4,
    models: [
      { name: 'base', size: '148 MB', needsCoreML: true },
      {
        name: 'base-q5_1',
        size: '59.7 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'base-q8_0',
        size: '81.8 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'base.en',
        size: '148 MB',
        needsCoreML: true,
        isEnglishOnly: true,
      },
      {
        name: 'base.en-q5_1',
        size: '59.7 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
      {
        name: 'base.en-q8_0',
        size: '81.8 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
    ],
  },
  {
    id: 'small',
    speed: 3,
    quality: 4,
    minRAM: 6,
    models: [
      { name: 'small', size: '488 MB', needsCoreML: true },
      {
        name: 'small-q5_1',
        size: '190 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'small-q8_0',
        size: '264 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'small.en',
        size: '488 MB',
        needsCoreML: true,
        isEnglishOnly: true,
      },
      {
        name: 'small.en-q5_1',
        size: '190 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
      {
        name: 'small.en-q8_0',
        size: '264 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
    ],
  },
  {
    id: 'medium',
    speed: 2,
    quality: 5,
    minRAM: 10,
    models: [
      { name: 'medium', size: '1.53 GB', needsCoreML: true },
      {
        name: 'medium-q5_0',
        size: '539 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'medium-q8_0',
        size: '823 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'medium.en',
        size: '1.53 GB',
        needsCoreML: true,
        isEnglishOnly: true,
      },
      {
        name: 'medium.en-q5_0',
        size: '539 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
      {
        name: 'medium.en-q8_0',
        size: '823 MB',
        needsCoreML: false,
        isQuantized: true,
        isEnglishOnly: true,
      },
    ],
  },
  {
    id: 'largeTurbo',
    speed: 3,
    quality: 5,
    minRAM: 10,
    models: [
      { name: 'large-v3-turbo', size: '1.62 GB', needsCoreML: true },
      {
        name: 'large-v3-turbo-q5_0',
        size: '574 MB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'large-v3-turbo-q8_0',
        size: '874 MB',
        needsCoreML: false,
        isQuantized: true,
      },
    ],
  },
  {
    id: 'large',
    speed: 1,
    quality: 5,
    minRAM: 16,
    models: [
      { name: 'large-v3', size: '3.1 GB', needsCoreML: true },
      {
        name: 'large-v3-q5_0',
        size: '1.08 GB',
        needsCoreML: false,
        isQuantized: true,
      },
      { name: 'large-v2', size: '3.09 GB', needsCoreML: true },
      {
        name: 'large-v2-q5_0',
        size: '1.08 GB',
        needsCoreML: false,
        isQuantized: true,
      },
      {
        name: 'large-v2-q8_0',
        size: '1.66 GB',
        needsCoreML: false,
        isQuantized: true,
      },
      { name: 'large-v1', size: '3.09 GB', needsCoreML: true },
    ],
  },
];

export const models = modelCategories.flatMap((cat) => cat.models);

export function getRecommendedCategory(totalMemoryGB: number): string {
  if (totalMemoryGB >= 16) return 'largeTurbo';
  if (totalMemoryGB >= 10) return 'small';
  if (totalMemoryGB >= 6) return 'small';
  if (totalMemoryGB >= 4) return 'base';
  return 'tiny';
}

export const needsCoreML = (model: string) => {
  const modelInfo = models.find((m) => m.name === model);
  return modelInfo ? modelInfo.needsCoreML : false;
};

/**
 * 支持的語言列表（前端使用）
 * 優化結構：預設使用 value 作為各平臺的語言代碼
 * 只有當某平臺的代碼與 value 不同時才顯式定義，不支持則定義為 null
 */
export const supportedLanguage = [
  // 最常用語言
  { name: '中文', value: 'zh' },
  { name: '英語', value: 'en' },
  { name: '日語', value: 'ja', baidu: 'jp' },
  { name: '韓語', value: 'ko', baidu: 'kor' },
  { name: '法語', value: 'fr', baidu: 'fra' },
  { name: '德語', value: 'de' },
  { name: '西班牙語', value: 'es', baidu: 'spa' },
  { name: '俄語', value: 'ru' },
  { name: '葡萄牙語', value: 'pt' },
  { name: '意大利語', value: 'it' },

  // 其他歐洲語言
  { name: '荷蘭語', value: 'nl' },
  { name: '波蘭語', value: 'pl' },
  { name: '土耳其語', value: 'tr', baidu: null },
  { name: '瑞典語', value: 'sv', baidu: 'swe' },
  { name: '捷克語', value: 'cs' },
  { name: '丹麥語', value: 'da', baidu: 'dan' },
  { name: '芬蘭語', value: 'fi', baidu: 'fin' },
  { name: '希臘語', value: 'el' },
  { name: '匈牙利語', value: 'hu' },
  { name: '挪威語', value: 'no', baidu: null },
  { name: '羅馬尼亞語', value: 'ro', baidu: 'rom' },
  { name: '斯洛伐克語', value: 'sk', baidu: null },
  { name: '克羅地亞語', value: 'hr', baidu: null },
  { name: '塞爾維亞語', value: 'sr', baidu: null },
  { name: '斯洛文尼亞語', value: 'sl', baidu: 'slo' },
  { name: '保加利亞語', value: 'bg', baidu: 'bul' },
  { name: '烏克蘭語', value: 'uk', baidu: null },
  { name: '愛沙尼亞語', value: 'et', baidu: 'est' },
  { name: '拉脫維亞語', value: 'lv', baidu: null },
  { name: '立陶宛語', value: 'lt', baidu: null },

  // 亞洲語言
  { name: '印地語', value: 'hi', baidu: null },
  { name: '泰語', value: 'th' },
  { name: '越南語', value: 'vi', baidu: 'vie' },
  { name: '印度尼西亞語', value: 'id', baidu: null },
  { name: '馬來語', value: 'ms', baidu: null },
  { name: '泰米爾語', value: 'ta', baidu: null },
  { name: '烏爾都語', value: 'ur', baidu: null },
  { name: '馬拉地語', value: 'mr', baidu: null },

  // 中東語言
  { name: '阿拉伯語', value: 'ar', baidu: 'ara' },
  { name: '希伯來語', value: 'he', baidu: null },
  { name: '波斯語', value: 'fa', baidu: null },

  // 其他語言
  { name: '阿非利堪斯語', value: 'af', baidu: null },
  { name: '加泰羅尼亞語', value: 'ca', baidu: null },
  { name: '加利西亞語', value: 'gl', baidu: null },
  { name: '塔加洛語', value: 'tl', baidu: null },
  { name: '斯瓦希里語', value: 'sw', baidu: null },
  { name: '威爾士語', value: 'cy', baidu: null },
  { name: '蒙古語', value: 'mn', baidu: null, volc: null },
  {
    name: '繁體中文',
    value: 'zh-Hant',
    baidu: 'cht',
    aliyun: 'zh-tw',
    google: 'zh-TW',
  },
  // 粵語：主要用於 Whisper 語音識別源語言；Google 翻譯無粵語，標記為不支持
  { name: '粵語', value: 'yue', google: null },
];

// 翻譯平臺類型
type TranslateProvider = 'baidu' | 'volc' | 'aliyun' | 'google' | 'doubao';

/**
 * 語言代碼轉換函數
 * 優化邏輯：如果平臺有顯式定義則使用定義值（包括 null 表示不支持），否則使用 value 作為預設值
 */
export const convertLanguageCode = (
  code: string,
  target: TranslateProvider,
): string | null => {
  const lang = supportedLanguage.find((lang) => lang.value === code);
  if (!lang) return code;

  // 檢查是否有顯式定義該平臺的映射（包括 null）
  if (target in lang) {
    return lang[target] as string | null;
  }

  // 沒有顯式定義，使用 value 作為預設值
  return lang.value;
};

export const openUrl = (url) => {
  window?.ipc?.send('openUrl', url);
};

export const gitCloneSteps = {
  'Compressing objects': '打包文件',
  'Receiving objects': '下載文件',
  'Resolving deltas': '解壓文件',
  'Updating workdir': '更新文件',
};

export const isSubtitleFile = (filePath) => {
  return (
    filePath?.endsWith('.srt') ||
    filePath?.endsWith('.ass') ||
    filePath?.endsWith('.ssa') ||
    filePath?.endsWith('.vtt')
  );
};

// 純音頻擴展名：校對界面據此渲染緊湊音頻播放器，避免空的影片黑框佔位
const AUDIO_FILE_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'aac',
  'wma',
  'flac',
  'm4a',
  'aiff',
  'ape',
  'opus',
  'ac3',
  'amr',
  'au',
];

export const isAudioPath = (filePath?: string): boolean => {
  if (!filePath) return false;
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return AUDIO_FILE_EXTENSIONS.includes(ext);
};

export const getModelDownloadUrl = (
  modelName: string,
  source: 'hf-mirror' | 'huggingface',
  endpoints: Pick<
    DownloadEndpointConfig,
    'huggingFaceMirror' | 'huggingFaceOfficial'
  > = DEFAULT_DOWNLOAD_ENDPOINTS,
) => {
  // base 已含協議（如 https://hf-mirror.com），與用戶在設置頁配置的鏡像保持一致。
  const base =
    source === 'hf-mirror'
      ? endpoints.huggingFaceMirror
      : endpoints.huggingFaceOfficial;
  return `${base}/ggerganov/whisper.cpp/resolve/main/ggml-${modelName.toLowerCase()}.bin?download=true`;
};

// 添加支持的文件擴展名常量
export const SUPPORTED_FILE_EXTENSIONS = [
  // 影片格式
  'mp4',
  'avi',
  'mov',
  'mkv',
  'flv',
  'wmv',
  'webm',
  // 音頻格式
  'mp3',
  'wav',
  'ogg',
  'aac',
  'wma',
  'flac',
  'm4a',
  'aiff',
  'ape',
  'opus',
  'ac3',
  'amr',
  'au',
  'mid',
  // 其他常見格式
  '3gp',
  'asf',
  'rm',
  'rmvb',
  'vob',
  'ts',
  'mts',
  'm2ts',
  // 字幕格式
  'srt',
  'vtt',
  'ass',
  'ssa',
] as const;

// 添加文件過濾方法
export const filterSupportedFiles = (files: File[]) => {
  return Array.from(files).filter((file) => {
    const ext = file.name.toLowerCase().split('.').pop();
    return SUPPORTED_FILE_EXTENSIONS.includes(
      ext as (typeof SUPPORTED_FILE_EXTENSIONS)[number],
    );
  });
};
