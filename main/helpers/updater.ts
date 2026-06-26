import { BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { store } from './store';
import { logMessage } from './logger';

// 配置自動更新
autoUpdater.autoDownload = false; // 不自動下載，讓用戶決定

autoUpdater.autoInstallOnAppQuit = true; // 應用退出時自動安裝

// 針對未簽名應用的配置
// autoUpdater.allowPrerelease = false; // 允許預發佈版本
autoUpdater.forceDevUpdateConfig = true; // 強制使用開發配置，繞過簽名驗證
// autoUpdater.allowDowngrade = true; // 允許降級安裝，有助於解決某些版本問題

// 日誌設置
autoUpdater.logger = {
  info: (message) => logMessage(`[Updater] ${message}`, 'info'),
  warn: (message) => logMessage(`[Updater] ${message}`, 'warning'),
  error: (message) => logMessage(`[Updater] ${message}`, 'error'),
  debug: (message) => logMessage(`[Updater] ${message}`, 'info'),
};

import { getBuildInfo } from './buildInfo';

export function setupAutoUpdater(mainWindow: BrowserWindow) {
  // 針對Mac平臺的特殊處理
  const isMacOS = process.platform === 'darwin';
  const buildInfo = getBuildInfo(); // buildInfo 仍用於日誌記錄

  // 如果是Mac平臺，禁用自動下載和安裝
  if (isMacOS) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  }

  // 設置更新通道：所有構建（含 beta 等預發佈版本）都只跟蹤穩定通道。
  // 預發佈版本若不顯式關閉 allowPrerelease，electron-updater 會從
  // releases.atom（包含未發 release 的裸 tag）解析出 beta tag 自身，
  // 再去請求其名下不存在的 latest-mac.yml 而報 404。
  // 關閉後 beta 安裝包靜默無更新，待下一個穩定版發佈時正常收到提示。
  autoUpdater.channel = 'latest';
  autoUpdater.allowPrerelease = false;
  logMessage(`Setting update channel to: ${autoUpdater.channel}`, 'info');

  // 檢查更新（失敗反饋統一由 renderer 依據 update-status error 事件呈現）
  const checkForUpdates = async () => {
    try {
      logMessage(
        `Checking for updates... Platform: ${buildInfo.platform}, Arch: ${buildInfo.arch} on channel '${autoUpdater.channel}'`,
        'info',
      );
      const result = await autoUpdater.checkForUpdates();
      return result;
    } catch (error) {
      logMessage(`Error checking for updates: ${error.message}`, 'error');
      return null;
    }
  };

  // 設置自動更新事件處理
  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    // 只通知渲染進程，不彈出系統對話框，由渲染進程的 UpdateDialog 組件處理
    mainWindow.webContents.send('update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('update-status', { status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update-status', {
      status: 'downloading',
      progress: progressObj.percent,
    });
  });

  // 安裝提示僅由 renderer 的 toast（帶「立即安裝」動作）承擔，不再疊加原生 dialog
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update-status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    logMessage(`Update error: ${error.message}`, 'error'); // Restored original log message for error
    mainWindow.webContents.send('update-status', {
      status: 'error',
      error: error.message,
    });

    // 當自動更新出錯時，提供手動下載選項
    // if (process.platform === 'darwin') {
    //   // 針對Mac平臺的特殊處理
    //   dialog
    //     .showMessageBox(mainWindow, {
    //       type: 'info',
    //       title: '更新失敗',
    //       message: '自動更新失敗',
    //       detail:
    //         '由於macOS系統限制，自動更新失敗。您可以手動下載並安裝最新版本。',
    //       buttons: ['手動下載', '取消'],
    //       cancelId: 1,
    //     })
    //     .then(({ response }) => {
    //       if (response === 0) {
    //         // 打開GitHub發佈頁面，讓用戶手動下載
    //         const releaseUrl =
    //           process.platform === 'darwin'
    //             ? 'https://github.com/stevenyangtw/SmartSub/releases/latest'
    //             : 'https://github.com/stevenyangtw/SmartSub/releases/latest';
    //         require('electron').shell.openExternal(releaseUrl);
    //       }
    //     });
    // }
  });

  // 設置IPC處理程序
  ipcMain.handle('check-for-updates', async () => {
    return checkForUpdates();
  });

  ipcMain.handle('download-update', async () => {
    // 針對Mac平臺的特殊處理
    if (process.platform === 'darwin') {
      // 打開GitHub發佈頁面，讓用戶手動下載
      const releaseUrl =
        'https://github.com/stevenyangtw/SmartSub.git/releases/latest';
      require('electron').shell.openExternal(releaseUrl);
      return { success: true, manualDownload: true };
    }

    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      logMessage(`Error downloading update: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('install-update', async () => {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });

  // 啟動時檢查更新（可選，根據用戶設置）
  const settings = store.get('settings');
  const checkUpdateOnStartup = settings?.checkUpdateOnStartup !== false; // 預設為true

  if (checkUpdateOnStartup) {
    // 延遲幾秒檢查更新，讓應用先啟動完成
    setTimeout(() => {
      checkForUpdates();
    }, 5000);
  }

  return {
    checkForUpdates,
  };
}
