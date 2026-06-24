import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import {
  getSourceFallbackOrder,
  type BinaryDownloadSource,
} from '../downloadSourceOrder';

export type MirrorStatus =
  | 'idle'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'completed'
  | 'error';

export interface MirrorProgress {
  status: MirrorStatus;
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  error?: string;
}

/** 下載過程中回報字節，供適配層持久化各自的續傳 state 形狀。 */
export interface DownloadFileHooks {
  onBytes?: (downloaded: number, total: number) => void;
}

type LogFn = (msg: string, level: 'info' | 'warning' | 'error') => void;

/**
 * 鏡像下載核心：進度數學 + 多源回退 + 斷點續傳單文件下載（Range/重定向/206/
 * 60s 無活動超時/30s 連接超時/abort）。不感知 addon/py 的產物語義。
 */
export class MirrorDownloader {
  private abortController: AbortController | null = null;
  private progress: MirrorProgress = {
    status: 'idle',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: 0,
    eta: 0,
  };
  private lastSpeedCalcTime = 0;
  private lastSpeedCalcBytes = 0;

  constructor(private readonly emit: (p: MirrorProgress) => void) {}

  getProgress(): MirrorProgress {
    return { ...this.progress };
  }

  /** 每次下載前重置 abort 控制器與速度基線。 */
  resetForDownload(): void {
    this.abortController = new AbortController();
    this.lastSpeedCalcTime = Date.now();
    this.lastSpeedCalcBytes = 0;
  }

  updateProgress(update: Partial<MirrorProgress>): void {
    this.progress = { ...this.progress, ...update };

    const now = Date.now();
    if (now - this.lastSpeedCalcTime >= 1000) {
      const bytesPerSecond =
        ((this.progress.downloaded - this.lastSpeedCalcBytes) * 1000) /
        (now - this.lastSpeedCalcTime);
      this.progress.speed = Math.max(0, bytesPerSecond);

      if (bytesPerSecond > 0 && this.progress.total > 0) {
        const remainingBytes = this.progress.total - this.progress.downloaded;
        this.progress.eta = Math.ceil(remainingBytes / bytesPerSecond);
      }

      this.lastSpeedCalcTime = now;
      this.lastSpeedCalcBytes = this.progress.downloaded;
    }

    if (this.progress.total > 0) {
      this.progress.progress =
        (this.progress.downloaded / this.progress.total) * 100;
    }

    this.emit({ ...this.progress });
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.updateProgress({ status: 'idle' });
  }

  /**
   * 按所選源 + 回退順序依次嘗試 attempt；isTerminalError 命中時不再換源（取消/協議）。
   */
  async runWithFallback<T>(
    source: BinaryDownloadSource,
    attempt: (s: BinaryDownloadSource) => Promise<T>,
    isTerminalError: (e: unknown) => boolean,
    logLabel: string,
    log: LogFn,
  ): Promise<T> {
    const order = getSourceFallbackOrder(source);
    let lastError: unknown;
    for (let i = 0; i < order.length; i++) {
      const s = order[i];
      try {
        if (i > 0) log(`${logLabel} falling back to source: ${s}`, 'warning');
        return await attempt(s);
      } catch (error) {
        if (isTerminalError(error)) throw error;
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        log(
          `${logLabel} from ${s} failed: ${msg}; ${
            i < order.length - 1 ? 'trying next source' : 'no more sources'
          }`,
          'warning',
        );
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** 斷點續傳單文件下載。resolve 為 destPath。取消時 reject('Download cancelled')。 */
  downloadFile(
    url: string,
    destPath: string,
    startByte: number,
    hooks?: DownloadFileHooks,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'SmartSub-Electron',
      };
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      const INACTIVITY_TIMEOUT = 60000;
      let inactivityTimer: NodeJS.Timeout | null = null;
      let isCompleted = false;
      // 持有寫流引用，確保任何失敗路徑都能釋放文件句柄；
      // 否則 Windows 上殘留句柄會鎖住 .tar.gz，下次下載 open 時報 EPERM。
      let writeStream: fs.WriteStream | null = null;

      const destroyWriteStream = () => {
        if (writeStream && !writeStream.destroyed) {
          writeStream.destroy();
        }
        writeStream = null;
      };

      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (!isCompleted) {
          inactivityTimer = setTimeout(() => {
            if (!isCompleted) {
              isCompleted = true;
              request.destroy();
              destroyWriteStream();
              reject(
                new Error('Download timeout: no data received for 60 seconds'),
              );
            }
          }, INACTIVITY_TIMEOUT);
        }
      };

      const clearInactivityTimer = () => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer);
          inactivityTimer = null;
        }
      };

      const request = protocol.get(url, { headers }, (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          clearInactivityTimer();
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            this.downloadFile(redirectUrl, destPath, startByte, hooks)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          clearInactivityTimer();
          reject(new Error(`HTTP Error: ${response.statusCode}`));
          return;
        }

        // 僅當服務器以 206 響應時才是真正的斷點續傳。
        // 若請求了 Range 卻收到 200（部分代理 / 鏡像忽略 Range，返回全量），
        // 必須按全量覆蓋處理：否則會把完整文件追加到已有部分字節之後，
        // 造成文件損壞、體積偏大，最終 sha 校驗失敗。
        const isResume = startByte > 0 && response.statusCode === 206;
        const effectiveStart = isResume ? startByte : 0;

        let totalSize = 0;
        if (response.statusCode === 206) {
          const contentRange = response.headers['content-range'];
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match) totalSize = parseInt(match[1], 10);
          }
        } else {
          const contentLength = response.headers['content-length'];
          if (contentLength) totalSize = parseInt(contentLength, 10);
        }

        this.updateProgress({ total: totalSize, downloaded: effectiveStart });
        hooks?.onBytes?.(effectiveStart, totalSize);

        writeStream = fs.createWriteStream(destPath, {
          flags: isResume ? 'a' : 'w',
        });

        let downloadedBytes = effectiveStart;
        resetInactivityTimer();

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          this.updateProgress({ downloaded: downloadedBytes });
          resetInactivityTimer();
          hooks?.onBytes?.(downloadedBytes, totalSize);
        });

        response.on('end', () => {
          clearInactivityTimer();
        });

        response.pipe(writeStream);

        writeStream.on('finish', () => {
          isCompleted = true;
          clearInactivityTimer();
          writeStream = null;
          resolve(destPath);
        });

        writeStream.on('error', (err) => {
          isCompleted = true;
          clearInactivityTimer();
          request.destroy();
          destroyWriteStream();
          reject(err);
        });

        if (this.abortController) {
          this.abortController.signal.addEventListener('abort', () => {
            isCompleted = true;
            clearInactivityTimer();
            request.destroy();
            destroyWriteStream();
            reject(new Error('Download cancelled'));
          });
        }
      });

      request.on('error', (err) => {
        isCompleted = true;
        clearInactivityTimer();
        destroyWriteStream();
        reject(err);
      });

      request.setTimeout(30000, () => {
        // 僅用於建立連接；一旦開始接收數據由 inactivityTimer 接管
      });

      resetInactivityTimer();
    });
  }
}
