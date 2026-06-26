import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import {
  EngineMessage,
  EngineResponse,
  PingResult,
  TranscribeHandlers,
  TranscribeResult,
  TranscribeSegment,
} from './protocol';
import { isProtocolSupported } from './protocolSupport';
import type { PyEngineId } from '../../../types/engine';

export interface EngineCommand {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 基座 prefix（設為 PYTHONHOME，定位 stdlib） */
  pythonHome?: string;
  /** 引擎包 site-packages（設為 PYTHONPATH，掛載該引擎依賴） */
  pythonPath?: string;
}

export type EngineLogger = (
  message: string,
  level: 'info' | 'warning' | 'error',
) => void;

export class PythonEngineError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PythonEngineError';
    this.code = code;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onEvent?: (method: string, params: Record<string, unknown>) => void;
  timer?: NodeJS.Timeout;
}

interface RequestOptions {
  timeoutMs?: number;
  onEvent?: (method: string, params: Record<string, unknown>) => void;
}

// 冷啟動 ping 超時：Windows 下基座解釋器首次加載 + 殺軟掃描可能較久。
// 重依賴已推遲到首個 transcribe（見 py-engine list_engines/find_spec），ping 本身很快，
// 這裡給足冗餘並配合一次重試，徹底消除"偶發冷啟動超時"。
export const START_PING_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 3_000;

export function buildSanitizedEnv(
  base: NodeJS.ProcessEnv = process.env,
  overrides?: { pythonHome?: string; pythonPath?: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    PYTHONNOUSERSITE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
    // 散裝 site-packages 下 numpy/ctranslate2/onnxruntime 可能各帶一份 Intel
    // OpenMP(libiomp5md)。容忍重複加載，規避 Windows 上 "OMP: Error #15 ...
    // already initialized" 直接 abort/卡死。
    KMP_DUPLICATE_LIB_OK: 'TRUE',
  };
  // 先清宿主機汙染源（全局 conda/venv/PYTHONPATH 會汙染基座解釋器）
  delete env.PYTHONPATH;
  delete env.PYTHONHOME;
  delete env.PYTHONSTARTUP;
  delete env.VIRTUAL_ENV;
  delete env.CONDA_PREFIX;
  // 再按三層模型注入受控值：基座 prefix + 當前引擎包 site-packages
  if (overrides?.pythonHome) env.PYTHONHOME = overrides.pythonHome;
  if (overrides?.pythonPath) env.PYTHONPATH = overrides.pythonPath;
  return env;
}

export class PythonRuntimeManager {
  private resolveCommand: (engineId: PyEngineId) => EngineCommand;
  private logger: EngineLogger;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private seq = 0;
  private startingPromise: Promise<PingResult> | null = null;
  private lastPingInfo: PingResult | null = null;
  private stopping = false;
  // 當前 sidecar 服務的引擎；切換引擎需重啟（換 PYTHONPATH / 模型環境）。
  private currentEngineId: PyEngineId | null = null;

  constructor(
    resolveCommand: (engineId: PyEngineId) => EngineCommand,
    logger?: EngineLogger,
  ) {
    this.resolveCommand = resolveCommand;
    this.logger = logger || (() => {});
  }

  get isRunning(): boolean {
    return this.proc !== null;
  }

  get engineInfo(): PingResult | null {
    return this.lastPingInfo;
  }

  get activeEngineId(): PyEngineId | null {
    return this.currentEngineId;
  }

  async ensureStarted(
    engineId: PyEngineId = 'faster-whisper',
  ): Promise<PingResult> {
    // 已在跑且就是目標引擎 → 直接複用緩存 ping。
    if (this.proc && this.lastPingInfo && this.currentEngineId === engineId) {
      return this.lastPingInfo;
    }
    // 在跑但引擎不同 → 切換：停舊 sidecar，換 PYTHONPATH 重啟（一次冷啟動）。
    if (this.proc && this.currentEngineId !== engineId) {
      this.logger(
        `Switching python engine ${this.currentEngineId} -> ${engineId}; restarting sidecar`,
        'info',
      );
      await this.stop();
    }
    if (!this.startingPromise) {
      const target = engineId;
      this.startingPromise = this.start(target).finally(() => {
        this.startingPromise = null;
      });
    }
    return this.startingPromise;
  }

  private async start(engineId: PyEngineId): Promise<PingResult> {
    this.currentEngineId = engineId;
    // 防重入：若殘留舊進程（如上次 ping 超時未清理），先殺掉，避免孤兒 + 引用覆蓋。
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        // already exited
      }
      this.proc = null;
    }

    const attempt = async (): Promise<PingResult> => {
      const cmd = this.resolveCommand(engineId);
      this.logger(
        `Starting python engine: ${cmd.command} ${cmd.args.join(' ')}`,
        'info',
      );
      this.logger(
        `python env: cwd=${cmd.cwd ?? ''} PYTHONHOME=${cmd.pythonHome ?? ''} PYTHONPATH=${cmd.pythonPath ?? ''}`,
        'info',
      );

      const proc = spawn(cmd.command, cmd.args, {
        cwd: cmd.cwd,
        env: {
          ...buildSanitizedEnv(process.env, {
            pythonHome: cmd.pythonHome,
            pythonPath: cmd.pythonPath,
          }),
          ...(cmd.env || {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.proc = proc;

      proc.on('error', (error) => {
        this.handleExit(`spawn error: ${error.message}`);
      });
      proc.on('exit', (code, signal) => {
        this.handleExit(`exited with code=${code} signal=${signal}`);
      });

      createInterface({ input: proc.stdout }).on('line', (line) => {
        this.handleLine(line);
      });
      createInterface({ input: proc.stderr }).on('line', (line) => {
        this.logger(line, 'info');
      });

      try {
        const info = await this.request<PingResult>(
          'ping',
          {},
          {
            timeoutMs: START_PING_TIMEOUT_MS,
          },
        );

        // 協議區間校驗：超出 app 支持區間則停機並報錯（提示升級 SmartSub，而非崩潰）。
        // 舊引擎不返回 protocolVersion 時放行（向後兼容）。
        if (
          typeof info.protocolVersion === 'number' &&
          !isProtocolSupported(info.protocolVersion)
        ) {
          if (this.proc === proc) {
            try {
              proc.kill();
            } catch {
              // already exited
            }
            this.proc = null;
            this.lastPingInfo = null;
          }
          throw new PythonEngineError(
            'protocol_unsupported',
            `engine protocolVersion=${info.protocolVersion} not supported by this SmartSub`,
          );
        }

        this.lastPingInfo = info;
        this.logger(
          `Python engine ready: version=${info.version} python=${info.python} engines=${JSON.stringify(info.engines)}`,
          'info',
        );
        return info;
      } catch (error) {
        // 關鍵：ping 失敗（超時/退出）時務必殺掉仍在啟動的進程，
        // 避免孤兒 + 二次 spawn + Windows 文件鎖。
        if (this.proc === proc) {
          try {
            proc.kill();
          } catch {
            // already exited
          }
          this.proc = null;
          this.lastPingInfo = null;
        }
        throw error;
      }
    };

    try {
      return await attempt();
    } catch (firstError) {
      // 協議不兼容重試無意義，直接拋出。
      if (
        firstError instanceof PythonEngineError &&
        firstError.code === 'protocol_unsupported'
      ) {
        throw firstError;
      }
      this.logger(
        `Python engine start failed, retrying once: ${firstError}`,
        'warning',
      );
      return attempt();
    }
  }

  request<T>(
    method: string,
    params: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    const id = `${method}-${++this.seq}`;
    return this.requestWithId<T>(id, method, params, options);
  }

  private requestWithId<T>(
    id: string,
    method: string,
    params: Record<string, unknown>,
    options?: RequestOptions,
  ): Promise<T> {
    if (!this.proc) {
      return Promise.reject(
        new PythonEngineError(
          'engine_not_running',
          'python engine is not running',
        ),
      );
    }
    return new Promise<T>((resolve, reject) => {
      const entry: PendingRequest = {
        resolve: resolve as (value: unknown) => void,
        reject,
        onEvent: options?.onEvent,
      };
      if (options?.timeoutMs) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new PythonEngineError(
              'timeout',
              `${method} timed out after ${options.timeoutMs}ms`,
            ),
          );
        }, options.timeoutMs);
      }
      this.pending.set(id, entry);
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc) return;
    this.write({ method, params });
  }

  transcribe(
    params: Record<string, unknown>,
    handlers?: TranscribeHandlers,
  ): { id: string; result: Promise<TranscribeResult> } {
    const id = `transcribe-${++this.seq}`;
    const result = this.requestWithId<TranscribeResult>(
      id,
      'transcribe',
      params,
      {
        onEvent: (method, eventParams) => {
          if (method === 'progress' && handlers?.onProgress) {
            handlers.onProgress(Number(eventParams.percent) || 0);
          } else if (method === 'segment' && handlers?.onSegment) {
            handlers.onSegment(eventParams as unknown as TranscribeSegment);
          }
        },
      },
    );
    return { id, result };
  }

  align(
    params: Record<string, unknown>,
    handlers?: TranscribeHandlers,
  ): { id: string; result: Promise<TranscribeResult> } {
    const id = `align-${++this.seq}`;
    const result = this.requestWithId<TranscribeResult>(id, 'align', params, {
      onEvent: (method, eventParams) => {
        if (method === 'progress' && handlers?.onProgress) {
          handlers.onProgress(Number(eventParams.percent) || 0);
        } else if (method === 'segment' && handlers?.onSegment) {
          handlers.onSegment(eventParams as unknown as TranscribeSegment);
        }
      },
    });
    return { id, result };
  }

  cancel(id: string): void {
    this.notify('cancel', { id });
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.stopping = true;
    try {
      this.notify('shutdown', {});
      proc.stdin.end();
    } catch {
      // process may have already exited
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // already exited
        }
        resolve();
      }, SHUTDOWN_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.stopping = false;
  }

  private write(message: Record<string, unknown>): void {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(JSON.stringify(message) + '\n');
    } catch (error) {
      this.logger(`Failed to write to python engine: ${error}`, 'error');
    }
  }

  private handleLine(line: string): void {
    let message: EngineMessage;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger(
        `Invalid JSON from python engine: ${line.slice(0, 200)}`,
        'warning',
      );
      return;
    }

    const response = message as EngineResponse;
    if (response.id !== undefined) {
      const entry = this.pending.get(response.id);
      if (!entry) {
        this.logger(`Response for unknown request: ${response.id}`, 'warning');
        return;
      }
      this.pending.delete(response.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (response.error) {
        entry.reject(
          new PythonEngineError(response.error.code, response.error.message),
        );
      } else {
        entry.resolve(response.result);
      }
      return;
    }

    const notification = message as {
      method: string;
      params?: Record<string, unknown>;
    };
    const targetId = notification.params?.id;
    if (targetId) {
      const entry = this.pending.get(String(targetId));
      if (entry?.onEvent) {
        entry.onEvent(notification.method, notification.params || {});
        return;
      }
    }
    if (notification.method === 'log') {
      this.logger(`[py-engine] ${notification.params?.message}`, 'info');
    }
  }

  private handleExit(reason: string): void {
    if (!this.proc) return;
    this.proc = null;
    this.lastPingInfo = null;
    this.currentEngineId = null;

    const level = this.stopping ? 'info' : 'error';
    this.logger(`Python engine ${reason}`, level);

    const error = new PythonEngineError(
      'engine_exited',
      `python engine ${reason}`,
    );
    this.pending.forEach((entry) => {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    });
    this.pending.clear();
  }
}
