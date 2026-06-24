import type { FunasrAddonParams } from '../engines/funasrParams';

/**
 * 純配置映射：FunasrAddonParams → sherpa-onnx VAD / OfflineRecognizer 配置，
 * 以及段時間與進度的數學。無 electron / fs / 原生庫依賴，便於單測。
 *
 * 注意：worker（extraResources 純 JS，不經 webpack）內聯了等價邏輯，
 * 兩者必須保持一致（見 sherpa-worker.js 的 loadConfigHelpers）。
 */

const SAMPLE_RATE = 16000;
/** SmartSub 約定 0 = 不限制最大語音時長；sherpa 用一個足夠大的秒數表達「不限制」。 */
const UNLIMITED_SPEECH_SECONDS = 100000;
/** silero-vad 窗口大小（樣本數），sherpa 推薦值。 */
const VAD_WINDOW_SIZE = 512;

export interface VadConfig {
  sileroVad: {
    model: string;
    threshold: number;
    minSpeechDuration: number;
    minSilenceDuration: number;
    windowSize: number;
    maxSpeechDuration: number;
  };
  sampleRate: number;
  numThreads: number;
  debug: number;
}

export interface OfflineRecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    senseVoice?: {
      model: string;
      language: string;
      useInverseTextNormalization: number;
    };
    paraformer?: { model: string };
    /** Qwen3-ASR 四件套 + 自迴歸解碼參數（sherpa-onnx >= 1.12.34）。 */
    qwen3Asr?: {
      convFrontend: string;
      encoder: string;
      decoder: string;
      tokenizer: string;
      maxTotalLen: number;
      maxNewTokens: number;
      temperature: number;
      topP: number;
      seed: number;
    };
    /** FireRedASR-AED：encoder + decoder 兩件套（tokens 走頂層 tokens.txt）。 */
    fireRedAsr?: {
      encoder: string;
      decoder: string;
    };
    tokens: string;
    numThreads: number;
    provider: string;
    debug: number;
  };
}

/** buildVadConfig 僅需的 VAD 字段（funasr / qwen 參數均結構兼容）。 */
export interface SherpaVadParams {
  vad_threshold: number;
  vad_min_silence_duration_ms: number;
  vad_min_speech_duration_ms: number;
  vad_max_speech_duration_s: number;
}

export function buildVadConfig(
  vadModel: string,
  p: SherpaVadParams,
): VadConfig {
  return {
    sileroVad: {
      model: vadModel,
      threshold: p.vad_threshold,
      minSpeechDuration: p.vad_min_speech_duration_ms / 1000,
      minSilenceDuration: p.vad_min_silence_duration_ms / 1000,
      windowSize: VAD_WINDOW_SIZE,
      maxSpeechDuration:
        p.vad_max_speech_duration_s > 0
          ? p.vad_max_speech_duration_s
          : UNLIMITED_SPEECH_SECONDS,
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    debug: 0,
  };
}

export function buildRecognizerConfig(
  modelType: 'sense_voice' | 'paraformer',
  asrModel: string,
  tokens: string,
  p: FunasrAddonParams,
): OfflineRecognizerConfig {
  const modelConfig: OfflineRecognizerConfig['modelConfig'] = {
    tokens,
    numThreads: p.num_threads,
    provider: p.provider,
    debug: 0,
  };
  if (modelType === 'paraformer') {
    modelConfig.paraformer = { model: asrModel };
  } else {
    modelConfig.senseVoice = {
      model: asrModel,
      // 'auto' → '' 讓 SenseVoice 自動檢測語言
      language: p.language === 'auto' ? '' : p.language,
      useInverseTextNormalization: p.use_itn ? 1 : 0,
    };
  }
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig,
  };
}

/** Qwen3-ASR 解碼相關參數（VAD 字段見 SherpaVadParams）。 */
export interface QwenRecognizerParams {
  num_threads: number;
  provider: string;
  max_total_len: number;
  max_new_tokens: number;
  temperature: number;
  top_p: number;
  seed: number;
}

/**
 * Qwen3-ASR OfflineRecognizer 配置：四件套（convFrontend/encoder/decoder + tokenizer 目錄）
 * 映射到 sherpa 的 `qwen3Asr` 塊。Qwen 無 tokens.txt（用 tokenizer 目錄），故 tokens 置空。
 *
 * ⚠️ 原生綁定對該 config 先 `memset(0)` 再按存在的鍵覆蓋，故每個數值字段都必須顯式給值，
 *    否則 maxTotalLen / maxNewTokens 等會變成 0（而非 C++ 結構體預設值）導致解碼失敗。
 */
export function buildQwenRecognizerConfig(
  files: {
    convFrontend: string;
    encoder: string;
    decoder: string;
    tokenizer: string;
  },
  p: QwenRecognizerParams,
): OfflineRecognizerConfig {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      qwen3Asr: {
        convFrontend: files.convFrontend,
        encoder: files.encoder,
        decoder: files.decoder,
        tokenizer: files.tokenizer,
        maxTotalLen: p.max_total_len,
        maxNewTokens: p.max_new_tokens,
        temperature: p.temperature,
        topP: p.top_p,
        seed: p.seed,
      },
      tokens: '',
      numThreads: p.num_threads,
      provider: p.provider,
      debug: 0,
    },
  };
}

/** FireRedASR-AED 解碼相關參數（VAD 字段見 SherpaVadParams）。 */
export interface FireRedRecognizerParams {
  num_threads: number;
  provider: string;
}

/**
 * FireRedASR-AED OfflineRecognizer 配置：encoder + decoder 兩件套映射到 sherpa 的
 * `fireRedAsr` 塊，tokens.txt 走**頂層 `tokens`**（與 sense_voice/paraformer 同位，
 * 區別於 qwen 的 tokenizer 目錄 + 空 tokens）。AED beam search 無暴露的數值解碼超參，
 * 故不存在 qwen 那樣的 memset(0) 數值清零陷阱。
 */
export function buildFireRedRecognizerConfig(
  files: {
    encoder: string;
    decoder: string;
  },
  tokens: string,
  p: FireRedRecognizerParams,
): OfflineRecognizerConfig {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      fireRedAsr: {
        encoder: files.encoder,
        decoder: files.decoder,
      },
      tokens,
      numThreads: p.num_threads,
      provider: p.provider,
      debug: 0,
    },
  };
}

export interface SegmentTiming {
  start: number;
  end: number;
}

/** VAD 段的樣本區間 → 秒。 */
export function segmentTiming(
  startSample: number,
  numSamples: number,
  sampleRate = SAMPLE_RATE,
): SegmentTiming {
  return {
    start: startSample / sampleRate,
    end: (startSample + numSamples) / sampleRate,
  };
}

/** 進度百分比（0..100，整數；total<=0 視為已完成）。 */
export function progressPercent(processed: number, total: number): number {
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
}
