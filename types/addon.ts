/**
 * CUDA 加速包相關類型定義
 */

/**
 * 可用的 CUDA 加速包版本
 */
export const AVAILABLE_CUDA_VERSIONS = [
  '11.8.0',
  '12.2.0',
  '12.4.0',
  '13.0.2',
] as const;

export type CudaVersion = (typeof AVAILABLE_CUDA_VERSIONS)[number];

/**
 * 全部加速包變體：CUDA 各版本 + Vulkan
 */
export const ALL_ADDON_VARIANTS = [
  ...AVAILABLE_CUDA_VERSIONS,
  'vulkan',
] as const;

export type AddonVariant = (typeof ALL_ADDON_VARIANTS)[number];

/**
 * GPU 加速模式（取代 useCuda 布爾開關）
 */
export type GpuMode = 'auto' | 'gpu-only' | 'cpu-only';

/**
 * GPU 廠商
 */
export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown';

export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
}

/**
 * 實際加載的 whisper 後端
 */
export type WhisperBackend =
  | 'cuda'
  | 'vulkan'
  | 'cpu'
  | 'metal'
  | 'coreml'
  | 'custom';

export type AddonSource = 'custom' | 'userData' | 'builtin';

/**
 * 單次候選加載失敗記錄
 */
export interface AddonLoadAttempt {
  backend: WhisperBackend;
  path: string;
  error: string;
  timestamp: string;
}

/**
 * 一次成功加載的結果（不含函數本體，可持久化/IPC 傳輸）
 */
export interface AddonLoadResultInfo {
  backend: WhisperBackend;
  variant: AddonVariant | null;
  source: AddonSource;
  path: string;
  /** 是否非首選候選（發生過降級） */
  fallback: boolean;
  failedAttempts: AddonLoadAttempt[];
  loadedAt: string;
}

/**
 * 加載歷史條目（環形緩衝 10 條，診斷面板數據源）
 */
export interface AddonLoadHistoryEntry {
  backend: WhisperBackend;
  path: string;
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * 降級事件（主進程 → 渲染層推送）
 */
export interface AddonFallbackEvent {
  expected: WhisperBackend;
  actual: WhisperBackend;
  reason: string;
}

/**
 * CUDA Toolkit 檢測結果
 */
export interface CudaToolkitInfo {
  /** 是否已安裝 CUDA Toolkit */
  installed: boolean;
  /** CUDA Toolkit 版本號 (如 "12.4.0") */
  version: string | null;
}

/**
 * GPU CUDA 支持檢測結果
 */
export interface GpuCudaSupport {
  /** 顯卡是否支持 CUDA */
  supported: boolean;
  /** 顯卡驅動版本 */
  driverVersion: string | null;
  /** 顯卡支持的最高 CUDA 版本 */
  maxCudaVersion: string | null;
  /** 顯卡名稱 */
  gpuName?: string;
}

/**
 * 加速包推薦信息
 */
export interface AddonRecommendation {
  /** 是否可以使用 CUDA 加速 */
  canUseCuda: boolean;
  /** 推薦的加速包版本 */
  recommendedVersion: CudaVersion | null;
  /** 是否需要下載包含 DLLs 的完整包 */
  needsDlls: boolean;
  /** 推薦的下載包類型 */
  downloadType: 'node.gz' | 'tar.gz' | null;
  /** 推薦原因說明（日誌/診斷，UI 請用 reasonKey） */
  reason?: string;
  /** 推薦原因 i18n 鍵 */
  reasonKey?:
    | 'cudaNotSupported'
    | 'cudaVersionTooOld'
    | 'maxCudaUnknown'
    | 'toolkitInstalled'
    | 'toolkitMissing';
}

/**
 * CUDA 環境完整檢測結果
 */
export interface CudaEnvironment {
  /** CUDA Toolkit 信息 */
  cudaToolkit: CudaToolkitInfo;
  /** GPU CUDA 支持信息 */
  gpuSupport: GpuCudaSupport;
  /** 加速包推薦 */
  recommendation: AddonRecommendation;
}

/**
 * GPU 環境完整檢測結果（跨廠商）
 */
export interface GpuEnvironment {
  /** 有效平臺（含 dev 模擬） */
  platform: string;
  /** systeminformation 枚舉的顯卡列表 */
  gpus: GpuInfo[];
  /** Vulkan 運行庫是否存在（僅 win/linux 有意義） */
  vulkanRuntime: boolean;
  /** 內置 vulkan addon 是否隨包分發 */
  builtinVulkanAvailable: boolean;
  /** NVIDIA 完整檢測結果（未檢測到 N 卡時為 null） */
  nvidia: CudaEnvironment | null;
}

/**
 * 已安裝的加速包信息
 */
export interface InstalledAddon {
  /** 安裝時間 */
  installedAt: string;
  /** 下載時的遠程版本號 (用於更新檢測) */
  remoteVersion: string;
  /** 是否包含 DLLs/SO 文件 */
  hasDlls: boolean;
  /** 文件大小 (字節) */
  size: number;
  /** 文件校驗和 */
  checksum?: string;
}

/**
 * 加速包配置
 */
export interface AddonConfig {
  /** 當前選中的版本 */
  selectedVersion: AddonVariant | null;
  /** 已安裝的加速包 */
  installed: Record<string, InstalledAddon>;
  /** 自定義 addon.node 文件路徑 */
  customAddonPath?: string | null;
}

/**
 * 遠程加速包版本信息
 */
export interface RemoteAddonVersion {
  /** 版本日期 (用於更新檢測) */
  version: string;
  /** 更新說明 */
  updateNotes: string;
  /** 校驗和信息 */
  checksum?: {
    'windows-tar'?: string;
    'windows-node'?: string;
    'linux-tar'?: string;
    'linux-node'?: string;
  };
  /** 各平臺包體積（字節），來自 addon-versions.json */
  sizes?: {
    'windows-tar'?: number;
    'windows-node'?: number;
    'linux-tar'?: number;
    'linux-node'?: number;
  };
}

/**
 * 遠程版本文件結構
 */
export type RemoteAddonVersions = Partial<
  Record<AddonVariant, RemoteAddonVersion>
>;

/**
 * 下載狀態
 */
export type DownloadStatus =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'extracting'
  | 'verifying'
  | 'completed'
  | 'error';

/**
 * 下載進度信息
 */
export interface DownloadProgress {
  /** 下載狀態 */
  status: DownloadStatus;
  /** 下載進度百分比 (0-100) */
  progress: number;
  /** 已下載字節數 */
  downloaded: number;
  /** 總字節數 */
  total: number;
  /** 下載速度 (字節/秒) */
  speed: number;
  /** 預計剩餘時間 (秒) */
  eta: number;
  /** 錯誤信息 */
  error?: string;
}

/**
 * 下載源類型
 */
export type DownloadSource = 'github' | 'ghproxy' | 'gitcode';

/**
 * 下載配置
 */
export interface DownloadConfig {
  /** 下載源 */
  source: DownloadSource;
  /** 加速包變體 */
  variant: AddonVariant;
  /** 下載類型 */
  type: 'node.gz' | 'tar.gz';
}

/**
 * 更新檢測結果
 */
export interface AddonUpdateInfo {
  /** 加速包變體 */
  variant: AddonVariant;
  /** 是否有更新 */
  hasUpdate: boolean;
  /** 當前本地版本 */
  localVersion: string;
  /** 遠程最新版本 */
  remoteVersion: string;
  /** 更新說明 */
  updateNotes?: string;
}

/**
 * 下載狀態持久化信息 (用於斷點續傳)
 */
export interface DownloadState {
  /** 下載 URL */
  url: string;
  /** 目標路徑 */
  destPath: string;
  /** 臨時文件路徑 */
  tempPath: string;
  /** 已下載字節數 */
  downloaded: number;
  /** 總字節數 */
  total: number;
  /** 加速包變體 */
  variant: AddonVariant;
  /** 下載類型 */
  downloadType: 'node.gz' | 'tar.gz';
  /** 開始時間 */
  startedAt: string;
  /** 最後更新時間 */
  lastUpdatedAt: string;
}

/**
 * 開發模式模擬配置
 */
export interface DevSimulationConfig {
  /** 是否啟用模擬 */
  enabled: boolean;
  /** 模擬平臺 */
  platform: 'win32' | 'linux';
  /** 是否安裝了 CUDA Toolkit */
  hasToolkit: boolean;
  /** CUDA Toolkit 版本 */
  toolkitVersion: string | null;
  /** GPU 支持的最高 CUDA 版本 */
  gpuCudaVersion: string;
  /** 顯卡名稱 */
  gpuName: string;
}
