import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as si from 'systeminformation';
import { logMessage } from './storeManager';
import { getExtraResourcesPath } from './utils';

/**
 * 異步執行外部命令（不阻塞主進程 event loop）。
 * GPU/CUDA 探測（nvcc / nvidia-smi）首次冷啟動可能耗時數秒，必須異步執行，
 * 否則同步 execSync 會卡死主進程，連帶阻塞所有併發 IPC（引擎/模型狀態等），UI 卡頓。
 */
const execAsync = promisify(exec);
import type {
  CudaEnvironment,
  CudaToolkitInfo,
  GpuCudaSupport,
  AddonRecommendation,
  CudaVersion,
  DevSimulationConfig,
  GpuEnvironment,
  GpuInfo,
  GpuVendor,
} from '../../types/addon';
import { AVAILABLE_CUDA_VERSIONS } from '../../types/addon';

/**
 * 開發模式模擬配置
 * 通過環境變量控制，僅在開發模式下生效
 */
export function getDevSimulationConfig(): DevSimulationConfig | null {
  // 僅在開發模式下啟用模擬
  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  if (process.env.DEV_SIMULATE_CUDA !== 'true') {
    return null;
  }

  return {
    enabled: true,
    platform:
      (process.env.DEV_SIMULATE_PLATFORM as 'win32' | 'linux') || 'win32',
    hasToolkit: process.env.DEV_SIMULATE_HAS_TOOLKIT === 'true',
    toolkitVersion: process.env.DEV_SIMULATE_CUDA_TOOLKIT || null,
    gpuCudaVersion: process.env.DEV_SIMULATE_GPU_CUDA_VERSION || '12.6',
    gpuName:
      process.env.DEV_SIMULATE_GPU_NAME ||
      'NVIDIA GeForce RTX 3080 (Simulated)',
  };
}

/**
 * 檢測 CUDA Toolkit 安裝情況
 * 通過檢測 nvcc 命令來判斷
 */
export async function getCudaToolkitInfo(): Promise<CudaToolkitInfo> {
  // 檢查開發模式模擬
  const simConfig = getDevSimulationConfig();
  if (simConfig?.enabled) {
    logMessage('[Dev Simulation] Using simulated CUDA Toolkit info', 'info');
    return {
      installed: simConfig.hasToolkit,
      version: simConfig.toolkitVersion,
    };
  }

  // 僅支持 Windows 和 Linux 平臺
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return { installed: false, version: null };
  }

  try {
    const { stdout: nvccOutput } = await execAsync('nvcc --version', {
      encoding: 'utf8',
      timeout: 5000,
    });

    // 解析 nvcc 輸出獲取版本號
    // 示例輸出: "Cuda compilation tools, release 12.4, V12.4.99"
    const versionMatch = nvccOutput.match(/release (\d+\.\d+)/i);
    if (versionMatch) {
      const majorMinor = versionMatch[1];
      // 補充完整版本號
      const fullVersionMatch = nvccOutput.match(/V(\d+\.\d+\.\d+)/);
      const version = fullVersionMatch
        ? fullVersionMatch[1]
        : `${majorMinor}.0`;

      logMessage(`CUDA Toolkit detected: ${version}`, 'info');
      return { installed: true, version };
    }

    return { installed: true, version: null };
  } catch {
    logMessage('CUDA Toolkit not detected (nvcc not found)', 'info');
    return { installed: false, version: null };
  }
}

/**
 * 檢測 GPU CUDA 支持情況
 * 通過 nvidia-smi 命令來判斷
 */
export async function getGpuCudaSupport(): Promise<GpuCudaSupport> {
  // 檢查開發模式模擬
  const simConfig = getDevSimulationConfig();
  if (simConfig?.enabled) {
    logMessage('[Dev Simulation] Using simulated GPU CUDA support', 'info');
    return {
      supported: true,
      driverVersion: '535.104.05',
      maxCudaVersion: simConfig.gpuCudaVersion,
      gpuName: simConfig.gpuName,
    };
  }

  // 僅支持 Windows 和 Linux 平臺
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return { supported: false, driverVersion: null, maxCudaVersion: null };
  }

  // 優先使用機器可讀查詢獲取顯卡名與驅動版本：
  // 跨驅動版本、跨語言環境最穩定，且不會像解析表格那樣誤匹配到進程行
  let gpuName: string | undefined;
  let driverVersion: string | null = null;
  try {
    const queryOutput = (
      await execAsync(
        'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader,nounits',
        { encoding: 'utf8', timeout: 10000 },
      )
    ).stdout.trim();
    const firstLine = queryOutput.split('\n').find((line) => line.trim());
    if (firstLine) {
      const [queriedName, queriedDriver] = firstLine
        .split(',')
        .map((field) => field.trim());
      gpuName = queriedName || undefined;
      driverVersion = queriedDriver || null;
    }
  } catch {
    // 查詢接口不可用時，下面回退到解析 nvidia-smi 文本輸出
  }

  // 解析顯卡支持的最高 CUDA 版本（--query-gpu 無此字段，只能從 nvidia-smi 表頭讀取）
  let maxCudaVersion: string | null = null;
  try {
    const { stdout: nsmiResult } = await execAsync('nvidia-smi', {
      encoding: 'utf8',
      timeout: 10000,
    });

    // 600 系列及以上驅動已將 "CUDA Version" 更名為 "CUDA UMD Version"，需同時兼容
    const cudaVersionMatch = nsmiResult.match(
      /CUDA(?:\s+UMD)?\s+Version\s*:\s*(\d+(?:\.\d+)?)/i,
    );
    maxCudaVersion = cudaVersionMatch ? cudaVersionMatch[1] : null;

    // 查詢接口失敗時從表格兜底補全驅動版本：
    // 兼容新版 "KMD Version" 與舊版 "Driver Version"，允許 2~3 段版本號（如 610.47）
    if (!driverVersion) {
      const driverVersionMatch = nsmiResult.match(
        /(?:KMD|Driver)\s+Version\s*:\s*(\d+(?:\.\d+)+)/i,
      );
      driverVersion = driverVersionMatch ? driverVersionMatch[1] : null;
    }

    // 查詢接口失敗時從表格兜底補全顯卡名稱：限定 NVIDIA 開頭，避免誤匹配進程行
    if (!gpuName) {
      const gpuNameMatch = nsmiResult.match(
        /\|\s*\d+\s+(NVIDIA[^|]+?)\s+(?:On|Off|N\/A)/i,
      );
      gpuName = gpuNameMatch ? gpuNameMatch[1].trim() : undefined;
    }
  } catch {
    // bare nvidia-smi 不可用時，maxCudaVersion 保持 null
  }

  // 只要檢測到 NVIDIA 顯卡（拿到名稱或驅動版本）即視為支持 CUDA，
  // 即使因輸出格式變化導致 CUDA 版本解析失敗，也不再誤判為"不支持"
  const hasNvidiaGpu = !!gpuName || !!driverVersion;
  const supported = !!maxCudaVersion || hasNvidiaGpu;

  if (!supported) {
    logMessage(
      'GPU CUDA support not detected (no NVIDIA GPU found via nvidia-smi)',
      'info',
    );
    return { supported: false, driverVersion: null, maxCudaVersion: null };
  }

  logMessage(
    `GPU CUDA support detected: maxCuda=${maxCudaVersion}, driver=${driverVersion}, gpu=${gpuName}`,
    'info',
  );

  return {
    supported,
    driverVersion,
    maxCudaVersion,
    gpuName,
  };
}

/**
 * 比較版本號
 * @returns 負數表示 v1 < v2, 0 表示相等, 正數表示 v1 > v2
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) {
      return p1 - p2;
    }
  }
  return 0;
}

/**
 * 提取版本號的 major.minor 部分
 * 例如 "13.0.2" -> "13.0", "12.4.0" -> "12.4"
 */
function getMajorMinor(version: string): string {
  const parts = version.split('.');
  return `${parts[0] || '0'}.${parts[1] || '0'}`;
}

/**
 * 獲取推薦的加速包版本
 * 根據用戶的 CUDA 版本，找到最合適的可用版本
 *
 * nvidia-smi 報告的 CUDA 版本 (如 "13.0") 表示驅動支持的最高 CUDA 運行時版本族，
 * 即 13.0.x 系列的補丁版本都是兼容的。因此匹配時只比較 major.minor，忽略 patch。
 *
 * 同時，新架構的 GPU（如 Blackwell）可能不被舊版 CUDA toolkit 支持，
 * 所以在兼容範圍內優先推薦最高版本。
 *
 * @param userCudaVersion 用戶的 CUDA 版本 (如 "12.6" 或 "13.0")
 * @returns 推薦的加速包版本，如果沒有合適的則返回 null
 */
export function getRecommendedAddonVersion(
  userCudaVersion: string,
): CudaVersion | null {
  const userMajorMinor = getMajorMinor(userCudaVersion);

  // 從高到低遍歷可用版本，找到第一個 major.minor 不超過用戶版本的
  // 這樣同系列的 patch 版本（如 13.0.2 對應驅動 13.0）也能正確匹配
  for (const version of [...AVAILABLE_CUDA_VERSIONS].reverse()) {
    const addonMajorMinor = getMajorMinor(version);
    if (compareVersions(addonMajorMinor, userMajorMinor) <= 0) {
      return version;
    }
  }

  return null;
}

/**
 * 獲取加速包推薦信息
 */
function getAddonRecommendation(
  toolkit: CudaToolkitInfo,
  gpuSupport: GpuCudaSupport,
): AddonRecommendation {
  // 未檢測到 NVIDIA 顯卡時無法使用加速
  if (!gpuSupport.supported) {
    return {
      canUseCuda: false,
      recommendedVersion: null,
      needsDlls: false,
      downloadType: null,
      reason: 'GPU 不支持 CUDA 或未檢測到 NVIDIA 顯卡',
      reasonKey: 'cudaNotSupported',
    };
  }

  // 兜底：檢測到 N 卡但未能解析出最高 CUDA 版本時（如新版驅動輸出格式變化），
  // 按可用加速包的最高版本推薦，避免誤判為不可用；用戶可在異常時手動改選更低版本
  const effectiveCudaVersion =
    gpuSupport.maxCudaVersion ||
    AVAILABLE_CUDA_VERSIONS[AVAILABLE_CUDA_VERSIONS.length - 1];

  // 獲取推薦版本
  const recommendedVersion = getRecommendedAddonVersion(effectiveCudaVersion);

  if (!recommendedVersion) {
    return {
      canUseCuda: false,
      recommendedVersion: null,
      needsDlls: false,
      downloadType: null,
      reason: `顯卡支持的 CUDA 版本 (${gpuSupport.maxCudaVersion}) 低於最低要求 (11.8.0)`,
      reasonKey: 'cudaVersionTooOld',
    };
  }

  // 判斷是否需要下載帶 DLLs 的包
  // 如果用戶已安裝 CUDA Toolkit，只需下載 addon.node
  // 如果未安裝，需要下載包含運行時庫的完整包
  const needsDlls = !toolkit.installed;
  const downloadType = needsDlls ? 'tar.gz' : 'node.gz';

  let reason: string;
  let reasonKey: AddonRecommendation['reasonKey'];
  if (!gpuSupport.maxCudaVersion) {
    reason = `未能識別顯卡支持的最高 CUDA 版本，已按最高加速包版本推薦；若運行異常請手動選擇更低版本`;
    reasonKey = 'maxCudaUnknown';
  } else if (toolkit.installed) {
    reason = `已檢測到 CUDA Toolkit ${toolkit.version}，推薦下載輕量版加速包`;
    reasonKey = 'toolkitInstalled';
  } else {
    reason = `未檢測到 CUDA Toolkit，推薦下載包含運行時庫的完整加速包`;
    reasonKey = 'toolkitMissing';
  }

  return {
    canUseCuda: true,
    recommendedVersion,
    needsDlls,
    downloadType,
    reason,
    reasonKey,
  };
}

/**
 * 獲取完整的 CUDA 環境信息
 * 這是主要的對外接口
 */
export async function getCudaEnvironment(): Promise<CudaEnvironment> {
  const cudaToolkit = await getCudaToolkitInfo();
  const gpuSupport = await getGpuCudaSupport();
  const recommendation = getAddonRecommendation(cudaToolkit, gpuSupport);

  logMessage(
    `CUDA Environment: toolkit=${JSON.stringify(cudaToolkit)}, gpu=${JSON.stringify(gpuSupport)}, recommendation=${JSON.stringify(recommendation)}`,
    'info',
  );

  return {
    cudaToolkit,
    gpuSupport,
    recommendation,
  };
}

/**
 * 檢查系統是否支持 CUDA 並返回支持的版本
 * @deprecated 請使用 getCudaEnvironment() 獲取更詳細的信息
 */
export async function checkCudaSupport(): Promise<string | false> {
  const env = await getCudaEnvironment();

  if (!env.recommendation.canUseCuda) {
    return false;
  }

  return env.recommendation.recommendedVersion || false;
}

/**
 * 檢查當前平臺是否可能支持 CUDA
 */
export function isPlatformCudaCapable(): boolean {
  // 檢查開發模式模擬
  const simConfig = getDevSimulationConfig();
  if (simConfig?.enabled) {
    return simConfig.platform === 'win32' || simConfig.platform === 'linux';
  }

  return process.platform === 'win32' || process.platform === 'linux';
}

/**
 * 獲取當前有效的平臺
 * 在開發模式模擬時返回模擬平臺
 */
export function getEffectivePlatform(): NodeJS.Platform {
  const simConfig = getDevSimulationConfig();
  if (simConfig?.enabled) {
    return simConfig.platform;
  }
  return process.platform;
}

/**
 * 歸一化 GPU 廠商
 */
function normalizeGpuVendor(vendor: string, model: string): GpuVendor {
  const s = `${vendor} ${model}`.toLowerCase();
  if (
    s.includes('nvidia') ||
    s.includes('geforce') ||
    s.includes('quadro') ||
    s.includes('tesla')
  ) {
    return 'nvidia';
  }
  if (
    s.includes('amd') ||
    s.includes('radeon') ||
    s.includes('advanced micro')
  ) {
    return 'amd';
  }
  if (s.includes('intel')) {
    return 'intel';
  }
  if (s.includes('apple')) {
    return 'apple';
  }
  return 'unknown';
}

/**
 * 枚舉顯卡（systeminformation，跨平臺），帶 10s 超時與 dev 模擬
 */
async function detectGpus(): Promise<GpuInfo[]> {
  const simConfig = getDevSimulationConfig();
  if (simConfig?.enabled) {
    return [{ name: simConfig.gpuName, vendor: 'nvidia' }];
  }

  if (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_SIMULATE_GPU_VENDOR
  ) {
    const vendor = process.env.DEV_SIMULATE_GPU_VENDOR as GpuVendor;
    return [{ name: `Simulated ${vendor.toUpperCase()} GPU`, vendor }];
  }

  try {
    const graphics = await Promise.race([
      si.graphics(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GPU detection timeout')), 10000),
      ),
    ]);
    return (graphics.controllers || [])
      .filter((c) => c.model || c.vendor)
      .map((c) => ({
        name: c.model || c.vendor || 'Unknown GPU',
        vendor: normalizeGpuVendor(c.vendor || '', c.model || ''),
      }));
  } catch (error) {
    logMessage(`GPU enumeration failed: ${error}`, 'warning');
    return [];
  }
}

/**
 * 檢測 Vulkan 運行庫是否存在（純文件檢查，毫秒級，不調用 vulkaninfo）
 */
export function detectVulkanRuntime(): boolean {
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_SIMULATE_VULKAN
  ) {
    return process.env.DEV_SIMULATE_VULKAN === 'true';
  }
  // dev 平臺模擬時本機文件檢查無意義，預設按可用處理（可用 DEV_SIMULATE_VULKAN=false 覆蓋）
  if (getDevSimulationConfig()?.enabled) {
    return true;
  }

  const platform = getEffectivePlatform();
  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    return fs.existsSync(path.join(systemRoot, 'System32', 'vulkan-1.dll'));
  }
  if (platform === 'linux') {
    const commonPaths = [
      '/usr/lib/x86_64-linux-gnu/libvulkan.so.1',
      '/usr/lib64/libvulkan.so.1',
      '/usr/lib/libvulkan.so.1',
    ];
    if (commonPaths.some((p) => fs.existsSync(p))) {
      return true;
    }
    try {
      const out = execSync('ldconfig -p', { encoding: 'utf8', timeout: 5000 });
      return out.includes('libvulkan.so.1');
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 內置 Vulkan addon 路徑（CI 預置；macOS / 開發環境通常不存在）
 */
export function getBuiltinVulkanAddonPath(): string {
  return path.join(getExtraResourcesPath(), 'addons', 'addon.vulkan.node');
}

let cachedGpuEnvironment: GpuEnvironment | null = null;

/**
 * 獲取完整 GPU 環境（跨廠商）。結果會話級緩存，forceRefresh 重新檢測。
 */
export async function getGpuEnvironment(
  forceRefresh = false,
): Promise<GpuEnvironment> {
  if (cachedGpuEnvironment && !forceRefresh) {
    return cachedGpuEnvironment;
  }

  const platform = getEffectivePlatform();
  const gpus = await detectGpus();
  const vulkanRuntime = isPlatformCudaCapable() ? detectVulkanRuntime() : false;
  const builtinVulkanAvailable =
    isPlatformCudaCapable() && fs.existsSync(getBuiltinVulkanAddonPath());

  // NVIDIA 詳細檢測：檢測到 N 卡、枚舉失敗（空列表，nvidia-smi 兜底）或 dev 模擬時執行
  const hasNvidia = gpus.some((g) => g.vendor === 'nvidia');
  const shouldProbeNvidia =
    isPlatformCudaCapable() &&
    (hasNvidia || gpus.length === 0 || !!getDevSimulationConfig()?.enabled);
  const nvidia = shouldProbeNvidia ? await getCudaEnvironment() : null;

  cachedGpuEnvironment = {
    platform,
    gpus,
    vulkanRuntime,
    builtinVulkanAvailable,
    nvidia,
  };
  logMessage(
    `GPU Environment: ${JSON.stringify({ ...cachedGpuEnvironment, nvidia: nvidia ? 'detected' : null })}`,
    'info',
  );
  return cachedGpuEnvironment;
}

export function clearGpuEnvironmentCache(): void {
  cachedGpuEnvironment = null;
}
