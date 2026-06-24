import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import decompress from 'decompress';
import { logMessage } from '../storeManager';

/** 與各下載器一致的取消錯誤信息，便於上層用 `=== CANCELLED` 判定。 */
const CANCELLED = 'Download cancelled';

export interface ExtractArchiveOptions {
  /** 待解壓的歸檔文件（.tar.bz2 / .tar.gz / .zip 等，system tar 自動識別壓縮格式）。 */
  archivePath: string;
  /** 解壓目標目錄（不存在會自動創建）。 */
  destDir: string;
  /** 剝離歸檔內頂層目錄層數（等價 tar --strip-components / decompress strip）。 */
  strip?: number;
  /** 路徑包含該子串的條目跳過（如 'test_wavs'），兩種後端均生效。 */
  excludeContains?: string;
  /** 安裝完成後的近似總字節數，用於按「目標目錄已寫入大小」估算解包進度。 */
  approxTotalBytes?: number;
  /** 解包進度回調（0..1，已按 approxTotalBytes 估算並封頂 0.99）。 */
  onProgress?: (ratio: number) => void;
  /** 取消信號：觸發後會 kill system tar 子進程並以 CANCELLED 拋錯。 */
  signal?: AbortSignal;
}

/** 遞歸統計目錄已寫入的字節數（用於解包進度估算）。 */
async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += await getDirSize(full);
      } else if (entry.isFile()) {
        total += (await fsp.stat(full)).size;
      }
    } catch {
      // 文件解包過程中可能瞬時不可讀，忽略。
    }
  }
  return total;
}

/** 輪詢目標目錄大小上報解包進度；返回停止函數。 */
function startProgressPoller(
  destDir: string,
  approxTotalBytes: number | undefined,
  onProgress: ((ratio: number) => void) | undefined,
): () => void {
  if (!approxTotalBytes || approxTotalBytes <= 0 || !onProgress) {
    return () => {};
  }
  let stopped = false;
  let timer: NodeJS.Timeout;
  const tick = async () => {
    if (stopped) return;
    const size = await getDirSize(destDir);
    if (stopped) return;
    onProgress(Math.min(size / approxTotalBytes, 0.99));
    timer = setTimeout(tick, 500);
  };
  timer = setTimeout(tick, 500);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * 用系統 `tar` 解包（獨立 OS 進程，不阻塞 Electron 主線程事件循環）。
 * macOS/Windows 為 bsdtar(libarchive)、Linux 多為 GNU tar，`-xf` 均自動識別 bz2/gz。
 * 解析失敗（無 tar / 老舊 Windows / 非零退出）時 reject，由上層回退 decompress。
 */
function extractWithSystemTar(opts: ExtractArchiveOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['-xf', opts.archivePath, '-C', opts.destDir];
    if (opts.strip != null) args.push(`--strip-components=${opts.strip}`);
    if (opts.excludeContains) args.push(`--exclude=*${opts.excludeContains}*`);

    const child = spawn('tar', args, { windowsHide: true });
    let stderr = '';

    const onAbort = () => {
      child.kill();
      reject(new Error(CANCELLED));
    };
    if (opts.signal?.aborted) {
      child.kill();
      reject(new Error(CANCELLED));
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited ${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

/** 回退：用 bundled 的 decompress（純 JS，同步 CPU 重，會短暫阻塞主線程）。 */
async function extractWithDecompress(
  opts: ExtractArchiveOptions,
): Promise<void> {
  await decompress(opts.archivePath, opts.destDir, {
    strip: opts.strip ?? 0,
    filter: opts.excludeContains
      ? (file) => !file.path.includes(opts.excludeContains!)
      : undefined,
  });
}

/**
 * 解壓歸檔到目標目錄：優先 system tar（獨立進程，主線程不卡），失敗回退 decompress。
 * 解包期間按目標目錄寫入大小估算進度（approxTotalBytes 提供時）。
 */
export async function extractArchive(
  opts: ExtractArchiveOptions,
): Promise<void> {
  fs.mkdirSync(opts.destDir, { recursive: true });
  const stopPoller = startProgressPoller(
    opts.destDir,
    opts.approxTotalBytes,
    opts.onProgress,
  );
  try {
    try {
      await extractWithSystemTar(opts);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === CANCELLED || opts.signal?.aborted) {
        throw new Error(CANCELLED);
      }
      logMessage(
        `system tar extract failed (${msg}); falling back to decompress`,
        'warning',
      );
      await extractWithDecompress(opts);
    }
  } finally {
    stopPoller();
  }
}
