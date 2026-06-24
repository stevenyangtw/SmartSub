/**
 * 字幕文件檢測器
 * 負責檢測影片對應的字幕文件，以及根據規則匹配字幕文件對
 */

import path from 'path';
import fs from 'fs-extra';
import {
  DetectedSubtitle,
  SubtitleDetectionResult,
  SubtitleMatchResult,
} from '../../types/proofread';
import { detectLanguageFromFilename } from './languageDetector';
import { store } from './storeManager';

// 支持的字幕格式
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.lrc'];

// 支持的影片格式
const VIDEO_EXTENSIONS = [
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.flv',
  '.wmv',
  '.webm',
  '.3gp',
  '.ts',
  '.m4v',
];

// 常見的翻譯字幕關鍵詞
const TRANSLATED_KEYWORDS = ['translated', '翻譯', 'target', 'trans'];

// 常見的原始字幕關鍵詞
const SOURCE_KEYWORDS = ['source', '原文', 'original', 'orig'];

/**
 * 按用戶任務語向判定字幕是原文還是譯文;語向不匹配時回退「en=原文」啟發式。
 * 與 renderer/lib/proofreadUtils.ts 的同名邏輯保持一致(進程邊界無法共享模塊)。
 */
function classifySubtitleLang(
  lang: string | undefined | null,
  sourceLanguage?: string,
  targetLanguage?: string,
): 'source' | 'translated' | 'unknown' {
  if (!lang) return 'unknown';
  if (sourceLanguage && sourceLanguage !== 'auto' && lang === sourceLanguage)
    return 'source';
  if (targetLanguage && lang === targetLanguage) return 'translated';
  return lang === 'en' ? 'source' : 'translated';
}

/**
 * 讀取用戶配置的任務語向(源語言/目標語言)，供語向判定使用
 */
function getUserTaskLanguages(): {
  sourceLanguage?: string;
  targetLanguage?: string;
} {
  const userConfig = store.get('userConfig') || {};
  return {
    sourceLanguage: userConfig.sourceLanguage,
    targetLanguage: userConfig.targetLanguage,
  };
}

/**
 * 判斷文件是否為影片文件
 */
export function isVideoExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * 判斷文件是否為字幕文件
 */
export function isSubtitleExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUBTITLE_EXTENSIONS.includes(ext);
}

/**
 * 檢測影片文件對應的字幕
 */
export async function detectSubtitlesForVideo(
  videoPath: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<SubtitleDetectionResult> {
  const directory = path.dirname(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));

  // 獲取目錄下所有字幕文件
  let files: string[] = [];
  try {
    const allFiles = await fs.readdir(directory);
    files = allFiles.filter((f) => isSubtitleExtension(f));
  } catch (error) {
    console.error('Error reading directory:', error);
    return { videoFile: videoPath, detectedSubtitles: [] };
  }

  const detectedSubtitles: DetectedSubtitle[] = [];

  // 調用方傳空字符串表示未指定語向，此時回退用戶配置的任務語向
  const userLangs = getUserTaskLanguages();
  const effectiveSourceLanguage = sourceLanguage || userLangs.sourceLanguage;
  const effectiveTargetLanguage = targetLanguage || userLangs.targetLanguage;

  for (const file of files) {
    const filePath = path.join(directory, file);
    const detection = analyzeSubtitleFile(
      filePath,
      videoName,
      effectiveSourceLanguage,
      effectiveTargetLanguage,
    );
    if (detection) {
      detectedSubtitles.push(detection);
    }
  }

  // 按置信度排序
  detectedSubtitles.sort((a, b) => b.confidence - a.confidence);

  return {
    videoFile: videoPath,
    detectedSubtitles,
  };
}

/**
 * 分析單個字幕文件，判斷其類型和匹配度
 * 不再依賴預設語言，改為自動從文件名檢測
 */
function analyzeSubtitleFile(
  filePath: string,
  videoName: string,
  sourceLanguage?: string,
  targetLanguage?: string,
): DetectedSubtitle | null {
  const fileName = path.basename(filePath, path.extname(filePath));
  const fileNameLower = fileName.toLowerCase();
  const videoNameLower = videoName.toLowerCase();

  // 嘗試從文件名檢測語言
  const langDetection = detectLanguageFromFilename(filePath);
  const detectedLangCode = langDetection?.code;

  // 規則1: 與影片完全同名（最高置信度，這是最常見的命名方式）
  if (fileNameLower === videoNameLower) {
    return {
      type: 'source',
      filePath,
      language: detectedLangCode, // 可能有也可能沒有
      confidence: 95,
    };
  }

  // 規則2: 檢測到語言代碼且文件名與影片名匹配（如 test.en.srt）
  if (detectedLangCode) {
    // 去除語言後綴後檢查是否與影片名匹配
    const baseName = fileNameLower.replace(/\.[a-z]{2}(?:-[a-z]{2,4})?$/i, '');

    if (baseName === videoNameLower || fileNameLower.includes(videoNameLower)) {
      // 按用戶任務語向判定原文/譯文；語向不匹配時回退「en=原文」啟發式
      const type = classifySubtitleLang(
        detectedLangCode,
        sourceLanguage,
        targetLanguage,
      );
      return {
        type,
        filePath,
        language: detectedLangCode,
        confidence: 90,
      };
    }
  }

  // 規則3: 包含翻譯關鍵詞且包含影片名
  if (
    TRANSLATED_KEYWORDS.some((kw) => fileNameLower.includes(kw)) &&
    fileNameLower.includes(videoNameLower)
  ) {
    return { type: 'translated', filePath, confidence: 75 };
  }

  // 規則4: 包含原文關鍵詞且包含影片名
  if (
    SOURCE_KEYWORDS.some((kw) => fileNameLower.includes(kw)) &&
    fileNameLower.includes(videoNameLower)
  ) {
    return { type: 'source', filePath, confidence: 75 };
  }

  // 規則5: 文件名包含影片名（低置信度）
  if (
    fileNameLower.includes(videoNameLower) ||
    videoNameLower.includes(fileNameLower)
  ) {
    // 如果檢測到了語言，也帶上
    return {
      type: 'unknown',
      filePath,
      language: detectedLangCode,
      confidence: 50,
    };
  }

  // 規則6: 同目錄的其他字幕（最低置信度）
  return {
    type: 'unknown',
    filePath,
    language: detectedLangCode,
    confidence: 30,
  };
}

/**
 * 從文件名中提取基礎名稱（去除語言後綴）
 */
function extractBaseName(fileName: string): string {
  const name = path.basename(fileName, path.extname(fileName));

  // 通用語言代碼模式（移除常見的語言後綴）
  const langPatterns = [
    /\.[a-z]{2}(?:-[A-Za-z]{2,4})?$/i, // .en, .zh-CN 等
    /_(en|zh|ja|ko|fr|de|es|ru|pt|it)$/i, // _en, _zh 等
    /\.(chinese|english|japanese|korean)$/i, // .chinese, .english 等
  ];

  for (const pattern of langPatterns) {
    if (pattern.test(name)) {
      return name.replace(pattern, '');
    }
  }

  return name;
}

/**
 * 根據文件名自動匹配字幕文件對
 * 不再需要預設語言，改為從文件名自動檢測
 */
export async function matchSubtitlesByRules(
  files: string[],
  sourceLanguage?: string,
  targetLanguage?: string,
): Promise<SubtitleMatchResult[]> {
  // 調用方傳空字符串表示未指定語向，此時回退用戶配置的任務語向
  const userLangs = getUserTaskLanguages();
  const effectiveSourceLanguage = sourceLanguage || userLangs.sourceLanguage;
  const effectiveTargetLanguage = targetLanguage || userLangs.targetLanguage;

  // 按目錄和基礎文件名分組
  const fileGroups = new Map<string, string[]>();

  for (const file of files) {
    if (!isSubtitleExtension(file)) continue;

    const dir = path.dirname(file);
    const baseName = extractBaseName(file);
    const key = `${dir}/${baseName}`;

    if (!fileGroups.has(key)) {
      fileGroups.set(key, []);
    }
    fileGroups.get(key)!.push(file);
  }

  const results: SubtitleMatchResult[] = [];

  // 對每組文件進行匹配
  for (const [key, groupFiles] of Array.from(fileGroups.entries())) {
    const match: SubtitleMatchResult = {
      baseName: path.basename(key),
    };

    // 檢測每個文件的語言，並按用戶任務語向判定原文/譯文角色
    const filesWithLang: Array<{
      file: string;
      lang: string | undefined;
      isEnglish: boolean;
      role: 'source' | 'translated' | 'unknown';
    }> = groupFiles.map((file) => {
      const detection = detectLanguageFromFilename(file);
      return {
        file,
        lang: detection?.code,
        isEnglish: detection?.code === 'en',
        role: classifySubtitleLang(
          detection?.code,
          effectiveSourceLanguage,
          effectiveTargetLanguage,
        ),
      };
    });

    // 檢出語言的文件按角色配對（角色互斥：每個文件只會是 source 或 translated）
    const detectedFiles = filesWithLang.filter((f) => f.lang);
    let sourceFile = detectedFiles.find((f) => f.role === 'source');
    let translatedFile = detectedFiles.find((f) => f.role === 'translated');

    // 判定衝突（多個檢出語言的文件全判為同一角色、配不成一對）時，
    // 回退原有「英語=原文、非英語=譯文」配對行為
    if (detectedFiles.length >= 2 && (!sourceFile || !translatedFile)) {
      sourceFile = detectedFiles.find((f) => f.isEnglish);
      translatedFile = detectedFiles.find((f) => !f.isEnglish);
    }

    if (sourceFile) {
      match.source = sourceFile.file;
      match.sourceLanguage = sourceFile.lang;
    }
    if (translatedFile) {
      match.target = translatedFile.file;
      match.targetLanguage = translatedFile.lang;
    }

    // 如果沒有檢測到語言，按關鍵詞匹配
    if (!match.source && !match.target) {
      for (const file of groupFiles) {
        const fileName = path.basename(file, path.extname(file)).toLowerCase();

        if (SOURCE_KEYWORDS.some((kw) => fileName.includes(kw))) {
          match.source = file;
        } else if (TRANSLATED_KEYWORDS.some((kw) => fileName.includes(kw))) {
          match.target = file;
        } else if (!match.source) {
          // 預設第一個作為源
          match.source = file;
        } else if (!match.target) {
          match.target = file;
        }
      }
    }

    // 如果只檢測到一種，另一個用預設邏輯填充
    if (match.source && !match.target && groupFiles.length > 1) {
      const other = groupFiles.find((f) => f !== match.source);
      if (other) {
        match.target = other;
        const detection = detectLanguageFromFilename(other);
        match.targetLanguage = detection?.code;
      }
    }
    if (!match.source && match.target && groupFiles.length > 1) {
      const other = groupFiles.find((f) => f !== match.target);
      if (other) {
        match.source = other;
        const detection = detectLanguageFromFilename(other);
        match.sourceLanguage = detection?.code;
      }
    }

    // 只有至少有一個文件的組才加入結果
    if (match.source || match.target) {
      results.push(match);
    }
  }

  return results;
}

/**
 * 掃描目錄獲取所有字幕文件
 */
export async function scanDirectoryForSubtitles(
  directoryPath: string,
): Promise<string[]> {
  const subtitleFiles: string[] = [];

  try {
    const files = await fs.readdir(directoryPath);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile() && isSubtitleExtension(file)) {
        subtitleFiles.push(filePath);
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
  }

  return subtitleFiles;
}

/**
 * 智能掃描目錄 - 返回影片和字幕文件
 */
export async function smartScanDirectory(
  directoryPath: string,
): Promise<{ videos: string[]; subtitles: string[] }> {
  const videos: string[] = [];
  const subtitles: string[] = [];

  try {
    const files = await fs.readdir(directoryPath);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stat = await fs.stat(filePath);

      if (stat.isFile()) {
        if (isVideoExtension(file)) {
          videos.push(filePath);
        } else if (isSubtitleExtension(file)) {
          subtitles.push(filePath);
        }
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
  }

  return { videos, subtitles };
}

/**
 * 驗證字幕文件是否存在且可讀
 */
export async function validateSubtitleFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK);
    return isSubtitleExtension(filePath);
  } catch {
    return false;
  }
}
