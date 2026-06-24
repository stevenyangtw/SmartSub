/**
 * 字幕合併狀態管理 Hook
 * 封裝所有業務邏輯，便於組件複用
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  SubtitleStyle,
  MergeProgress,
  MergeStatus,
  VideoInfo,
  SubtitleInfo,
  MergeConfig,
  MergeOutputMode,
  VideoQuality,
} from '../../../../types/subtitleMerge';
import {
  getDefaultStyle,
  getPlatformDefaultFont,
  STYLE_PRESETS,
} from '../constants';

/**
 * Hook 返回的狀態和方法
 */
export interface UseSubtitleMergeReturn {
  // 文件狀態
  videoPath: string | null;
  subtitlePath: string | null;
  videoInfo: VideoInfo | null;
  subtitleInfo: SubtitleInfo | null;

  // 樣式狀態
  style: SubtitleStyle;
  activePresetId: string | null;

  // 輸出狀態
  outputPath: string | null;
  outputMode: MergeOutputMode;
  videoQuality: VideoQuality;

  // 進度狀態
  progress: MergeProgress;
  status: MergeStatus;

  // 文件操作方法
  selectVideo: () => Promise<void>;
  selectSubtitle: () => Promise<void>;
  setVideoPath: (path: string) => Promise<void>;
  setSubtitlePath: (path: string) => Promise<void>;
  clearFiles: () => void;
  clearVideo: () => void;
  clearSubtitle: () => void;

  // 樣式操作方法
  setStyle: (style: SubtitleStyle) => void;
  updateStyle: (updates: Partial<SubtitleStyle>) => void;
  applyPreset: (presetId: string) => void;
  resetStyle: () => void;

  // 輸出操作方法
  selectOutputPath: () => Promise<void>;
  setOutputPath: (path: string) => void;
  setOutputMode: (mode: MergeOutputMode) => void;
  setVideoQuality: (quality: VideoQuality) => void;

  // 合併操作方法
  startMerge: () => Promise<void>;
  cancelMerge: () => Promise<void>;
  isCancelling: boolean;
  canMerge: boolean;

  // 其他方法
  openOutputFolder: () => Promise<void>;
}

/**
 * Hook 配置選項
 */
export interface UseSubtitleMergeOptions {
  /** 初始影片路徑 */
  initialVideoPath?: string;
  /** 初始字幕路徑 */
  initialSubtitlePath?: string;
  /** 初始樣式 */
  initialStyle?: SubtitleStyle;
  /** 進度回調 */
  onProgress?: (progress: MergeProgress) => void;
  /** 完成回調 */
  onComplete?: (outputPath: string) => void;
  /** 錯誤回調 */
  onError?: (error: string) => void;
}

/**
 * 字幕合併狀態管理 Hook
 */
export function useSubtitleMerge(
  options: UseSubtitleMergeOptions = {},
): UseSubtitleMergeReturn {
  const {
    initialVideoPath,
    initialSubtitlePath,
    initialStyle,
    onProgress,
    onComplete,
    onError,
  } = options;

  // 文件狀態
  const [videoPath, setVideoPathState] = useState<string | null>(
    initialVideoPath || null,
  );
  const [subtitlePath, setSubtitlePathState] = useState<string | null>(
    initialSubtitlePath || null,
  );
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [subtitleInfo, setSubtitleInfo] = useState<SubtitleInfo | null>(null);

  // 樣式狀態
  const [style, setStyleState] = useState<SubtitleStyle>(
    () => initialStyle || getDefaultStyle(),
  );
  const [activePresetId, setActivePresetId] = useState<string | null>(
    'classic',
  );

  // 輸出狀態
  const [outputPath, setOutputPathState] = useState<string | null>(null);
  const [outputMode, setOutputModeState] =
    useState<MergeOutputMode>('hardcode');
  // 燒錄畫質，預設原畫質（CRF18），儘量貼近源文件畫質（issue #331）
  const [videoQuality, setVideoQualityState] =
    useState<VideoQuality>('original');
  // 供異步回調讀取最新輸出方式（生成預設路徑時按模式定擴展名）
  const outputModeRef = useRef<MergeOutputMode>('hardcode');
  outputModeRef.current = outputMode;

  // 軟字幕封裝固定輸出 .mkv；切回燒錄恢復影片原擴展名
  const applyModeExtension = useCallback(
    (path: string, mode: MergeOutputMode, currentVideoPath: string | null) => {
      if (mode === 'softmux') {
        return path.replace(/\.[^./\\]+$/, '.mkv');
      }
      const videoExtMatch = currentVideoPath?.match(/(\.[^./\\]+)$/);
      return videoExtMatch
        ? path.replace(/\.[^./\\]+$/, videoExtMatch[1])
        : path;
    },
    [],
  );

  // 進度狀態
  const [progress, setProgress] = useState<MergeProgress>({
    percent: 0,
    timeMark: '',
    targetSize: 0,
    status: 'idle',
  });
  const [isCancelling, setIsCancelling] = useState(false);

  // 引用
  const isMountedRef = useRef(true);

  // 監聽實時進度事件 (只更新進度百分比，不處理完成/錯誤狀態)
  useEffect(() => {
    isMountedRef.current = true;

    const handleProgress = (progressData: MergeProgress) => {
      if (isMountedRef.current && progressData.status === 'processing') {
        setProgress(progressData);
        onProgress?.(progressData);
      }
    };

    const cleanup = window.ipc?.on('subtitleMerge:progress', handleProgress);

    return () => {
      isMountedRef.current = false;
      cleanup?.();
    };
  }, [onProgress]);

  // 加載影片信息
  const loadVideoInfo = useCallback(
    async (path: string) => {
      try {
        const result = await window.ipc.invoke('subtitleMerge:getVideoInfo', {
          videoPath: path,
        });
        if (result.success && result.data) {
          setVideoInfo(result.data);
        }
      } catch (error) {
        console.error('加載影片信息失敗:', error);
      }
      // 只要選了影片就生成預設輸出路徑（不依賴影片信息讀取成功）
      try {
        const outputResult = await window.ipc.invoke(
          'subtitleMerge:generateOutputPath',
          {
            videoPath: path,
            suffix: '_subtitled',
          },
        );
        if (outputResult.success && outputResult.data) {
          setOutputPathState(
            applyModeExtension(outputResult.data, outputModeRef.current, path),
          );
        }
      } catch (error) {
        console.error('生成預設輸出路徑失敗:', error);
      }
    },
    [applyModeExtension],
  );

  // 加載字幕信息
  const loadSubtitleInfo = useCallback(async (path: string) => {
    try {
      const result = await window.ipc.invoke('subtitleMerge:getSubtitleInfo', {
        subtitlePath: path,
      });
      if (result.success && result.data) {
        setSubtitleInfo(result.data);
      }
    } catch (error) {
      console.error('加載字幕信息失敗:', error);
    }
  }, []);

  // 預填路徑（如從任務完成橫幅跳轉）需要主動加載文件信息
  useEffect(() => {
    if (initialVideoPath) {
      loadVideoInfo(initialVideoPath);
    }
    if (initialSubtitlePath) {
      loadSubtitleInfo(initialSubtitlePath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 換文件後舊的合成結果不再對應當前輸入，復位完成/錯誤狀態
  const resetStaleProgress = useCallback(() => {
    setProgress((prev) =>
      prev.status === 'completed' || prev.status === 'error'
        ? { percent: 0, timeMark: '', targetSize: 0, status: 'idle' }
        : prev,
    );
  }, []);

  // 選擇影片文件
  const selectVideo = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('selectFile', {
        type: 'video',
        title: '選擇影片文件',
      });
      if (!result.canceled && result.filePath) {
        setVideoPathState(result.filePath);
        resetStaleProgress();
        await loadVideoInfo(result.filePath);
      }
    } catch (error) {
      console.error('選擇影片失敗:', error);
    }
  }, [loadVideoInfo, resetStaleProgress]);

  // 選擇字幕文件
  const selectSubtitle = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('selectFile', {
        type: 'subtitle',
        title: '選擇字幕文件',
      });
      if (!result.canceled && result.filePath) {
        setSubtitlePathState(result.filePath);
        resetStaleProgress();
        await loadSubtitleInfo(result.filePath);
      }
    } catch (error) {
      console.error('選擇字幕失敗:', error);
    }
  }, [loadSubtitleInfo, resetStaleProgress]);

  // 設置影片路徑
  const setVideoPath = useCallback(
    async (path: string) => {
      setVideoPathState(path);
      resetStaleProgress();
      await loadVideoInfo(path);
    },
    [loadVideoInfo, resetStaleProgress],
  );

  // 設置字幕路徑
  const setSubtitlePath = useCallback(
    async (path: string) => {
      setSubtitlePathState(path);
      resetStaleProgress();
      await loadSubtitleInfo(path);
    },
    [loadSubtitleInfo, resetStaleProgress],
  );

  // 清空文件
  const clearFiles = useCallback(() => {
    setVideoPathState(null);
    setSubtitlePathState(null);
    setVideoInfo(null);
    setSubtitleInfo(null);
    setOutputPathState(null);
    setProgress({
      percent: 0,
      timeMark: '',
      targetSize: 0,
      status: 'idle',
    });
  }, []);

  // 單獨清除影片：輸出路徑派生自影片一併清除；合成結果不再對應，進度復位
  const clearVideo = useCallback(() => {
    setVideoPathState(null);
    setVideoInfo(null);
    setOutputPathState(null);
    setProgress({
      percent: 0,
      timeMark: '',
      targetSize: 0,
      status: 'idle',
    });
  }, []);

  // 單獨清除字幕
  const clearSubtitle = useCallback(() => {
    setSubtitlePathState(null);
    setSubtitleInfo(null);
    setProgress({
      percent: 0,
      timeMark: '',
      targetSize: 0,
      status: 'idle',
    });
  }, []);

  // 設置完整樣式
  const setStyle = useCallback((newStyle: SubtitleStyle) => {
    setStyleState(newStyle);
    setActivePresetId(null);
  }, []);

  // 更新部分樣式
  const updateStyle = useCallback((updates: Partial<SubtitleStyle>) => {
    setStyleState((prev) => ({ ...prev, ...updates }));
    setActivePresetId(null);
  }, []);

  // 應用預設樣式
  const applyPreset = useCallback((presetId: string) => {
    const preset = STYLE_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      // classic 預設字體跟隨平臺，避免 Arial 渲染不了 CJK
      const nextStyle =
        preset.id === 'classic'
          ? { ...preset.style, fontName: getPlatformDefaultFont() }
          : preset.style;
      setStyleState(nextStyle);
      setActivePresetId(presetId);
    }
  }, []);

  // 重置樣式
  const resetStyle = useCallback(() => {
    setStyleState(getDefaultStyle());
    setActivePresetId('classic');
  }, []);

  // 選擇輸出路徑
  const selectOutputPath = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('subtitleMerge:selectOutputPath', {
        defaultPath: outputPath,
      });
      if (result.success && result.data) {
        setOutputPathState(result.data);
      }
    } catch (error) {
      console.error('選擇輸出路徑失敗:', error);
    }
  }, [outputPath]);

  // 設置輸出路徑
  const setOutputPath = useCallback((path: string) => {
    setOutputPathState(path);
  }, []);

  // 設置燒錄畫質（僅 hardcode 生效）
  const setVideoQuality = useCallback((quality: VideoQuality) => {
    setVideoQualityState(quality);
  }, []);

  // 切換輸出方式（聯動輸出擴展名；舊合成結果不再對應，復位狀態）
  const setOutputMode = useCallback(
    (mode: MergeOutputMode) => {
      setOutputModeState(mode);
      setOutputPathState((prev) =>
        prev ? applyModeExtension(prev, mode, videoPath) : prev,
      );
      resetStaleProgress();
    },
    [applyModeExtension, videoPath, resetStaleProgress],
  );

  // 開始合併
  const startMerge = useCallback(async () => {
    if (!videoPath || !subtitlePath || !outputPath) return;

    setProgress({
      percent: 0,
      timeMark: '',
      targetSize: 0,
      status: 'processing',
    });

    try {
      const config: MergeConfig = {
        videoPath,
        subtitlePath,
        outputPath,
        style,
        outputMode,
        videoQuality,
      };
      const result = await window.ipc.invoke(
        'subtitleMerge:startMerge',
        config,
      );

      if (result.success && result.cancelled) {
        // 用戶取消：靜默復位，不算失敗
        setProgress({
          percent: 0,
          timeMark: '',
          targetSize: 0,
          status: 'idle',
        });
      } else if (result.success) {
        // 合併成功
        setProgress({
          percent: 100,
          timeMark: '',
          targetSize: 0,
          status: 'completed',
        });
        onComplete?.(outputPath);
      } else {
        // 合併失敗
        setProgress({
          percent: 0,
          timeMark: '',
          targetSize: 0,
          status: 'error',
          errorMessage: result.error,
        });
        onError?.(result.error || '合併失敗');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '合併失敗';
      setProgress({
        percent: 0,
        timeMark: '',
        targetSize: 0,
        status: 'error',
        errorMessage,
      });
      onError?.(errorMessage);
    } finally {
      setIsCancelling(false);
    }
  }, [
    videoPath,
    subtitlePath,
    outputPath,
    style,
    outputMode,
    videoQuality,
    onComplete,
    onError,
  ]);

  // 取消合成
  const cancelMerge = useCallback(async () => {
    if (progress.status !== 'processing' || isCancelling) return;
    setIsCancelling(true);
    try {
      await window.ipc.invoke('subtitleMerge:cancelMerge');
      // 復位由 startMerge 的 cancelled 分支完成
    } catch (error) {
      console.error('取消合成失敗:', error);
      setIsCancelling(false);
    }
  }, [progress.status, isCancelling]);

  // 打開輸出資料夾
  const openOutputFolder = useCallback(async () => {
    if (!outputPath) return;
    try {
      await window.ipc.invoke('subtitleMerge:openOutputFolder', {
        filePath: outputPath,
      });
    } catch (error) {
      console.error('打開資料夾失敗:', error);
    }
  }, [outputPath]);

  // 是否可以開始合併
  const canMerge = Boolean(
    videoPath && subtitlePath && outputPath && progress.status !== 'processing',
  );

  return {
    // 文件狀態
    videoPath,
    subtitlePath,
    videoInfo,
    subtitleInfo,

    // 樣式狀態
    style,
    activePresetId,

    // 輸出狀態
    outputPath,
    outputMode,
    videoQuality,

    // 進度狀態
    progress,
    status: progress.status,

    // 文件操作方法
    selectVideo,
    selectSubtitle,
    setVideoPath,
    setSubtitlePath,
    clearFiles,
    clearVideo,
    clearSubtitle,

    // 樣式操作方法
    setStyle,
    updateStyle,
    applyPreset,
    resetStyle,

    // 輸出操作方法
    selectOutputPath,
    setOutputPath,
    setOutputMode,
    setVideoQuality,

    // 合併操作方法
    startMerge,
    cancelMerge,
    isCancelling,
    canMerge,

    // 其他方法
    openOutputFolder,
  };
}
