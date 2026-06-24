import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { logMessage, store } from './storeManager';

/**
 * 計算字符串的MD5哈希值
 */
export function getMd5(str: string) {
  return createHash('md5').update(str).digest('hex');
}

/**
 * 將 ffmpeg 的時間標記（HH:MM:SS.xx / MM:SS / 純秒數）轉換為秒。
 * 用於在 fluent-ffmpeg 的 progress.percent 不可用時，根據 timemark 與總時長自算進度。
 */
export function timemarkToSeconds(timemark: string | number): number {
  if (typeof timemark === 'number')
    return Number.isFinite(timemark) ? timemark : 0;
  if (!timemark) return 0;
  const parts = timemark.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * 獲取臨時目錄路徑
 */
export function getTempDir() {
  const settings = store.get('settings');

  // 判斷是否使用自定義臨時目錄
  if (settings.useCustomTempDir && settings.customTempDir) {
    // 確保自定義目錄存在
    const customDir = settings.customTempDir as string;
    if (!fs.existsSync(customDir)) {
      try {
        fs.mkdirSync(customDir, { recursive: true });
      } catch (error) {
        logMessage(
          `無法創建自定義臨時目錄: ${error.message}，將使用預設臨時目錄`,
          'error',
        );
        return path.join(app.getPath('temp'), 'whisper-subtitles');
      }
    }
    return customDir;
  }

  // 預設臨時目錄
  return path.join(app.getPath('temp'), 'whisper-subtitles');
}

/**
 * 確保臨時目錄存在
 */
export function ensureTempDir() {
  const tempDir = getTempDir();
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * 格式化SRT內容
 */
export function formatSrtContent(subtitles: [string, string, string][]) {
  return subtitles
    .map((subtitle, index) => {
      const [startTime, endTime, text] = subtitle;
      // SRT格式：序號 + 時間碼 + 文本 + 空行
      return `${index + 1}\n${startTime.replace('.', ',')} --> ${endTime.replace('.', ',')}\n${text.trim()}\n`;
    })
    .join('\n');
}

/**
 * 創建或清空文件
 */
export async function createOrClearFile(filePath: string): Promise<void> {
  try {
    await fs.promises.writeFile(filePath, '');
  } catch (error) {
    logMessage(`Failed to create/clear file: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * 向文件追加內容
 */
export async function appendToFile(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await fs.promises.appendFile(filePath, content);
  } catch (error) {
    logMessage(`Failed to append to file: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * 讀取文件內容並按行分割
 */
export async function readFileContent(filePath: string): Promise<string[]> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content.split('\n');
  } catch (error) {
    logMessage(`Failed to read file: ${error.message}`, 'error');
    throw error;
  }
}

/**
 * 封裝文件對象
 */
export function wrapFileObject(filePath: string) {
  let fileSize = 0;
  try {
    fileSize = fs.statSync(filePath).size;
  } catch {
    // 文件不可讀時大小留 0，渲染層不展示
  }
  return {
    filePath,
    fileName: path.basename(filePath, path.extname(filePath)),
    fileNameWithoutExtension: path.basename(filePath),
    fileExtension: path.extname(filePath),
    directory: path.dirname(filePath),
    fileSize,
    uuid: Math.random().toString(36).substring(2),
  };
}
