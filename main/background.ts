// 在最開始加載環境變量（僅開發模式；路徑相對 app/ 編譯產物）
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({
    path: require('path').join(__dirname, '../../.env.development.local'),
  });
}

import path from 'path';
import { app, protocol } from 'electron';
import serve from 'electron-serve';
import { createWindow } from './helpers/create-window';
import { setupIpcHandlers } from './helpers/ipcHandlers';
import { setupTaskProcessor } from './helpers/taskProcessor';
import { setupSystemInfoManager } from './helpers/systemInfoManager';
import { setupStoreHandlers, store } from './helpers/storeManager';
import { setupTaskManager } from './helpers/taskManager';
import {
  initializeWorkItemStore,
  setupWorkItemStoreLifecycle,
} from './helpers/workItemStore';
import { setupWorkItemHandlers } from './helpers/workItemHandlers';
import { setupAutoUpdater } from './helpers/updater';
import { setupAppMenu } from './helpers/menu';
import { setupWindowCloseBehavior, markQuitting } from './helpers/windowClose';
import { setupParameterHandlers } from './helpers/ipcParameterHandlers';
import { setupProofreadHandlers } from './helpers/ipcProofreadHandlers';
import { setupSubtitleMergeHandlers } from './helpers/ipcSubtitleMergeHandlers';
import { configurationManager } from './service/configurationManager';
import {
  registerAddonIpcHandlers,
  setMainWindowForAddon,
} from './helpers/ipcAddonHandlers';
import {
  registerEngineIpcHandlers,
  setMainWindowForEngine,
} from './helpers/ipcEngineHandlers';
import { shutdownPythonRuntime } from './helpers/pythonRuntime';
import { maybeAutoCheckPyEngineUpdate } from './helpers/pythonRuntime/autoUpdateCheck';
import { cleanupLegacyPyEngine } from './helpers/pythonRuntime/legacyCleanup';
import { applyProxyFromSettings } from './helpers/network/proxyManager';
import { setupNetworkHandlers } from './helpers/ipcNetworkHandlers';
import {
  applyMacAppBranding,
  resolveAppIcon,
  setAppDisplayNameEarly,
} from './helpers/appBranding';
import { getDevSimulationConfig, getGpuEnvironment } from './helpers/cudaUtils';

//控制台出現中文亂碼，需要去node_modules\electron\cli.js中修改啟動代碼頁

const isProd = process.env.NODE_ENV === 'production';

// media:// 需在 webSecurity:true 下注冊為 privileged scheme（必須在 app ready 之前）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/** 回退開關：SMARTSUB_LEGACY_WEB_SECURITY=true 恢復舊行為 */
const useLegacyWebSecurity =
  process.env.SMARTSUB_LEGACY_WEB_SECURITY === 'true';

// macOS 開發態：須在 ready 前設置，否則菜單欄仍顯示 Electron
setAppDisplayNameEarly();

if (isProd) {
  serve({ directory: 'app' });
} else {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

let runtimeShutdownDone = false;
app.on('before-quit', (event) => {
  // 真退出標記集中在 windowClose 模塊，close 監聽據此放行
  markQuitting();
  if (!runtimeShutdownDone) {
    event.preventDefault();
    runtimeShutdownDone = true;
    void shutdownPythonRuntime().finally(() => {
      app.exit(0);
    });
  }
});

(async () => {
  await app.whenReady();
  applyMacAppBranding();

  const sim = getDevSimulationConfig();
  if (sim?.enabled) {
    console.log(
      `[SmartSub] CUDA dev simulation ON → platform=${sim.platform}, gpu=${sim.gpuName}`,
    );
  }

  // 註冊自定義協議處理本地媒體文件
  protocol.registerFileProtocol('media', (request, callback) => {
    const url = request.url.substr(8); // 移除 "media://" 部分
    try {
      const decodedUrl = decodeURIComponent(url);
      return callback({ path: decodedUrl });
    } catch (error) {
      console.error('Protocol handler error:', error);
      return callback({ error: -2 });
    }
  });

  setupStoreHandlers();
  // 代理須在任何聯網（providers 初始化 / 下載 / 更新檢測）前生效
  applyProxyFromSettings();
  setupParameterHandlers();
  setupProofreadHandlers();
  registerAddonIpcHandlers();

  // Initialize configuration manager
  try {
    await configurationManager.initialize();
    console.log('Configuration Manager initialized');
  } catch (error) {
    console.error('Failed to initialize Configuration Manager:', error);
  }

  const settings = store.get('settings');
  const userLanguage = settings?.language || 'zh'; // 預設為中文

  const mainWindow = createWindow('main', {
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: resolveAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 本地媒體經 media:// 協議加載；緊急回退 SMARTSUB_LEGACY_WEB_SECURITY=true
      webSecurity: !useLegacyWebSecurity,
    },
  });

  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });

  // 關窗行為（macOS 智能模式 / Win·Linux 防誤殺）+ Dock 激活恢復
  setupWindowCloseBehavior(mainWindow);

  if (isProd) {
    await mainWindow.loadURL(`app://./${userLanguage}/home/`);
  } else {
    const port = process.argv[2];
    await mainWindow.loadURL(`http://localhost:${port}/${userLanguage}/home/`);
    mainWindow.webContents.openDevTools();
  }

  setupAppMenu(mainWindow);
  setupIpcHandlers(mainWindow);
  setupNetworkHandlers();
  setupTaskProcessor(mainWindow);
  setupSystemInfoManager(mainWindow);
  initializeWorkItemStore();
  setupWorkItemStoreLifecycle();
  setupWorkItemHandlers();
  setupTaskManager();
  setupAutoUpdater(mainWindow);
  setupSubtitleMergeHandlers(mainWindow);
  setMainWindowForAddon(mainWindow);
  registerEngineIpcHandlers();
  setMainWindowForEngine(mainWindow);
  // 清理三層架構改造前遺留的舊 py-engine 目錄/狀態文件（冪等，失敗靜默）。
  cleanupLegacyPyEngine();
  // 啟動後每日一次的節流靜默檢查 faster-whisper 運行時更新（非阻塞，失敗靜默）。
  void maybeAutoCheckPyEngineUpdate(mainWindow);
  // 後臺預熱 GPU/CUDA 環境檢測緩存：首次探測（nvcc / nvidia-smi）較慢，提前異步完成並寫入
  // 會話緩存，用戶進入「引擎與模型」頁時直接命中，避免首屏等待。非阻塞，失敗靜默。
  void getGpuEnvironment().catch(() => {});
})();

app.on('window-all-closed', () => {
  // macOS 慣例：關窗不退出（任務保活），其餘平臺正常退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
