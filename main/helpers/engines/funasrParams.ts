import { getNumericSetting } from './transcribeShared';

/** funasr/SenseVoice 專屬參數映射：SmartSub 統一 settings → sherpa-onnx addon 參數。 */

/** SmartSub 語言 → SenseVoice 語言標籤（auto|zh|yue|en|ja|ko）。 */
export function getFunasrLanguage(language?: string): string {
  if (!language || language === 'auto') return 'auto';
  const n = language.toLowerCase();
  if (n.startsWith('yue') || n === 'zh-hk' || n === 'zh-yue') return 'yue';
  if (n.startsWith('zh')) return 'zh';
  if (n.startsWith('en')) return 'en';
  if (n.startsWith('ja')) return 'ja';
  if (n.startsWith('ko')) return 'ko';
  return 'auto';
}

export interface FunasrEngineSettings {
  funasrUseItn?: boolean;
  /** sherpa-onnx provider；P1 僅 cpu 落地，cuda/coreml 預留 */
  funasrProvider?: 'cpu' | 'cuda' | 'coreml';
  funasrNumThreads?: number;
  useVAD?: boolean;
  vadThreshold?: number;
  vadMinSilenceDuration?: number;
  vadMinSpeechDuration?: number;
  vadMaxSpeechDuration?: number;
}

export interface FunasrAddonParams {
  language: string;
  use_itn: boolean;
  provider: string;
  num_threads: number;
  vad_threshold: number;
  vad_min_silence_duration_ms: number;
  vad_min_speech_duration_ms: number;
  vad_max_speech_duration_s: number;
}

/** 組裝 funasr 的可選參數（不含 audio_file / 模型文件，由 adapter 注入）。 */
export function buildFunasrParams(
  settings: Record<string, unknown>,
  sourceLanguage?: string,
): FunasrAddonParams {
  const s = settings as FunasrEngineSettings;
  return {
    language: getFunasrLanguage(sourceLanguage), // 'auto' → 引擎側歸一為 '' 自動
    use_itn: s.funasrUseItn !== false, // 預設開 ITN
    provider: s.funasrProvider || 'cpu',
    num_threads:
      Number(s.funasrNumThreads) > 0 ? Number(s.funasrNumThreads) : 2,
    // VAD 調參複用 SmartSub 統一開關（與 faster-whisper 一致；缺省也安全）。
    vad_threshold: getNumericSetting(s.vadThreshold, 0.5),
    vad_min_silence_duration_ms: getNumericSetting(
      s.vadMinSilenceDuration,
      100,
    ),
    vad_min_speech_duration_ms: getNumericSetting(s.vadMinSpeechDuration, 250),
    // SmartSub 約定 0 = 不限制；addon 側據此映射。
    vad_max_speech_duration_s: getNumericSetting(s.vadMaxSpeechDuration, 0),
  };
}
