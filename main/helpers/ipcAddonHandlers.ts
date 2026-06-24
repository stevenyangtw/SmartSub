import { ipcMain, BrowserWindow, dialog } from 'electron';
import { logMessage } from './storeManager';
import {
  getCudaEnvironment,
  isPlatformCudaCapable,
  getGpuEnvironment,
  clearGpuEnvironmentCache,
} from './cudaUtils';
import {
  getActiveBackend,
  setFallbackNotifier,
  setLoadResultNotifier,
  clearAddonLoadCache,
} from './addonLoader';
import {
  getAddonConfig,
  getInstalledAddons,
  getSelectedAddonVersion,
  selectAddonVersion,
  removeAddon,
  registerInstalledAddon,
  getAddonSummary,
  setCustomAddonPath,
  getCustomAddonPath,
} from './addonManager';
import {
  getAddonDownloader,
  getDownloadUrl,
  getAddonFileName,
} from './addonDownloader';
import {
  fetchRemoteVersions,
  checkAllUpdates,
  getRemoteVersionInfo,
  getPackageDownloadSize,
} from './addonVersions';
import type {
  AddonVariant,
  DownloadSource,
  DownloadConfig,
} from '../../types/addon';

let mainWindow: BrowserWindow | null = null;

/**
 * 設置主窗口引用
 */
export function setMainWindowForAddon(window: BrowserWindow): void {
  mainWindow = window;
  getAddonDownloader(window);

  // 加載降級 / 後端變更事件推送到渲染層
  setFallbackNotifier((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('addon-fallback', event);
    }
  });
  setLoadResultNotifier((info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('active-backend-changed', info);
    }
  });
}

/**
 * 註冊所有加速包相關的 IPC 處理程序
 */
export function registerAddonIpcHandlers(): void {
  // 獲取 CUDA 環境信息
  ipcMain.handle('get-cuda-environment', async () => {
    try {
      const env = await getCudaEnvironment();
      return env;
    } catch (error) {
      logMessage(`Error getting CUDA environment: ${error}`, 'error');
      return null;
    }
  });

  // 獲取跨廠商 GPU 環境信息
  ipcMain.handle(
    'get-gpu-environment',
    async (_event, forceRefresh?: boolean) => {
      try {
        if (forceRefresh) {
          clearGpuEnvironmentCache();
        }
        return await getGpuEnvironment(!!forceRefresh);
      } catch (error) {
        logMessage(`Error getting GPU environment: ${error}`, 'error');
        return null;
      }
    },
  );

  // 獲取當前生效的後端（最近一次加載結果）
  ipcMain.handle('get-active-backend', async () => {
    try {
      return getActiveBackend();
    } catch (error) {
      logMessage(`Error getting active backend: ${error}`, 'error');
      return null;
    }
  });

  // 獲取已安裝的加速包列表
  ipcMain.handle('get-installed-addons', async () => {
    try {
      return getInstalledAddons();
    } catch (error) {
      logMessage(`Error getting installed addons: ${error}`, 'error');
      return [];
    }
  });

  // 獲取加速包配置
  ipcMain.handle('get-addon-config', async () => {
    try {
      return getAddonConfig();
    } catch (error) {
      logMessage(`Error getting addon config: ${error}`, 'error');
      return null;
    }
  });

  // 獲取當前選中的加速包版本
  ipcMain.handle('get-selected-addon-version', async () => {
    try {
      return getSelectedAddonVersion();
    } catch (error) {
      logMessage(`Error getting selected addon version: ${error}`, 'error');
      return null;
    }
  });

  // 選擇加速包版本
  ipcMain.handle(
    'select-addon-version',
    async (event, version: AddonVariant) => {
      try {
        selectAddonVersion(version);
        clearAddonLoadCache();
        return { success: true };
      } catch (error) {
        logMessage(`Error selecting addon version: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 開始下載加速包（立即返回，不等待下載完成）
  ipcMain.handle(
    'start-addon-download',
    async (event, config: DownloadConfig) => {
      try {
        const downloader = getAddonDownloader(mainWindow || undefined);

        // 異步啟動下載，不等待完成
        downloader
          .download(config.source, config.variant, config.type)
          .then(async () => {
            // 下載完成後註冊加速包並自動選中
            const remoteInfo = await getRemoteVersionInfo(config.variant);
            registerInstalledAddon(
              config.variant,
              remoteInfo?.version ||
                new Date().toISOString().split('T')[0].replace(/-/g, '.'),
            );
            // 自動選中剛下載的版本
            selectAddonVersion(config.variant);
            clearAddonLoadCache();
            logMessage(
              `Addon ${config.variant} downloaded and selected`,
              'info',
            );
          })
          .catch((error) => {
            logMessage(`Download failed: ${error}`, 'error');
          });

        // 立即返回，表示下載已啟動
        return { success: true, started: true };
      } catch (error) {
        logMessage(`Error starting addon download: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 取消下載
  ipcMain.handle('cancel-addon-download', async () => {
    try {
      const downloader = getAddonDownloader();
      downloader.cancel();
      return { success: true };
    } catch (error) {
      logMessage(`Error cancelling download: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  });

  // 刪除加速包
  ipcMain.handle('remove-addon', async (event, version: AddonVariant) => {
    try {
      await removeAddon(version);
      clearAddonLoadCache();
      return { success: true };
    } catch (error) {
      logMessage(`Error removing addon: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  });

  // 檢查加速包更新
  ipcMain.handle('check-addon-updates', async () => {
    try {
      const updates = await checkAllUpdates();
      return updates;
    } catch (error) {
      logMessage(`Error checking addon updates: ${error}`, 'error');
      return [];
    }
  });

  // 獲取遠程版本信息
  ipcMain.handle('get-remote-addon-versions', async () => {
    try {
      return await fetchRemoteVersions();
    } catch (error) {
      logMessage(`Error fetching remote versions: ${error}`, 'error');
      return null;
    }
  });

  ipcMain.handle(
    'get-addon-package-size',
    async (
      _event,
      {
        variant,
        type,
        source,
      }: {
        variant: AddonVariant;
        type: 'node.gz' | 'tar.gz';
        source?: DownloadSource;
      },
    ) => {
      try {
        return await getPackageDownloadSize(variant, type, source ?? 'github');
      } catch (error) {
        logMessage(`Error getting addon package size: ${error}`, 'error');
        return null;
      }
    },
  );

  // 獲取加速包摘要信息
  ipcMain.handle('get-addon-summary', async () => {
    try {
      return getAddonSummary();
    } catch (error) {
      logMessage(`Error getting addon summary: ${error}`, 'error');
      return {
        hasInstalled: false,
        selectedVersion: null,
        installedCount: 0,
        installedVersions: [],
      };
    }
  });

  // 檢查平臺是否支持 CUDA
  ipcMain.handle('is-platform-cuda-capable', async () => {
    return isPlatformCudaCapable();
  });

  // 獲取下載 URL（用於顯示或手動下載）
  ipcMain.handle(
    'get-addon-download-url',
    async (
      event,
      {
        source,
        variant,
        type,
      }: {
        source: DownloadSource;
        variant: AddonVariant;
        type: 'node.gz' | 'tar.gz';
      },
    ) => {
      try {
        return getDownloadUrl(source, variant, type);
      } catch (error) {
        return null;
      }
    },
  );

  // 選擇自定義 addon.node 文件
  ipcMain.handle('select-addon-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select addon.node file',
        filters: [
          {
            name: 'Node Addon',
            extensions: ['node'],
          },
        ],
      });

      if (result.canceled || !result.filePaths[0]) {
        return { filePath: null, canceled: true };
      }

      return { filePath: result.filePaths[0], canceled: false };
    } catch (error) {
      logMessage(`Error selecting addon file: ${error}`, 'error');
      return { filePath: null, canceled: true, error: String(error) };
    }
  });

  // 設置自定義 addon.node 路徑
  ipcMain.handle(
    'set-custom-addon-path',
    async (event, filePath: string | null) => {
      try {
        setCustomAddonPath(filePath);
        clearAddonLoadCache();
        return { success: true };
      } catch (error) {
        logMessage(`Error setting custom addon path: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 獲取自定義 addon.node 路徑
  ipcMain.handle('get-custom-addon-path', async () => {
    try {
      return getCustomAddonPath();
    } catch (error) {
      logMessage(`Error getting custom addon path: ${error}`, 'error');
      return null;
    }
  });

  logMessage('Addon IPC handlers registered', 'info');
}
