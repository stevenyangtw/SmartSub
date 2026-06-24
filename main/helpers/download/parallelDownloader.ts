import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

/**
 * 多連接 / HTTP Range 分塊並行下載（與下載源無關，對大文件成倍提速）。
 *
 * 與源無關地工作，但要求服務端支持 Range（返回 206 + Content-Range/總長）。
 * 不支持 / 文件過小 / 無法判定總長時拋 {@link RangeNotSupportedError}，調用方
 * 應回退到原有單連接下載。設計取捨：
 *   - 寫 `${destPath}.par` 臨時文件，校驗總大小後再 rename 到 destPath；中斷只會
 *     殘留 `.par`（下次開始前清理），絕不汙染單連接續傳用的 `.download` 文件；
 *   - 每塊獨立重試 + 塊內按已寫字節續傳，斷一塊只重那一塊；
 *   - 定位寫（pwrite, 指定 position）+ 背壓（寫盤期間 pause 響應），內存有界；
 *   - 簽名 CDN URL 過期（401/403/410）時自動按原始 URL 重新解析。
 */

const DEFAULT_CONNECTIONS = 4;
const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024; // 16 MiB
const DEFAULT_MIN_PARALLEL_SIZE = 24 * 1024 * 1024; // 小於此值不值得並行
const CONNECT_TIMEOUT = 30_000;
const CHUNK_INACTIVITY_TIMEOUT = 60_000;
const MAX_CHUNK_RETRIES = 4;
const MAX_REDIRECTS = 5;

const CANCELLED_MESSAGE = 'Download cancelled';

export class RangeNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeNotSupportedError';
  }
}

export interface ParallelDownloadParams {
  /** 原始下載地址（可含重定向）。 */
  url: string;
  /** 最終落盤路徑；下載寫入 `${destPath}.par` 後校驗並 rename 到此路徑。 */
  destPath: string;
  signal?: AbortSignal;
  connections?: number;
  chunkSize?: number;
  minParallelSize?: number;
  headers?: Record<string, string>;
  /** 進度回調：本文件已下載字節數 + 文件總字節數。 */
  onProgress?: (downloaded: number, total: number) => void;
  log?: (message: string, level: 'info' | 'warning' | 'error') => void;
}

interface ResolvedTarget {
  finalUrl: string;
  total: number;
}

function isHttps(u: string): boolean {
  return new URL(u).protocol === 'https:';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isExpiredStatus(code: number): boolean {
  return code === 401 || code === 403 || code === 410;
}

/**
 * 用 `Range: bytes=0-0` 探測：跟隨重定向，返回最終 URL 與總大小。
 * 服務端不支持 Range（非 206 或無 Content-Range 總長）時拋 RangeNotSupportedError。
 */
function probe(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  redirects = 0,
): Promise<ResolvedTarget> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCELLED_MESSAGE));
      return;
    }
    const lib = isHttps(url) ? https : http;
    const req = lib.get(
      url,
      { headers: { ...headers, Range: 'bytes=0-0' } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.destroy();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error('Too many redirects while probing'));
            return;
          }
          const next = new URL(res.headers.location, url).href;
          probe(next, headers, signal, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (code === 206) {
          const contentRange = res.headers['content-range'];
          res.destroy();
          let total = 0;
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)\s*$/);
            if (match) total = parseInt(match[1], 10);
          }
          if (!total) {
            reject(
              new RangeNotSupportedError('no total size in content-range'),
            );
            return;
          }
          resolve({ finalUrl: url, total });
          return;
        }

        res.destroy();
        if (code >= 200 && code < 300) {
          reject(
            new RangeNotSupportedError(`server ignored Range (status ${code})`),
          );
        } else {
          reject(new Error(`probe HTTP ${code}`));
        }
      },
    );
    req.on('error', reject);
    req.setTimeout(CONNECT_TIMEOUT, () => {
      req.destroy(new Error('probe connect timeout'));
    });
    signal?.addEventListener(
      'abort',
      () => req.destroy(new Error(CANCELLED_MESSAGE)),
      { once: true },
    );
  });
}

interface ChunkContext {
  getUrl: () => string;
  reResolve: () => Promise<void>;
  headers: Record<string, string>;
  signal?: AbortSignal;
  fileHandle: fs.promises.FileHandle;
  start: number;
  end: number;
  onBytes: (n: number) => void;
  log: (message: string, level: 'info' | 'warning' | 'error') => void;
}

/** 下載 [start, end] 閉區間到文件對應偏移；內部按已寫字節續傳 + 有限重試。 */
async function downloadChunk(ctx: ChunkContext): Promise<void> {
  let pos = ctx.start; // 下一個待寫入的絕對偏移

  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    if (ctx.signal?.aborted) throw new Error(CANCELLED_MESSAGE);
    if (pos > ctx.end) return;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let request: http.ClientRequest | null = null;
        let inactivityTimer: NodeJS.Timeout | null = null;
        let redirects = 0;

        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
          if (err) reject(err);
          else resolve();
        };

        const onAbort = () => {
          request?.destroy();
          finish(new Error(CANCELLED_MESSAGE));
        };

        const resetInactivity = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            request?.destroy();
            finish(new Error('chunk inactivity timeout'));
          }, CHUNK_INACTIVITY_TIMEOUT);
        };

        const doRequest = (requestUrl: string) => {
          const lib = isHttps(requestUrl) ? https : http;
          const reqHeaders = {
            ...ctx.headers,
            Range: `bytes=${pos}-${ctx.end}`,
          };
          request = lib.get(requestUrl, { headers: reqHeaders }, (res) => {
            const code = res.statusCode || 0;

            if (code >= 300 && code < 400 && res.headers.location) {
              res.destroy();
              if (redirects >= MAX_REDIRECTS) {
                finish(new Error('Too many redirects'));
                return;
              }
              redirects += 1;
              doRequest(new URL(res.headers.location, requestUrl).href);
              return;
            }

            if (isExpiredStatus(code)) {
              res.destroy();
              finish(new Error(`expired url (status ${code})`));
              return;
            }

            if (code !== 206) {
              res.destroy();
              finish(new Error(`unexpected status ${code}`));
              return;
            }

            resetInactivity();

            res.on('data', (chunk: Buffer) => {
              res.pause();
              ctx.fileHandle
                .write(chunk, 0, chunk.length, pos)
                .then(({ bytesWritten }) => {
                  pos += bytesWritten;
                  ctx.onBytes(bytesWritten);
                  resetInactivity();
                  res.resume();
                })
                .catch((err) => {
                  request?.destroy();
                  finish(err instanceof Error ? err : new Error(String(err)));
                });
            });

            res.on('end', () => {
              if (pos > ctx.end) finish();
              else finish(new Error('incomplete chunk (early EOF)'));
            });

            res.on('error', (err) => finish(err));
          });

          request.on('error', (err) => finish(err));
          request.setTimeout(CONNECT_TIMEOUT, () => {
            request?.destroy(new Error('chunk connect timeout'));
          });
        };

        if (ctx.signal) {
          ctx.signal.addEventListener('abort', onAbort, { once: true });
        }
        resetInactivity();
        doRequest(ctx.getUrl());
      });

      return; // 'end' 時 pos > end，塊完成
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === CANCELLED_MESSAGE) throw error;

      if (message.startsWith('expired url')) {
        // 簽名 URL 過期：按原始地址重新解析後重試（不計入失敗上限的"硬錯誤"）
        ctx.log(
          `chunk ${ctx.start}-${ctx.end} url expired; re-resolving`,
          'info',
        );
        await ctx.reResolve();
      }

      if (attempt === MAX_CHUNK_RETRIES - 1) throw error;
      ctx.log(
        `chunk ${ctx.start}-${ctx.end} attempt ${attempt + 1} failed: ${message}; retry from ${pos}`,
        'warning',
      );
      await delay(1000 * (attempt + 1));
    }
  }
}

export async function downloadFileParallel(
  params: ParallelDownloadParams,
): Promise<void> {
  const connections = params.connections ?? DEFAULT_CONNECTIONS;
  const chunkSize = params.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const minParallelSize = params.minParallelSize ?? DEFAULT_MIN_PARALLEL_SIZE;
  const headers = {
    'User-Agent': 'SmartSub-Electron',
    ...(params.headers || {}),
  };
  const signal = params.signal;
  const log = params.log ?? (() => {});

  if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);

  const resolved = await probe(params.url, headers, signal);
  const total = resolved.total;
  if (!total || total < minParallelSize) {
    throw new RangeNotSupportedError(
      `size ${total} below parallel threshold ${minParallelSize}`,
    );
  }

  const working = `${params.destPath}.par`;
  await fs.promises.rm(working, { force: true });

  const chunks: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < total; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize, total) - 1 });
  }

  let currentUrl = resolved.finalUrl;
  let reResolving: Promise<void> | null = null;
  const reResolve = (): Promise<void> => {
    if (!reResolving) {
      reResolving = probe(params.url, headers, signal)
        .then((r) => {
          currentUrl = r.finalUrl;
        })
        .finally(() => {
          reResolving = null;
        });
    }
    return reResolving;
  };

  const fileHandle = await fs.promises.open(working, 'w');
  let fileHandleClosed = false;
  try {
    let downloaded = 0;
    let nextChunk = 0;
    let failure: Error | null = null;

    const worker = async (): Promise<void> => {
      while (true) {
        if (failure) return;
        if (signal?.aborted) {
          failure = new Error(CANCELLED_MESSAGE);
          return;
        }
        const index = nextChunk++;
        if (index >= chunks.length) return;
        const { start, end } = chunks[index];
        try {
          await downloadChunk({
            getUrl: () => currentUrl,
            reResolve,
            headers,
            signal,
            fileHandle,
            start,
            end,
            onBytes: (n) => {
              downloaded += n;
              params.onProgress?.(downloaded, total);
            },
            log,
          });
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
          return;
        }
      }
    };

    const workerCount = Math.min(connections, chunks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (failure) throw failure;
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE);

    await fileHandle.close();
    fileHandleClosed = true;

    const stat = await fs.promises.stat(working);
    if (stat.size !== total) {
      throw new Error(
        `size mismatch after parallel download: got ${stat.size}, expected ${total}`,
      );
    }

    await fs.promises.rm(params.destPath, { force: true });
    await fs.promises.rename(working, params.destPath);
    log(
      `parallel download completed (${workerCount} connections): ${params.destPath}`,
      'info',
    );
  } catch (error) {
    if (!fileHandleClosed) {
      await fileHandle.close().catch(() => {});
    }
    await fs.promises.rm(working, { force: true }).catch(() => {});
    throw error;
  }
}
