import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { logMessage } from './storeManager';
import type { ModelDownloadProgress } from './modelDownloader';
import {
  QWEN_MODELS,
  QwenModelId,
  QwenModelSource,
  QwenModelSpec,
  QWEN_DEFAULT_SOURCE,
  getQwenSourceOrder,
  getQwenArchiveUrl,
  getQwenModelScopeFileUrl,
  getQwenModelScopeTreeUrl,
  getQwenModelDir,
  getQwenModelsRoot,
  isQwenModelInstalled,
} from './qwenModelCatalog';
import {
  downloadFileParallel,
  RangeNotSupportedError,
} from './download/parallelDownloader';
import { extractArchive } from './download/extractArchive';

const CONNECT_TIMEOUT = 30_000;
const CANCELLED = 'Download cancelled';

/** 進度 key：qwen:<modelId>，與 funasr:<id> / ct2:<id> 同構，渲染層按前綴路由。 */
export function getQwenProgressKey(id: QwenModelId): string {
  return `qwen:${id}`;
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).href;
}

/** ModelScope 文件樹條目（僅取所需字段）。 */
interface MsFileEntry {
  Path: string;
  Size: number;
  Type: string;
}

/** 拉取 JSON（跟隨 3xx 重定向），用於 ModelScope 文件樹 API。 */
function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;
    const request = protocol.get(
      url,
      { headers: { 'User-Agent': 'SmartSub-Electron' } },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          fetchJson<T>(resolveRedirectUrl(url, response.headers.location))
            .then(resolve)
            .catch(reject);
          return;
        }
        if (!response.statusCode || response.statusCode >= 400) {
          reject(new Error(`HTTP Error: ${response.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(CONNECT_TIMEOUT);
  });
}

/**
 * Qwen 模型下載器：整包（tar.bz2）下載 + 解包到 userData/models/qwen/<id>/。
 * 複用 downloadFileParallel（斷點續傳 + 多連接 + 取消），解包用 decompress（含 tarbz2 插件）。
 * 與 FunasrModelDownloader 同構（同事件名 downloadProgress / modelDownloadDetail）。
 */
export class QwenModelDownloader {
  private abortController: AbortController | null = null;
  private mainWindow: BrowserWindow | null = null;
  private currentKey: string | null = null;
  private progress: ModelDownloadProgress = {
    status: 'idle',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: 0,
    eta: 0,
  };

  constructor(mainWindow?: BrowserWindow) {
    this.mainWindow = mainWindow || null;
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.progress = { ...this.progress, status: 'idle' };
    this.currentKey = null;
  }

  private send(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.currentKey) {
      const ratio =
        this.progress.total > 0
          ? this.progress.downloaded / this.progress.total
          : 0;
      this.mainWindow.webContents.send(
        'downloadProgress',
        this.currentKey,
        Math.min(ratio, 0.99),
      );
      this.mainWindow.webContents.send(
        'modelDownloadDetail',
        this.currentKey,
        this.progress,
      );
    }
  }

  private update(p: Partial<ModelDownloadProgress>): void {
    this.progress = { ...this.progress, ...p };
    if (this.progress.total > 0) {
      this.progress.progress =
        (this.progress.downloaded / this.progress.total) * 100;
    }
    this.send();
  }

  private sendFinal(key: string, value: number): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('downloadProgress', key, value);
      this.mainWindow.webContents.send(
        'modelDownloadDetail',
        key,
        this.progress,
      );
    }
  }

  /** 解包階段進度：複用 downloadProgress 讓進度條繼續走，status='extracting' 供 UI 顯示「解包中」。 */
  private sendExtract(ratio: number): void {
    const capped = Math.min(ratio, 0.99);
    this.progress = {
      ...this.progress,
      status: 'extracting',
      progress: Math.round(capped * 100),
    };
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.currentKey) {
      this.mainWindow.webContents.send(
        'downloadProgress',
        this.currentKey,
        capped,
      );
      this.mainWindow.webContents.send(
        'modelDownloadDetail',
        this.currentKey,
        this.progress,
      );
    }
  }

  async download(
    id: QwenModelId,
    source: QwenModelSource = QWEN_DEFAULT_SOURCE,
  ): Promise<boolean> {
    if (isQwenModelInstalled(id)) return true;
    const spec = QWEN_MODELS[id];
    const key = getQwenProgressKey(id);
    this.currentKey = key;
    this.abortController = new AbortController();

    this.update({
      status: 'downloading',
      downloaded: 0,
      total: 0,
      progress: 0,
      error: undefined,
    });

    let lastError: unknown = null;
    // 按所選源優先、其餘按國內優先順序回退（modelscope → ghproxy → github）。
    for (const src of getQwenSourceOrder(source)) {
      try {
        if (src === 'modelscope') {
          await this.downloadFromModelScope(spec);
        } else {
          await this.downloadFromArchive(spec, src);
        }

        if (!isQwenModelInstalled(id)) {
          throw new Error(
            `download finished but required files missing for ${id}: ${spec.requiredFiles.join(', ')}`,
          );
        }
        this.progress = {
          ...this.progress,
          status: 'completed',
          progress: 100,
        };
        this.sendFinal(key, 1);
        this.currentKey = null;
        logMessage(`qwen model ${id} installed from ${src}`, 'info');
        return true;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (msg === CANCELLED) {
          this.progress = { ...this.progress, status: 'idle' };
          this.sendFinal(key, 1);
          this.currentKey = null;
          throw error;
        }
        logMessage(`qwen model ${id} from ${src} failed: ${msg}`, 'warning');
      }
    }

    this.progress = {
      ...this.progress,
      status: 'error',
      error: lastError instanceof Error ? lastError.message : String(lastError),
    };
    this.sendFinal(key, 0);
    this.currentKey = null;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * ModelScope 國內源：逐文件直下到模型目錄，免解包（國內 CDN 最快）。
   * 先拉文件樹拿各文件大小以計算總進度；已存在且大小吻合的文件跳過（續傳友好）。
   */
  private async downloadFromModelScope(spec: QwenModelSpec): Promise<void> {
    const destDir = getQwenModelDir(spec.id);

    let sizeByPath = new Map<string, number>();
    try {
      const tree = await fetchJson<{ Data?: { Files?: MsFileEntry[] } }>(
        getQwenModelScopeTreeUrl(spec),
      );
      sizeByPath = new Map(
        (tree.Data?.Files ?? [])
          .filter((e) => e.Type === 'blob')
          .map((e) => [e.Path, e.Size ?? 0]),
      );
    } catch (e) {
      // 樹拉取失敗僅導致進度退化（按 0 計），不阻斷逐文件下載。
      logMessage(`qwen modelscope tree fetch failed: ${String(e)}`, 'warning');
    }

    const files = spec.modelScopeFiles.map((f) => ({
      ...f,
      size: sizeByPath.get(f.remote) ?? 0,
    }));
    const total = files.reduce((s, f) => s + f.size, 0);
    let downloaded = 0;
    this.update({
      status: 'downloading',
      downloaded: 0,
      total,
      progress: 0,
      error: undefined,
    });

    for (const f of files) {
      const dest = path.join(destDir, f.local);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (
        f.size > 0 &&
        fs.existsSync(dest) &&
        fs.statSync(dest).size === f.size
      ) {
        downloaded += f.size;
        this.update({ downloaded });
        continue;
      }
      const url = getQwenModelScopeFileUrl(spec, f.remote);
      try {
        await downloadFileParallel({
          url,
          destPath: dest,
          signal: this.abortController?.signal,
          headers: { 'User-Agent': 'SmartSub-Electron' },
          onProgress: (thisFile) =>
            this.update({ downloaded: downloaded + thisFile, total }),
          log: (m, l) => logMessage(m, l),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg === CANCELLED) throw error;
        if (error instanceof RangeNotSupportedError) {
          await this.downloadSingle(url, dest, this.abortController?.signal);
        } else {
          throw error;
        }
      }
      downloaded += f.size;
      this.update({ downloaded });
    }
  }

  /** 整包源（ghproxy/github）：下載 tar.bz2 → 解包到模型目錄（獨立進程 system tar）。 */
  private async downloadFromArchive(
    spec: QwenModelSpec,
    source: 'ghproxy' | 'github',
  ): Promise<void> {
    const destDir = getQwenModelDir(spec.id);
    const tmp = path.join(getQwenModelsRoot(), spec.archiveName);
    const url = getQwenArchiveUrl(spec, source);

    this.update({
      status: 'downloading',
      downloaded: 0,
      total: 0,
      progress: 0,
      error: undefined,
    });

    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
      await this.downloadArchive(url, tmp);

      // 解包到獨立進程（system tar），主進程事件循環不阻塞 → 不再「卡住」；
      // 失敗回退 bundled decompress。strip 頂層目錄、過濾 test_wavs。
      this.progress = { ...this.progress, status: 'extracting' };
      this.sendExtract(0);
      await extractArchive({
        archivePath: tmp,
        destDir,
        strip: 1,
        excludeContains: 'test_wavs',
        approxTotalBytes: spec.approxInstallBytes,
        signal: this.abortController?.signal,
        onProgress: (ratio) => this.sendExtract(ratio),
      });
    } finally {
      // 無論成功/失敗/取消都清理臨時整包，避免汙染 models 根目錄。
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    }
  }

  /** 並行續傳下載整包；服務端不支持 Range 時回退單連接。 */
  private async downloadArchive(url: string, dest: string): Promise<void> {
    try {
      await downloadFileParallel({
        url,
        destPath: dest,
        signal: this.abortController?.signal,
        headers: { 'User-Agent': 'SmartSub-Electron' },
        onProgress: (downloaded, total) => this.update({ downloaded, total }),
        log: (m, l) => logMessage(m, l),
      });
    } catch (error) {
      if (error instanceof RangeNotSupportedError) {
        await this.downloadSingle(url, dest, this.abortController?.signal);
        return;
      }
      throw error;
    }
  }

  private downloadSingle(
    url: string,
    destPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const protocol = parsed.protocol === 'https:' ? https : http;
      const onAbort = () => {
        req.destroy();
        reject(new Error(CANCELLED));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const req = protocol.get(
        url,
        { headers: { 'User-Agent': 'SmartSub-Electron' } },
        (response) => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            signal?.removeEventListener('abort', onAbort);
            this.downloadSingle(
              resolveRedirectUrl(url, response.headers.location),
              destPath,
              signal,
            )
              .then(resolve)
              .catch(reject);
            return;
          }
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`HTTP Error: ${response.statusCode}`));
            return;
          }
          const total = Number(response.headers['content-length'] || 0);
          let downloaded = 0;
          response.on('data', (c: Buffer) => {
            downloaded += c.length;
            this.update({ downloaded, total });
          });
          const out = fs.createWriteStream(destPath, { flags: 'w' });
          response.pipe(out);
          out.on('finish', () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          });
          out.on('error', reject);
        },
      );
      req.on('error', reject);
      req.setTimeout(CONNECT_TIMEOUT);
    });
  }
}

let instance: QwenModelDownloader | null = null;

export function getQwenModelDownloader(
  mainWindow?: BrowserWindow,
): QwenModelDownloader {
  if (!instance) instance = new QwenModelDownloader(mainWindow);
  else if (mainWindow) instance.setMainWindow(mainWindow);
  return instance;
}
