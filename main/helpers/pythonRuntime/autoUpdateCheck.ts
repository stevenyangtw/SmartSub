import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logMessage } from '../storeManager';
import { getPyEngineDownloader } from './downloader';
import { isRuntimeInstalled } from './paths';
import type { PyEngineDownloadSource, PyEngineId } from '../../../types/engine';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 支持在線下載/更新的 Python 引擎運行時集合（目前僅 faster-whisper）。 */
const UPDATABLE_ENGINES: PyEngineId[] = ['faster-whisper'];

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'py-engine-update-check.json');
}

function readLastCheckAt(): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
    return typeof parsed?.lastCheckAt === 'number' ? parsed.lastCheckAt : 0;
  } catch {
    return 0;
  }
}

function writeLastCheckAt(ts: number): void {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify({ lastCheckAt: ts }));
  } catch (error) {
    logMessage(
      `py-engine update-check state write failed: ${error}`,
      'warning',
    );
  }
}

/**
 * 啟動後每日一次的節流靜默更新檢查：遍歷所有已安裝的 Python 引擎，發現更新時通過
 * `py-engine-update-available` 通知渲染層（攜帶 engineId，不自動下載）。弱網/失敗靜默，僅日誌。
 */
export async function maybeAutoCheckPyEngineUpdate(
  mainWindow: BrowserWindow,
  source: PyEngineDownloadSource = 'github',
): Promise<void> {
  const installedEngines = UPDATABLE_ENGINES.filter((engineId) =>
    isRuntimeInstalled(engineId),
  );
  if (installedEngines.length === 0) return;

  const now = Date.now();
  if (now - readLastCheckAt() < CHECK_INTERVAL_MS) return;

  let anyChecked = false;
  for (const engineId of installedEngines) {
    try {
      const info = await getPyEngineDownloader(
        engineId,
        mainWindow,
      ).checkUpdate(source);
      anyChecked = true;
      if (info.hasUpdate && info.protocolSupported) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('py-engine-update-available', {
            ...info,
            engineId,
          });
        }
        logMessage(
          `py-engine[${engineId}] update available (daily auto-check)`,
          'info',
        );
      }
    } catch (error) {
      // 單引擎失敗不影響其它引擎；本輪不寫 lastCheckAt，下次啟動可重試
      logMessage(
        `py-engine[${engineId}] daily update-check failed: ${error}`,
        'warning',
      );
    }
  }

  // 僅當至少一個引擎成功檢查後才落地節流時間戳
  if (anyChecked) writeLastCheckAt(now);
}
