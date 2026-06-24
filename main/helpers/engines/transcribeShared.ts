/**
 * 各引擎轉寫實現共用的純工具：數值兜底、語言歸一、SRT 時間格式化、VAD 設置歸一。
 * 不依賴任何引擎實現，供 builtin / faster-whisper / localCli 適配器複用。
 */

export function getNumericSetting(
  value: unknown,
  defaultValue: number,
): number {
  return typeof value === 'number' && isFinite(value) ? value : defaultValue;
}

export function getWhisperLanguage(language?: string): string {
  if (!language || language === 'auto') {
    return 'auto';
  }

  const normalized = language.toLowerCase();
  // 所有中文變體（簡體/繁體/臺灣/香港等）統一映射為 zh，
  // Whisper 對 zh 的訓練數據最充分，識別國語/普通話最準確；
  // 粵語請通過下拉框單獨選擇 yue 傳入。
  if (normalized.startsWith('zh')) {
    return 'zh';
  }

  return normalized;
}

export function secondsToSrtTime(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds || 0) * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (value: number, len = 2) => String(value).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export interface VadSettings {
  useVAD: boolean;
  vadThreshold: number;
  vadMinSpeechDuration: number;
  vadMinSilenceDuration: number;
  vadMaxSpeechDuration: number;
  vadSpeechPad: number;
  vadSamplesOverlap: number;
}

/** 抗幻覺/抗重複總開關（全局設置 settings.reduceRepetition）。 */
export function isReduceRepetitionEnabled(
  settings: Record<string, unknown> | undefined,
): boolean {
  return settings?.reduceRepetition === true;
}

/**
 * faster-whisper 的抗幻覺/抗重複參數包：僅在開關開啟時返回覆蓋值，
 * 關閉時返回空對象（sidecar 缺鍵回落 faster-whisper 預設，行為不變）。
 * - condition_on_previous_text=false：斷開上文喂入，最有效地打斷重複/幻覺級聯
 * - no_repeat_ngram_size=3 / repetition_penalty=1.1：禁止重複 n-gram、懲罰重複 token
 * - hallucination_silence_threshold=2.0：跳過長靜音（依賴 word_timestamps，已開）
 */
export function getFasterWhisperAntiRepetitionParams(
  settings: Record<string, unknown> | undefined,
): Record<string, number | boolean> {
  if (!isReduceRepetitionEnabled(settings)) return {};
  return {
    condition_on_previous_text: false,
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.1,
    hallucination_silence_threshold: 2.0,
  };
}

/** 從 store 的 settings 歸一化出 VAD 參數（各引擎再映射到自己的字段名）。 */
export function getVadSettings(settings: Record<string, unknown>): VadSettings {
  return {
    useVAD: settings?.useVAD !== false,
    vadThreshold: getNumericSetting(settings?.vadThreshold, 0.5),
    vadMinSpeechDuration: getNumericSetting(
      settings?.vadMinSpeechDuration,
      250,
    ),
    vadMinSilenceDuration: getNumericSetting(
      settings?.vadMinSilenceDuration,
      100,
    ),
    vadMaxSpeechDuration: getNumericSetting(settings?.vadMaxSpeechDuration, 0),
    vadSpeechPad: getNumericSetting(settings?.vadSpeechPad, 200),
    vadSamplesOverlap: getNumericSetting(settings?.vadSamplesOverlap, 0.1),
  };
}
