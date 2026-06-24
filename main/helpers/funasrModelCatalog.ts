import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getDownloadEndpoints } from './config/downloadConfig';
import { resolveOverridePath, resolveBundledVadPath } from './modelImport';

/** funasr 模型根目錄：userData/models/funasr */
export function getFunasrModelsRoot(): string {
  const { store } = require('./store') as typeof import('./store');
  const fallback = path.join(app.getPath('userData'), 'models', 'funasr');
  const root = resolveOverridePath(
    store.get('settings')?.funasrModelsPath,
    fallback,
  );
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/** funasr 子模型標識（與本地子目錄一一對應）。 */
export type FunasrModelId = 'sensevoice-small' | 'paraformer-zh' | 'silero-vad';

/** ASR 模型底層類型，決定 sidecar 走 from_sense_voice / from_paraformer。 */
export type FunasrModelType = 'sense_voice' | 'paraformer';

/**
 * 兩種下載模式：
 * - repo：從 HF（鏡像）倉庫按 tree 下載子集（keepFiles）。
 * - files：按顯式候選 URL 順序回退下單個文件（silero 這類 release 資產）。
 */
export interface FunasrModelSpec {
  id: FunasrModelId;
  dirName: string;
  /** 'asr' 進入模型下拉並參與轉寫；'vad' 為共用基礎組件，不進下拉。 */
  kind: 'asr' | 'vad';
  /** ASR 模型的底層加載類型（kind==='asr' 時必填）。 */
  modelType?: FunasrModelType;
  /** 判定「已安裝」必須存在的關鍵文件 */
  requiredFiles: string[];
  /** HF（鏡像）倉庫 id（repo 模式） */
  repo?: string;
  /** 僅保留這些文件，省帶寬（repo 模式；缺省下載全部非點文件） */
  keepFiles?: string[];
  /**
   * files 模式的待下載文件列表（按 name 逐個下載）。
   * 候選 URL 由 getFunasrFileUrls() 在運行時按可配置端點生成；
   * urls 僅作為可選的靜態兜底（一般留空）。
   */
  files?: { name: string; urls?: string[] }[];
}

export const FUNASR_MODELS: Record<FunasrModelId, FunasrModelSpec> = {
  'sensevoice-small': {
    id: 'sensevoice-small',
    dirName: 'sensevoice-small',
    kind: 'asr',
    modelType: 'sense_voice',
    repo: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    keepFiles: ['model.int8.onnx', 'tokens.txt'],
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
  },
  'paraformer-zh': {
    id: 'paraformer-zh',
    dirName: 'paraformer-zh',
    kind: 'asr',
    modelType: 'paraformer',
    repo: 'csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09',
    keepFiles: ['model.int8.onnx', 'tokens.txt'],
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
  },
  // 【已退役/隨包內置】VAD 現隨應用發佈（extraResources/sherpa/vad/silero_vad.onnx），
  // 運行時一律走 getFunasrVadModelPath()/isFunasrVadInstalled()，不再下載。
  // 此條目僅作為兼容舊版「曾下載到 funasr 根」的遺留元數據保留，UI 不再暴露下載入口。
  'silero-vad': {
    id: 'silero-vad',
    dirName: 'silero-vad',
    kind: 'vad',
    requiredFiles: ['silero_vad.onnx'],
    // 候選 URL 在運行時由 getFunasrFileUrls() 按可配置端點生成（鏡像/代理可在設置頁覆蓋）。
    files: [{ name: 'silero_vad.onnx' }],
  },
};

/**
 * files 模式下單個文件的運行時候選下載 URL（按序回退）。
 * 鏡像 / 代理 / GitHub base 均取自可配置的下載端點，用戶在設置頁改完即時生效。
 */
export function getFunasrFileUrls(
  id: FunasrModelId,
  fileName: string,
): string[] {
  if (id === 'silero-vad' && fileName === 'silero_vad.onnx') {
    const ep = getDownloadEndpoints();
    const ghRelease = `${ep.githubBase}/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx`;
    return [
      `${ep.huggingFaceMirror}/csukuangfj/vad/resolve/main/silero_vad.onnx`,
      ghRelease,
      `${ep.githubProxyPrefix}/${ghRelease}`,
      `${ep.huggingFaceOfficial}/csukuangfj/vad/resolve/main/silero_vad.onnx`,
    ];
  }
  return [];
}

export function getFunasrModelDir(id: FunasrModelId): string {
  const dir = path.join(getFunasrModelsRoot(), FUNASR_MODELS[id].dirName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isFunasrModelInstalled(id: FunasrModelId): boolean {
  const dir = path.join(getFunasrModelsRoot(), FUNASR_MODELS[id].dirName);
  return FUNASR_MODELS[id].requiredFiles.every((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

/**
 * 共享 silero VAD 的絕對路徑：隨應用內置（extraResources/sherpa/vad/silero_vad.onnx），
 * 不再依賴下載。funasr / qwen / fireRedAsr 共用這一份，與各引擎可自定義的模型根目錄解耦。
 */
export function getFunasrVadModelPath(): string {
  const { getExtraResourcesPath } =
    require('./utils') as typeof import('./utils');
  return resolveBundledVadPath(getExtraResourcesPath());
}

/** 共享 VAD 是否就緒：檢查隨包內置文件是否存在（正常安裝下恆為真）。 */
export function isFunasrVadInstalled(): boolean {
  return fs.existsSync(getFunasrVadModelPath());
}

/** 全部 ASR 模型 id（靜態，純函數，不觸磁盤）。 */
export function getFunasrAsrModelIds(): FunasrModelId[] {
  return (Object.keys(FUNASR_MODELS) as FunasrModelId[]).filter(
    (id) => FUNASR_MODELS[id].kind === 'asr',
  );
}

/** 已安裝的 ASR 模型 id（觸磁盤）。 */
export function getInstalledFunasrAsrModels(): FunasrModelId[] {
  return getFunasrAsrModelIds().filter((id) => isFunasrModelInstalled(id));
}

/**
 * 選定要使用的 ASR 模型（純函數）：
 * - requested 命中已裝 ASR → 用它；
 * - 否則回退首個已裝 ASR；
 * - 無已裝 ASR → null。
 */
export function resolveFunasrAsrSelection(
  requested: string | undefined,
  installedAsr: FunasrModelId[],
): { id: FunasrModelId; modelType: FunasrModelType } | null {
  if (installedAsr.length === 0) return null;
  const asrIds = getFunasrAsrModelIds();
  const normalized = (requested || '').toLowerCase();
  const chosen =
    asrIds.find((id) => id === normalized && installedAsr.includes(id)) ??
    installedAsr[0];
  return {
    id: chosen,
    modelType: FUNASR_MODELS[chosen].modelType ?? 'sense_voice',
  };
}

/** funasr 轉寫就緒 = 內置 VAD + 至少一個 ASR 模型已安裝。 */
export function isFunasrReady(): boolean {
  return isFunasrVadInstalled() && getInstalledFunasrAsrModels().length > 0;
}

export function deleteFunasrModel(id: FunasrModelId): void {
  const dir = path.join(getFunasrModelsRoot(), FUNASR_MODELS[id].dirName);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
