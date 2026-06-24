import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as tar from 'tar';
import { logMessage } from './storeManager';
import type {
  DownloadProgress,
  DownloadState,
  DownloadSource,
  AddonVariant,
} from '../../types/addon';
import { getEffectivePlatform } from './cudaUtils';
import { getAddonVersionDir } from './addonManager';
import { createHash } from 'crypto';
import { resolveReleaseBaseUrl } from './download/sources';
import { MirrorDownloader } from './download/mirrorDownloader';

/**
 * 加速包發佈倉庫（注意：GitCode 鏡像用的是 whisper.node 倉庫，與 GitHub 不同）。
 */
const ADDON_REPO_SLUGS = {
  github: 'buxuku/whisper.cpp',
  gitcode: 'buxuku1/whisper.node',
};

/** addon release 基礎 URL（保留末尾斜槓，兼容舊的拼接方式）。 */
function addonBaseUrl(source: DownloadSource): string {
  return `${resolveReleaseBaseUrl(source, ADDON_REPO_SLUGS, 'latest')}/`;
}

/** addon-versions.json 的下載地址（按源） */
export function getAddonVersionsUrl(source: DownloadSource): string {
  return `${addonBaseUrl(source)}addon-versions.json`;
}

/**
 * 獲取下載狀態文件路徑
 */
function getDownloadStatePath(): string {
  return path.join(app.getPath('userData'), 'addon-download-state.json');
}

/**
 * 讀取下載狀態
 */
export function readDownloadState(): DownloadState | null {
  try {
    const statePath = getDownloadStatePath();
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(content);
      // 兼容舊版字段名 cudaVersion（v2.16 之前的斷點續傳狀態文件）
      if (parsed && parsed.cudaVersion && !parsed.variant) {
        parsed.variant = parsed.cudaVersion;
        delete parsed.cudaVersion;
      }
      return parsed;
    }
  } catch (error) {
    logMessage(`Error reading download state: ${error}`, 'error');
  }
  return null;
}

/**
 * 保存下載狀態
 */
function saveDownloadState(state: DownloadState | null): void {
  try {
    const statePath = getDownloadStatePath();
    if (state === null) {
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    } else {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
  } catch (error) {
    logMessage(`Error saving download state: ${error}`, 'error');
  }
}

/**
 * 獲取加速包文件名
 */
export function getAddonFileName(
  variant: AddonVariant,
  downloadType: 'node.gz' | 'tar.gz',
): string {
  const platform = getEffectivePlatform();
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  const osName = platform === 'win32' ? 'windows' : 'linux';

  if (variant === 'vulkan') {
    // Vulkan 無運行時依賴，僅提供 node.gz 單文件包
    if (downloadType === 'tar.gz') {
      throw new Error('Vulkan addon only provides node.gz package');
    }
    return `addon-${osName}-vulkan.node.gz`;
  }

  const versionNum = variant.replace(/\./g, '').slice(0, 4);
  return downloadType === 'tar.gz'
    ? `${osName}-cuda-${versionNum}-optimized.tar.gz`
    : `addon-${osName}-cuda-${versionNum}-optimized.node.gz`;
}

/**
 * 獲取完整下載 URL
 */
export function getDownloadUrl(
  source: DownloadSource,
  variant: AddonVariant,
  downloadType: 'node.gz' | 'tar.gz',
): string {
  const baseUrl = addonBaseUrl(source);
  const fileName = getAddonFileName(variant, downloadType);
  return `${baseUrl}${fileName}`;
}

/**
 * 加速包下載器類
 */
export class AddonDownloader {
  private mainWindow: BrowserWindow | null = null;
  private core: MirrorDownloader;

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null;
    this.core = new MirrorDownloader((p) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(
          'addon-download-progress',
          p as DownloadProgress,
        );
      }
    });
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  getProgress(): DownloadProgress {
    return this.core.getProgress() as DownloadProgress;
  }

  cancel(): void {
    this.core.cancel();
  }

  /**
   * 執行下載：按所選源 + 回退順序依次嘗試，任一源成功即返回。
   * 用戶取消（Download cancelled）不回退，直接拋出。
   */
  async download(
    source: DownloadSource,
    variant: AddonVariant,
    downloadType: 'node.gz' | 'tar.gz',
  ): Promise<string> {
    return this.core.runWithFallback(
      source,
      (s) => this.downloadFromSource(s, variant, downloadType),
      (error) =>
        (error instanceof Error ? error.message : String(error)) ===
        'Download cancelled',
      'Addon download',
      logMessage,
    );
  }

  /**
   * 從單一源執行下載（斷點續傳 + 進度走共享核心；解壓沿用 addon 專屬邏輯）
   */
  private async downloadFromSource(
    source: DownloadSource,
    variant: AddonVariant,
    downloadType: 'node.gz' | 'tar.gz',
  ): Promise<string> {
    const url = getDownloadUrl(source, variant, downloadType);
    const addonsDir = path.join(app.getPath('userData'), 'addons');
    const versionDir = getAddonVersionDir(variant);

    fs.mkdirSync(versionDir, { recursive: true });

    this.core.resetForDownload();
    this.core.updateProgress({
      status: 'downloading',
      progress: 0,
      downloaded: 0,
      total: 0,
      speed: 0,
      eta: 0,
      error: undefined,
    });

    try {
      const existingState = readDownloadState();
      let startByte = 0;
      let tempPath: string;

      if (
        existingState &&
        existingState.url === url &&
        fs.existsSync(existingState.tempPath)
      ) {
        tempPath = existingState.tempPath;
        const stat = fs.statSync(tempPath);
        startByte = stat.size;

        if (existingState.total > 0 && stat.size >= existingState.total) {
          logMessage(
            'Download already complete, skipping to extraction',
            'info',
          );
          this.core.updateProgress({
            downloaded: stat.size,
            total: existingState.total,
            progress: 100,
            status: 'extracting',
          });
          await this.extractFile(tempPath, versionDir, downloadType);
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          saveDownloadState(null);
          this.core.updateProgress({ status: 'completed', progress: 100 });
          logMessage(`Addon extracted to ${versionDir}`, 'info');
          return versionDir;
        }

        this.core.updateProgress({
          downloaded: startByte,
          total: existingState.total,
        });
        logMessage(`Resuming download from byte ${startByte}`, 'info');
      } else {
        tempPath = path.join(addonsDir, `temp-${variant.replace(/\./g, '')}`);
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
          logMessage(`Cleaned up old temp file: ${tempPath}`, 'info');
        }
      }

      const startedAt = new Date().toISOString();
      const downloadedPath = await this.core.downloadFile(
        url,
        tempPath,
        startByte,
        {
          onBytes: (downloaded, total) =>
            saveDownloadState({
              url,
              destPath: tempPath,
              tempPath,
              downloaded,
              total,
              variant,
              downloadType,
              startedAt,
              lastUpdatedAt: new Date().toISOString(),
            }),
        },
      );

      this.core.updateProgress({ status: 'extracting' });
      await this.extractFile(downloadedPath, versionDir, downloadType);
      if (fs.existsSync(downloadedPath)) fs.unlinkSync(downloadedPath);
      saveDownloadState(null);

      this.core.updateProgress({ status: 'completed', progress: 100 });
      logMessage(`Addon downloaded and extracted to ${versionDir}`, 'info');
      return versionDir;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage === 'Download cancelled') {
        this.core.updateProgress({
          status: 'idle',
          error: 'Download cancelled',
        });
        throw error;
      }
      this.core.updateProgress({ status: 'error', error: errorMessage });
      logMessage(`Download error: ${errorMessage}`, 'error');
      throw error;
    }
  }

  /**
   * 清理版本目錄中的舊文件，保留目錄本身
   */
  private cleanVersionDir(destDir: string): void {
    try {
      const files = fs.readdirSync(destDir);
      for (const file of files) {
        const filePath = path.join(destDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
      logMessage(`Cleaned version directory: ${destDir}`, 'info');
    } catch (error) {
      logMessage(`Error cleaning version directory: ${error}`, 'warning');
    }
  }

  /**
   * 解壓文件
   */
  private async extractFile(
    filePath: string,
    destDir: string,
    downloadType: 'node.gz' | 'tar.gz',
  ): Promise<void> {
    this.cleanVersionDir(destDir);

    if (downloadType === 'tar.gz') {
      await tar.extract({
        file: filePath,
        cwd: destDir,
      });

      await this.renameNodeFile(destDir);
    } else {
      const destPath = path.join(destDir, 'addon.node');
      await this.gunzipFile(filePath, destPath);
    }

    logMessage(`Extracted to ${destDir}`, 'info');
  }

  /**
   * 查找並重命名 .node 文件為 addon.node
   * 支持在根目錄和一級子目錄中查找
   */
  private async renameNodeFile(destDir: string): Promise<void> {
    // 首先在根目錄查找
    const files = fs.readdirSync(destDir);
    logMessage(`Files in ${destDir}: ${files.join(', ')}`, 'info');

    let nodeFile = files.find((f) => f.endsWith('.node') && f !== 'addon.node');

    if (nodeFile) {
      const oldPath = path.join(destDir, nodeFile);
      const newPath = path.join(destDir, 'addon.node');

      // 如果已存在 addon.node，先刪除
      if (fs.existsSync(newPath)) {
        fs.unlinkSync(newPath);
      }

      fs.renameSync(oldPath, newPath);
      logMessage(`Renamed ${nodeFile} to addon.node`, 'info');
      return;
    }

    // 如果根目錄沒找到，檢查一級子目錄（tar 可能解壓到子目錄）
    for (const item of files) {
      const itemPath = path.join(destDir, item);
      const stat = fs.statSync(itemPath);

      if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(itemPath);
        logMessage(
          `Files in subdirectory ${item}: ${subFiles.join(', ')}`,
          'info',
        );

        // 查找 .node 文件
        nodeFile = subFiles.find(
          (f) => f.endsWith('.node') && f !== 'addon.node',
        );

        if (nodeFile) {
          // 將子目錄中的所有文件移動到根目錄
          for (const subFile of subFiles) {
            const srcPath = path.join(itemPath, subFile);
            const destPath = path.join(
              destDir,
              subFile === nodeFile ? 'addon.node' : subFile,
            );

            // 如果目標文件已存在，先刪除
            if (fs.existsSync(destPath)) {
              fs.unlinkSync(destPath);
            }

            fs.renameSync(srcPath, destPath);
            logMessage(
              `Moved ${subFile} from subdirectory to ${destPath}`,
              'info',
            );
          }

          // 刪除空的子目錄
          fs.rmdirSync(itemPath);
          logMessage(`Removed empty subdirectory: ${item}`, 'info');
          return;
        }
      }
    }

    // 檢查是否已經有 addon.node 文件
    if (files.includes('addon.node')) {
      logMessage('addon.node already exists', 'info');
      return;
    }

    logMessage('No .node file found in extracted contents', 'warning');
  }

  /**
   * 解壓 gzip 文件
   */
  private gunzipFile(srcPath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(srcPath);
      const writeStream = fs.createWriteStream(destPath);
      const gunzip = zlib.createGunzip();

      readStream
        .pipe(gunzip)
        .pipe(writeStream)
        .on('finish', resolve)
        .on('error', reject);
    });
  }
}

/**
 * 計算文件的 SHA256 校驗和
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 驗證文件校驗和
 */
export async function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<boolean> {
  try {
    const actualChecksum = await calculateFileChecksum(filePath);
    return actualChecksum.toLowerCase() === expectedChecksum.toLowerCase();
  } catch {
    return false;
  }
}

// 導出單例實例
let downloaderInstance: AddonDownloader | null = null;

export function getAddonDownloader(
  mainWindow?: BrowserWindow,
): AddonDownloader {
  if (!downloaderInstance) {
    downloaderInstance = new AddonDownloader(mainWindow);
  } else if (mainWindow) {
    downloaderInstance.setMainWindow(mainWindow);
  }
  return downloaderInstance;
}
