import { getEngineAdapterForTask } from './engines/registry';
import { getTaskContext } from './taskContext';
import type { TranscribeContext } from './engines/types';
import type { TranscriptionEngine } from '../../types/engine';

export async function routeTranscription(
  ctx: TranscribeContext,
): Promise<string> {
  // 引擎按任務攜帶的 transcriptionEngine 解析（缺省回退 builtin）。
  const adapter = getEngineAdapterForTask(
    ctx.formData as { transcriptionEngine?: TranscriptionEngine },
  );
  const status = await adapter.isAvailable();
  if (status.state !== 'ready') {
    throw new Error(
      `${adapter.displayName} is not available: ${status.message || status.state}`,
    );
  }
  // 取消信號統一在此從任務上下文注入，引擎以 ctx.signal 為準。
  return adapter.transcribe({
    ...ctx,
    signal: ctx.signal ?? getTaskContext()?.signal,
  });
}
