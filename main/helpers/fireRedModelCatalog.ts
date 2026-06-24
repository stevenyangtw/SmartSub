import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { resolveOverridePath, resolveBundledVadPath } from './modelImport';
import {
  getGithubBase,
  getGithubProxyPrefix,
  getModelScopeBase,
} from './config/downloadConfig';

/** fireRed 模型根目錄：settings.fireRedModelsPath 覆蓋，否則 userData/models/firered */
export function getFireRedModelsRoot(): string {
  const { store } = require('./store') as typeof import('./store');
  const fallback = path.join(app.getPath('userData'), 'models', 'firered');
  const root = resolveOverridePath(
    store.get('settings')?.fireRedModelsPath,
    fallback,
  );
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** fireRed 子模型標識（與本地子目錄一一對應）。本期僅 AED-L int8。 */
export type FireRedModelId = 'fire-red-asr-large-zh-en';

/** 預設（當前唯一）fireRed 模型。 */
export const FIRERED_DEFAULT_MODEL_ID: FireRedModelId =
  'fire-red-asr-large-zh-en';

/**
 * fireRed 模型下載源：
 * - modelscope：ModelScope 官方鏡像逐文件直下（國內 CDN 最快，且免解包）；
 * - ghproxy：GitHub release 整包經 gh-proxy.com 代理（國內加速）；
 * - github：GitHub release 整包直連（海外）。
 */
export type FireRedModelSource = 'modelscope' | 'ghproxy' | 'github';

/** 預設下載源：國內優先 ModelScope（官方鏡像存在）。 */
export const FIRERED_DEFAULT_SOURCE: FireRedModelSource = 'modelscope';

/** 源回退規範順序（國內優先）：modelscope → ghproxy → github。 */
const FIRERED_SOURCE_ORDER: FireRedModelSource[] = [
  'modelscope',
  'ghproxy',
  'github',
];

/** 所選源排第一，其餘按規範順序補齊，供下載失敗時自動回退。 */
export function getFireRedSourceOrder(
  selected: FireRedModelSource,
): FireRedModelSource[] {
  return [selected, ...FIRERED_SOURCE_ORDER.filter((s) => s !== selected)];
}

/** ModelScope 逐文件映射：remote=倉庫內路徑，local=相對模型目錄的落地路徑。 */
export interface FireRedModelScopeFile {
  remote: string;
  local: string;
}

/**
 * fireRed 模型清單：支持兩種獲取方式——
 * - ModelScope 逐文件（modelScopeRepo + modelScopeFiles）：國內首選，免解包；
 * - GitHub release tar.bz2 整包（releasePath + archiveName）：經 gh-proxy / 直連回退，需解包。
 * sherpa-onnx FireRedASR-AED 兩件套：encoder.int8 / decoder.int8 + tokens.txt。
 */
export interface FireRedModelSpec {
  id: FireRedModelId;
  dirName: string;
  /** 體積/硬件提示用（解包後約 1.74GB；tar.bz2 下載包約 1.4GB）。 */
  approxInstallBytes: number;
  /** ModelScope 倉庫 id（逐文件國內源，官方鏡像）。 */
  modelScopeRepo: string;
  /** ModelScope 逐文件清單（remote→local）。 */
  modelScopeFiles: FireRedModelScopeFile[];
  /** GitHub release 路徑（owner/repo/releases/download/tag），用於整包源拼 URL。 */
  releasePath: string;
  /** release 整包文件名（tar.bz2）。 */
  archiveName: string;
  /** 解包後頂層目錄名（用 decompress strip:1 去掉，此處僅作記錄）。 */
  archiveInnerDir: string;
  /** 判定「已安裝」必須存在的關鍵文件（相對 dirName）。 */
  requiredFiles: string[];
}

const FIRERED_ARCHIVE =
  'sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16.tar.bz2';
const FIRERED_INNER = 'sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16';
const FIRERED_RELEASE_PATH = 'k2-fsa/sherpa-onnx/releases/download/asr-models';
/** sherpa-onnx 的 FireRedASR onnx 官方鏡像（與 HF csukuangfj 同作者同內容）。 */
const FIRERED_MS_REPO =
  'csukuangfj/sherpa-onnx-fire-red-asr-large-zh_en-2025-02-16';

export const FIRERED_MODELS: Record<FireRedModelId, FireRedModelSpec> = {
  'fire-red-asr-large-zh-en': {
    id: 'fire-red-asr-large-zh-en',
    dirName: 'fire-red-asr-large-zh-en',
    // encoder 1.29GB + decoder 425MB + tokens 70KB ≈ 1.74GB（實測字節累加）。
    approxInstallBytes: 1_740_000_000,
    modelScopeRepo: FIRERED_MS_REPO,
    // ModelScope 倉庫內文件平鋪在根（經文件樹 API 核實）。
    modelScopeFiles: [
      { remote: 'encoder.int8.onnx', local: 'encoder.int8.onnx' },
      { remote: 'decoder.int8.onnx', local: 'decoder.int8.onnx' },
      { remote: 'tokens.txt', local: 'tokens.txt' },
    ],
    releasePath: FIRERED_RELEASE_PATH,
    archiveName: FIRERED_ARCHIVE,
    archiveInnerDir: FIRERED_INNER,
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
  },
};

/** 整包源（ghproxy/github）的 tar.bz2 下載 URL。 */
export function getFireRedArchiveUrl(
  spec: FireRedModelSpec,
  source: 'ghproxy' | 'github',
): string {
  const github = `${getGithubBase()}/${spec.releasePath}/${spec.archiveName}`;
  return source === 'ghproxy' ? `${getGithubProxyPrefix()}/${github}` : github;
}

/** ModelScope 單文件 resolve 直鏈（302 跳國內 CDN，支持 Range）。 */
export function getFireRedModelScopeFileUrl(
  spec: FireRedModelSpec,
  remote: string,
): string {
  return `${getModelScopeBase()}/models/${spec.modelScopeRepo}/resolve/master/${remote}`;
}

/** ModelScope 文件樹 API（取各文件 size 以計算總進度）。 */
export function getFireRedModelScopeTreeUrl(spec: FireRedModelSpec): string {
  return `${getModelScopeBase()}/api/v1/models/${spec.modelScopeRepo}/repo/files?Revision=master&Recursive=true`;
}

export function getFireRedModelDir(id: FireRedModelId): string {
  const dir = path.join(getFireRedModelsRoot(), FIRERED_MODELS[id].dirName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isFireRedModelInstalled(id: FireRedModelId): boolean {
  const dir = path.join(getFireRedModelsRoot(), FIRERED_MODELS[id].dirName);
  return FIRERED_MODELS[id].requiredFiles.every((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

/** 兩件套 + tokens 絕對路徑（供 adapter 注入 worker 模型請求）。 */
export function getFireRedModelFiles(id: FireRedModelId): {
  encoder: string;
  decoder: string;
  tokens: string;
} {
  const dir = getFireRedModelDir(id);
  return {
    encoder: path.join(dir, 'encoder.int8.onnx'),
    decoder: path.join(dir, 'decoder.int8.onnx'),
    tokens: path.join(dir, 'tokens.txt'),
  };
}

/** 共享 silero VAD：隨應用內置（extraResources/sherpa/vad/silero_vad.onnx），與 funasr/qwen 共用同一份。 */
export function getFireRedVadModelPath(): string {
  const { getExtraResourcesPath } =
    require('./utils') as typeof import('./utils');
  return resolveBundledVadPath(getExtraResourcesPath());
}

/** 共享 VAD 是否就緒：檢查隨包內置文件是否存在（正常安裝下恆為真）。 */
export function isFireRedVadInstalled(): boolean {
  return fs.existsSync(getFireRedVadModelPath());
}

/** 全部 fireRed 模型 id（靜態，純函數，不觸磁盤）。 */
export function getFireRedModelIds(): FireRedModelId[] {
  return Object.keys(FIRERED_MODELS) as FireRedModelId[];
}

/** 已安裝的 fireRed 模型 id（觸磁盤）。 */
export function getInstalledFireRedModels(): FireRedModelId[] {
  return getFireRedModelIds().filter((id) => isFireRedModelInstalled(id));
}

/**
 * 選定要使用的 fireRed 模型（純函數）：
 * - requested 命中已裝 → 用它；
 * - 否則回退首個已裝；
 * - 無已裝 → null。
 */
export function resolveFireRedSelection(
  requested: string | undefined,
  installed: FireRedModelId[],
): { id: FireRedModelId } | null {
  if (installed.length === 0) return null;
  const ids = getFireRedModelIds();
  const normalized = (requested || '').toLowerCase();
  const chosen =
    ids.find((id) => id === normalized && installed.includes(id)) ??
    installed[0];
  return { id: chosen };
}

/** fireRed 轉寫就緒 = 至少一個 fireRed 模型 + 共享 silero VAD 均已安裝。 */
export function isFireRedReady(): boolean {
  return getInstalledFireRedModels().length > 0 && isFireRedVadInstalled();
}

export function deleteFireRedModel(id: FireRedModelId): void {
  const dir = path.join(getFireRedModelsRoot(), FIRERED_MODELS[id].dirName);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
