import type { EngineStatus, TranscriptionEngine } from '../../types/engine';
import { models } from './utils';

/**
 * 引擎感知的模型就緒判斷。
 *
 * 背景：`systemInfo.modelsInstalled` 是 whisper.cpp(ggml) 單引擎時代的字段，
 * 僅代表 ggml 模型；新增 faster-whisper 引擎後其模型在
 * `fasterWhisperModelsInstalled`（獨立命名空間）。兩個字段語義不同需並存，
 * 因此「當前引擎是否已就緒 / 已裝哪些模型」必須按當前引擎判斷，統一收斂到這裡，
 * 避免各處各自只看 `modelsInstalled` 而誤判（已下 faster-whisper 模型仍提示無模型）。
 */
export interface EngineModelInfo {
  transcriptionEngine?: TranscriptionEngine;
  modelsInstalled?: string[];
  fasterWhisperModelsInstalled?: string[];
  funasrVadInstalled?: boolean;
  funasrAsrModelsInstalled?: string[];
  /** faster-whisper 運行時狀態（state==='ready' 即引擎包已安裝可運行） */
  pythonEngineStatus?: EngineStatus;
  /** funasr 運行庫（sherpa-onnx）是否已安裝 */
  funasrEngineInstalled?: boolean;
  /** qwen 共享 silero VAD 是否就緒 */
  qwenVadInstalled?: boolean;
  /** qwen 已安裝的模型 id 列表 */
  qwenModelsInstalled?: string[];
  /** qwen 運行庫（sherpa-onnx，與 funasr 同庫）是否已安裝 */
  qwenEngineInstalled?: boolean;
  /** fireRed 共享 silero VAD 是否就緒 */
  fireRedVadInstalled?: boolean;
  /** fireRed 已安裝的模型 id 列表 */
  fireRedModelsInstalled?: string[];
  /** fireRed 運行庫（sherpa-onnx，與 funasr 同庫）是否已安裝 */
  fireRedEngineInstalled?: boolean;
}

/** 解析當前轉寫引擎，兼容舊的 useLocalWhisper 開關 */
export function resolveEngine(
  info: EngineModelInfo | undefined,
  useLocalWhisper = false,
): TranscriptionEngine {
  return (
    info?.transcriptionEngine ?? (useLocalWhisper ? 'localCli' : 'builtin')
  );
}

/**
 * 當前引擎已安裝的模型列表。
 * localCli 由用戶自備模型/命令，這裡不枚舉，返回空數組（就緒與否由 hasModelsForEngine 判定）。
 */
export function getInstalledModelsForEngine(
  info: EngineModelInfo | undefined,
  useLocalWhisper = false,
): string[] {
  const engine = resolveEngine(info, useLocalWhisper);
  if (engine === 'fasterWhisper') {
    return info?.fasterWhisperModelsInstalled ?? [];
  }
  if (engine === 'localCli') {
    return [];
  }
  if (engine === 'funasr') {
    return info?.funasrAsrModelsInstalled ?? [];
  }
  if (engine === 'qwen') {
    return info?.qwenModelsInstalled ?? [];
  }
  if (engine === 'fireRedAsr') {
    return info?.fireRedModelsInstalled ?? [];
  }
  return info?.modelsInstalled ?? [];
}

/**
 * 當前引擎在「語音模型」下拉里可選的模型列表（與 Models.tsx 下拉同源）。
 * 與 getInstalledModelsForEngine 的區別：localCli 返回內置 models 名單（用戶自備模型/命令，
 * 下拉里仍可選），而 getInstalledModelsForEngine 對 localCli 返回 [] 用於「就緒判斷」。
 * 用於預設模型自動選擇，確保自動選中的值一定是下拉里存在的選項。
 */
export function getSelectableModelsForEngine(
  info: EngineModelInfo | undefined,
  useLocalWhisper = false,
): string[] {
  const engine = resolveEngine(info, useLocalWhisper);
  if (engine === 'fasterWhisper') {
    return info?.fasterWhisperModelsInstalled ?? [];
  }
  if (engine === 'localCli') {
    return models.map((m) => m.name);
  }
  if (engine === 'funasr') {
    return info?.funasrAsrModelsInstalled ?? [];
  }
  if (engine === 'qwen') {
    return info?.qwenModelsInstalled ?? [];
  }
  if (engine === 'fireRedAsr') {
    return info?.fireRedModelsInstalled ?? [];
  }
  return info?.modelsInstalled ?? [];
}

/** 當前引擎是否已就緒可開始轉寫 */
export function hasModelsForEngine(
  info: EngineModelInfo | undefined,
  useLocalWhisper = false,
): boolean {
  const engine = resolveEngine(info, useLocalWhisper);
  if (engine === 'localCli') return true;
  if (engine === 'funasr') {
    return (
      !!info?.funasrVadInstalled &&
      (info?.funasrAsrModelsInstalled?.length ?? 0) > 0
    );
  }
  if (engine === 'qwen') {
    return (
      !!info?.qwenVadInstalled && (info?.qwenModelsInstalled?.length ?? 0) > 0
    );
  }
  if (engine === 'fireRedAsr') {
    return (
      !!info?.fireRedVadInstalled &&
      (info?.fireRedModelsInstalled?.length ?? 0) > 0
    );
  }
  return getInstalledModelsForEngine(info, useLocalWhisper).length > 0;
}

// ── 跨引擎（逐任務選擇）輔助 ─────────────────────────────────────────────
// 背景：逐任務引擎下，任務頁不再"按全局引擎過濾模型"，而是把各引擎已裝模型聚合成
// 「引擎 ▸ 模型」分組供選擇。下面的輔助統一聚合/就緒口徑，避免各處自行拼裝出錯。

/** 「引擎 ▸ 模型」分組：每組 = 一個引擎 + 該引擎可選模型名列表。 */
export interface EngineModelGroup {
  engine: TranscriptionEngine;
  models: string[];
}

/** (引擎,模型) 選項值的分隔符；引擎 id 與模型名均不含 "::"，故可安全編碼/解碼。 */
const ENGINE_MODEL_SEP = '::';

/** 把 (引擎,模型) 編碼為分組下拉的選項 value。 */
export function encodeEngineModel(
  engine: TranscriptionEngine,
  model: string,
): string {
  return `${engine}${ENGINE_MODEL_SEP}${model}`;
}

/** 解析分組下拉選項 value 為 (引擎,模型)；非法返回 null。 */
export function decodeEngineModel(
  value: string | undefined,
): { engine: TranscriptionEngine; model: string } | null {
  if (!value) return null;
  const idx = value.indexOf(ENGINE_MODEL_SEP);
  if (idx <= 0) return null;
  const engine = value.slice(0, idx) as TranscriptionEngine;
  const model = value.slice(idx + ENGINE_MODEL_SEP.length);
  if (!model) return null;
  return { engine, model };
}

/** faster-whisper 運行時是否已安裝可運行（引擎包 ready）。 */
function isFasterWhisperRunnable(info: EngineModelInfo | undefined): boolean {
  return info?.pythonEngineStatus?.state === 'ready';
}

/**
 * 聚合各引擎"可運行的可選模型"為分組結構（任務頁「引擎 ▸ 模型」分組下拉數據源）。
 * 僅納入「引擎運行時已安裝」的引擎——只下了模型但沒裝對應引擎不可轉寫，故從任務選擇中過濾掉。
 * - builtin: ggml 已裝模型（內置運行時，始終可運行）
 * - fasterWhisper: ct2 已裝模型，且引擎包已安裝（`pythonEngineStatus.state==='ready'`）
 * - funasr / qwen / fireRedAsr: 需 VAD 就緒 + 至少一個模型即可。
 *   三族共用的 sherpa-onnx 運行庫現隨安裝包內置（見 sherpaLibPaths / fetch-sherpa-native），
 *   不再單獨安裝，故口徑與引擎頁（`is*Ready()` = 內置 VAD + 模型）一致，
 *   不再附加 `*EngineInstalled` 條件——否則會出現「引擎頁顯示已就緒、任務頁下拉卻不列出」的不一致。
 * - localCli: 用戶自備模型/命令，無"已裝模型"概念；僅當 `includeLocalCli` 時以
 *   內置規範模型名清單出現（保 `${whisperModel}` 佔位符替換可用，D9）。
 * 空分組省略；localCli 預設不出現（由調用方按是否啟用 localCli 決定）。
 */
export function getEngineModelGroups(
  info: EngineModelInfo | undefined,
  opts?: { includeLocalCli?: boolean },
): EngineModelGroup[] {
  const groups: EngineModelGroup[] = [];

  const ggml = info?.modelsInstalled ?? [];
  if (ggml.length) groups.push({ engine: 'builtin', models: ggml });

  const ct2 = info?.fasterWhisperModelsInstalled ?? [];
  if (ct2.length && isFasterWhisperRunnable(info)) {
    groups.push({ engine: 'fasterWhisper', models: ct2 });
  }

  const funasrAsr = info?.funasrAsrModelsInstalled ?? [];
  if (info?.funasrVadInstalled && funasrAsr.length) {
    groups.push({ engine: 'funasr', models: funasrAsr });
  }

  const qwenModels = info?.qwenModelsInstalled ?? [];
  if (info?.qwenVadInstalled && qwenModels.length) {
    groups.push({ engine: 'qwen', models: qwenModels });
  }

  const fireRedModels = info?.fireRedModelsInstalled ?? [];
  if (info?.fireRedVadInstalled && fireRedModels.length) {
    groups.push({ engine: 'fireRedAsr', models: fireRedModels });
  }

  if (opts?.includeLocalCli) {
    groups.push({ engine: 'localCli', models: models.map((m) => m.name) });
  }

  return groups;
}

/**
 * 跨引擎就緒判斷："任意引擎裝有任意可運行模型即視為就緒"。
 * 用於新手引導 / 全景概覽 / 任務頁"去下載模型"引導。
 * 與 getEngineModelGroups 同口徑：fw 還需引擎包已安裝；funasr/qwen/fireRedAsr 的
 * sherpa-onnx 運行庫隨包內置（見 getEngineModelGroups 註釋），只看內置 VAD + 模型；
 * localCli 不計入（自備模型，無可下載模型；其可用性由是否配置命令決定，另行處理）。
 */
export function hasAnyModelAnyEngine(
  info: EngineModelInfo | undefined,
): boolean {
  if ((info?.modelsInstalled?.length ?? 0) > 0) return true;
  if (
    (info?.fasterWhisperModelsInstalled?.length ?? 0) > 0 &&
    isFasterWhisperRunnable(info)
  ) {
    return true;
  }
  if (
    info?.funasrVadInstalled &&
    (info?.funasrAsrModelsInstalled?.length ?? 0) > 0
  ) {
    return true;
  }
  if (info?.qwenVadInstalled && (info?.qwenModelsInstalled?.length ?? 0) > 0) {
    return true;
  }
  if (
    info?.fireRedVadInstalled &&
    (info?.fireRedModelsInstalled?.length ?? 0) > 0
  ) {
    return true;
  }
  return false;
}

/**
 * 從分組選項中挑選預設 (引擎,模型)：
 * 1) 命中"上次使用"（引擎仍有分組、模型仍可用）則沿用；模型失配時退回該引擎首個模型；
 * 2) 否則優先 builtin 分組（初次預設），無則取首個分組；
 * 3) 無任何分組返回 null（調用方據此展示"去下載模型"）。
 */
export function pickDefaultEngineModel(
  groups: EngineModelGroup[],
  last?: { engine?: TranscriptionEngine; model?: string },
): { engine: TranscriptionEngine; model: string } | null {
  if (!groups.length) return null;

  if (last?.engine) {
    const g = groups.find((x) => x.engine === last.engine);
    if (g && g.models.length) {
      const matched =
        (last.model &&
          g.models.find(
            (m) => m.toLowerCase() === last.model!.toLowerCase(),
          )) ||
        g.models[0];
      return { engine: g.engine, model: matched };
    }
  }

  const preferred = groups.find((x) => x.engine === 'builtin') ?? groups[0];
  if (preferred?.models.length) {
    return { engine: preferred.engine, model: preferred.models[0] };
  }
  return null;
}
