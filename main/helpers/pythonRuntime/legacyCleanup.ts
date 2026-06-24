import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { logMessage } from '../storeManager';
import { getEngineDir, getRuntimePythonPath } from './paths';

/**
 * 清理歷史架構遺留的 userData 目錄與狀態文件（自包含運行時 + 內置 sherpa 改造前的產物）。
 *
 * 當前架構使用：
 *   - userData/py-engines/<engineId>  （faster-whisper 單自包含運行時，含內嵌解釋器）
 *   - userData/py-engine-download-state-<engineId>.json （按引擎隔離的下載狀態）
 *   - sherpa-onnx 原生庫隨安裝包內置（extraResources/sherpa/native/<platformKey>/），不落 userData
 *
 * 以下為已徹底廢棄、可安全刪除的遺留物（僅在本機歷史版本殘留）：
 *   - userData/py-engine               （單數：舊 PyInstaller 單二進制引擎目錄）
 *   - userData/py-engine-download-state.json （舊單引擎下載狀態，無 engineId 後綴）
 *   - userData/py-base                 （可下載/可升級 Python 基座；基座已併入運行時包）
 *   - userData/sherpa-onnx             （sherpa 運行時下載樹 current/staging/previous；現改內置）
 *   - userData/py-engines/<engineId>   （舊「基座+引擎」分體包：有 main.py/site-packages 但缺內嵌解釋器，
 *                                        在新方案下不可用，刪除以引導重下單運行時）
 *
 * 不在清理範圍（仍被現網代碼使用，誤刪會丟數據）：
 *   - userData/py-engine-cache         （faster-whisper 舊 HF 緩存，按模型在 UI 內清理）
 *   - userData/py-engines              （複數：當前運行時根目錄）
 *
 * 冪等：僅當目標存在時刪除並記日誌；缺省靜默。任何異常都吞掉，不影響啟動。
 */
export function cleanupLegacyPyEngine(): void {
  const userData = app.getPath('userData');

  const legacyTargets: { path: string; kind: 'dir' | 'file' }[] = [
    { path: path.join(userData, 'py-engine'), kind: 'dir' },
    {
      path: path.join(userData, 'py-engine-download-state.json'),
      kind: 'file',
    },
    // 基座已併入運行時包：整個下載/升級基座目錄退役。
    { path: path.join(userData, 'py-base'), kind: 'dir' },
    // sherpa-onnx 改為隨安裝包內置：舊運行時下載樹退役。
    { path: path.join(userData, 'sherpa-onnx'), kind: 'dir' },
  ];

  // 舊「基座+引擎」分體安裝：僅當運行時目錄存在但缺內嵌解釋器時清除（避免誤刪新版自包含運行時）。
  const fwRuntimeDir = getEngineDir('faster-whisper');
  if (
    fs.existsSync(fwRuntimeDir) &&
    !fs.existsSync(getRuntimePythonPath(fwRuntimeDir))
  ) {
    legacyTargets.push({ path: fwRuntimeDir, kind: 'dir' });
  }

  for (const target of legacyTargets) {
    try {
      if (!fs.existsSync(target.path)) continue;
      fs.rmSync(target.path, {
        recursive: target.kind === 'dir',
        force: true,
      });
      logMessage(`Removed legacy py-engine artifact: ${target.path}`, 'info');
    } catch (error) {
      // 佔用 / 權限等問題不應阻斷啟動，下次啟動會再嘗試
      logMessage(
        `Failed to remove legacy py-engine artifact ${target.path}: ${error}`,
        'warning',
      );
    }
  }
}
