import type {
  TranscriptionEngine,
  EngineStatus,
  PyEngineId,
} from '../../../types/engine';
import type { IpcMainInvokeEvent } from 'electron';
import type { IFiles } from '../../../types';

export interface TranscribeContext {
  event: IpcMainInvokeEvent;
  file: IFiles;
  formData: Record<string, unknown>;
  hasOpenAiWhisper: boolean;
  /** 取消信號。由 router 從任務上下文注入，各引擎據此中斷轉寫。 */
  signal?: AbortSignal;
}

export interface TranscriptionEngineAdapter {
  id: TranscriptionEngine;
  displayName: string;
  requiresRuntime: boolean;
  /** 運行時引擎對應的 Python 三層架構引擎 id（warmup/sidecar 切換用）；非 Python 引擎留空。 */
  pyEngineId?: PyEngineId;
  isAvailable(): Promise<EngineStatus>;
  transcribe(ctx: TranscribeContext): Promise<string>;
  /** 中斷進行中的轉寫。builtin=signal 原生中斷(no-op)、faster=sidecar 取消、localCli=kill child。 */
  cancelActive(): void;
  /**
   * 批次開始時的可選預熱（在 ensureStarted 成功後調用）：把模型加載等冷啟動成本
   * 移出首個文件關鍵路徑，與音頻抽取並行。必須非致命（失敗僅記日誌，不阻塞任務）。
   */
  prewarm?(formData: Record<string, unknown>): void;
}
