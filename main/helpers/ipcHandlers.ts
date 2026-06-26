import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createMessageSender } from './messageHandler';
import { logMessage } from './storeManager';
import { wrapFileObject, ensureTempDir, getMd5 } from './fileUtils';
import { CONTENT_TEMPLATES } from '../translate/constants';
import { renderTemplate, getExtraResourcesPath } from './utils';
import {
  detectSubtitleFormat,
  parseSubtitleEntries,
  parseStartEndTime,
  getSubtitleFileHeader,
  serializeCue,
  convertSubtitleContent,
} from './subtitleFormats';

// 定義支持的文件擴展名常量
export const MEDIA_EXTENSIONS = [
  // 影片格式
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.flv',
  '.wmv',
  '.webm',
  // 音頻格式
  '.mp3',
  '.wav',
  '.ogg',
  '.aac',
  '.wma',
  '.flac',
  '.m4a',
  '.aiff',
  '.ape',
  '.opus',
  '.ac3',
  '.amr',
  '.au',
  '.mid',
  // 其他常見影片格式
  '.3gp',
  '.asf',
  '.rm',
  '.rmvb',
  '.vob',
  '.ts',
  '.mts',
  '.m2ts',
];

export const SUBTITLE_EXTENSIONS = [
  // 字幕格式
  '.srt',
  '.vtt',
  '.ass',
  '.ssa',
  '.lrc',
];

// 判斷文件是否為媒體文件
export function isMediaFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return MEDIA_EXTENSIONS.includes(ext);
}

// 判斷文件是否為字幕文件
export function isSubtitleFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUBTITLE_EXTENSIONS.includes(ext);
}

// 遞歸獲取資料夾中的符合任務類型的文件
async function getMediaFilesFromDirectory(
  directoryPath: string,
  taskType: string,
): Promise<string[]> {
  // 根據任務類型選擇擴展名
  const supportedExtensions =
    taskType === 'translate' ? SUBTITLE_EXTENSIONS : MEDIA_EXTENSIONS;

  const files: string[] = [];

  try {
    const entries = await fs.promises.readdir(directoryPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        // 遞歸處理子目錄
        const subDirFiles = await getMediaFilesFromDirectory(
          fullPath,
          taskType,
        );
        files.push(...subDirFiles);
      } else if (entry.isFile()) {
        // 檢查文件擴展名是否受支持
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`讀取目錄 ${directoryPath} 時出錯:`, error);
  }

  return files;
}

export function setupIpcHandlers(mainWindow: BrowserWindow) {
  ipcMain.on('message', async (event, arg) => {
    event.reply('message', `${arg} World!`);
  });

  ipcMain.on('openDialog', async (event, data) => {
    const { fileType } = data;
    console.log(fileType, 'fileType');
    const name = fileType === 'srt' ? 'Subtitle Files' : 'Media Files';
    const taskType = fileType === 'srt' ? 'translate' : 'media';

    const extensions =
      fileType === 'srt'
        ? SUBTITLE_EXTENSIONS.map((ext) => ext.substring(1))
        : MEDIA_EXTENSIONS.map((ext) => ext.substring(1));

    // macOS 支持同時選擇文件和資料夾；Windows/Linux 兩者互斥，僅支持選擇文件
    const properties: Electron.OpenDialogOptions['properties'] =
      process.platform === 'darwin'
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'];

    const result = await dialog.showOpenDialog({
      properties,
      filters: [
        {
          name: name,
          extensions: extensions,
        },
      ],
    });

    const allValidPaths: string[] = [];
    for (const filePath of result.filePaths) {
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.isDirectory()) {
          const dirFiles = await getMediaFilesFromDirectory(filePath, taskType);
          allValidPaths.push(...dirFiles);
        } else if (stats.isFile()) {
          allValidPaths.push(filePath);
        }
      } catch (error) {
        console.error(`Failed to stat file ${filePath}:`, error);
      }
    }
    event.sender.send('file-selected', allValidPaths.map(wrapFileObject));
  });

  ipcMain.on('openUrl', (event, url) => {
    shell.openExternal(url);
  });

  // 引導「試一試」示例音頻:複製到用戶數據目錄後返回——打包態 resources 目錄只讀,
  // 轉寫輸出會寫在媒體文件同目錄,必須給它一個可寫的家
  ipcMain.handle('getOnboardingSamplePath', async () => {
    const bundled = path.join(getExtraResourcesPath(), 'sample-onboarding.mp3');
    const sampleDir = path.join(app.getPath('userData'), 'sample');
    await fs.promises.mkdir(sampleDir, { recursive: true });
    const dest = path.join(sampleDir, 'sample-onboarding.mp3');
    await fs.promises.copyFile(bundled, dest);
    return dest;
  });

  ipcMain.handle('getDroppedFiles', async (event, { files, taskType }) => {
    // 處理文件和資料夾
    const allValidPaths: string[] = [];

    for (const filePath of files) {
      try {
        const stats = await fs.promises.stat(filePath);

        if (stats.isDirectory()) {
          // 如果是資料夾，遞歸獲取所有符合任務類型的文件
          const filteredFiles = await getMediaFilesFromDirectory(
            filePath,
            taskType,
          );
          allValidPaths.push(...filteredFiles);
        } else if (stats.isFile()) {
          // 如果是文件，根據任務類型過濾
          // 根據任務類型決定添加哪種文件
          if (
            (taskType === 'translate' && isSubtitleFile(filePath)) ||
            (taskType !== 'translate' && isMediaFile(filePath))
          ) {
            allValidPaths.push(filePath);
          }
        }
      } catch {
        // 如果訪問失敗，跳過此路徑
        continue;
      }
    }

    return allValidPaths.map(wrapFileObject);
  });

  // 讀取字幕文件（按擴展名自動識別 srt/vtt/ass/lrc 格式）
  ipcMain.handle('readSubtitleFile', async (event, { filePath }) => {
    try {
      if (!fs.existsSync(filePath)) {
        logMessage(`讀取字幕文件失敗: 文件不存在 ${filePath}`, 'error');
        return [];
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const format = detectSubtitleFormat(filePath);
      return parseSubtitleEntries(content, format);
    } catch (error) {
      logMessage(`讀取字幕文件錯誤: ${error.message}`, 'error');
      return [];
    }
  });

  // 讀取任意字幕文件並轉換為 WebVTT 文本（供播放器內嵌字幕軌道使用）
  ipcMain.handle('getSubtitleAsVtt', async (event, { filePath }) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const format = detectSubtitleFormat(filePath);
      const vtt = convertSubtitleContent(content, format, 'vtt');
      return { content: vtt };
    } catch (error) {
      logMessage(`轉換字幕為 VTT 失敗: ${error.message}`, 'error');
      return { error: `Error converting subtitle: ${error.message}` };
    }
  });

  // 讀取文件原始內容
  ipcMain.handle('readRawFileContent', async (event, { filePath }) => {
    try {
      if (!fs.existsSync(filePath)) {
        logMessage(`讀取文件失敗: 文件不存在 ${filePath}`, 'error');
        return { error: `File not found: ${filePath}` };
      }
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { content };
    } catch (error) {
      logMessage(`讀取文件錯誤: ${error.message}`, 'error');
      return { error: `Error reading file: ${error.message}` };
    }
  });

  // 保存字幕文件（按目標文件擴展名序列化為對應格式）
  ipcMain.handle(
    'saveSubtitleFile',
    async (event, { filePath, subtitles, contentType = 'source' }) => {
      try {
        const format = detectSubtitleFormat(filePath);
        // 計算每條字幕實際要寫入的可見文本（去掉模板帶來的尾部空行，分隔交給序列化器處理）
        const buildText = (subtitle): string => {
          if (contentType === 'source') {
            return subtitle.sourceContent ?? '';
          }
          return renderTemplate(CONTENT_TEMPLATES[contentType], {
            sourceContent: subtitle.sourceContent ?? '',
            targetContent: subtitle.targetContent ?? '',
          }).replace(/\n+$/, '');
        };

        const content =
          getSubtitleFileHeader(format) +
          subtitles
            .map((subtitle) => {
              const { startMs, endMs } = parseStartEndTime(
                subtitle.startEndTime,
              );
              return serializeCue(
                {
                  id: subtitle.id,
                  startMs,
                  endMs,
                  text: buildText(subtitle),
                },
                format,
              );
            })
            .join('');
        // 覆蓋前滾動備份一份到臨時目錄（避免汙染用戶影片目錄；失敗不阻斷保存）
        try {
          if (fs.existsSync(filePath)) {
            const backupPath = path.join(
              ensureTempDir(),
              `subtitle-backup-${getMd5(filePath)}${path.extname(filePath)}.bak`,
            );
            await fs.promises.copyFile(filePath, backupPath);
          }
        } catch (backupError) {
          logMessage(
            `備份字幕文件失敗（繼續保存）: ${backupError.message}`,
            'warning',
          );
        }
        await fs.promises.writeFile(filePath, content, 'utf-8');
        logMessage(`保存字幕文件成功: ${filePath}`, 'info');
        return { success: true };
      } catch (error) {
        logMessage(`保存字幕文件錯誤: ${error.message}`, 'error');
        return {
          error: `保存字幕文件錯誤: ${error.message}`,
        };
      }
    },
  );

  // 檢查文件是否存在
  ipcMain.handle('checkFileExists', async (event, { filePath }) => {
    try {
      const exists = fs.existsSync(filePath);
      return { exists };
    } catch (error) {
      logMessage(`檢查文件是否存在錯誤: ${error.message}`, 'error');
      return { exists: false, error: error.message };
    }
  });

  // 獲取目錄中的文件列表
  ipcMain.handle('getDirectoryFiles', async (event, { directoryPath }) => {
    try {
      const files = await fs.promises.readdir(directoryPath);
      return { files };
    } catch (error) {
      logMessage(`獲取目錄文件列表錯誤: ${error.message}`, 'error');
      return { files: [], error: error.message };
    }
  });

  ipcMain.handle(
    'selectDirectory',
    async (event, options?: { title?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: options?.title,
      });
      return {
        directoryPath: result.filePaths[0] || null,
        canceled: result.canceled,
      };
    },
  );

  // 選擇單個文件
  ipcMain.handle(
    'selectFile',
    async (
      event,
      options: { type: 'video' | 'subtitle' | 'any'; title?: string },
    ) => {
      const { type, title } = options;

      let filters: { name: string; extensions: string[] }[] = [];

      if (type === 'video') {
        filters = [
          {
            name: 'Media Files',
            extensions: MEDIA_EXTENSIONS.map((ext) => ext.substring(1)),
          },
        ];
      } else if (type === 'subtitle') {
        filters = [
          {
            name: 'Subtitle Files',
            extensions: SUBTITLE_EXTENSIONS.map((ext) => ext.substring(1)),
          },
        ];
      }

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title,
        filters: filters.length > 0 ? filters : undefined,
      });

      return {
        filePath: result.filePaths[0] || null,
        canceled: result.canceled,
      };
    },
  );

  // 選擇多個文件
  ipcMain.handle(
    'selectFiles',
    async (
      event,
      options: {
        type: 'video' | 'subtitle' | 'txt' | 'any';
        title?: string;
        multiple?: boolean;
      },
    ) => {
      const { type, title, multiple = true } = options;

      let filters: { name: string; extensions: string[] }[] = [];

      if (type === 'video') {
        filters = [
          {
            name: 'Media Files',
            extensions: MEDIA_EXTENSIONS.map((ext) => ext.substring(1)),
          },
        ];
      } else if (type === 'subtitle') {
        filters = [
          {
            name: 'Subtitle Files',
            extensions: SUBTITLE_EXTENSIONS.map((ext) => ext.substring(1)),
          },
        ];
      } else if (type === 'txt') {
        filters = [
          {
            name: 'Text Files',
            extensions: ['txt'],
          },
        ];
      }

      const properties: ('openFile' | 'multiSelections')[] = ['openFile'];
      if (multiple) {
        properties.push('multiSelections');
      }

      const result = await dialog.showOpenDialog({
        properties,
        title,
        filters: filters.length > 0 ? filters : undefined,
      });

      return {
        filePaths: result.filePaths,
        canceled: result.canceled,
      };
    },
  );
}
