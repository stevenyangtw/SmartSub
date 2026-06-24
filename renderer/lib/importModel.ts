/**
 * 渲染層「從本地資料夾導入模型」的統一調用封裝。
 * 負責調用主進程 importModel IPC 並把結果歸一化為 ImportOutcome，
 * 文案/刷新由各引擎面板按自身 i18n 命名空間處理（避免傳 t 引發的類型耦合）。
 */
export type ImportOutcome =
  | { kind: 'success' }
  | { kind: 'canceled' }
  | { kind: 'invalid-layout'; missing: string[] }
  | { kind: 'error'; message: string };

export async function importModelFromFolder(
  engine: 'funasr' | 'qwen' | 'fireRedAsr' | 'fasterWhisper',
  modelId: string,
): Promise<ImportOutcome> {
  try {
    const r = await window?.ipc?.invoke('importModel', { engine, modelId });
    if (r?.success) return { kind: 'success' };
    if (r?.canceled) return { kind: 'canceled' };
    if (r?.reason === 'invalid-layout') {
      return { kind: 'invalid-layout', missing: r.missing || [] };
    }
    return { kind: 'error', message: r?.error || r?.reason || 'unknown' };
  } catch (e) {
    return { kind: 'error', message: String(e) };
  }
}
