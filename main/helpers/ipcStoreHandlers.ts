import { app, ipcMain } from 'electron';
import os from 'os';
import { store } from './store';
import { defaultUserConfig } from './utils';
import { getAndInitializeProviders } from './providerManager';
import { logMessage } from './logger';
import { LogEntry } from './store/types';
import { getBuildInfo } from './buildInfo';
import { exportConfig, importConfig } from './configExporter';
import { rebuildAppMenu } from './menu';
import { shutdownPythonRuntime } from './pythonRuntime';
import { applyProxyFromSettings } from './network/proxyManager';
import { syncTaskPowerSaveBlocker } from './powerSaveManager';

console.log(app.getVersion(), 'version');

export function setupStoreHandlers() {
  // gpuMode 一次性遷移：
  // 老用戶（settings 中無 gpuMode）統一遷移為 'auto'，並標記待通知；
  // 新裝用戶由 store defaults 提供 gpuMode='auto'，不會進入此分支。
  const currentSettings = store.get('settings');
  if (currentSettings && currentSettings.gpuMode === undefined) {
    store.set('settings', {
      ...currentSettings,
      gpuMode: 'auto',
      gpuMigrationNotified: false,
    });
    logMessage(
      `Migrated GPU settings: useCuda=${currentSettings.useCuda} -> gpuMode=auto`,
      'info',
    );
  }

  // 啟動時初始化服務商配置
  getAndInitializeProviders().then(async () => {
    const osInfo = {
      platform: os.platform(),
      arch: os.arch(),
      version: os.version(),
      model: os.machine(),
      cpuModel: os?.cpus()?.[0]?.model,
      release: os.release(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      type: os.type(),
      buildInfo: getBuildInfo(),
    };
    logMessage(`osInfo: ${JSON.stringify(osInfo, null, 2)}`, 'info');
    logMessage('Translation providers initialized', 'info');
  });

  // Provider 相關處理
  ipcMain.on('setTranslationProviders', async (event, providers) => {
    store.set('translationProviders', providers);
  });

  ipcMain.handle('getTranslationProviders', async () => {
    return getAndInitializeProviders();
  });

  // 用戶配置相關處理
  ipcMain.on('setUserConfig', async (event, config) => {
    store.set('userConfig', config);
  });

  ipcMain.handle('getUserConfig', async () => {
    const storedConfig = store.get('userConfig');
    return { ...defaultUserConfig, ...storedConfig };
  });

  // 設置相關處理
  ipcMain.handle('setSettings', async (event, settings) => {
    const preSettings = store.get('settings');
    store.set('settings', { ...preSettings, ...settings });
    if (
      settings?.proxyMode !== undefined ||
      settings?.proxyUrl !== undefined ||
      settings?.proxyNoProxy !== undefined
    ) {
      applyProxyFromSettings();
    }
    if (settings?.preventSleepDuringTask !== undefined) {
      syncTaskPowerSaveBlocker();
    }
    if (
      settings?.fasterWhisperModelsPath &&
      settings.fasterWhisperModelsPath !== preSettings?.fasterWhisperModelsPath
    ) {
      await shutdownPythonRuntime();
      logMessage(
        `faster-whisper models path changed, python engine restarted`,
        'info',
      );
    }
    // 語言切換後重建應用菜單
    if (settings?.language && settings.language !== preSettings?.language) {
      rebuildAppMenu(settings.language);
    }
  });

  ipcMain.handle('getSettings', async () => {
    return store.get('settings');
  });

  // 日誌相關處理
  ipcMain.handle(
    'addLog',
    async (event, logEntry: Omit<LogEntry, 'timestamp'>) => {
      const logs = store.get('logs');
      const newLog = {
        ...logEntry,
        timestamp: Date.now(),
      };
      store.set('logs', [...logs, newLog]);
      event.sender.send('newLog', newLog);
    },
  );

  ipcMain.handle('getLogs', async (event, projectId?: string) => {
    const logs = store.get('logs') || [];
    if (!projectId) return logs;
    return logs.filter((log) => log.projectId === projectId);
  });

  ipcMain.handle('clearLogs', async (_event, projectId?: string) => {
    const logs = store.get('logs') || [];
    if (!projectId) {
      store.set('logs', []);
      return true;
    }
    store.set(
      'logs',
      logs.filter((log) => log.projectId !== projectId),
    );
    return true;
  });

  // 清理配置
  ipcMain.handle('clearConfig', async () => {
    store.clear();
    return true;
  });

  // 配置導入導出
  ipcMain.handle('exportConfig', async (_event, password: string) => {
    return exportConfig(password);
  });

  ipcMain.handle('importConfig', async (_event, password: string) => {
    return importConfig(password);
  });
}
