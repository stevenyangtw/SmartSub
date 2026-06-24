import fs from 'fs';
import type { EngineStatus, PyEngineManifest } from '../../../types/engine';
import {
  isRuntimeInstalled,
  readEngineManifest,
  normalizePyEngineVariant,
} from '../pythonRuntime/paths';
import {
  getFasterWhisperModelsPath,
  resolveCt2ModelSnapshotDir,
} from '../modelCatalog';
import { formatSrtContent } from '../fileUtils';
import { logMessage, store } from '../storeManager';
import { getPythonRuntimeManager } from '../pythonRuntime';
import {
  getTaskContext,
  isTaskCancelledError,
  TaskCancelledError,
} from '../taskContext';
import { toFasterWhisperModel } from './modelMap';
import {
  getNumericSetting,
  getWhisperLanguage,
  secondsToSrtTime,
  getFasterWhisperAntiRepetitionParams,
} from './transcribeShared';
import type { TranscribeContext, TranscriptionEngineAdapter } from './types';

/**
 * 判定是否為 CUDA 運行庫（cuBLAS/cuDNN/cudart）缺失或無法加載類錯誤。
 * 典型：CTranslate2 拋 "Library cublas64_12.dll is not found or cannot be loaded"。
 */
function isCudaRuntimeError(error: unknown): boolean {
  const msg = (
    error instanceof Error ? error.message : String(error ?? '')
  ).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('cublas') ||
    msg.includes('cudnn') ||
    msg.includes('cudart') ||
    msg.includes('cuda')
  );
}

/**
 * CUDA 運行庫不可用時面向用戶的可操作提示：引導改用 CPU 設備或更換引擎。
 */
function formatCudaRuntimeHint(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  return `faster-whisper GPU(CUDA) 加速所需的運行庫（cuBLAS/cuDNN）缺失或無法加載，無法使用 CUDA。請在「資源中心 → 引擎 → faster-whisper」將「計算設備」改為 CPU，或改用其他轉寫引擎。原始錯誤：${raw}`;
}

let activeFasterWhisperTranscribeId: string | null = null;

function cancelFasterWhisperTranscription(): void {
  if (activeFasterWhisperTranscribeId) {
    getPythonRuntimeManager().cancel(activeFasterWhisperTranscribeId);
    activeFasterWhisperTranscribeId = null;
  }
}

/**
 * 安裝版本展示：優先真實 engineVersion；老安裝（version='latest'）回退 sha256 短哈希，
 * 避免顯示無意義的 "vlatest"。
 */
function formatInstalledVersion(
  manifest: PyEngineManifest | null,
): string | undefined {
  if (!manifest) return undefined;
  if (manifest.engineVersion) return manifest.engineVersion;
  if (manifest.version && manifest.version !== 'latest')
    return manifest.version;
  if (manifest.sha256) return manifest.sha256.slice(0, 7);
  return undefined;
}

/**
 * 批次預熱：在音頻抽取的同時，讓 sidecar 預加載所選 CT2 模型並寫滿 _model_cache，
 * 使首個 transcribe 直接命中。sidecar 為「先加載模型、再發 progress(0%)」，且重依賴
 * （ctranslate2/av/tokenizers）已惰性推遲到首個 transcribe/preload；若不預熱，首個文件
 * 會把導入 + 模型加載的冷啟動成本全壓在關鍵路徑上，表現為長時間「卡在 0% 無進度」
 * （取消重試因緩存命中而恢復）。預熱與 ffmpeg 抽取並行，失敗一律非致命。
 *
 * 參數（model/device/compute_type/download_root）必須與 transcribe 完全一致，
 * 否則 _get_model 的緩存 key 不匹配、預熱白做。
 */
function prewarmFasterWhisper(formData: Record<string, unknown>): void {
  try {
    if (!isRuntimeInstalled('faster-whisper')) return;
    const { model } = formData as { model?: string };
    const modelId = toFasterWhisperModel(model);
    const modelSnapshotDir = resolveCt2ModelSnapshotDir(modelId);
    if (!modelSnapshotDir) return;
    const settings = store.get('settings');
    const params = {
      engine: 'faster_whisper',
      model: modelSnapshotDir,
      local_files_only: true,
      download_root: getFasterWhisperModelsPath(),
      device: settings.fasterWhisperDevice || 'auto',
      compute_type: settings.fasterWhisperComputeType || 'auto',
    };
    const manager = getPythonRuntimeManager();
    // taskProcessor 在 ensureStarted('faster-whisper') 成功後才調用本函數，
    // 此處再確認一次 sidecar 在跑且正服務 faster-whisper，避免引擎已被切走時空發。
    if (manager.activeEngineId !== 'faster-whisper' || !manager.isRunning)
      return;
    // 預加載在 sidecar worker 線程進行，給足冗餘超時；任何錯誤（含舊引擎
    // method_not_found）都吞掉——首個 transcribe 仍會按需加載，預熱只是優化。
    manager
      .request('preload', params, { timeoutMs: 10 * 60_000 })
      .then(() => logMessage('faster-whisper model prewarm done', 'info'))
      .catch((error) =>
        logMessage(`faster-whisper model prewarm skipped: ${error}`, 'warning'),
      );
    logMessage('faster-whisper model prewarm started', 'info');
  } catch (error) {
    logMessage(`faster-whisper prewarm error (non-fatal): ${error}`, 'warning');
  }
}

/**
 * 使用 Python sidecar 中的 faster-whisper 生成字幕。
 * 取消與內置 whisper 一致走 AbortSignal：信號觸發即通知 sidecar 逐段取消。
 */
async function transcribeFasterWhisper(
  ctx: TranscribeContext,
): Promise<string> {
  const { event, file, formData } = ctx;
  event.sender.send('taskFileChange', { ...file, extractSubtitle: 'loading' });

  const { tempAudioFile, srtFile } = file;
  const { model, sourceLanguage, prompt } = formData as {
    model?: string;
    sourceLanguage?: string;
    prompt?: string;
  };
  const settings = store.get('settings');

  const manager = getPythonRuntimeManager();
  let engineInfo;
  try {
    engineInfo = await manager.ensureStarted('faster-whisper');
  } catch (error) {
    throw new Error(
      `faster-whisper engine unavailable: ${error?.message || error}`,
    );
  }
  if (!engineInfo?.engines?.faster_whisper) {
    throw new Error(
      'faster-whisper is not available in the python engine runtime',
    );
  }

  const modelId = toFasterWhisperModel(model);
  const modelSnapshotDir = resolveCt2ModelSnapshotDir(modelId);
  if (!modelSnapshotDir) {
    throw new Error(
      `faster-whisper model "${modelId}" not found in ${getFasterWhisperModelsPath()}. Download it from Resource Hub > Models.`,
    );
  }
  const configuredDevice = (settings.fasterWhisperDevice || 'auto') as
    | 'auto'
    | 'cpu'
    | 'cuda';
  // device 逐次嘗試注入，便於 CUDA 運行庫缺失時回退 CPU 重試；其餘參數對各設備一致。
  const baseParams = {
    engine: 'faster_whisper',
    audio_file: tempAudioFile,
    model: modelSnapshotDir,
    local_files_only: true,
    download_root: getFasterWhisperModelsPath(),
    language: getWhisperLanguage(sourceLanguage),
    compute_type: settings.fasterWhisperComputeType || 'auto',
    initial_prompt: prompt || '',
    // faster-whisper #1119：開啟詞級時間戳，讓 segment.end 對齊到真實末詞，
    // 避免開 VAD 時段尾時間被拉到下一段開頭。舊 sidecar 忽略該參數也無害。
    word_timestamps: true,
    vad: settings.useVAD !== false,
    vad_threshold: getNumericSetting(settings.vadThreshold, 0.5),
    vad_min_speech_duration_ms: getNumericSetting(
      settings.vadMinSpeechDuration,
      250,
    ),
    vad_min_silence_duration_ms: getNumericSetting(
      settings.vadMinSilenceDuration,
      100,
    ),
    // SmartSub 約定 0 = 不限制；sidecar 會映射為 faster-whisper 的 inf。
    vad_max_speech_duration_s: getNumericSetting(
      settings.vadMaxSpeechDuration,
      0,
    ),
    vad_speech_pad_ms: getNumericSetting(settings.vadSpeechPad, 200),
    // 抗幻覺/抗重複參數（僅開關開啟時注入；關閉則不下發，sidecar 回落預設）。
    ...getFasterWhisperAntiRepetitionParams(settings),
  };

  const signal = ctx.signal ?? getTaskContext()?.signal;

  // 單次轉寫嘗試：按指定 device 下發，內含進度回傳與取消處理。
  const runAttempt = async (device: 'auto' | 'cpu' | 'cuda') => {
    const params = { ...baseParams, device };
    logMessage(
      `fasterWhisperParams: ${JSON.stringify(params, null, 2)}`,
      'info',
    );
    event.sender.send('taskProgressChange', file, 'extractSubtitle', 0);

    // 診斷：記錄「下發 transcribe → sidecar 首個 progress」的牆鍾間隔。首任務卡 0% 時，
    // 這段間隔即為 sidecar 側導入重依賴 + 加載模型（或等待 preload 佔用的模型鎖）的耗時；
    // 配合 sidecar 端 [py-engine] 日誌即可定位卡在哪一步。
    const dispatchAt = Date.now();
    logMessage(
      `faster-whisper: dispatching transcribe to sidecar (device=${device})`,
      'info',
    );
    let firstProgressLogged = false;
    const { id, result } = manager.transcribe(params, {
      onProgress: (percent) => {
        if (!firstProgressLogged) {
          firstProgressLogged = true;
          logMessage(
            `faster-whisper: first progress from sidecar after ${Date.now() - dispatchAt}ms`,
            'info',
          );
        }
        event.sender.send(
          'taskProgressChange',
          file,
          'extractSubtitle',
          percent,
        );
      },
    });
    activeFasterWhisperTranscribeId = id;

    const onAbort = () => {
      if (activeFasterWhisperTranscribeId === id) manager.cancel(id);
    };
    if (signal?.aborted) {
      manager.cancel(id);
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await result;
    } catch (error) {
      // 用戶取消：sidecar 回 {code:'cancelled'}。轉成取消語義，避免被標記為轉寫錯誤。
      if (
        signal?.aborted ||
        (error as { code?: string })?.code === 'cancelled'
      ) {
        throw new TaskCancelledError();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      activeFasterWhisperTranscribeId = null;
    }
  };

  let transcription;
  try {
    transcription = await runAttempt(configuredDevice);
  } catch (error) {
    if (isTaskCancelledError(error)) throw error;
    // CUDA 運行庫（cuBLAS/cuDNN）缺失或加載失敗：
    // device=auto 時自動回退 CPU 重試一次；顯式選 cuda 則給出可操作的中文提示。
    if (isCudaRuntimeError(error)) {
      if (configuredDevice === 'auto') {
        logMessage(
          `faster-whisper: CUDA 運行庫加載失敗，自動回退 CPU 重試（原始錯誤：${
            error instanceof Error ? error.message : String(error)
          }）`,
          'warning',
        );
        try {
          transcription = await runAttempt('cpu');
        } catch (cpuError) {
          if (isTaskCancelledError(cpuError)) throw cpuError;
          throw new Error(formatCudaRuntimeHint(cpuError));
        }
      } else {
        throw new Error(formatCudaRuntimeHint(error));
      }
    } else {
      throw error;
    }
  }

  // 邊界：轉寫正常返回但此刻已被取消，同樣按取消處理，避免寫出半截字幕。
  if (signal?.aborted) {
    throw new TaskCancelledError();
  }

  const formattedSrt = formatSrtContent(
    (transcription?.segments || []).map(
      (segment) =>
        [
          secondsToSrtTime(segment.start),
          secondsToSrtTime(segment.end),
          segment.text || '',
        ] as [string, string, string],
    ),
  );
  await fs.promises.writeFile(srtFile, formattedSrt);

  event.sender.send('taskProgressChange', file, 'extractSubtitle', 100);
  event.sender.send('taskFileChange', { ...file, extractSubtitle: 'done' });
  logMessage(
    `generate subtitle done (faster-whisper, language=${transcription?.language})`,
    'info',
  );
  return srtFile;
}

export const fasterWhisperEngineAdapter: TranscriptionEngineAdapter = {
  id: 'fasterWhisper',
  displayName: 'faster-whisper',
  requiresRuntime: true,
  pyEngineId: 'faster-whisper',

  async isAvailable(): Promise<EngineStatus> {
    // 安裝狀態以「自包含運行時已落盤（內嵌解釋器 + main.py + site-packages）+ manifest 存在」為準；
    // 運行時探活（冷啟動 ping）推遲到真正轉寫時進行，避免解釋器首次冷啟動耗時
    // 超過探活超時，被誤報為「安裝異常 / ping timeout」（實際安裝是成功的）。
    if (!isRuntimeInstalled('faster-whisper')) {
      return {
        state: 'not_installed',
        message: 'faster-whisper runtime not installed',
      };
    }
    const manifest = readEngineManifest('faster-whisper');
    return {
      state: 'ready',
      version: formatInstalledVersion(manifest),
      variant: normalizePyEngineVariant(manifest?.variant),
    };
  },

  async transcribe(ctx: TranscribeContext): Promise<string> {
    return transcribeFasterWhisper(ctx);
  },

  cancelActive(): void {
    cancelFasterWhisperTranscription();
  },

  prewarm(formData: Record<string, unknown>): void {
    prewarmFasterWhisper(formData);
  },
};
