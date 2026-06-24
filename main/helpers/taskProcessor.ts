import fse from 'fs-extra';
import { ipcMain, BrowserWindow, Notification } from 'electron';
import { processFile } from './fileProcessor';
import { checkOpenAiWhisper, getPath } from './whisper';
import { logMessage, store } from './storeManager';
import path from 'path';
import { isAppleSilicon } from './utils';
import { IFiles } from '../../types';
import { ExtendedProvider, CustomParameterConfig } from '../../types/provider';
import { configurationManager } from '../service/configurationManager';
import { applyTaskEventToProjects } from './taskManager';
import { runWithTaskContext } from './taskContext';
import { killFfmpegForFiles } from './audioProcessor';
import {
  listEngineAdapters,
  getEngineAdapterForTask,
  resolveEngineIdForTask,
} from './engines/registry';
import { getPythonRuntimeManager } from './pythonRuntime';
import type { TranscriptionEngine } from '../../types/engine';
import {
  acquireTaskPowerSaveBlocker,
  releaseTaskPowerSaveBlocker,
} from './powerSaveManager';

const TASK_EVENT_CHANNELS = new Set([
  'taskStatusChange',
  'taskProgressChange',
  'taskErrorChange',
  'taskFileChange',
]);

/**
 * 包裝 IPC event：任務事件除發往渲染層外，同步鏡像進任務工程存儲。
 * 這樣用戶中途離開任務頁（無渲染層監聽）時，工程狀態也不會停留在 loading。
 */
function wrapTaskEvent(event: any) {
  const sender = event.sender;
  return {
    ...event,
    sender: {
      send: (channel: string, ...args: any[]) => {
        if (TASK_EVENT_CHANNELS.has(channel)) {
          applyTaskEventToProjects(channel, ...args);
        }
        try {
          sender.send(channel, ...args);
        } catch (error) {
          // 窗口銷燬等場景下發送失敗，但鏡像已落庫
          console.error('send task event failed', error);
        }
      },
    },
  };
}

interface QueueItem {
  file: IFiles;
  formData: any;
  projectId: string;
}

interface ProjectRuntime {
  /** 正在執行的文件數 */
  active: number;
  /** 正在執行的文件 uuid（取消時定位 ffmpeg 進程） */
  activeFiles: Set<string>;
  paused: boolean;
  cancelled: boolean;
  /** 取消信號：翻譯批次邊界與階段邊界檢查 */
  controller: AbortController;
  /** 本輪入列的文件總數（Dock/任務欄進度分母） */
  total: number;
  /** 已結束（成功/失敗/取消）的文件數（進度分子） */
  completed: number;
}

const DEFAULT_PROJECT_ID = 'default';
const TRANSCRIPTION_POWER_SAVE_REASON = 'transcription';

let processingQueue: QueueItem[] = [];
const projectRuntimes = new Map<string, ProjectRuntime>();
let isProcessing = false;
let maxConcurrentTasks = 3;
let hasOpenAiWhisper = false;
let activeTasksCount = 0;
/** 執行中"受限引擎"(faster-whisper/funasr)任務數：混合引擎隊列併發鉗制用。 */
let activeRestrictiveCount = 0;

/** faster-whisper / funasr / qwen / fireRedAsr 共享單 sidecar/worker，需鉗制有效併發為 1。 */
function isRestrictiveEngine(engine: TranscriptionEngine): boolean {
  return (
    engine === 'fasterWhisper' ||
    engine === 'funasr' ||
    engine === 'qwen' ||
    engine === 'fireRedAsr'
  );
}
/** 最近一次 handleTask 的 event：resume 觸發派發時複用 */
let dispatchEvent: any = null;
/** Dock/任務欄進度條目標窗口 */
let progressWindow: BrowserWindow | null = null;

function hasRunnableQueuedTasks(): boolean {
  return processingQueue.some((item) => {
    const runtime = projectRuntimes.get(item.projectId);
    return !runtime?.paused && !runtime?.cancelled;
  });
}

function syncTranscriptionPowerSaveBlocker() {
  if (activeTasksCount > 0 || hasRunnableQueuedTasks()) {
    acquireTaskPowerSaveBlocker(TRANSCRIPTION_POWER_SAVE_REASON);
  } else {
    releaseTaskPowerSaveBlocker(TRANSCRIPTION_POWER_SAVE_REASON);
  }
}

/**
 * 正在執行 + 排隊中的轉寫任務總數。供關閉窗口提示展示「仍在處理 N 個任務」。
 */
export function getTranscriptionBusyCount(): number {
  return activeTasksCount + processingQueue.length;
}

/**
 * 是否有轉寫任務在執行或排隊。供升級/下載 IPC 在運行中拒絕操作（避免 Windows 文件鎖）。
 */
export function isTranscriptionBusy(): boolean {
  return getTranscriptionBusyCount() > 0;
}

function ensureRuntime(projectId: string): ProjectRuntime {
  let runtime = projectRuntimes.get(projectId);
  if (!runtime) {
    runtime = {
      active: 0,
      activeFiles: new Set(),
      paused: false,
      cancelled: false,
      controller: new AbortController(),
      total: 0,
      completed: 0,
    };
    projectRuntimes.set(projectId, runtime);
  }
  return runtime;
}

/** 按文件粒度聚合全部工程，更新 macOS Dock / Windows 任務欄進度條 */
function updateTaskbarProgress() {
  if (!progressWindow || progressWindow.isDestroyed()) return;
  try {
    let total = 0;
    let completed = 0;
    projectRuntimes.forEach((runtime) => {
      total += runtime.total;
      completed += runtime.completed;
    });
    if (total === 0) {
      progressWindow.setProgressBar(-1);
    } else {
      progressWindow.setProgressBar(Math.min(completed / total, 1));
    }
  } catch (error) {
    logMessage(`updateTaskbarProgress error: ${error}`, 'warning');
  }
}

function queuedCount(projectId: string): number {
  return processingQueue.filter((item) => item.projectId === projectId).length;
}

function sendTaskComplete(
  event: any,
  projectId: string,
  status: 'completed' | 'cancelled',
) {
  try {
    event?.sender?.send('taskComplete', { projectId, status });
  } catch (error) {
    console.error('send taskComplete failed', error);
  }
}

/** 工程內已無排隊與執行中文件時收尾：發完成事件並清理運行時 */
function finalizeProjectIfDrained(event: any, projectId: string) {
  const runtime = projectRuntimes.get(projectId);
  if (!runtime) return;
  if (runtime.active > 0 || queuedCount(projectId) > 0) return;
  const status = runtime.cancelled ? 'cancelled' : 'completed';
  projectRuntimes.delete(projectId);
  updateTaskbarProgress();
  sendTaskComplete(event, projectId, status);
  if (status === 'completed') notifyProjectDone(event);
}

/**
 * Load custom parameters for a provider and create an ExtendedProvider
 */
async function createExtendedProvider(
  baseProvider: any,
): Promise<ExtendedProvider> {
  try {
    // Get custom parameters from configuration manager
    const providerCustomParams: CustomParameterConfig | null =
      await configurationManager.getConfiguration(baseProvider.id);

    // Create extended provider with custom parameters
    const extendedProvider: ExtendedProvider = {
      ...baseProvider,
      customParameters: providerCustomParams,
    };

    if (providerCustomParams) {
      logMessage(
        `Custom parameters loaded for provider: ${baseProvider.id}`,
        'info',
      );
      logMessage(
        `Header parameters: ${Object.keys(providerCustomParams.headerParameters || {}).length}`,
        'info',
      );
      logMessage(
        `Body parameters: ${Object.keys(providerCustomParams.bodyParameters || {}).length}`,
        'info',
      );
    } else {
      logMessage(
        `No custom parameters found for provider: ${baseProvider.id}`,
        'info',
      );
    }

    return extendedProvider;
  } catch (error) {
    logMessage(
      `Error loading custom parameters for provider ${baseProvider.id}: ${error}`,
      'error',
    );
    // Return base provider if custom parameter loading fails
    return {
      ...baseProvider,
      customParameters: null,
    };
  }
}

export function setupTaskProcessor(mainWindow: BrowserWindow) {
  progressWindow = mainWindow;
  ipcMain.on(
    'handleTask',
    async (
      event,
      {
        files,
        formData,
        projectId,
      }: { files: IFiles[]; formData: any; projectId?: string },
    ) => {
      const pid = projectId || DEFAULT_PROJECT_ID;
      dispatchEvent = event;
      await runWithTaskContext({ projectId: pid }, async () => {
        logMessage(`handleTask start`, 'info');
        logMessage(`formData: \n ${JSON.stringify(formData, null, 2)}`, 'info');
      });
      const runtime = ensureRuntime(pid);
      // 重新開始：清除上一輪的暫停/取消殘留
      runtime.paused = false;
      runtime.cancelled = false;
      if (runtime.controller.signal.aborted) {
        runtime.controller = new AbortController();
      }
      processingQueue.push(
        ...files.map((file) => ({ file, formData, projectId: pid })),
      );
      runtime.total += files.length;
      updateTaskbarProgress();
      syncTranscriptionPowerSaveBlocker();
      if (!isProcessing) {
        isProcessing = true;
        hasOpenAiWhisper = await checkOpenAiWhisper();
        maxConcurrentTasks = formData.maxConcurrentTasks || 3;
        // 預熱 sidecar：把冷啟動成本移出首個文件關鍵路徑（faster-whisper 等需運行時引擎）。
        // ensureStarted 成功後再 prewarm（按引擎預加載模型），與首個文件的音頻抽取並行，
        // 避免 FunASR 等首個 transcribe 因首次加載原生庫/ONNX 過慢而長時間卡在 0%。
        try {
          // 按本批任務攜帶的引擎預熱（缺省回退全局/預設）。
          const batchAdapter = getEngineAdapterForTask(formData);
          if (batchAdapter.requiresRuntime && batchAdapter.pyEngineId) {
            // Python 運行時引擎（faster-whisper）：先拉起 sidecar 再預熱。
            void getPythonRuntimeManager()
              .ensureStarted(batchAdapter.pyEngineId)
              .then(() => batchAdapter.prewarm?.(formData))
              .catch((e) =>
                logMessage(`engine warmup failed (non-fatal): ${e}`, 'warning'),
              );
          } else if (batchAdapter.prewarm) {
            // 無 Python 的引擎（funasr/sherpa）：worker 線程直接預加載模型。
            batchAdapter.prewarm(formData);
          }
        } catch (e) {
          logMessage(`engine warmup skipped: ${e}`, 'warning');
        }
        processNextTasks(event);
      }
    },
  );

  ipcMain.on('pauseTask', (event, projectId?: string) => {
    if (projectId) {
      ensureRuntime(projectId).paused = true;
      syncTranscriptionPowerSaveBlocker();
      return;
    }
    projectRuntimes.forEach((runtime) => {
      runtime.paused = true;
    });
    syncTranscriptionPowerSaveBlocker();
  });

  ipcMain.on('resumeTask', (event, projectId?: string) => {
    if (projectId) {
      ensureRuntime(projectId).paused = false;
    } else {
      projectRuntimes.forEach((runtime) => {
        runtime.paused = false;
      });
    }
    syncTranscriptionPowerSaveBlocker();
    if (processingQueue.length > 0) {
      isProcessing = true;
      processNextTasks(dispatchEvent || event);
    }
  });

  ipcMain.on('cancelTask', (event, projectId?: string) => {
    const ids = projectId
      ? [projectId]
      : Array.from(
          new Set([
            ...Array.from(projectRuntimes.keys()),
            ...processingQueue.map((item) => item.projectId),
          ]),
        );
    for (const id of ids) {
      const beforeCount = processingQueue.length;
      processingQueue = processingQueue.filter((item) => item.projectId !== id);
      const removedCount = beforeCount - processingQueue.length;
      const runtime = projectRuntimes.get(id);
      if (runtime) {
        runtime.total = Math.max(runtime.total - removedCount, 0);
      }
      if (runtime && runtime.active > 0) {
        runtime.cancelled = true;
        runtime.paused = false;
        runtime.controller.abort();
        // kill ffmpeg 提取；whisper 轉寫經 AbortSignal 同步中斷
        killFfmpegForFiles(Array.from(runtime.activeFiles));
        // 通知所有引擎中斷進行中的轉寫（如 faster-whisper sidecar 的逐段取消）。
        // 逐任務引擎下無全局"當前引擎"，對全部適配器調用 cancelActive；
        // 未在運行的引擎為空操作（內置 whisper 已由 AbortSignal 中斷）。
        for (const adapter of listEngineAdapters()) {
          try {
            adapter.cancelActive();
          } catch (err) {
            logMessage(`cancelActive(${adapter.id}) failed: ${err}`, 'warning');
          }
        }
        logMessage(
          `cancel project ${id}: aborting ${runtime.active} running file(s)`,
          'warning',
        );
      } else {
        projectRuntimes.delete(id);
        sendTaskComplete(event, id, 'cancelled');
      }
    }
    updateTaskbarProgress();
    syncTranscriptionPowerSaveBlocker();
  });

  // 獲取指定工程的任務狀態（無 projectId 時回退全局語義）
  ipcMain.handle('getTaskStatus', (event, projectId?: string) => {
    if (!projectId) {
      return activeTasksCount > 0 || processingQueue.length > 0
        ? 'running'
        : 'idle';
    }
    const runtime = projectRuntimes.get(projectId);
    const queued = queuedCount(projectId);
    if (!runtime) return queued > 0 ? 'running' : 'idle';
    if (runtime.cancelled) return runtime.active > 0 ? 'cancelling' : 'idle';
    if (runtime.paused) return 'paused';
    if (runtime.active > 0 || queued > 0) return 'running';
    return 'idle';
  });

  ipcMain.handle('checkMlmodel', async (event, modelName) => {
    // 如果不是蘋果芯片，不需要該文件，直接返回true
    if (!isAppleSilicon()) {
      return true;
    }
    // 判斷模型目錄下是否存在 `ggml-${modelName}-encoder.mlmodelc` 文件或者目錄
    const modelsPath = getPath('modelsPath');
    const modelPath = path.join(
      modelsPath,
      `ggml-${modelName}-encoder.mlmodelc`,
    );
    const exists = await fse.pathExists(modelPath);
    return exists;
  });
}

/** 工程全部完成且應用不在前臺時發系統通知 */
function notifyProjectDone(event) {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isFocused()) return;
    if (!Notification.isSupported()) return;
    const lang = store.get('settings')?.language || 'zh-TW';
    const notification = new Notification({
      title: lang === 'zh' ? '任務全部完成' : 'All tasks completed',
      body:
        lang === 'zh'
          ? '字幕任務已處理完畢，點擊查看結果'
          : 'Your subtitle tasks are done — click to view results',
    });
    notification.on('click', () => {
      win?.show();
      win?.focus();
    });
    notification.show();
  } catch (error) {
    logMessage(`notifyProjectDone error: ${error}`, 'warning');
  }
}

/** 取出最多 limit 個可派發項（跳過暫停/已取消工程），其餘留在隊列 */
function takeEligibleItems(limit: number): QueueItem[] {
  const taken: QueueItem[] = [];
  const rest: QueueItem[] = [];
  for (const item of processingQueue) {
    const runtime = projectRuntimes.get(item.projectId);
    if (taken.length < limit && !runtime?.paused && !runtime?.cancelled) {
      taken.push(item);
    } else {
      rest.push(item);
    }
  }
  processingQueue = rest;
  return taken;
}

async function processNextTasks(event) {
  syncTranscriptionPowerSaveBlocker();
  // 隊列與執行均清空：全局收工
  if (processingQueue.length === 0 && activeTasksCount === 0) {
    isProcessing = false;
    return;
  }

  // 混合引擎併發鉗制：只要"執行中"或"待派發(可派發)"任務裡含 faster-whisper/funasr，
  // 有效併發鉗為 1（共享單 sidecar/worker，避免顯存爭用與取消句柄相互覆蓋）；
  // 純 builtin/localCli 隊列遵循用戶配置的併發。
  let effectiveMax = maxConcurrentTasks;
  try {
    let hasRestrictive = activeRestrictiveCount > 0;
    if (!hasRestrictive) {
      for (const item of processingQueue) {
        const runtime = projectRuntimes.get(item.projectId);
        if (runtime?.paused || runtime?.cancelled) continue;
        if (isRestrictiveEngine(resolveEngineIdForTask(item.formData))) {
          hasRestrictive = true;
          break;
        }
      }
    }
    if (hasRestrictive) effectiveMax = 1;
  } catch {
    // 解析引擎失敗時回退到用戶配置的併發
  }

  // 計算可以啟動的新任務數量
  const availableSlots = effectiveMax - activeTasksCount;

  if (availableSlots > 0) {
    const tasksToProcess = takeEligibleItems(availableSlots);
    if (tasksToProcess.length > 0) {
      const translationProviders = store.get('translationProviders');

      tasksToProcess.forEach(async (task) => {
        const runtime = ensureRuntime(task.projectId);
        const fileUuid = task.file?.uuid;
        const taskEngine = resolveEngineIdForTask(task.formData);
        activeTasksCount++;
        runtime.active++;
        if (isRestrictiveEngine(taskEngine)) activeRestrictiveCount++;
        if (fileUuid) runtime.activeFiles.add(fileUuid);
        try {
          const baseProvider = translationProviders.find(
            (p) => p.id === task.formData.translateProvider,
          );

          // 找不到服務商（'-1' 殘留或已刪除）時不加載擴展參數；
          // 是否報錯由翻譯階段判定，轉寫等階段照常執行
          const extendedProvider = baseProvider
            ? await createExtendedProvider(baseProvider)
            : undefined;

          await runWithTaskContext(
            {
              projectId: task.projectId,
              fileUuid,
              signal: runtime.controller.signal,
            },
            () =>
              processFile(
                wrapTaskEvent(event),
                task.file as IFiles,
                task.formData,
                hasOpenAiWhisper,
                extendedProvider,
              ),
          );
        } catch (error) {
          event.sender.send('message', error);
        } finally {
          activeTasksCount--;
          runtime.active--;
          if (isRestrictiveEngine(taskEngine)) activeRestrictiveCount--;
          runtime.completed++;
          if (fileUuid) runtime.activeFiles.delete(fileUuid);
          finalizeProjectIfDrained(event, task.projectId);
          syncTranscriptionPowerSaveBlocker();
          updateTaskbarProgress();
          // 處理完一個任務後，檢查是否可以啟動新任務
          processNextTasks(event);
        }
      });
    }
  }

  // 有任務在跑（100ms）或隊列裡還躺著暫停項（500ms）：保持輪詢，
  // 這樣 handleTask/resumeTask 之後的新增項總能被派發
  if (activeTasksCount > 0) {
    setTimeout(() => processNextTasks(event), 100);
  } else if (processingQueue.length > 0) {
    setTimeout(() => processNextTasks(event), 500);
  }
}
