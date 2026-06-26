import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type {
  PyEngineManifest,
  PyEngineId,
  PyEngineVariant,
} from '../../../types/engine';
import { resolveReleaseBaseUrl } from '../download/sources';

/** 獨立發佈倉庫：https://github.com/stevenyangtw/smartsub-py-engine */
export const PY_ENGINE_REPO = 'stevenyangtw/smartsub-py-engine';

/** 滾動 latest Release，SmartSub 始終從此 tag 拉取最新構建 */
export const PY_ENGINE_TAG = 'latest';

export function getPyEngineArtifactSuffix(): string {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  }
  if (process.platform === 'win32') return 'windows-x64';
  if (process.platform === 'linux') return 'linux-x64';
  throw new Error(`Unsupported platform: ${process.platform}`);
}

/**
 * Full GPU(CUDA12) 變體僅在 windows-x64 / linux-x64 發佈（引擎倉 release.yml 的 gpu:true 平臺）。
 * macOS 無 NVIDIA CUDA，恆為 cpu 包。
 */
export function isPyEngineVariantSupported(variant: PyEngineVariant): boolean {
  if (variant === 'cpu') return true;
  return process.platform === 'win32' || process.platform === 'linux';
}

/** 規整變體：在不支持 cuda 的平臺上把 'cuda' 收斂為 'cpu'，其餘原樣返回。 */
export function normalizePyEngineVariant(
  variant: PyEngineVariant | undefined | null,
): PyEngineVariant {
  const v: PyEngineVariant = variant === 'cuda' ? 'cuda' : 'cpu';
  return isPyEngineVariantSupported(v) ? v : 'cpu';
}

/** GitCode 鏡像 owner 與 GitHub 不同（buxuku1），repo 名相同。 */
const PY_ENGINE_REPO_SLUGS = {
  github: PY_ENGINE_REPO,
  gitcode: 'buxuku1/smartsub-py-engine',
};

export function getPyEngineReleaseBaseUrl(
  source: 'github' | 'ghproxy' | 'gitcode',
  tag: string = PY_ENGINE_TAG,
): string {
  return resolveReleaseBaseUrl(source, PY_ENGINE_REPO_SLUGS, tag);
}

export function getPyEngineChecksumsUrl(
  source: 'github' | 'ghproxy' | 'gitcode',
  tag: string = PY_ENGINE_TAG,
): string {
  return `${getPyEngineReleaseBaseUrl(source, tag)}/checksums.sha256`;
}

export function getPyEngineManifestUrl(
  source: 'github' | 'ghproxy' | 'gitcode',
  tag: string = PY_ENGINE_TAG,
): string {
  return `${getPyEngineReleaseBaseUrl(source, tag)}/manifest.json`;
}

// ============================================================================
// faster-whisper 單自包含運行時：內嵌 PBS 解釋器 + site-packages + main.py
// （舊的「內置基座(Layer1) + 可重定位引擎包(Layer2)」兩層已塌縮為一個可下載運行時；
//   不再有可單獨下載/內置的 Python 基座。）
// ============================================================================

const DEFAULT_ENGINE_ID: PyEngineId = 'faster-whisper';

/**
 * 運行時內嵌 python 解釋器路徑（PBS 佈局，按平臺）：
 * win=<runtime>\python.exe，unix=<runtime>/bin/python3。
 */
export function getRuntimePythonPath(runtimeDir: string): string {
  return process.platform === 'win32'
    ? path.join(runtimeDir, 'python.exe')
    : path.join(runtimeDir, 'bin', 'python3');
}

/** 所有引擎運行時的根目錄：userData/py-engines */
export function getPyEnginesRoot(): string {
  return path.join(app.getPath('userData'), 'py-engines');
}

/** 單個引擎運行時目錄：userData/py-engines/<engineId> */
export function getEngineDir(engineId: PyEngineId = DEFAULT_ENGINE_ID): string {
  return path.join(getPyEnginesRoot(), engineId);
}

/** 運行時 site-packages（spawn 內嵌 python 時掛到 PYTHONPATH） */
export function getEngineSitePackages(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): string {
  return path.join(getEngineDir(engineId), 'site-packages');
}

/** 運行時入口 main.py */
export function getEngineMainPy(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): string {
  return path.join(getEngineDir(engineId), 'main.py');
}

/**
 * 運行時就緒 = 內嵌解釋器 + main.py + site-packages 三者俱在。
 * 自包含運行時不依賴任何外部基座，故內嵌解釋器存在與否是關鍵判據。
 */
export function isRuntimeInstalled(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): boolean {
  return (
    fs.existsSync(getRuntimePythonPath(getEngineDir(engineId))) &&
    fs.existsSync(getEngineMainPy(engineId)) &&
    fs.existsSync(getEngineSitePackages(engineId))
  );
}

export function getEngineManifestPath(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): string {
  return path.join(getEngineDir(engineId), 'manifest.json');
}

export function readEngineManifest(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): PyEngineManifest | null {
  const p = getEngineManifestPath(engineId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PyEngineManifest;
  } catch {
    return null;
  }
}

export function writeEngineManifest(
  manifest: PyEngineManifest,
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): void {
  const dir = getEngineDir(engineId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    getEngineManifestPath(engineId),
    JSON.stringify(manifest, null, 2),
  );
}

/** 已安裝變體：讀本地 manifest.variant，缺失（老安裝/未裝）按 'cpu' 兜底。 */
export function getInstalledVariant(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
): PyEngineVariant {
  return normalizePyEngineVariant(readEngineManifest(engineId)?.variant);
}

/**
 * 運行時產物名：smartsub-faster-whisper-runtime-<suffix>[-cuda].tar.gz（與引擎倉 release.yml 一致）。
 * cpu 變體不帶後綴（即原產物名，保證向後兼容）；cuda 變體追加 -cuda。
 */
export function getEngineArtifactName(
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
  variant: PyEngineVariant = 'cpu',
): string {
  const variantSuffix =
    normalizePyEngineVariant(variant) === 'cuda' ? '-cuda' : '';
  return `smartsub-${engineId}-runtime-${getPyEngineArtifactSuffix()}${variantSuffix}.tar.gz`;
}

export function getEngineDownloadUrl(
  source: 'github' | 'ghproxy' | 'gitcode',
  engineId: PyEngineId = DEFAULT_ENGINE_ID,
  variant: PyEngineVariant = 'cpu',
  tag: string = PY_ENGINE_TAG,
): string {
  return `${getPyEngineReleaseBaseUrl(source, tag)}/${getEngineArtifactName(engineId, variant)}`;
}
