import path from 'path';
import { app } from 'electron';
import os from 'os';
import { spawn } from 'child_process';

/**
 * 敏感字段列表（小寫形式，用於不區分大小寫匹配）
 * 包含 API 密鑰、密碼、令牌等敏感信息的字段名
 */
const SENSITIVE_FIELDS = [
  'apikey',
  'apisecret',
  'secret',
  'secretkey',
  'password',
  'token',
  'accesstoken',
  'accesskey',
  'accesskeysecret',
  'authorization',
  'bearer',
  'credential',
  'credentials',
  'privatekey',
  'private_key',
  'api_key',
  'api_secret',
  'secret_key',
  'access_token',
  'access_key',
];

/**
 * 檢查字段名是否為敏感字段
 */
function isSensitiveField(fieldName: string): boolean {
  const lowerFieldName = fieldName.toLowerCase();
  return SENSITIVE_FIELDS.some(
    (sensitive) =>
      lowerFieldName === sensitive || lowerFieldName.includes(sensitive),
  );
}

/**
 * 對敏感值進行脫敏處理
 * 保留前2位和後2位，中間用 **** 替換
 */
function maskValue(value: string): string {
  if (!value || typeof value !== 'string') {
    return value;
  }

  const length = value.length;
  if (length <= 4) {
    return '****';
  }

  const visibleChars = Math.min(2, Math.floor(length / 4));
  const prefix = value.substring(0, visibleChars);
  const suffix = value.substring(length - visibleChars);
  return `${prefix}****${suffix}`;
}

/**
 * 遞歸處理對象，對敏感字段進行脫敏
 * @param obj 要處理的對象
 * @param maxDepth 最大遞歸深度，防止循環引用
 */
export function sanitizeObject(obj: any, maxDepth: number = 10): any {
  if (maxDepth <= 0) {
    return '[Max depth exceeded]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, maxDepth - 1));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveField(key)) {
      // 對敏感字段進行脫敏
      sanitized[key] =
        typeof value === 'string' ? maskValue(value) : '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // 遞歸處理嵌套對象
      sanitized[key] = sanitizeObject(value, maxDepth - 1);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * 對日誌消息進行脫敏處理
 * 支持處理字符串中的 JSON 對象和常見敏感值模式
 */
export function sanitizeLogMessage(message: string): string {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let sanitized = message;

  // 嘗試檢測和處理 JSON 對象
  const jsonPattern = /\{[\s\S]*\}/g;
  const jsonMatches = message.match(jsonPattern);

  if (jsonMatches) {
    for (const jsonStr of jsonMatches) {
      try {
        const parsed = JSON.parse(jsonStr);
        const sanitizedObj = sanitizeObject(parsed);
        sanitized = sanitized.replace(
          jsonStr,
          JSON.stringify(sanitizedObj, null, 2),
        );
      } catch {
        // 不是有效的 JSON，繼續處理下一個
      }
    }
  }

  // 處理常見的敏感值模式（如 apiKey: "xxx", "apiKey": "xxx"）
  const sensitivePatterns = SENSITIVE_FIELDS.map((field) => {
    // 匹配 key: "value" 或 key: 'value' 或 "key": "value" 等模式
    const pattern = new RegExp(
      `(["']?${field}["']?\\s*[:=]\\s*)["']([^"']+)["']`,
      'gi',
    );
    return { field, pattern };
  });

  for (const { pattern } of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, (match, prefix, value) => {
      return `${prefix}"${maskValue(value)}"`;
    });
  }

  return sanitized;
}

// 將字符串轉成模板字符串
export const renderTemplate = (template, data) => {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    result = result.replace(regex, value?.toString() || '');
  }
  return result;
};

export const isDarwin = () => os.platform() === 'darwin';

export const isWin32 = () => os.platform() === 'win32';

export const isAppleSilicon = () => {
  return os.platform() === 'darwin' && os.arch() === 'arm64';
};

export const getExtraResourcesPath = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return isProd
    ? path.join(process.resourcesPath, 'extraResources')
    : path.join(app.getAppPath(), 'extraResources');
};

export function runCommand(command, args, onProcess = undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    const sendProgress = throttle((data) => {
      onProcess && onProcess(data?.toString());
    }, 300);
    child.stdout.on('data', (data) => {
      // console.log(`${data} \n`);
      sendProgress(data);
    });

    child.stderr.on('data', (data) => {
      // console.error(`${data} \n`);
      sendProgress(data);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} process error ${code}`));
      } else {
        resolve(true);
      }
    });
  });
}

function throttle(func, limit) {
  let lastFunc;
  let lastRan;
  return function (...args) {
    const context = this;
    if (!lastRan) {
      func.apply(context, args);
      lastRan = Date.now();
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(
        function () {
          if (Date.now() - lastRan >= limit) {
            func.apply(context, args);
            lastRan = Date.now();
          }
        },
        limit - (Date.now() - lastRan),
      );
    }
  };
}

// 刪除 processFile 函數

export const defaultUserConfig = {
  sourceLanguage: 'en',
  targetLanguage: 'zh',
  customTargetSrtFileName: '${fileName}.${targetLanguage}',
  customSourceSrtFileName: '${fileName}.${sourceLanguage}',
  // 逐任務引擎：任務攜帶引擎，後端按此解析執行（缺省 builtin，任務頁預設邏輯會按"上次使用"細化）
  transcriptionEngine: 'builtin',
  model: 'tiny',
  translateProvider: 'baidu',
  translateContent: 'onlyTranslate',
  maxConcurrentTasks: 1,
  sourceSrtSaveOption: 'noSave',
  targetSrtSaveOption: 'fileNameWithLang',
  subtitleOutputFormat: 'srt',
  removeChinesePunctuation: false,
};

export function getSrtFileName(
  option: string,
  fileName: string,
  language: string,
  customFileName: string,
  templateData: { [key: string]: string },
): string {
  switch (option) {
    case 'noSave':
      return `${fileName}_temp`;
    case 'fileName':
      return fileName;
    case 'fileNameWithLang':
      return `${fileName}.${language}`;
    case 'custom':
      return renderTemplate(customFileName, templateData);
    default:
      return `${fileName}_temp`;
  }
}

/**
 * 支持的語言列表
 * 優化結構：預設使用 value 作為各平臺的語言代碼
 * 只有當某平臺的代碼與 value 不同時才顯式定義，不支持則定義為 null
 */
export const supportedLanguage = [
  // 最常用語言
  // 訊飛機器翻譯簡體中文代碼為 cn（非 zh）；小牛/騰訊均使用 zh
  { name: '中文', value: 'zh', xunfei: 'cn' },
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
  { name: '希臘語', value: 'el', doubao: null },
  { name: '匈牙利語', value: 'hu' },
  { name: '挪威語', value: 'no', baidu: null, doubao: 'nb' },
  { name: '羅馬尼亞語', value: 'ro', baidu: 'rom' },
  { name: '斯洛伐克語', value: 'sk', baidu: null, doubao: null },
  { name: '克羅地亞語', value: 'hr', baidu: null },
  { name: '塞爾維亞語', value: 'sr', baidu: null, doubao: null },
  { name: '斯洛文尼亞語', value: 'sl', baidu: 'slo', doubao: null },
  { name: '保加利亞語', value: 'bg', baidu: 'bul', doubao: null },
  { name: '烏克蘭語', value: 'uk', baidu: null },
  { name: '愛沙尼亞語', value: 'et', baidu: 'est', doubao: null },
  { name: '拉脫維亞語', value: 'lv', baidu: null, doubao: null },
  { name: '立陶宛語', value: 'lt', baidu: null, doubao: null },

  // 亞洲語言
  { name: '印地語', value: 'hi', baidu: null, doubao: null },
  { name: '泰語', value: 'th' },
  { name: '越南語', value: 'vi', baidu: 'vie' },
  { name: '印度尼西亞語', value: 'id', baidu: null },
  { name: '馬來語', value: 'ms', baidu: null },
  { name: '泰米爾語', value: 'ta', baidu: null, doubao: null },
  { name: '烏爾都語', value: 'ur', baidu: null, doubao: null },
  { name: '馬拉地語', value: 'mr', baidu: null, doubao: null },

  // 中東語言
  { name: '阿拉伯語', value: 'ar', baidu: 'ara' },
  { name: '希伯來語', value: 'he', baidu: null, doubao: null },
  { name: '波斯語', value: 'fa', baidu: null, doubao: null },

  // 其他語言
  { name: '阿非利堪斯語', value: 'af', baidu: null, doubao: null },
  { name: '加泰羅尼亞語', value: 'ca', baidu: null, doubao: null },
  { name: '加利西亞語', value: 'gl', baidu: null, doubao: null },
  { name: '塔加洛語', value: 'tl', baidu: null, doubao: null },
  { name: '斯瓦希里語', value: 'sw', baidu: null, doubao: null },
  { name: '威爾士語', value: 'cy', baidu: null, doubao: null },
  { name: '蒙古語', value: 'mn', baidu: null, volc: null, doubao: null },
  {
    name: '繁體中文',
    value: 'zh-Hant',
    baidu: 'cht',
    aliyun: 'zh-tw',
    google: 'zh-TW',
    niutrans: 'cht',
    tencent: 'zh-TW',
    xunfei: 'cht',
  },
  // 粵語：主要用於 Whisper 語音識別源語言；Google 翻譯無粵語，標記為不支持
  { name: '粵語', value: 'yue', google: null },
];

// 翻譯平臺類型
type TranslateProvider =
  | 'baidu'
  | 'volc'
  | 'aliyun'
  | 'google'
  | 'doubao'
  | 'niutrans'
  | 'tencent'
  | 'xunfei';

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
