import path from 'path';
import fs from 'fs';
import type { EngineStatus } from '../../../types/engine';
import { getPath, loadWhisperAddon } from '../whisper';
import { logMessage, store } from '../storeManager';
import { formatSrtContent } from '../fileUtils';
import { getExtraResourcesPath } from '../utils';
import {
  getTaskContext,
  isWhisperAbortError,
  isWhisperCancelledResult,
  TaskCancelledError,
  throwIfTaskCancelled,
} from '../taskContext';
import {
  getWhisperLanguage,
  getVadSettings,
  isReduceRepetitionEnabled,
} from './transcribeShared';
import type { TranscribeContext, TranscriptionEngineAdapter } from './types';

/**
 * 使用內置 whisper.cpp 庫生成字幕。取消經 whisperParams.signal 原生中斷。
 */
async function transcribeBuiltin(ctx: TranscribeContext): Promise<string> {
  const { event, file, formData } = ctx;
  event.sender.send('taskFileChange', { ...file, extractSubtitle: 'loading' });

  try {
    const { tempAudioFile, srtFile } = file;
    const { model, sourceLanguage, prompt, maxContext } = formData as {
      model?: string;
      sourceLanguage?: string;
      prompt?: string;
      maxContext?: number;
    };
    const whisperModel = model?.toLowerCase();
    const settings = store.get('settings');

    // 加載鏈內部按 gpuMode + 環境自動決策並逐級降級（見 addonLoader）
    const { whisperAsync, backend, variant } =
      await loadWhisperAddon(whisperModel);
    const backendLabels: Record<string, string> = {
      vulkan: 'Vulkan',
      cpu: 'CPU',
      metal: 'Metal',
      coreml: 'CoreML',
      custom: 'Custom',
    };
    const whisperBackend =
      backend === 'cuda' && variant !== null && variant !== 'vulkan'
        ? `CUDA ${variant}`
        : backendLabels[backend] || backend;
    // 把實際後端推給任務卡片（useIpcCommunication 做通用 merge）
    event.sender.send('taskFileChange', {
      ...file,
      extractSubtitle: 'loading',
      whisperBackend,
    });
    const modelPath = `${getPath('modelsPath')}/ggml-${whisperModel}.bin`;

    // VAD 模型路徑 - 使用內置的 VAD 模型
    const vadModelPath = path.join(
      getExtraResourcesPath(),
      'ggml-silero-v6.2.0.bin',
    );

    const vad = getVadSettings(settings as Record<string, unknown>);
    const signal = ctx.signal ?? getTaskContext()?.signal;
    const whisperParams = {
      language: getWhisperLanguage(sourceLanguage),
      model: modelPath,
      fname_inp: tempAudioFile,
      use_gpu: backend !== 'cpu',
      flash_attn: false,
      no_prints: false,
      comma_in_time: false,
      translate: false,
      no_timestamps: false,
      audio_ctx: 0,
      max_len: 0,
      print_progress: true,
      prompt,
      // 抗幻覺/抗重複開啟時強制 max_context=0（不攜帶上文，≈faster-whisper 的
      // condition_on_previous_text=false），這是 whisper.cpp 打斷重複/幻覺級聯的關鍵槓桿。
      max_context: isReduceRepetitionEnabled(settings)
        ? 0
        : +(maxContext ?? -1),
      // VAD 參數
      vad: vad.useVAD,
      vad_model: vadModelPath,
      vad_threshold: vad.vadThreshold,
      vad_min_speech_duration_ms: vad.vadMinSpeechDuration,
      vad_min_silence_duration_ms: vad.vadMinSilenceDuration,
      vad_max_speech_duration_s: vad.vadMaxSpeechDuration,
      vad_speech_pad_ms: vad.vadSpeechPad,
      vad_samples_overlap: vad.vadSamplesOverlap,
      progress_callback: (progress: number) => {
        if (signal?.aborted) return;
        event.sender.send(
          'taskProgressChange',
          file,
          'extractSubtitle',
          progress,
        );
      },
      signal,
    };

    logMessage(
      `whisperParams: ${JSON.stringify({ ...whisperParams, signal: whisperParams.signal ? '[AbortSignal]' : undefined }, null, 2)}`,
      'info',
    );
    event.sender.send('taskProgressChange', file, 'extractSubtitle', 0);
    throwIfTaskCancelled();
    const result = await whisperAsync(whisperParams);

    if (isWhisperCancelledResult(result) || signal?.aborted) {
      if (file.srtFile && fs.existsSync(file.srtFile)) {
        try {
          fs.unlinkSync(file.srtFile);
        } catch {
          /* ignore partial srt cleanup failure */
        }
      }
      logMessage(`generate subtitle cancelled for ${file.fileName}`, 'warning');
      throw new TaskCancelledError();
    }

    const formattedSrt = formatSrtContent(result?.transcription || []);
    await fs.promises.writeFile(srtFile, formattedSrt);

    event.sender.send('taskFileChange', { ...file, extractSubtitle: 'done' });
    logMessage(`generate subtitle done!`, 'info');

    return srtFile;
  } catch (error) {
    const aborted =
      isWhisperAbortError(error) ||
      Boolean(ctx.signal?.aborted) ||
      Boolean(getTaskContext()?.signal?.aborted);
    if (aborted) {
      if (file.srtFile && fs.existsSync(file.srtFile)) {
        try {
          fs.unlinkSync(file.srtFile);
        } catch {
          /* ignore partial srt cleanup failure */
        }
      }
      logMessage(`generate subtitle cancelled for ${file.fileName}`, 'warning');
      throw new TaskCancelledError();
    }
    logMessage(`generate subtitle error: ${error}`, 'error');
    throw error;
  }
}

export const builtinEngineAdapter: TranscriptionEngineAdapter = {
  id: 'builtin',
  displayName: 'whisper.cpp (builtin)',
  requiresRuntime: false,

  async isAvailable(): Promise<EngineStatus> {
    return { state: 'ready' };
  },

  async transcribe(ctx: TranscribeContext): Promise<string> {
    return transcribeBuiltin(ctx);
  },

  cancelActive(): void {
    // builtin 經 whisperParams.signal 原生中斷，無需額外動作。
  },
};
