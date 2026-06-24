import { ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import { logMessage, store } from './storeManager';
import { listEngineAdapters } from './engines/registry';
import { getPyEngineDownloader } from './pythonRuntime/downloader';
import { isTranscriptionBusy } from './taskProcessor';
import {
  getPythonRuntimeManager,
  shutdownPythonRuntime,
} from './pythonRuntime';
import { getEngineDir } from './pythonRuntime/paths';
import type { TranscriptionEngine } from '../../types/engine';
import type {
  PyEngineDownloadSource,
  PyEngineId,
  PyEngineVariant,
} from '../../types/engine';
import { normalizePyEngineVariant } from './pythonRuntime/paths';

let mainWindow: BrowserWindow | null = null;

/** 僅 faster-whisper 走 Python 運行時下載（funasr/qwen/firered 已遷移內置 sherpa 原生庫）。 */
function coerceEngineId(_value: unknown): PyEngineId {
  return 'faster-whisper';
}

export function setMainWindowForEngine(window: BrowserWindow): void {
  mainWindow = window;
  // 預綁定運行時下載器的 mainWindow，保證後臺（自動更新）觸發的下載進度也能上報。
  getPyEngineDownloader('faster-whisper', window);
}

export function registerEngineIpcHandlers(): void {
  ipcMain.handle('get-engine-status', async () => {
    try {
      const adapters = listEngineAdapters();
      const statuses: Record<
        TranscriptionEngine,
        Awaited<ReturnType<(typeof adapters)[number]['isAvailable']>>
      > = {} as Record<
        TranscriptionEngine,
        Awaited<ReturnType<(typeof adapters)[number]['isAvailable']>>
      >;
      for (const adapter of adapters) {
        statuses[adapter.id] = await adapter.isAvailable();
      }
      return statuses;
    } catch (error) {
      logMessage(`Error getting engine status: ${error}`, 'error');
      return {};
    }
  });

  // --- sherpa-onnx 原生運行庫（funasr / qwen / fireRed 引擎共用）：隨安裝包內置 ---
  // 庫隨 App 固定發佈、整體隨版本升級，故無下載/升級/卸載通道，僅暴露內置狀態。
  ipcMain.handle('sherpa-lib-status', async () => {
    const { getSherpaLibStatus } = await import(
      './sherpaOnnx/sherpaLibManager'
    );
    return getSherpaLibStatus();
  });

  ipcMain.handle(
    'start-py-engine-download',
    async (
      _event,
      {
        source,
        engineId,
        variant,
      }: {
        source: PyEngineDownloadSource;
        engineId?: PyEngineId;
        variant?: PyEngineVariant;
      },
    ) => {
      try {
        // 運行中禁止安裝/升級：避免替換 current/ 時的 Windows 文件鎖與轉寫中斷。
        if (isTranscriptionBusy()) {
          return { success: false, error: 'engine_busy' };
        }
        const downloader = getPyEngineDownloader(
          coerceEngineId(engineId),
          mainWindow || undefined,
        );
        // 不支持 cuda 的平臺（macOS）會被 normalize 收斂為 cpu，避免下載不存在的產物。
        downloader
          .download(source, normalizePyEngineVariant(variant))
          .catch((error) => {
            logMessage(`Py-engine download failed: ${error}`, 'error');
          });
        return { success: true, started: true };
      } catch (error) {
        logMessage(`Error starting py-engine download: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'check-py-engine-update',
    async (
      _event,
      {
        source,
        engineId,
        variant,
      }: {
        source: PyEngineDownloadSource;
        engineId?: PyEngineId;
        variant?: PyEngineVariant;
      },
    ) => {
      try {
        const info = await getPyEngineDownloader(
          coerceEngineId(engineId),
          mainWindow || undefined,
        ).checkUpdate(
          source,
          variant ? normalizePyEngineVariant(variant) : undefined,
        );
        return { success: true, info };
      } catch (error) {
        logMessage(`Error checking py-engine update: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'cancel-py-engine-download',
    async (_event, payload?: { engineId?: PyEngineId }) => {
      try {
        getPyEngineDownloader(
          coerceEngineId(payload?.engineId),
          mainWindow || undefined,
        ).cancel();
        return { success: true };
      } catch (error) {
        logMessage(`Error cancelling py-engine download: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'get-py-engine-download-progress',
    async (_event, payload?: { engineId?: PyEngineId }) => {
      try {
        return getPyEngineDownloader(
          coerceEngineId(payload?.engineId),
          mainWindow || undefined,
        ).getProgress();
      } catch (error) {
        logMessage(
          `Error getting py-engine download progress: ${error}`,
          'error',
        );
        return null;
      }
    },
  );

  ipcMain.handle(
    'uninstall-py-engine',
    async (_event, payload?: { engineId?: PyEngineId }) => {
      try {
        if (isTranscriptionBusy()) {
          return { success: false, error: 'engine_busy' };
        }
        await shutdownPythonRuntime();

        // 整個引擎包目錄（含內部 manifest.json）一併刪除即回到未安裝態
        const engineDir = getEngineDir(coerceEngineId(payload?.engineId));
        if (fs.existsSync(engineDir)) {
          fs.rmSync(engineDir, { recursive: true, force: true });
        }

        return { success: true };
      } catch (error) {
        logMessage(`Error uninstalling py-engine: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'set-faster-whisper-settings',
    async (
      _event,
      {
        device,
        computeType,
      }: {
        device?: 'auto' | 'cpu' | 'cuda';
        computeType?: string;
      },
    ) => {
      try {
        const settings = store.get('settings');
        store.set('settings', {
          ...settings,
          ...(device !== undefined ? { fasterWhisperDevice: device } : {}),
          ...(computeType !== undefined
            ? { fasterWhisperComputeType: computeType }
            : {}),
        });
        return { success: true };
      } catch (error) {
        logMessage(`Error setting faster-whisper settings: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'set-funasr-settings',
    async (
      _event,
      {
        provider,
        useItn,
        numThreads,
      }: {
        provider?: 'cpu' | 'cuda' | 'coreml';
        useItn?: boolean;
        numThreads?: number;
      },
    ) => {
      try {
        const settings = store.get('settings');
        store.set('settings', {
          ...settings,
          ...(provider !== undefined ? { funasrProvider: provider } : {}),
          ...(useItn !== undefined ? { funasrUseItn: useItn } : {}),
          ...(numThreads !== undefined ? { funasrNumThreads: numThreads } : {}),
        });
        return { success: true };
      } catch (error) {
        logMessage(`Error setting funasr settings: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'set-qwen-settings',
    async (
      _event,
      {
        provider,
        numThreads,
      }: {
        provider?: 'cpu' | 'cuda';
        numThreads?: number;
      },
    ) => {
      try {
        const settings = store.get('settings');
        store.set('settings', {
          ...settings,
          ...(provider !== undefined ? { qwenProvider: provider } : {}),
          ...(numThreads !== undefined ? { qwenNumThreads: numThreads } : {}),
        });
        return { success: true };
      } catch (error) {
        logMessage(`Error setting qwen settings: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'set-firered-settings',
    async (
      _event,
      {
        provider,
        numThreads,
      }: {
        provider?: 'cpu' | 'cuda';
        numThreads?: number;
      },
    ) => {
      try {
        const settings = store.get('settings');
        store.set('settings', {
          ...settings,
          ...(provider !== undefined ? { fireRedProvider: provider } : {}),
          ...(numThreads !== undefined
            ? { fireRedNumThreads: numThreads }
            : {}),
        });
        return { success: true };
      } catch (error) {
        logMessage(`Error setting firered settings: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'python-engine:ping',
    async (_event, payload?: { engineId?: PyEngineId }) => {
      try {
        const manager = getPythonRuntimeManager();
        // 唯一的 Python 引擎是 faster-whisper（coerceEngineId 恆返回它），按顯式 engineId 預熱。
        const engineId = coerceEngineId(payload?.engineId);
        await manager.ensureStarted(engineId);
        return { success: true };
      } catch (error) {
        logMessage(`Python engine ping failed: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  logMessage('Engine IPC handlers registered', 'info');
}
