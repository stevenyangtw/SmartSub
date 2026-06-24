export type TranscriptionEngine =
  | 'builtin'
  | 'fasterWhisper'
  | 'funasr'
  | 'qwen'
  | 'fireRedAsr'
  | 'localCli';

export type EngineStatusState =
  | 'ready'
  | 'not_installed'
  | 'downloading'
  | 'error'
  | 'checking';

export interface EngineStatus {
  state: EngineStatusState;
  version?: string;
  message?: string;
  /** 已安裝的運行時變體：cpu=默認包，cuda=Full GPU 包（僅 win/linux）。 */
  variant?: PyEngineVariant;
}

/**
 * 運行時變體：
 * - cpu：默認包（原產物名，不帶後綴），所有平臺可用；
 * - cuda：Full GPU(CUDA12) 包（產物名帶 -cuda 後綴，捆綁 cuBLAS/cuDNN），僅 windows-x64 / linux-x64。
 */
export type PyEngineVariant = 'cpu' | 'cuda';

export interface PyEngineManifest {
  version: string; // 兼容歷史（可能為 'latest'）
  platform: string;
  sha256: string;
  installedAt: string;
  engineVersion?: string;
  protocolVersion?: number;
  builtAt?: string;
  gitSha?: string;
  engineId?: string; // 'faster-whisper'（運行時按引擎區分目錄）
  pythonAbi?: string; // 'cp312'，與內嵌 PBS 解釋器 ABI 一致
  /** 已安裝變體；老安裝缺失時按 'cpu' 兜底（原產物即 CPU 包）。 */
  variant?: PyEngineVariant;
}

export interface RemoteEngineArtifact {
  sizeBytes: number;
  sha256: string;
}

/**
 * 單自包含運行時信息（內嵌 PBS 解釋器 + site-packages + main.py），按 (os,arch) 分平臺。
 * 取代舊的「可下載基座包 + 可重定位引擎包」兩段式產物。
 */
export interface RemoteRuntimeInfo {
  /** 命名模板（如 smartsub-faster-whisper-runtime-<suffix>.tar.gz），僅供展示/排錯。 */
  artifactPattern?: string;
  /** 按平臺 suffix（macos-arm64 / windows-x64 …）映射到產物大小與哈希。 */
  artifacts: Record<string, RemoteEngineArtifact>;
}

export interface RemoteEngineManifest {
  engineVersion: string;
  protocolVersion: number;
  builtAt: string;
  gitSha?: string;
  engines: string[];
  pythonVersion?: string;
  pythonAbi?: string;
  engineId?: string;
  /** 單自包含運行時產物（按平臺）。老 release 可能缺失，消費方需容忍 undefined。 */
  runtime?: RemoteRuntimeInfo;
}

/** 可獨立下載的 Python 引擎運行時標識。faster-whisper 是唯一 Python 引擎（funasr/qwen/firered 已改用內置 sherpa-onnx 原生庫）。 */
export type PyEngineId = 'faster-whisper';

export interface PyEngineUpdateInfo {
  installed: boolean;
  hasUpdate: boolean;
  localManifest: PyEngineManifest | null;
  remoteManifest: RemoteEngineManifest | null;
  remoteHash: string | null;
  protocolSupported: boolean;
  /** 本次更新檢查所針對的變體（默認取已安裝變體，未安裝時為 'cpu'）。 */
  variant?: PyEngineVariant;
}

export type PyEngineDownloadSource = 'github' | 'ghproxy' | 'gitcode';

export interface PyEngineDownloadProgress {
  status:
    | 'idle'
    | 'downloading'
    | 'extracting'
    | 'verifying'
    | 'completed'
    | 'error';
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  error?: string;
  /** 多引擎下載時標識是哪個引擎運行時（渲染層據此路由進度）。 */
  engineId?: PyEngineId;
}
