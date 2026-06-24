import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { resolveOverridePath, resolveBundledVadPath } from './modelImport';
import {
  getGithubBase,
  getGithubProxyPrefix,
  getModelScopeBase,
} from './config/downloadConfig';

/** qwen 模型根目錄：settings.qwenModelsPath 覆蓋，否則 userData/models/qwen */
export function getQwenModelsRoot(): string {
  const { store } = require('./store') as typeof import('./store');
  const fallback = path.join(app.getPath('userData'), 'models', 'qwen');
  const root = resolveOverridePath(
    store.get('settings')?.qwenModelsPath,
    fallback,
  );
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** qwen 子模型標識（與本地子目錄一一對應）。P2 僅 0.6B。 */
export type QwenModelId = 'qwen3-asr-0.6b';

/** 預設（當前唯一）qwen 模型。 */
export const QWEN_DEFAULT_MODEL_ID: QwenModelId = 'qwen3-asr-0.6b';

/**
 * qwen 模型下載源：
 * - modelscope：ModelScope 國內倉庫逐文件直下（國內 CDN 最快，且免解包）；
 * - ghproxy：GitHub release 整包經 gh-proxy.com 代理（國內加速）；
 * - github：GitHub release 整包直連（海外）。
 */
export type QwenModelSource = 'modelscope' | 'ghproxy' | 'github';

/** 預設下載源：國內優先 ModelScope。 */
export const QWEN_DEFAULT_SOURCE: QwenModelSource = 'modelscope';

/** 源回退規範順序（國內優先）：modelscope → ghproxy → github。 */
const QWEN_SOURCE_ORDER: QwenModelSource[] = [
  'modelscope',
  'ghproxy',
  'github',
];

/** 所選源排第一，其餘按規範順序補齊，供下載失敗時自動回退。 */
export function getQwenSourceOrder(
  selected: QwenModelSource,
): QwenModelSource[] {
  return [selected, ...QWEN_SOURCE_ORDER.filter((s) => s !== selected)];
}

/** ModelScope 逐文件映射：remote=倉庫內路徑，local=相對模型目錄的落地路徑。 */
export interface QwenModelScopeFile {
  remote: string;
  local: string;
}

/**
 * qwen 模型清單：支持兩種獲取方式——
 * - ModelScope 逐文件（modelScopeRepo + modelScopeFiles）：國內首選，免解包；
 * - GitHub release tar.bz2 整包（releasePath + archiveName）：經 gh-proxy / 直連回退，需解包。
 * sherpa-onnx Qwen3-ASR 四件套：conv_frontend / encoder / decoder + tokenizer 目錄。
 */
export interface QwenModelSpec {
  id: QwenModelId;
  dirName: string;
  /** 體積/硬件提示用（解包後約 0.95GB；tar.bz2 下載包約 838MB）。 */
  approxInstallBytes: number;
  /** ModelScope 倉庫 id（逐文件國內源）。 */
  modelScopeRepo: string;
  /** ModelScope 逐文件清單（remote→local）。 */
  modelScopeFiles: QwenModelScopeFile[];
  /** GitHub release 路徑（owner/repo/releases/download/tag），用於整包源拼 URL。 */
  releasePath: string;
  /** release 整包文件名（tar.bz2）。 */
  archiveName: string;
  /** 解包後頂層目錄名（用 decompress strip:1 去掉，此處僅作記錄）。 */
  archiveInnerDir: string;
  /** 判定「已安裝」必須存在的關鍵文件（相對 dirName）。 */
  requiredFiles: string[];
}

const QWEN_0_6B_ARCHIVE = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2';
const QWEN_0_6B_INNER = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25';
const QWEN_0_6B_RELEASE_PATH =
  'k2-fsa/sherpa-onnx/releases/download/asr-models';
/** sherpa-onnx 的 Qwen3-ASR onnx 即源自該 ModelScope 倉庫（k2-fsa 據此打包 tar.bz2）。 */
const QWEN_MS_REPO = 'zengshuishui/Qwen3-ASR-onnx';

export const QWEN_MODELS: Record<QwenModelId, QwenModelSpec> = {
  'qwen3-asr-0.6b': {
    id: 'qwen3-asr-0.6b',
    dirName: 'qwen3-asr-0.6b',
    approxInstallBytes: 1_020_000_000,
    modelScopeRepo: QWEN_MS_REPO,
    modelScopeFiles: [
      { remote: 'model_0.6B/conv_frontend.onnx', local: 'conv_frontend.onnx' },
      { remote: 'model_0.6B/encoder.int8.onnx', local: 'encoder.int8.onnx' },
      { remote: 'model_0.6B/decoder.int8.onnx', local: 'decoder.int8.onnx' },
      { remote: 'tokenizer/vocab.json', local: 'tokenizer/vocab.json' },
      { remote: 'tokenizer/merges.txt', local: 'tokenizer/merges.txt' },
      {
        remote: 'tokenizer/tokenizer_config.json',
        local: 'tokenizer/tokenizer_config.json',
      },
      { remote: 'tokenizer/config.json', local: 'tokenizer/config.json' },
      {
        remote: 'tokenizer/chat_template.json',
        local: 'tokenizer/chat_template.json',
      },
      {
        remote: 'tokenizer/preprocessor_config.json',
        local: 'tokenizer/preprocessor_config.json',
      },
    ],
    releasePath: QWEN_0_6B_RELEASE_PATH,
    archiveName: QWEN_0_6B_ARCHIVE,
    archiveInnerDir: QWEN_0_6B_INNER,
    // tokenizer 是目錄；以其中兩個關鍵文件作為安裝完整性標記。
    requiredFiles: [
      'conv_frontend.onnx',
      'encoder.int8.onnx',
      'decoder.int8.onnx',
      'tokenizer/vocab.json',
      'tokenizer/merges.txt',
    ],
  },
};

/** 整包源（ghproxy/github）的 tar.bz2 下載 URL。 */
export function getQwenArchiveUrl(
  spec: QwenModelSpec,
  source: 'ghproxy' | 'github',
): string {
  const github = `${getGithubBase()}/${spec.releasePath}/${spec.archiveName}`;
  return source === 'ghproxy' ? `${getGithubProxyPrefix()}/${github}` : github;
}

/** ModelScope 單文件 resolve 直鏈（302 跳國內 CDN，支持 Range）。 */
export function getQwenModelScopeFileUrl(
  spec: QwenModelSpec,
  remote: string,
): string {
  return `${getModelScopeBase()}/models/${spec.modelScopeRepo}/resolve/master/${remote}`;
}

/** ModelScope 文件樹 API（取各文件 size 以計算總進度）。 */
export function getQwenModelScopeTreeUrl(spec: QwenModelSpec): string {
  return `${getModelScopeBase()}/api/v1/models/${spec.modelScopeRepo}/repo/files?Revision=master&Recursive=true`;
}

export function getQwenModelDir(id: QwenModelId): string {
  const dir = path.join(getQwenModelsRoot(), QWEN_MODELS[id].dirName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isQwenModelInstalled(id: QwenModelId): boolean {
  const dir = path.join(getQwenModelsRoot(), QWEN_MODELS[id].dirName);
  return QWEN_MODELS[id].requiredFiles.every((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

/** 四件套絕對路徑（供 adapter 注入 worker 模型請求；tokenizer 為目錄）。 */
export function getQwenModelFiles(id: QwenModelId): {
  convFrontend: string;
  encoder: string;
  decoder: string;
  tokenizer: string;
} {
  const dir = getQwenModelDir(id);
  return {
    convFrontend: path.join(dir, 'conv_frontend.onnx'),
    encoder: path.join(dir, 'encoder.int8.onnx'),
    decoder: path.join(dir, 'decoder.int8.onnx'),
    tokenizer: path.join(dir, 'tokenizer'),
  };
}

/** 共享 silero VAD：隨應用內置（extraResources/sherpa/vad/silero_vad.onnx），與 funasr/fireRed 共用同一份。 */
export function getQwenVadModelPath(): string {
  const { getExtraResourcesPath } =
    require('./utils') as typeof import('./utils');
  return resolveBundledVadPath(getExtraResourcesPath());
}

/** 共享 VAD 是否就緒：檢查隨包內置文件是否存在（正常安裝下恆為真）。 */
export function isQwenVadInstalled(): boolean {
  return fs.existsSync(getQwenVadModelPath());
}

/** 全部 qwen 模型 id（靜態，純函數，不觸磁盤）。 */
export function getQwenModelIds(): QwenModelId[] {
  return Object.keys(QWEN_MODELS) as QwenModelId[];
}

/** 已安裝的 qwen 模型 id（觸磁盤）。 */
export function getInstalledQwenModels(): QwenModelId[] {
  return getQwenModelIds().filter((id) => isQwenModelInstalled(id));
}

/**
 * 選定要使用的 qwen 模型（純函數）：
 * - requested 命中已裝 → 用它；
 * - 否則回退首個已裝；
 * - 無已裝 → null。
 */
export function resolveQwenSelection(
  requested: string | undefined,
  installed: QwenModelId[],
): { id: QwenModelId } | null {
  if (installed.length === 0) return null;
  const ids = getQwenModelIds();
  const normalized = (requested || '').toLowerCase();
  const chosen =
    ids.find((id) => id === normalized && installed.includes(id)) ??
    installed[0];
  return { id: chosen };
}

/** qwen 轉寫就緒 = 至少一個 qwen 模型 + 共享 silero VAD 均已安裝。 */
export function isQwenReady(): boolean {
  return getInstalledQwenModels().length > 0 && isQwenVadInstalled();
}

export function deleteQwenModel(id: QwenModelId): void {
  const dir = path.join(getQwenModelsRoot(), QWEN_MODELS[id].dirName);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
