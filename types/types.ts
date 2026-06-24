import type { EngineStatus } from './engine';

export interface ISystemInfo {
  modelsInstalled: string[];
  modelsPath: string;
  downloadingModels: string[];
  totalMemoryGB?: number;
  fasterWhisperModelsInstalled?: string[];
  fasterWhisperModelsPath?: string;
  pythonEngineStatus?: EngineStatus;
  /** funasr 引擎包是否已安裝 */
  funasrEngineInstalled?: boolean;
  /** funasr 共用 VAD 是否已安裝 */
  funasrVadInstalled?: boolean;
  /** 已安裝的 funasr ASR 模型 id（如 ['sensevoice-small','paraformer-zh']） */
  funasrAsrModelsInstalled?: string[];
  /** funasr 模型根目錄（固定路徑，僅展示用，不可更改） */
  funasrModelsPath?: string;
  /** qwen 引擎包（sherpa-onnx，與 funasr 同庫）是否已安裝 */
  qwenEngineInstalled?: boolean;
  /** qwen 共用 silero VAD 是否已安裝 */
  qwenVadInstalled?: boolean;
  /** 已安裝的 qwen 模型 id（如 ['qwen3-asr-0.6b']） */
  qwenModelsInstalled?: string[];
  /** qwen 模型根目錄（固定路徑，僅展示用，不可更改） */
  qwenModelsPath?: string;
  /** fireRed 引擎包（sherpa-onnx，與 funasr 同庫）是否已安裝 */
  fireRedEngineInstalled?: boolean;
  /** fireRed 共用 silero VAD 是否已安裝 */
  fireRedVadInstalled?: boolean;
  /** 已安裝的 fireRed 模型 id（如 ['fire-red-asr-large-zh-en']） */
  fireRedModelsInstalled?: string[];
  /** fireRed 模型根目錄（固定路徑，僅展示用，不可更改） */
  fireRedModelsPath?: string;
}

export interface IFiles {
  uuid: string;
  filePath: string;
  fileName: string;
  fileExtension: string;
  directory: string;
  extractAudio?: boolean;
  extractSubtitle?: boolean;
  translateSubtitle?: boolean;
  audioFile?: string;
  srtFile?: string;
  tempSrtFile?: string;
  tempAudioFile?: string;
  translatedSrtFile?: string;
  tempTranslatedSrtFile?: string;
  /** 本次轉寫實際使用的後端標籤（如 "CUDA 12.4.0" / "Vulkan" / "CPU"） */
  whisperBackend?: string;
  /** 該文件走了內封軟字幕直提（跳過抽音頻 + ASR）：用於任務列表標識 */
  embeddedSubtitle?: boolean;
}

export type TaskProjectType =
  | 'generateAndTranslate'
  | 'generateOnly'
  | 'translateOnly';

/** 一次任務工程：任務維度記錄，下掛文件列表 */
export interface TaskProject {
  id: string;
  /** 默認「時間 + 第一個文件名」，用戶可改 */
  name: string;
  taskType: TaskProjectType;
  files: IFiles[];
  createdAt: number;
  updatedAt: number;
}

export interface IFormData {
  /** 任務類型（運行時由任務攜帶）：用於區分源字幕是 ASR 生成還是用戶導入。 */
  taskType?: TaskProjectType;
  translateContent:
    | 'onlyTranslate'
    | 'sourceAndTranslate'
    | 'translateAndSource';
  targetSrtSaveOption: string;
  customTargetSrtFileName: string;
  sourceLanguage: string;
  targetLanguage: string;
  translateRetryTimes: string;
  subtitleOutputFormat?: 'srt' | 'vtt' | 'ass' | 'lrc' | 'txt';
  /** 中文標點去除（任務級開關）：開啟後把中文標點替換為空格。作用於源字幕(中文源)與譯文(中文目標)。缺省關閉。 */
  removeChinesePunctuation?: boolean;
}
