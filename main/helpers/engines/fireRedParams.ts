import { getNumericSetting } from './transcribeShared';

/**
 * FireRedASR-AED 專屬參數映射：SmartSub 統一 settings → sherpa-onnx addon 參數。
 *
 * 與 qwen 的關鍵差異：
 * - FireRedASR-AED 走 beam search，sherpa 的 `fireRedAsr` 配置**不暴露數值解碼超參**
 *   （無 max_new_tokens / temperature 等），故無 qwen 那樣的 memset(0) 清零陷阱。
 * - **不接 language**：FireRedASR 內部處理中英，sherpa 配置無 language 字段。
 *
 * 段長安全閘（design D8）：FireRedASR-AED 僅支持 ≤60s 輸入（>60s 易幻覺、
 * >200s 觸發位置編碼錯誤）。故 fireRed **不沿用 SmartSub「0=不限制」約定**：
 * 預設 30s，且實際生效值硬鉗到 (0, 60] —— 0/未設/超限均收斂到安全範圍內。
 */

/** FireRedASR-AED 預設最大語音段長（秒）：留足 60s 硬限下的安全裕度。 */
export const FIRERED_DEFAULT_MAX_SPEECH_S = 30;
/** FireRedASR-AED 最大語音段長硬上限（秒）：超過此值模型會幻覺/位置編碼報錯。 */
export const FIRERED_HARD_MAX_SPEECH_S = 60;

export interface FireRedEngineSettings {
  /** sherpa-onnx provider；本期僅 cpu 落地，cuda 預留未來階段。 */
  fireRedProvider?: 'cpu' | 'cuda';
  fireRedNumThreads?: number;
  useVAD?: boolean;
  vadThreshold?: number;
  vadMinSilenceDuration?: number;
  vadMinSpeechDuration?: number;
  vadMaxSpeechDuration?: number;
}

export interface FireRedAddonParams {
  provider: string;
  num_threads: number;
  vad_threshold: number;
  vad_min_silence_duration_ms: number;
  vad_min_speech_duration_ms: number;
  vad_max_speech_duration_s: number;
}

/**
 * 段長安全閘：把任意輸入收斂到 FireRedASR-AED 安全範圍。
 * - 未設/非數值 → 預設 30s；
 * - 0（SmartSub「不限制」語義）或 > 60 → 硬上限 60s（絕不放行不限制）；
 * - (0, 60] → 原樣採用。
 */
export function clampFireRedMaxSpeech(raw: unknown): number {
  const v = getNumericSetting(raw, FIRERED_DEFAULT_MAX_SPEECH_S);
  if (v <= 0 || v > FIRERED_HARD_MAX_SPEECH_S) return FIRERED_HARD_MAX_SPEECH_S;
  return v;
}

/** 組裝 fireRed 的可選參數（不含 audio_file / 模型文件，由 adapter 注入）。 */
export function buildFireRedParams(
  settings: Record<string, unknown>,
): FireRedAddonParams {
  const s = settings as FireRedEngineSettings;
  return {
    // 本期僅 cpu 落地（design D6）；非法/未設回退 cpu。
    provider: s.fireRedProvider === 'cuda' ? 'cuda' : 'cpu',
    num_threads:
      Number(s.fireRedNumThreads) > 0 ? Number(s.fireRedNumThreads) : 2,
    // VAD 調參複用 SmartSub 統一開關（與 funasr / qwen / faster-whisper 一致）。
    vad_threshold: getNumericSetting(s.vadThreshold, 0.5),
    vad_min_silence_duration_ms: getNumericSetting(
      s.vadMinSilenceDuration,
      100,
    ),
    vad_min_speech_duration_ms: getNumericSetting(s.vadMinSpeechDuration, 250),
    // 段長安全閘：FireRedASR-AED 不允許「不限制」，預設 30s、硬鉗 ≤60s。
    vad_max_speech_duration_s: clampFireRedMaxSpeech(s.vadMaxSpeechDuration),
  };
}
