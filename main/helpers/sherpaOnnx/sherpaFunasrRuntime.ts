import path from 'path';
import { Worker } from 'worker_threads';
import { logMessage } from '../storeManager';
import { getExtraResourcesPath } from '../utils';
import { getSherpaLibDir, isSherpaLibInstalled } from './sherpaLibPaths';
import type { FunasrAddonParams } from '../engines/funasrParams';
import type { QwenAddonParams } from '../engines/qwenParams';
import type { FireRedAddonParams } from '../engines/fireRedParams';

export interface SherpaModelRequest {
  vadModel: string;
  modelType: 'sense_voice' | 'paraformer' | 'qwen3_asr' | 'fire_red_asr';
  /** sense_voice / paraformer：單模型文件 + tokens.txt；fire_red_asr 複用 tokens 承載 tokens.txt。 */
  asrModel?: string;
  tokens?: string;
  /** qwen3_asr：四件套（tokenizer 為目錄）。 */
  qwen?: {
    convFrontend: string;
    encoder: string;
    decoder: string;
    tokenizer: string;
  };
  /** fire_red_asr：encoder + decoder 兩件套（tokens 走 tokens 字段）。 */
  fireRed?: {
    encoder: string;
    decoder: string;
  };
  /** funasr 用 FunasrAddonParams；qwen 用 QwenAddonParams；fireRed 用 FireRedAddonParams（共享 VAD/線程字段）。 */
  params: FunasrAddonParams | QwenAddonParams | FireRedAddonParams;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

function workerPath(): string {
  return path.join(
    getExtraResourcesPath(),
    'sherpa',
    'worker',
    'sherpa-worker.js',
  );
}

/**
 * 主側 sherpa funasr 運行時：常駐一個 worker（worker 內 dlopen 原生庫、緩存識別器），
 * 提供 prewarm / transcribe / cancel / dispose。模型加載與解碼均在 worker 線程，
 * 不阻塞主/UI 線程——根治 Windows 首個 transcribe 卡 0%。
 */
class SherpaFunasrRuntime {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<
    string,
    {
      resolve: (s: { segments: Segment[] }) => void;
      reject: (e: Error) => void;
      onProgress?: (p: number) => void;
    }
  >();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (!isSherpaLibInstalled()) {
      throw new Error('sherpa native lib not installed');
    }
    const libDir = getSherpaLibDir();
    const w = new Worker(workerPath(), {
      env: {
        ...process.env,
        SHERPA_ONNX_LIB_DIR: libDir,
        // Windows DLL / Linux SO 依賴解析（macOS 靠 @loader_path 重寫）。
        PATH: `${libDir}${path.delimiter}${process.env.PATH ?? ''}`,
        LD_LIBRARY_PATH: `${libDir}${path.delimiter}${
          process.env.LD_LIBRARY_PATH ?? ''
        }`,
      },
    });
    w.on('message', (msg: any) => this.onMessage(msg));
    w.on('error', (e) => this.failAll(e));
    w.on('exit', (code) => {
      if (code !== 0) this.failAll(new Error(`sherpa worker exited ${code}`));
      this.worker = null;
    });
    this.worker = w;
    return w;
  }

  private onMessage(msg: any): void {
    if (msg.type === 'ready') return;
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.onProgress?.(msg.percent);
    } else if (msg.type === 'done') {
      this.pending.delete(msg.id);
      entry.resolve({ segments: msg.segments });
    } else if (msg.type === 'error') {
      this.pending.delete(msg.id);
      const err = new Error(msg.message) as Error & { code?: string };
      if (msg.code) err.code = msg.code;
      entry.reject(err);
    }
  }

  private failAll(e: Error): void {
    this.pending.forEach((entry) => entry.reject(e));
    this.pending.clear();
  }

  /** 預熱：僅 load 模型，不轉寫。失敗非致命。 */
  prewarm(model: SherpaModelRequest): void {
    try {
      this.ensureWorker().postMessage({ type: 'load', ...model });
    } catch (e) {
      logMessage(`sherpa prewarm skipped: ${e}`, 'warning');
    }
  }

  transcribe(
    model: SherpaModelRequest,
    audioFile: string,
    onProgress?: (p: number) => void,
  ): { id: string; result: Promise<{ segments: Segment[] }> } {
    const w = this.ensureWorker();
    const id = `t${++this.seq}`;
    const result = new Promise<{ segments: Segment[] }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
    });
    w.postMessage({ type: 'transcribe', id, audioFile, ...model });
    return { id, result };
  }

  cancel(id: string): void {
    this.worker?.postMessage({ type: 'cancel', id });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

let runtime: SherpaFunasrRuntime | null = null;

export function getSherpaFunasrRuntime(): SherpaFunasrRuntime {
  if (!runtime) runtime = new SherpaFunasrRuntime();
  return runtime;
}

/**
 * 引擎無關的 sherpa ASR 運行時入口（D4）：funasr 與 qwen 複用同一常駐 worker 與緩存。
 * worker 依 `SherpaModelRequest.modelType` 選擇 sense_voice / paraformer / qwen3_asr 分支。
 */
export const getSherpaAsrRuntime = getSherpaFunasrRuntime;
