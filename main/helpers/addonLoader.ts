import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { store, logMessage } from './storeManager';
import { getExtraResourcesPath, isAppleSilicon } from './utils';
import {
  getEffectivePlatform,
  getGpuEnvironment,
  getBuiltinVulkanAddonPath,
} from './cudaUtils';
import {
  getSelectedAddonVersion,
  isAddonInstalled,
  getAddonVersionDir,
  hasDependentLibs,
  getCustomAddonPath,
} from './addonManager';
import type {
  AddonVariant,
  GpuMode,
  WhisperBackend,
  AddonSource,
  AddonLoadAttempt,
  AddonLoadResultInfo,
  AddonFallbackEvent,
  AddonLoadHistoryEntry,
} from '../../types/addon';

type WhisperFn = (
  params: Record<string, unknown>,
  callback: (error: Error | null, result?: unknown) => void,
) => void;

export type WhisperAsyncFn = (params: Record<string, unknown>) => Promise<any>;

export interface AddonLoadResult extends AddonLoadResultInfo {
  whisperAsync: WhisperAsyncFn;
}

export interface LoadContext {
  gpuMode: GpuMode;
  /** Apple Silicon 且當前模型存在 encoder（CoreML 可用） */
  coremlEligible: boolean;
}

interface AddonCandidate {
  backend: WhisperBackend;
  variant: AddonVariant | null;
  source: AddonSource;
  path: string;
}

let cachedResult: AddonLoadResult | null = null;
let cachedKey: string | null = null;
const notifiedFallbackReasons = new Set<string>();
let fallbackNotifier: ((event: AddonFallbackEvent) => void) | null = null;
let loadResultNotifier: ((info: AddonLoadResultInfo) => void) | null = null;

export function setFallbackNotifier(
  fn: (event: AddonFallbackEvent) => void,
): void {
  fallbackNotifier = fn;
}

export function setLoadResultNotifier(
  fn: (info: AddonLoadResultInfo) => void,
): void {
  loadResultNotifier = fn;
}

export function clearAddonLoadCache(): void {
  cachedResult = null;
  cachedKey = null;
}

function builtinAddonPath(file: string): string {
  return path.join(getExtraResourcesPath(), 'addons', file);
}

/**
 * 設置動態鏈接庫搜索路徑（必須在 dlopen 之前調用）
 */
function setupLibraryPath(addonDir: string): void {
  const platform = getEffectivePlatform();
  const absoluteAddonDir = path.resolve(addonDir);

  if (platform === 'win32') {
    const currentPath = process.env.PATH || '';
    if (!currentPath.includes(absoluteAddonDir)) {
      process.env.PATH = `${absoluteAddonDir};${currentPath}`;
      logMessage(`Added ${absoluteAddonDir} to PATH for DLL loading`, 'info');
    }
  } else if (platform === 'linux') {
    const currentLdPath = process.env.LD_LIBRARY_PATH || '';
    if (!currentLdPath.includes(absoluteAddonDir)) {
      process.env.LD_LIBRARY_PATH = `${absoluteAddonDir}:${currentLdPath}`;
      logMessage(
        `Added ${absoluteAddonDir} to LD_LIBRARY_PATH for SO loading`,
        'info',
      );
    }
  }
}

/**
 * 按推薦矩陣生成加載候選列表
 *
 * win/linux auto：custom → selected（CUDA 需 N 卡驅動可用）→ userData vulkan → 內置 vulkan → 內置 CPU
 * win/linux gpu-only：同 auto 但去掉內置 CPU
 * win/linux cpu-only：僅內置 CPU
 * darwin：custom → CoreML（可用時）→ 內置（arm64 為 Metal，intel 為 CPU），不受 gpuMode 影響
 */
async function resolveCandidates(ctx: LoadContext): Promise<AddonCandidate[]> {
  const platform = getEffectivePlatform();
  const candidates: AddonCandidate[] = [];
  const builtinDefault: AddonCandidate = {
    backend: platform === 'darwin' && isAppleSilicon() ? 'metal' : 'cpu',
    variant: null,
    source: 'builtin',
    path: builtinAddonPath('addon.node'),
  };

  if (platform === 'darwin') {
    const customPath = getCustomAddonPath();
    if (customPath) {
      candidates.push({
        backend: 'custom',
        variant: null,
        source: 'custom',
        path: customPath,
      });
    }
    if (ctx.coremlEligible) {
      candidates.push({
        backend: 'coreml',
        variant: null,
        source: 'builtin',
        path: builtinAddonPath('addon.coreml.node'),
      });
    }
    candidates.push(builtinDefault);
    return candidates;
  }

  if (ctx.gpuMode === 'cpu-only') {
    return [builtinDefault];
  }

  // custom 無條件最高優先級（修復舊版非 NVIDIA 環境忽略自定義路徑的問題）
  const customPath = getCustomAddonPath();
  if (customPath) {
    candidates.push({
      backend: 'custom',
      variant: null,
      source: 'custom',
      path: customPath,
    });
  }

  const gpuEnv = await getGpuEnvironment();
  const selected = getSelectedAddonVersion();

  if (selected && isAddonInstalled(selected)) {
    if (selected === 'vulkan') {
      candidates.push({
        backend: 'vulkan',
        variant: 'vulkan',
        source: 'userData',
        path: path.join(getAddonVersionDir('vulkan'), 'addon.node'),
      });
    } else if (gpuEnv.nvidia?.gpuSupport.supported) {
      candidates.push({
        backend: 'cuda',
        variant: selected,
        source: 'userData',
        path: path.join(getAddonVersionDir(selected), 'addon.node'),
      });
    } else {
      logMessage(
        `Selected CUDA addon ${selected} skipped: no NVIDIA GPU detected`,
        'warning',
      );
    }
  }

  // 已下載到 userData 的 Vulkan（比內置新），未被 selected 命中時作為次級候選
  if (selected !== 'vulkan' && isAddonInstalled('vulkan')) {
    candidates.push({
      backend: 'vulkan',
      variant: 'vulkan',
      source: 'userData',
      path: path.join(getAddonVersionDir('vulkan'), 'addon.node'),
    });
  }

  // 內置 Vulkan：不預過濾 vulkanRuntime（檢測僅供 UI 診斷），由 dlopen try/catch 兜底
  const builtinVulkan = getBuiltinVulkanAddonPath();
  if (fs.existsSync(builtinVulkan)) {
    candidates.push({
      backend: 'vulkan',
      variant: 'vulkan',
      source: 'builtin',
      path: builtinVulkan,
    });
  }

  if (ctx.gpuMode === 'auto') {
    candidates.push(builtinDefault);
  }

  return candidates;
}

/**
 * 嘗試加載單個候選（調用方負責 try/catch）
 */
function tryLoadCandidate(candidate: AddonCandidate): WhisperFn {
  if (!fs.existsSync(candidate.path)) {
    throw new Error(`Addon not found: ${candidate.path}`);
  }
  const dir = path.dirname(candidate.path);
  if (hasDependentLibs(dir)) {
    setupLibraryPath(dir);
  }
  const module = { exports: { whisper: null } };
  process.dlopen(module, candidate.path);
  if (typeof module.exports.whisper !== 'function') {
    throw new Error(`Addon loaded but exports no whisper(): ${candidate.path}`);
  }
  return module.exports.whisper as WhisperFn;
}

function pushHistory(entry: AddonLoadHistoryEntry): void {
  const history: AddonLoadHistoryEntry[] = store.get('addonLoadHistory') || [];
  history.push(entry);
  while (history.length > 10) {
    history.shift();
  }
  store.set('addonLoadHistory', history);
}

function notifyFallback(
  expected: AddonCandidate,
  actual: AddonCandidate,
  attempts: AddonLoadAttempt[],
): void {
  const reasonKey = `${expected.backend}->${actual.backend}:${attempts[0]?.error || ''}`;
  if (notifiedFallbackReasons.has(reasonKey)) {
    return;
  }
  notifiedFallbackReasons.add(reasonKey);
  fallbackNotifier?.({
    expected: expected.backend,
    actual: actual.backend,
    reason: attempts[0]?.error || 'unknown',
  });
}

/**
 * 加載最優可用 addon（核心入口）
 *
 * 候選逐個 try/catch dlopen；成功結果會話級緩存（緩存 key 覆蓋全部決策輸入，
 * 設置變更後 key 變化自動重新解析，無需手動失效）。
 */
export async function loadBestAddon(
  ctx: LoadContext,
): Promise<AddonLoadResult> {
  const cacheKey = JSON.stringify({
    gpuMode: ctx.gpuMode,
    coremlEligible: ctx.coremlEligible,
    selected: getSelectedAddonVersion(),
    custom: getCustomAddonPath(),
  });
  if (cachedResult && cachedKey === cacheKey) {
    return cachedResult;
  }

  const candidates = await resolveCandidates(ctx);
  if (candidates.length === 0) {
    throw new Error('No addon candidates available');
  }
  logMessage(
    `Addon candidates: ${candidates.map((c) => `${c.backend}(${c.source})`).join(' -> ')}`,
    'info',
  );

  const failedAttempts: AddonLoadAttempt[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const whisper = tryLoadCandidate(candidate);
      const loadedAt = new Date().toISOString();
      const result: AddonLoadResult = {
        whisperAsync: promisify(whisper) as WhisperAsyncFn,
        backend: candidate.backend,
        variant: candidate.variant,
        source: candidate.source,
        path: candidate.path,
        fallback: i > 0,
        failedAttempts,
        loadedAt,
      };
      logMessage(
        `Whisper addon loaded: backend=${candidate.backend} source=${candidate.source} path=${candidate.path} fallback=${result.fallback}`,
        'info',
      );
      pushHistory({
        backend: candidate.backend,
        path: candidate.path,
        success: true,
        timestamp: loadedAt,
      });
      const { whisperAsync: _fn, ...info } = result;
      store.set('lastAddonLoadResult', info);
      loadResultNotifier?.(info);
      if (result.fallback) {
        notifyFallback(candidates[0], candidate, failedAttempts);
      }
      cachedResult = result;
      cachedKey = cacheKey;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logMessage(
        `Failed to load addon candidate (${candidate.backend} @ ${candidate.path}): ${message}`,
        'warning',
      );
      const timestamp = new Date().toISOString();
      failedAttempts.push({
        backend: candidate.backend,
        path: candidate.path,
        error: message,
        timestamp,
      });
      pushHistory({
        backend: candidate.backend,
        path: candidate.path,
        success: false,
        error: message,
        timestamp,
      });
    }
  }

  const summary = failedAttempts
    .map((a) => `${a.backend}: ${a.error}`)
    .join('; ');
  if (ctx.gpuMode === 'gpu-only') {
    throw new Error(
      `GPU acceleration unavailable in GPU-only mode. ${summary}`,
    );
  }
  throw new Error(`Failed to load whisper addon. ${summary}`);
}

/**
 * 當前生效的後端（無內存緩存時回退到持久化的最近一次結果）
 */
export function getActiveBackend(): AddonLoadResultInfo | null {
  if (cachedResult) {
    const { whisperAsync: _fn, ...info } = cachedResult;
    return info;
  }
  return store.get('lastAddonLoadResult') || null;
}
