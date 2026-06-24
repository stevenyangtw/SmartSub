import fs from 'fs';
import path from 'path';
import type { EngineStatus } from '../../../types/engine';
import {
  getFunasrModelDir,
  getFunasrVadModelPath,
  isFunasrReady,
  getInstalledFunasrAsrModels,
  resolveFunasrAsrSelection,
} from '../funasrModelCatalog';
import { isSherpaLibInstalled } from '../sherpaOnnx/sherpaLibPaths';
import { getSherpaLibStatus } from '../sherpaOnnx/sherpaLibManager';
import {
  getSherpaFunasrRuntime,
  type SherpaModelRequest,
} from '../sherpaOnnx/sherpaFunasrRuntime';
import { formatSrtContent } from '../fileUtils';
import { logMessage, store } from '../storeManager';
import { getTaskContext, TaskCancelledError } from '../taskContext';
import { secondsToSrtTime } from './transcribeShared';
import { buildFunasrParams } from './funasrParams';
import type { TranscribeContext, TranscriptionEngineAdapter } from './types';

let activeTranscribeId: string | null = null;

type FunasrAsrSelection = NonNullable<
  ReturnType<typeof resolveFunasrAsrSelection>
>;

/** 組裝 worker 模型請求（不含 audio_file）。transcribe 與 prewarm 共用，緩存 key 一致。 */
function buildModelRequest(
  selection: FunasrAsrSelection,
  settings: Record<string, unknown>,
  sourceLanguage?: string,
): SherpaModelRequest {
  const asrDir = getFunasrModelDir(selection.id);
  return {
    asrModel: path.join(asrDir, 'model.int8.onnx'),
    tokens: path.join(asrDir, 'tokens.txt'),
    vadModel: getFunasrVadModelPath(),
    modelType: selection.modelType,
    params: buildFunasrParams(settings, sourceLanguage),
  };
}

/**
 * 批次預熱：在音頻抽取的同時，讓 worker 預加載所選 ASR/VAD 模型並寫滿識別器緩存，
 * 使首個 transcribe 直接命中。模型加載在 worker 線程進行，不阻塞主/UI 線程。失敗非致命。
 */
function prewarmFunasr(formData: Record<string, unknown>): void {
  try {
    if (!isSherpaLibInstalled() || !isFunasrReady()) return;
    const installedAsr = getInstalledFunasrAsrModels();
    const selection = resolveFunasrAsrSelection(
      (formData as { model?: string })?.model,
      installedAsr,
    );
    if (!selection) return;
    const settings = store.get('settings') as Record<string, unknown>;
    const { sourceLanguage } = formData as { sourceLanguage?: string };
    getSherpaFunasrRuntime().prewarm(
      buildModelRequest(selection, settings, sourceLanguage),
    );
    logMessage('funasr (sherpa) prewarm started', 'info');
  } catch (error) {
    logMessage(`funasr prewarm error (non-fatal): ${error}`, 'warning');
  }
}

/**
 * 用 sherpa-onnx Node 原生 addon（worker 線程）生成字幕。
 * 取消與 faster-whisper 一致走 AbortSignal：信號觸發即通知 worker 逐段取消。
 */
async function transcribeFunasr(ctx: TranscribeContext): Promise<string> {
  const { event, file, formData } = ctx;
  event.sender.send('taskFileChange', { ...file, extractSubtitle: 'loading' });

  const { tempAudioFile, srtFile } = file;
  const { sourceLanguage } = formData as { sourceLanguage?: string };
  const settings = store.get('settings') as Record<string, unknown>;

  if (!isSherpaLibInstalled()) {
    throw new Error(
      'sherpa runtime not installed. Download it from Resource Hub > Engines.',
    );
  }
  if (!isFunasrReady()) {
    throw new Error(
      'funasr models not installed. Download SenseVoice/Paraformer + silero-VAD from Resource Hub > Models.',
    );
  }

  const installedAsr = getInstalledFunasrAsrModels();
  const selection = resolveFunasrAsrSelection(
    (formData as { model?: string })?.model,
    installedAsr,
  );
  if (!selection) {
    throw new Error(
      'funasr ASR model not installed. Download SenseVoice or Paraformer from Resource Hub > Models.',
    );
  }

  const model = buildModelRequest(selection, settings, sourceLanguage);
  logMessage(`funasr(sherpa) model: ${JSON.stringify(model)}`, 'info');
  event.sender.send('taskProgressChange', file, 'extractSubtitle', 0);

  const runtime = getSherpaFunasrRuntime();
  const { id, result } = runtime.transcribe(model, tempAudioFile, (percent) =>
    event.sender.send('taskProgressChange', file, 'extractSubtitle', percent),
  );
  activeTranscribeId = id;

  const signal = ctx.signal ?? getTaskContext()?.signal;
  const onAbort = () => {
    if (activeTranscribeId === id) runtime.cancel(id);
  };
  if (signal?.aborted) runtime.cancel(id);
  else signal?.addEventListener('abort', onAbort, { once: true });

  let transcription;
  try {
    transcription = await result;
  } catch (error) {
    if (signal?.aborted || (error as { code?: string })?.code === 'cancelled') {
      throw new TaskCancelledError();
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    activeTranscribeId = null;
  }

  if (signal?.aborted) throw new TaskCancelledError();

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
  logMessage('generate subtitle done (funasr/sherpa)', 'info');
  return srtFile;
}

export const funasrEngineAdapter: TranscriptionEngineAdapter = {
  id: 'funasr',
  displayName: 'FunASR (SenseVoice / Paraformer)',
  requiresRuntime: true,

  async isAvailable(): Promise<EngineStatus> {
    if (!isSherpaLibInstalled()) {
      return {
        state: 'not_installed',
        message: 'sherpa runtime not downloaded',
      };
    }
    if (!isFunasrReady()) {
      return {
        state: 'not_installed',
        message: 'funasr models not downloaded',
      };
    }
    return { state: 'ready', version: getSherpaLibStatus().version };
  },

  async transcribe(ctx: TranscribeContext): Promise<string> {
    return transcribeFunasr(ctx);
  },

  cancelActive(): void {
    if (activeTranscribeId) {
      getSherpaFunasrRuntime().cancel(activeTranscribeId);
      activeTranscribeId = null;
    }
  },

  prewarm(formData: Record<string, unknown>): void {
    prewarmFunasr(formData);
  },
};
