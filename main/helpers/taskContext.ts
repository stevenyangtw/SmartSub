import { AsyncLocalStorage } from 'async_hooks';

export interface TaskRunContext {
  projectId?: string;
  fileUuid?: string;
  /** 取消信號：翻譯批次邊界與階段邊界檢查 */
  signal?: AbortSignal;
}

const storage = new AsyncLocalStorage<TaskRunContext>();

/** 在任務上下文中執行：logMessage 自動打 projectId 標，取消檢查可感知 signal */
export function runWithTaskContext<T>(
  context: TaskRunContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

export function getTaskContext(): TaskRunContext | undefined {
  return storage.getStore();
}

const CANCEL_MESSAGE = 'TASK_CANCELLED';

export class TaskCancelledError extends Error {
  constructor() {
    super(CANCEL_MESSAGE);
    this.name = 'TaskCancelledError';
  }
}

export function isTaskCancelledError(error: unknown): boolean {
  return (
    error instanceof TaskCancelledError ||
    (error instanceof Error && error.message === CANCEL_MESSAGE)
  );
}

export function isTaskCancelled(): boolean {
  return Boolean(storage.getStore()?.signal?.aborted);
}

export function throwIfTaskCancelled(): void {
  if (isTaskCancelled()) throw new TaskCancelledError();
}

/** whisper addon 因 AbortSignal 中斷時拋出的錯誤（與 TaskCancelledError 統一處理） */
export function isWhisperAbortError(error: unknown): boolean {
  if (isTaskCancelledError(error)) return true;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    const msg = error.message.toLowerCase();
    if (
      msg.includes('aborted') ||
      msg.includes('abort') ||
      msg.includes('cancelled') ||
      msg.includes('canceled')
    ) {
      return true;
    }
  }
  return false;
}

/** addon 正常 resolve 但 cancelled:true（非 throw） */
export function isWhisperCancelledResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { cancelled?: boolean }).cancelled === true
  );
}
