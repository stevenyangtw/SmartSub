/**
 * 字幕校對相關的工具函數
 * 封裝公共的字幕檢測、創建 PendingFile 等邏輯
 */

import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// 檢測到的字幕信息
export interface DetectedSubtitle {
  filePath: string;
  type: 'source' | 'translated' | 'bilingual' | 'unknown';
  language?: string;
  confidence: number;
}

// 待校對文件項
export interface PendingFile {
  id: string;
  videoPath?: string;
  fileName: string;
  detectedSubtitles: DetectedSubtitle[];
  selectedSource?: string;
  selectedTarget?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  status: 'pending' | 'proofreading' | 'completed';
  isSubtitleOnlyMode?: boolean; // 字幕導入模式，源字幕不可切換
}

// 支持的字幕類型
export type SubtitleType = 'source' | 'translated' | 'bilingual' | 'unknown';

/**
 * 按用戶任務語向判定字幕是原文還是譯文;語向不匹配時回退「en=原文」啟發式。
 * 與 main/helpers/subtitleDetector.ts 的同名邏輯保持一致(進程邊界無法共享模塊)。
 */
export function classifySubtitleLang(
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
 * 從檢測到的字幕列表中選擇最佳的源字幕和翻譯字幕
 */
export function selectBestSubtitles(
  detectedSubtitles: DetectedSubtitle[],
  excludeSource?: string,
): {
  bestSource: DetectedSubtitle | undefined;
  bestTarget: DetectedSubtitle | undefined;
} {
  // 源字幕優先選擇 source 或 unknown 類型
  const sourceSubtitles = detectedSubtitles
    .filter((s) => s.type === 'source' || s.type === 'unknown')
    .sort((a, b) => b.confidence - a.confidence);

  // 翻譯字幕優先選擇 translated 類型
  const translatedSubtitles = detectedSubtitles
    .filter(
      (s) =>
        s.type === 'translated' &&
        (!excludeSource || s.filePath !== excludeSource),
    )
    .sort((a, b) => b.confidence - a.confidence);

  return {
    bestSource: sourceSubtitles[0],
    bestTarget: translatedSubtitles[0],
  };
}

/**
 * 從影片路徑創建 PendingFile
 */
export async function createPendingFileFromVideo(
  videoPath: string,
): Promise<PendingFile> {
  // 檢測關聯的字幕
  const detectResult = await window.ipc.invoke('detectSubtitles', {
    videoPath,
  });

  const detectedSubtitles: DetectedSubtitle[] = detectResult.success
    ? detectResult.data.detectedSubtitles
    : [];

  const { bestSource, bestTarget } = selectBestSubtitles(detectedSubtitles);

  return {
    id: uuidv4(),
    videoPath,
    fileName: path.basename(videoPath),
    detectedSubtitles,
    selectedSource: bestSource?.filePath,
    selectedTarget: bestTarget?.filePath,
    sourceLanguage: bestSource?.language,
    targetLanguage: bestTarget?.language,
    status: 'pending',
  };
}

/**
 * 從字幕文件路徑創建 PendingFile
 * @param sourceFilePath 源字幕文件路徑
 * @param detectRelated 是否檢測關聯字幕（同目錄下的其他字幕）
 */
export async function createPendingFileFromSubtitle(
  sourceFilePath: string,
  detectRelated: boolean = true,
): Promise<PendingFile> {
  const sourceFileName = path.basename(sourceFilePath);
  const sourceBaseName = sourceFileName.replace(/\.[^.]+$/, '');

  // 檢測源字幕語言
  const sourceLangResult = await window.ipc.invoke('detectLanguage', {
    filePath: sourceFilePath,
  });
  const sourceLanguage = sourceLangResult.success
    ? sourceLangResult.data?.code
    : undefined;

  let detectedSubtitles: DetectedSubtitle[] = [];

  if (detectRelated) {
    // 使用檢測邏輯獲取同目錄下的相關字幕
    const detectResult = await window.ipc.invoke('detectSubtitles', {
      videoPath: sourceFilePath.replace(/\.[^.]+$/, '.mp4'), // 偽造影片路徑以複用檢測邏輯
    });

    if (detectResult.success && detectResult.data.detectedSubtitles) {
      detectedSubtitles = detectResult.data.detectedSubtitles;
    }
  }

  // 確保源字幕在列表中（標記為 source，置信度 100%）
  const sourceInList = detectedSubtitles.find(
    (s) => s.filePath === sourceFilePath,
  );
  if (!sourceInList) {
    detectedSubtitles.unshift({
      filePath: sourceFilePath,
      type: 'source',
      language: sourceLanguage,
      confidence: 100,
    });
  } else {
    // 更新源字幕信息
    sourceInList.type = 'source';
    sourceInList.confidence = 100;
  }

  // 找到置信度最高的翻譯字幕（排除源字幕）
  const translatedSubtitles = detectedSubtitles
    .filter((s) => s.filePath !== sourceFilePath && s.type !== 'source')
    .sort((a, b) => b.confidence - a.confidence);

  const bestTranslated = translatedSubtitles[0];

  return {
    id: uuidv4(),
    fileName: sourceBaseName,
    detectedSubtitles,
    selectedSource: sourceFilePath,
    selectedTarget: bestTranslated?.filePath,
    sourceLanguage,
    targetLanguage: bestTranslated?.language,
    status: 'pending',
    isSubtitleOnlyMode: true, // 標記為字幕導入模式
  };
}

/**
 * 獲取字幕文件同目錄下的可用字幕列表
 * @param subtitlePath 字幕文件路徑
 * @param sourceLanguage 用戶任務的源語言(用於語向判定,可選)
 * @param targetLanguage 用戶任務的目標語言(用於語向判定,可選)
 */
export async function getAvailableSubtitles(
  subtitlePath: string,
  sourceLanguage?: string,
  targetLanguage?: string,
): Promise<DetectedSubtitle[]> {
  const dir = path.dirname(subtitlePath);

  const scanResult = await window.ipc.invoke('scanDirectorySubtitles', {
    directoryPath: dir,
  });

  if (!scanResult.success || !scanResult.data) {
    return [];
  }

  // 對每個字幕文件進行語言檢測和置信度計算
  const detectedSubtitles = await Promise.all(
    scanResult.data.map(async (filePath: string) => {
      const langResult = await window.ipc.invoke('detectLanguage', {
        filePath,
      });
      const lang = langResult.success ? langResult.data?.code : undefined;

      // 計算置信度：與源字幕同名的文件置信度更高
      const sourceName = path
        .basename(subtitlePath, path.extname(subtitlePath))
        .replace(/\.\w{2,3}$/, '');
      const fileName = path
        .basename(filePath, path.extname(filePath))
        .replace(/\.\w{2,3}$/, '');
      const isRelated = sourceName === fileName;
      const confidence = isRelated ? 90 : 70;

      return {
        filePath,
        type: (filePath === subtitlePath
          ? 'source'
          : classifySubtitleLang(
              lang,
              sourceLanguage,
              targetLanguage,
            )) as SubtitleType,
        language: lang,
        confidence,
      };
    }),
  );

  return detectedSubtitles;
}

/**
 * 確保指定的字幕文件在列表中
 * @param subtitles 現有字幕列表
 * @param filePath 要確保存在的文件路徑
 * @param type 字幕類型
 * @param language 語言代碼
 * @returns 更新後的字幕列表
 */
export function ensureSubtitleInList(
  subtitles: DetectedSubtitle[],
  filePath: string | undefined,
  type: 'source' | 'translated',
  language?: string,
): DetectedSubtitle[] {
  if (!filePath) return subtitles;

  const exists = subtitles.some((s) => s.filePath === filePath);
  if (exists) return subtitles;

  return [
    ...subtitles,
    {
      filePath,
      type,
      language,
      confidence: 100, // 用戶已選擇的置信度設為最高
    },
  ];
}

/**
 * 從 ProofreadItem 加載 PendingFile（包括檢測可用字幕）
 * @param item ProofreadItem 數據
 */
export async function loadPendingFileFromItem(item: {
  id: string;
  videoPath?: string;
  sourceSubtitlePath: string;
  targetSubtitlePath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  status: 'pending' | 'in_progress' | 'completed';
  detectedSubtitles?: DetectedSubtitle[];
}): Promise<PendingFile> {
  let detectedSubtitles: DetectedSubtitle[] = [];
  const isSubtitleOnlyMode = !item.videoPath;

  // 如果任務中已保存了 detectedSubtitles，優先使用
  if (item.detectedSubtitles && item.detectedSubtitles.length > 0) {
    detectedSubtitles = item.detectedSubtitles.map((s) => ({
      filePath: s.filePath,
      type: s.type as 'source' | 'translated' | 'unknown',
      language: s.language,
      confidence: s.confidence,
    }));
  } else {
    // 否則重新檢測
    if (item.videoPath) {
      // 有影片：使用影片檢測
      const detectResult = await window.ipc.invoke('detectSubtitles', {
        videoPath: item.videoPath,
      });
      if (detectResult.success) {
        detectedSubtitles = detectResult.data.detectedSubtitles || [];
      }
    } else if (item.sourceSubtitlePath) {
      // 僅字幕：檢測同目錄下的其他字幕文件（按用戶任務語向判定原文/譯文）
      const userConfig = await window.ipc.invoke('getUserConfig');
      detectedSubtitles = await getAvailableSubtitles(
        item.sourceSubtitlePath,
        userConfig?.sourceLanguage,
        userConfig?.targetLanguage,
      );
    }
  }

  // 確保已選擇的字幕在列表中
  detectedSubtitles = ensureSubtitleInList(
    detectedSubtitles,
    item.sourceSubtitlePath,
    'source',
    item.sourceLanguage,
  );
  detectedSubtitles = ensureSubtitleInList(
    detectedSubtitles,
    item.targetSubtitlePath,
    'translated',
    item.targetLanguage,
  );

  return {
    id: item.id,
    videoPath: item.videoPath,
    fileName: item.videoPath
      ? path.basename(item.videoPath)
      : path.basename(item.sourceSubtitlePath),
    detectedSubtitles,
    selectedSource: item.sourceSubtitlePath,
    selectedTarget: item.targetSubtitlePath,
    sourceLanguage: item.sourceLanguage,
    targetLanguage: item.targetLanguage,
    status: item.status === 'completed' ? 'completed' : 'pending',
    isSubtitleOnlyMode,
  };
}

/**
 * 將 PendingFile 轉換為保存格式（用於創建/更新任務）
 */
export function pendingFileToSaveFormat(file: PendingFile): {
  id: string;
  videoPath?: string;
  sourceSubtitlePath: string;
  targetSubtitlePath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  detectedSubtitles: DetectedSubtitle[];
  status: 'pending' | 'in_progress' | 'completed';
} {
  // 將 PendingFile 的 status 映射到 ProofreadItem 的 status
  const itemStatus =
    file.status === 'completed'
      ? 'completed'
      : file.status === 'proofreading'
        ? 'in_progress'
        : 'pending';

  return {
    id: file.id, // 保留原始 ID
    videoPath: file.videoPath,
    sourceSubtitlePath: file.selectedSource || '',
    targetSubtitlePath: file.selectedTarget,
    sourceLanguage: file.sourceLanguage,
    targetLanguage: file.targetLanguage,
    detectedSubtitles: file.detectedSubtitles.map((s) => ({
      filePath: s.filePath,
      type: s.type,
      language: s.language,
      confidence: s.confidence,
    })),
    status: itemStatus,
  };
}
