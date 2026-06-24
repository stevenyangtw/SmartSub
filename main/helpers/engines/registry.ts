import { builtinEngineAdapter } from './builtinEngine';
import { fasterWhisperEngineAdapter } from './fasterWhisperEngine';
import { funasrEngineAdapter } from './funasrEngine';
import { qwenEngineAdapter } from './qwenEngine';
import { fireRedEngineAdapter } from './fireRedEngine';
import { localCliEngineAdapter } from './localCliEngine';
import type { TranscriptionEngine } from '../../../types/engine';
import type { TranscriptionEngineAdapter } from './types';

const adapters: TranscriptionEngineAdapter[] = [
  builtinEngineAdapter,
  fasterWhisperEngineAdapter,
  funasrEngineAdapter,
  qwenEngineAdapter,
  fireRedEngineAdapter,
  localCliEngineAdapter,
];

export function getEngineAdapter(
  id: TranscriptionEngine,
): TranscriptionEngineAdapter | undefined {
  return adapters.find((a) => a.id === id);
}

/**
 * 逐任務引擎解析：任務 formData 攜帶的 `transcriptionEngine` 優先（且必須是已知引擎），
 * 缺省回退 builtin。引擎已逐任務化，不再讀全局設置。
 */
export function resolveEngineIdForTask(formData?: {
  transcriptionEngine?: TranscriptionEngine;
}): TranscriptionEngine {
  const fromTask = formData?.transcriptionEngine;
  if (fromTask && getEngineAdapter(fromTask)) return fromTask;
  return 'builtin';
}

export function getEngineAdapterForTask(formData?: {
  transcriptionEngine?: TranscriptionEngine;
}): TranscriptionEngineAdapter {
  return (
    getEngineAdapter(resolveEngineIdForTask(formData)) ?? builtinEngineAdapter
  );
}

export function listEngineAdapters(): TranscriptionEngineAdapter[] {
  return adapters;
}
