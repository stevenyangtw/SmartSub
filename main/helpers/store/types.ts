import { Provider, CustomParameterConfig } from '../../../types/provider';
import { ProofreadHistory, ProofreadTask } from '../../../types/proofread';
import { IFiles, TaskProject } from '../../../types';
import { WorkItem } from '../../../types/workItem';
import type { TranscriptionEngine } from '../../../types/engine';
import {
  GpuMode,
  AddonLoadResultInfo,
  AddonLoadHistoryEntry,
} from '../../../types/addon';
import type { DownloadEndpointConfig } from '../../../types/downloadConfig';

export type LogEntry = {
  timestamp: number;
  message: string;
  type?: 'info' | 'error' | 'warning';
  /** 任務工程日誌歸屬；系統日誌（updater 等）無此字段 */
  projectId?: string;
};

export type StoreType = {
  translationProviders: Provider[];
  userConfig: Record<string, any>;
  settings: {
    whisperCommand: string;
    language: string;
    useLocalWhisper: boolean;
    builtinWhisperCommand: string;
    useCuda: boolean;
    /** GPU 加速模式（取代 useCuda；useCuda 保留僅為回滾安全） */
    gpuMode?: GpuMode;
    /** gpuMode 遷移一次性通知標記：false=待通知，true=已通知 */
    gpuMigrationNotified?: boolean;
    modelsPath: string;
    maxContext?: number;
    useCustomTempDir?: boolean;
    customTempDir?: string;
    useVAD: boolean;
    checkUpdateOnStartup: boolean;
    preventSleepDuringTask: boolean;
    vadThreshold: number;
    vadMinSpeechDuration: number;
    vadMinSilenceDuration: number;
    vadMaxSpeechDuration: number;
    vadSpeechPad: number;
    vadSamplesOverlap: number;
    /** 抗幻覺/抗重複：開啟後斷開上文條件並抑制重複（builtin: max_context=0；faster-whisper: condition_on_previous_text=false + no_repeat_ngram/repetition_penalty 等）。預設關閉，按需開啟。 */
    reduceRepetition?: boolean;
    /** 任務預設引擎+模型的"上次使用"記憶（全局單條，二者作為整體，避免引擎/模型失配）。 */
    lastUsedTranscription?: { engine: TranscriptionEngine; model?: string };
    fasterWhisperDevice?: 'auto' | 'cpu' | 'cuda';
    fasterWhisperComputeType?: string;
    fasterWhisperModelsPath?: string;
    /** funasr 模型根目錄覆蓋；缺省回退 userData/models/funasr */
    funasrModelsPath?: string;
    /** qwen 模型根目錄覆蓋；缺省回退 userData/models/qwen */
    qwenModelsPath?: string;
    /** fireRed 模型根目錄覆蓋；缺省回退 userData/models/firered */
    fireRedModelsPath?: string;
    /** FunASR(SenseVoice via sherpa-onnx) 推理 provider；P1 僅 cpu 落地，cuda/coreml 預留 */
    funasrProvider?: 'cpu' | 'cuda' | 'coreml';
    /** FunASR 逆文本歸一化（數字/標點），預設開啟 */
    funasrUseItn?: boolean;
    /** FunASR 解碼線程數，預設 2 */
    funasrNumThreads?: number;
    /** Qwen3-ASR(sherpa-onnx) 推理 provider；P2 僅 cpu 落地，cuda 預留 */
    qwenProvider?: 'cpu' | 'cuda';
    /** Qwen3-ASR 解碼線程數，預設 2 */
    qwenNumThreads?: number;
    /** Qwen3-ASR 最大總序列長度，預設 512（對齊 sherpa 上游） */
    qwenMaxTotalLen?: number;
    /** Qwen3-ASR 單段最大新生成 token 數，預設 128 */
    qwenMaxNewTokens?: number;
    /** Qwen3-ASR 採樣溫度，預設 1e-6（近貪心，確定性） */
    qwenTemperature?: number;
    /** Qwen3-ASR top-p 採樣閾值，預設 0.8 */
    qwenTopP?: number;
    /** Qwen3-ASR 隨機種子，預設 42 */
    qwenSeed?: number;
    /** FireRedASR-AED(sherpa-onnx) 推理 provider；本期僅 cpu 落地，cuda 預留 */
    fireRedProvider?: 'cpu' | 'cuda';
    /** FireRedASR-AED 解碼線程數，預設 2 */
    fireRedNumThreads?: number;
    /** 全局網絡代理模式（none=直連；custom=手動 URL） */
    proxyMode?: 'none' | 'custom';
    /** custom 模式的代理 URL，如 http://user:pass@host:port */
    proxyUrl?: string;
    /** 可選 NO_PROXY 列表（逗號分隔），預設 localhost,127.0.0.1 */
    proxyNoProxy?: string;
    /** 下載源端點（鏡像/代理）用戶覆蓋；缺省字段走 DEFAULT_DOWNLOAD_ENDPOINTS。 */
    downloadEndpoints?: Partial<DownloadEndpointConfig>;
    /** 任務列表視圖：list=列表，grid=網格（全局統一，跨重啟保留） */
    taskViewMode?: 'list' | 'grid';
    /** 關閉窗口行為：smart=有任務轉後臺/空閒退出，background=始終後臺，quit=始終退出（僅 macOS 生效，Win/Linux 固定兜底） */
    closeAction?: 'smart' | 'background' | 'quit';
    /** 首次「轉入後臺」提示是否已展示（勾「不再提示」後置 true） */
    closeHintShown?: boolean;
  };
  providerVersion?: number;
  logs: LogEntry[];
  lastAddonLoadResult?: AddonLoadResultInfo;
  addonLoadHistory?: AddonLoadHistoryEntry[];
  customParameters?: Record<string, CustomParameterConfig>;
  proofreadHistories?: ProofreadHistory[]; // 舊版，保留兼容
  proofreadTasks?: ProofreadTask[]; // 新版批量任務
  /** 統一工作項（P19 WorkItem） */
  workItems?: WorkItem[];
  workItemsMigrationVersion?: number;
  /** 舊版扁平任務列表（僅保留用於遷移到 taskProjects） */
  tasks?: IFiles[];
  /** 任務工程列表（任務維度，跨重啟保留） */
  taskProjects?: TaskProject[];
  [key: string]: any;
};
