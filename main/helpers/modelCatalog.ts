import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { store } from './storeManager';
import { getPath } from './whisper';
import {
  cacheDirNameToModelId,
  hfRepoToCacheDirName,
  getCt2HfRepo,
} from './fasterWhisperModelCatalog';

/** ggml 路徑：語義不變，複用 getPath('modelsPath') */
export function getGgmlModelsPath(): string {
  return getPath('modelsPath') as string;
}

export function getFasterWhisperModelsPath(): string {
  const settings = store.get('settings');
  const userData = app.getPath('userData');
  const resolved =
    settings?.fasterWhisperModelsPath ||
    path.join(userData, 'faster-whisper-models');
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

/** HuggingFace Hub 標準緩存子目錄：{modelsPath}/hub/models--* */
export function getFasterWhisperHubDir(): string {
  const root = getFasterWhisperModelsPath();
  const hub = path.join(root, 'hub');
  if (!fs.existsSync(hub)) {
    fs.mkdirSync(hub, { recursive: true });
  }
  migrateLegacyCt2Layout(root, hub);
  return hub;
}

/** 將舊版 {root}/models--* 佈局遷移到 {root}/hub/models--* */
function migrateLegacyCt2Layout(root: string, hub: string): void {
  try {
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('models--')) continue;
      const src = path.join(root, entry);
      const dest = path.join(hub, entry);
      if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
      if (fs.existsSync(dest)) continue;
      fs.renameSync(src, dest);
    }
  } catch {
    // 忽略遷移失敗，不影響主流程
  }
}

export function toCt2CacheDirName(modelId: string): string {
  return hfRepoToCacheDirName(getCt2HfRepo(modelId));
}

export function getCt2ModelCacheDir(modelId: string): string {
  return path.join(getFasterWhisperHubDir(), toCt2CacheDirName(modelId));
}

/** 解析 UI 模型目錄下的 snapshot 絕對路徑（僅查 fasterWhisperModelsPath） */
export function resolveCt2ModelSnapshotDir(modelId: string): string | null {
  const dirName = toCt2CacheDirName(modelId);
  const snapshotRoots = [
    path.join(getFasterWhisperHubDir(), dirName, 'snapshots'),
    path.join(getFasterWhisperModelsPath(), dirName, 'snapshots'),
  ];

  for (const snapshotRoot of snapshotRoots) {
    if (!fs.existsSync(snapshotRoot)) continue;
    for (const rev of fs.readdirSync(snapshotRoot)) {
      const snapshotDir = path.join(snapshotRoot, rev);
      if (fs.existsSync(path.join(snapshotDir, 'model.bin'))) {
        return snapshotDir;
      }
    }
  }
  return null;
}

function snapshotDirHasModelBin(snapshotRoot: string): boolean {
  if (!fs.existsSync(snapshotRoot)) return false;
  for (const rev of fs.readdirSync(snapshotRoot)) {
    if (fs.existsSync(path.join(snapshotRoot, rev, 'model.bin'))) {
      return true;
    }
  }
  return false;
}

function collectInstalledFromHubLikeDir(
  hubDir: string,
  found: Set<string>,
): void {
  if (!fs.existsSync(hubDir)) return;
  for (const entry of fs.readdirSync(hubDir)) {
    const mapped = cacheDirNameToModelId(entry);
    if (!mapped) continue;
    const snapshotRoot = path.join(hubDir, entry, 'snapshots');
    if (snapshotDirHasModelBin(snapshotRoot)) {
      found.add(mapped);
    }
  }
}

/** 掃描 UI 模型目錄，返回邏輯模型 id 列表 */
export function getFasterWhisperModelsInstalled(): string[] {
  const root = getFasterWhisperModelsPath();
  const found = new Set<string>();

  collectInstalledFromHubLikeDir(getFasterWhisperHubDir(), found);
  collectInstalledFromHubLikeDir(root, found);

  return Array.from(found).sort();
}

/** ggml 模型名 → faster-whisper id */
export function toFasterWhisperModelId(ggmlName: string): string {
  const base = ggmlName
    .toLowerCase()
    .replace(/-q\d+_\d+$/, '')
    .replace(/\.en$/, '.en');
  const map: Record<string, string> = {
    'large-v3-turbo': 'distil-large-v3',
    'large-v3': 'large-v3',
    'large-v2': 'large-v2',
    'large-v1': 'large-v1',
  };
  return map[base] || base;
}
