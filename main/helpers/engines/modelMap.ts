/**
 * ggml 模型名（去掉量化後綴後）→ faster-whisper(CT2) 倉庫/目錄名 的顯式映射。
 * 顯式優於隱式正則，覆蓋 large-v3-turbo 等邊界，未來可擴展更多列。
 *
 * 本模塊刻意保持「純」（不依賴 electron/store），便於單元測試直接導入。
 */
export const GGML_TO_CT2: Record<string, string> = {
  tiny: 'tiny',
  'tiny.en': 'tiny.en',
  base: 'base',
  'base.en': 'base.en',
  small: 'small',
  'small.en': 'small.en',
  medium: 'medium',
  'medium.en': 'medium.en',
  'large-v1': 'large-v1',
  'large-v2': 'large-v2',
  'large-v3': 'large-v3',
  'large-v3-turbo': 'large-v3-turbo',
};

/**
 * 把 ggml 模型名（可能含 -q5_0 等量化後綴）解析為 faster-whisper 模型名。
 * 未命中映射表時回退原值（去後綴後）並記日誌，避免硬失敗。
 */
export function toFasterWhisperModel(model?: string): string {
  const base = (model || 'base').toLowerCase().replace(/-q\d+_\d+$/, '');
  const mapped = GGML_TO_CT2[base];
  if (mapped) return mapped;
  console.warn(
    `faster-whisper model name "${base}" not in GGML_TO_CT2 map, using as-is`,
  );
  return base;
}
