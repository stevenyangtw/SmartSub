/**
 * 字幕合併功能 IPC 處理函數
 */

import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logMessage } from './storeManager';
import {
  getVideoInfo,
  mergeSubtitleToVideo,
  generateOutputPath,
  getSubtitleFormat,
  countSubtitles,
  cancelCurrentMerge,
  MERGE_CANCELLED,
} from './subtitleMerger';
import {
  acquireTaskPowerSaveBlocker,
  releaseTaskPowerSaveBlocker,
} from './powerSaveManager';
import type {
  MergeConfig,
  MergeProgress,
  SubtitleMergeResponse,
  VideoInfo,
  SubtitleInfo,
} from '../../types/subtitleMerge';

// 存儲當前進度回調
let currentProgressCallback: ((progress: MergeProgress) => void) | null = null;
const SUBTITLE_MERGE_POWER_SAVE_REASON = 'subtitleMerge';

/**
 * 設置字幕合併相關的 IPC 處理函數
 */
export function setupSubtitleMergeHandlers(mainWindow: BrowserWindow) {
  // 獲取影片信息
  ipcMain.handle(
    'subtitleMerge:getVideoInfo',
    async (event, { videoPath }): Promise<SubtitleMergeResponse<VideoInfo>> => {
      try {
        if (!fs.existsSync(videoPath)) {
          return { success: false, error: '影片文件不存在' };
        }
        const info = await getVideoInfo(videoPath);
        return { success: true, data: info };
      } catch (error) {
        logMessage(`獲取影片信息失敗: ${error}`, 'error');
        return { success: false, error: `獲取影片信息失敗: ${error}` };
      }
    },
  );

  // 獲取字幕文件信息
  ipcMain.handle(
    'subtitleMerge:getSubtitleInfo',
    async (
      event,
      { subtitlePath },
    ): Promise<SubtitleMergeResponse<SubtitleInfo>> => {
      try {
        if (!fs.existsSync(subtitlePath)) {
          return { success: false, error: '字幕文件不存在' };
        }

        const count = await countSubtitles(subtitlePath);
        const format = getSubtitleFormat(subtitlePath);

        return {
          success: true,
          data: {
            path: subtitlePath,
            fileName: path.basename(subtitlePath),
            count,
            format,
          },
        };
      } catch (error) {
        logMessage(`獲取字幕信息失敗: ${error}`, 'error');
        return { success: false, error: `獲取字幕信息失敗: ${error}` };
      }
    },
  );

  // 開始合併字幕
  ipcMain.handle(
    'subtitleMerge:startMerge',
    async (
      event,
      config: MergeConfig,
    ): Promise<SubtitleMergeResponse<string>> => {
      let powerSaveAcquired = false;
      try {
        if (!fs.existsSync(config.videoPath)) {
          return { success: false, error: '影片文件不存在' };
        }
        if (!fs.existsSync(config.subtitlePath)) {
          return { success: false, error: '字幕文件不存在' };
        }

        // 如果沒有指定輸出路徑，自動生成
        const outputPath =
          config.outputPath || generateOutputPath(config.videoPath);

        // 確保輸出目錄存在
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          await fs.promises.mkdir(outputDir, { recursive: true });
        }

        // 設置進度回調
        currentProgressCallback = (progress: MergeProgress) => {
          mainWindow.webContents.send('subtitleMerge:progress', progress);
        };

        try {
          acquireTaskPowerSaveBlocker(SUBTITLE_MERGE_POWER_SAVE_REASON);
          powerSaveAcquired = true;

          const result = await mergeSubtitleToVideo(
            { ...config, outputPath },
            currentProgressCallback,
          );
          return { success: true, data: result };
        } finally {
          currentProgressCallback = null;
          if (powerSaveAcquired) {
            releaseTaskPowerSaveBlocker(SUBTITLE_MERGE_POWER_SAVE_REASON);
          }
        }
      } catch (error) {
        // 用戶主動取消不算失敗
        if (error instanceof Error && error.message === MERGE_CANCELLED) {
          return { success: true, cancelled: true };
        }
        logMessage(`合併失敗: ${error}`, 'error');
        return { success: false, error: `合併失敗: ${error}` };
      }
    },
  );

  // 取消當前合成（kill ffmpeg + 清理半成品輸出）
  ipcMain.handle(
    'subtitleMerge:cancelMerge',
    async (): Promise<SubtitleMergeResponse<boolean>> => {
      const killed = cancelCurrentMerge();
      return { success: true, data: killed };
    },
  );

  // 選擇輸出路徑
  ipcMain.handle(
    'subtitleMerge:selectOutputPath',
    async (event, { defaultPath }): Promise<SubtitleMergeResponse<string>> => {
      try {
        const result = await dialog.showSaveDialog(mainWindow, {
          title: '選擇保存位置',
          defaultPath: defaultPath || undefined,
          filters: [
            { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, error: '用戶取消選擇' };
        }

        return { success: true, data: result.filePath };
      } catch (error) {
        logMessage(`選擇輸出路徑失敗: ${error}`, 'error');
        return { success: false, error: `選擇輸出路徑失敗: ${error}` };
      }
    },
  );

  // 生成預設輸出路徑
  ipcMain.handle(
    'subtitleMerge:generateOutputPath',
    async (
      event,
      { videoPath, suffix },
    ): Promise<SubtitleMergeResponse<string>> => {
      try {
        const outputPath = generateOutputPath(videoPath, suffix);
        return { success: true, data: outputPath };
      } catch (error) {
        return { success: false, error: `生成輸出路徑失敗: ${error}` };
      }
    },
  );

  // 打開輸出文件所在目錄
  ipcMain.handle(
    'subtitleMerge:openOutputFolder',
    async (event, { filePath }): Promise<SubtitleMergeResponse<boolean>> => {
      try {
        shell.showItemInFolder(filePath);
        return { success: true, data: true };
      } catch (error) {
        return { success: false, error: `打開目錄失敗: ${error}` };
      }
    },
  );

  logMessage('字幕合併 IPC 處理函數已註冊', 'info');
}
