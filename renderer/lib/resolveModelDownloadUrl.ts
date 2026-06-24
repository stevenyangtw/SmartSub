/**
 * 通過主進程解析「可複製的下載鏈接」（按引擎域 + 模型 + 當前選中源）。
 *
 * 鏈接構造邏輯集中在主進程各 catalog，renderer 僅薄封裝一次 IPC，避免重複實現
 * 導致與真實下載鏈接漂移。解析失敗（未知模型/源、IPC 異常）統一返回 null，
 * 由調用方（氣泡複製按鈕）給出失敗提示。
 */
export type ModelUrlScope = 'funasr' | 'qwen' | 'firered' | 'pyEngine';

export async function resolveModelDownloadUrl(
  scope: ModelUrlScope,
  source: string,
  modelId?: string,
  /** pyEngine 域專用：cpu=預設包，cuda=Full GPU 包（影響複製的資產直鏈）。 */
  variant?: 'cpu' | 'cuda',
): Promise<string | null> {
  try {
    const r = await window?.ipc?.invoke('resolveModelDownloadUrl', {
      scope,
      modelId,
      source,
      variant,
    });
    return r?.success && r.url ? (r.url as string) : null;
  } catch {
    return null;
  }
}
