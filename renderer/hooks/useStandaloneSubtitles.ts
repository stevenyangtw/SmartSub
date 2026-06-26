/**
 * 獨立校對模式的字幕管理 Hook
 * 不依賴 IFiles，直接接收文件路徑
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import path from 'path';
import { toast } from 'sonner';
import { useTranslation } from 'next-i18next';
import { Subtitle, SubtitleStats, PlayerSubtitleTrack } from './useSubtitles';
import { useSubtitleHistory, computeRangeDiff } from './useSubtitleHistory';

interface StandaloneSubtitlesConfig {
  videoPath?: string;
  sourceSubtitlePath?: string;
  targetSubtitlePath?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  finalTargetSubtitlePath?: string; // 目標翻譯文件（用戶配置格式，可能是雙語）
  translateContent?: string; // 翻譯內容格式設置
}

// 將時間字符串轉換為秒
const timeToSeconds = (timeStr: string): number => {
  const parts = timeStr.replace(',', '.').split(':');
  if (parts.length !== 3) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
};

// 從時間範圍字符串中提取開始和結束時間
const parseTimeRange = (timeRange: string): { start: number; end: number } => {
  const times = timeRange.split(' --> ');
  if (times.length !== 2) return { start: 0, end: 0 };
  return {
    start: timeToSeconds(times[0]),
    end: timeToSeconds(times[1]),
  };
};

// id 歸一化為「下標+1」：僅克隆 id 變化的行（合併/拆分/撤銷重做後調用）
const renormalizeIds = (arr: Subtitle[]): Subtitle[] =>
  arr.map((sub, idx) => {
    const id = String(idx + 1);
    return sub.id === id ? sub : { ...sub, id };
  });

// 秒數轉 SRT 時間戳字符串（HH:MM:SS,mmm）
const secondsToTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0').replace('.', ',')}`;
};

// 時間相等容差（SRT 精度為毫秒）
const TIME_EPSILON = 0.0005;

export const useStandaloneSubtitles = (
  config: StandaloneSubtitlesConfig,
  isOpen: boolean,
) => {
  const { t } = useTranslation('home');
  const [mergedSubtitles, setMergedSubtitles] = useState<Subtitle[]>([]);
  const [videoPath, setVideoPath] = useState<string>('');
  const [currentSubtitleIndex, setCurrentSubtitleIndex] = useState(-1);
  const [previousSubtitleIndex, setPreviousSubtitleIndex] = useState(-1);
  const [videoInfo, setVideoInfo] = useState({ fileName: '', extension: '' });
  const [hasTranslationFile, setHasTranslationFile] = useState(false);
  const [subtitleTracksForPlayer, setSubtitleTracksForPlayer] = useState<
    PlayerSubtitleTrack[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  // 撤銷/重做歷史（命令模式：區間 diff 命令棧）
  const history = useSubtitleHistory();

  // 字幕數組的同步鏡像：所有變更經 applySubtitles 落盤，
  // 命令構造/合併窗口等同步邏輯讀它，避免依賴異步 setState
  const subtitlesRef = useRef<Subtitle[]>([]);

  // 逐字編輯合併窗口：同行同字段的連續輸入合併為一條撤銷命令
  const pendingEditRef = useRef<{
    index: number;
    field: 'sourceContent' | 'targetContent';
    before: Subtitle;
  } | null>(null);

  // 自上次保存以來是否有未保存修改
  const [isDirty, setIsDirty] = useState(false);

  // 光標位置（用於拆分功能）
  const cursorPositionRef = useRef(0);

  // 是否有翻譯字幕
  const shouldShowTranslation = !!config.targetSubtitlePath;

  // 統一落盤：鏡像 ref 與 state 同步更新
  const applySubtitles = useCallback((next: Subtitle[]) => {
    subtitlesRef.current = next;
    setMergedSubtitles(next);
  }, []);

  // 讀取最新字幕數組（異步流程結束後回填用，避免拿到過期快照）
  const getSubtitles = useCallback(() => subtitlesRef.current, []);

  // 讀取字幕文件
  const readSubtitleFile = async (filePath: string): Promise<Subtitle[]> => {
    try {
      const result: Subtitle[] = await window.ipc.invoke('readSubtitleFile', {
        filePath,
      });
      return result;
    } catch (error) {
      console.error('Error reading subtitle file:', error);
      return [];
    }
  };

  // 創建播放器字幕軌道
  const createPlayerTrack = async (
    srtPath: string | undefined,
    language: string,
    isDefault?: boolean,
  ): Promise<PlayerSubtitleTrack | null> => {
    if (!srtPath) return null;
    try {
      const result = await window.ipc.invoke('getSubtitleAsVtt', {
        filePath: srtPath,
      });
      if (result.error || !result.content) {
        console.error(`無法讀取字幕文件 ${srtPath}:`, result.error);
        return null;
      }
      const vttBlob = new Blob([result.content], { type: 'text/vtt' });
      const vttUrl = URL.createObjectURL(vttBlob);
      return {
        kind: 'subtitles',
        src: vttUrl,
        srcLang: language,
        label: `(${language})`,
        default: isDefault,
      };
    } catch (error) {
      console.error(`轉換字幕到 VTT 失敗:`, error);
      return null;
    }
  };

  // 加載文件
  const loadFiles = useCallback(async () => {
    if (!config.sourceSubtitlePath) return;

    setIsLoading(true);
    try {
      // 設置影片路徑
      if (config.videoPath) {
        setVideoPath(config.videoPath);
      }

      const playerTracks: PlayerSubtitleTrack[] = [];

      // 讀取源字幕
      const sourceSubtitles = await readSubtitleFile(config.sourceSubtitlePath);
      const track1 = await createPlayerTrack(
        config.sourceSubtitlePath,
        config.sourceLanguage || 'auto',
        !shouldShowTranslation,
      );
      if (track1) playerTracks.push(track1);

      // 讀取翻譯字幕
      let translatedSubtitles: Subtitle[] = [];
      if (config.targetSubtitlePath) {
        translatedSubtitles = await readSubtitleFile(config.targetSubtitlePath);
        setHasTranslationFile(translatedSubtitles.length > 0);

        const track2 = await createPlayerTrack(
          config.targetSubtitlePath,
          config.targetLanguage || 'auto',
          true,
        );
        if (track2) playerTracks.push(track2);
      }

      setSubtitleTracksForPlayer(playerTracks);

      // 合併字幕
      if (sourceSubtitles.length > 0) {
        const translatedMap = new Map();
        translatedSubtitles.forEach((sub) => {
          translatedMap.set(sub.startEndTime, sub);
        });

        const merged = sourceSubtitles.map((sub, index) => {
          const translated =
            translatedMap.get(sub.startEndTime) ||
            (index < translatedSubtitles.length
              ? translatedSubtitles[index]
              : null);

          const { start, end } = parseTimeRange(sub.startEndTime);

          return {
            ...sub,
            sourceContent: sub.content.join('\n'),
            targetContent: translated ? translated.content.join('\n') : '',
            isEditing: false,
            startTimeInSeconds: start,
            endTimeInSeconds: end,
          };
        });

        applySubtitles(merged);
      }
      // 重新加載即新的編輯起點：清空歷史與合併窗口
      history.reset();
      pendingEditRef.current = null;
      setIsDirty(false);
    } catch (error) {
      console.error('Error loading files:', error);
      toast.error(t('loadFileFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [config, shouldShowTranslation, t, applySubtitles, history.reset]);

  // 加載文件
  useEffect(() => {
    if (isOpen && config.sourceSubtitlePath) {
      loadFiles();
    }

    // 清理 Object URL
    return () => {
      subtitleTracksForPlayer.forEach((track) => {
        if (track.src && track.src.startsWith('blob:')) {
          URL.revokeObjectURL(track.src);
        }
      });
    };
  }, [isOpen, config.sourceSubtitlePath, config.targetSubtitlePath]);

  // 更新影片信息
  useEffect(() => {
    if (videoPath) {
      const fileName = path.basename(videoPath, path.extname(videoPath));
      const extension = path.extname(videoPath).replace('.', '');
      setVideoInfo({ fileName, extension });
    } else if (config.sourceSubtitlePath) {
      const fileName = path.basename(
        config.sourceSubtitlePath,
        path.extname(config.sourceSubtitlePath),
      );
      setVideoInfo({ fileName, extension: '' });
    }
  }, [videoPath, config.sourceSubtitlePath]);

  // 把合併窗口中的逐字編輯提交為一條撤銷命令
  const flushPendingEdit = useCallback(() => {
    const pending = pendingEditRef.current;
    if (!pending) return;
    pendingEditRef.current = null;
    const after = subtitlesRef.current[pending.index];
    if (!after || after === pending.before) return;
    if ((after[pending.field] ?? '') === (pending.before[pending.field] ?? ''))
      return;
    history.push({
      start: pending.index,
      removed: [pending.before],
      inserted: [after],
    });
  }, [history.push]);

  // 更新字幕內容（行級克隆，連續輸入合併為一條命令）
  const handleSubtitleChange = useCallback(
    (
      index: number,
      field: 'sourceContent' | 'targetContent',
      value: string,
    ) => {
      const current = subtitlesRef.current;
      const row = current[index];
      if (!row) return;

      const pending = pendingEditRef.current;
      // 換行或換字段：先提交上一個合併窗口
      if (pending && (pending.index !== index || pending.field !== field)) {
        flushPendingEdit();
      }
      if (!pendingEditRef.current) {
        pendingEditRef.current = { index, field, before: row };
      }

      const next = current.slice();
      next[index] = {
        ...row,
        [field]: value,
        content: field === 'sourceContent' ? value.split('\n') : row.content,
      };
      applySubtitles(next);
      setIsDirty(true);
    },
    [applySubtitles, flushPendingEdit],
  );

  // 保存字幕文件；返回是否全部寫入成功
  const handleSave = async (): Promise<boolean> => {
    // 先把未提交的逐字編輯補入撤銷歷史，保證保存後仍可撤銷
    flushPendingEdit();
    try {
      const results: { error?: string }[] = [];

      // 保存源字幕
      if (config.sourceSubtitlePath) {
        results.push(
          await window.ipc.invoke('saveSubtitleFile', {
            filePath: config.sourceSubtitlePath,
            subtitles: mergedSubtitles,
            contentType: 'source',
          }),
        );
      }

      // 保存翻譯字幕（純翻譯內容到臨時文件）
      if (config.targetSubtitlePath && shouldShowTranslation) {
        results.push(
          await window.ipc.invoke('saveSubtitleFile', {
            filePath: config.targetSubtitlePath,
            subtitles: mergedSubtitles,
            contentType: 'onlyTranslate',
          }),
        );
      }

      // 保存到目標翻譯文件（按用戶配置格式，可能是雙語）
      if (config.finalTargetSubtitlePath && shouldShowTranslation) {
        const contentType = config.translateContent || 'onlyTranslate';
        results.push(
          await window.ipc.invoke('saveSubtitleFile', {
            filePath: config.finalTargetSubtitlePath,
            subtitles: mergedSubtitles,
            contentType,
          }),
        );
      }

      const failed = results.find((result) => result && result.error);
      if (failed) {
        console.error('Error saving subtitles:', failed.error);
        toast.error(t('saveFailed'));
        return false;
      }

      setIsDirty(false);
      toast.success(t('subtitleSavedSuccess'));
      return true;
    } catch (error) {
      console.error('Error saving subtitles:', error);
      toast.error(t('saveFailed'));
      return false;
    }
  };

  // 字幕統計
  const getSubtitleStats = (): SubtitleStats => {
    const total = mergedSubtitles.length;
    const withTranslation = shouldShowTranslation
      ? mergedSubtitles.filter(
          (sub) => sub.targetContent && sub.targetContent.trim() !== '',
        ).length
      : 0;
    const percent =
      total > 0 && shouldShowTranslation
        ? Math.round((withTranslation / total) * 100)
        : 0;
    return { total, withTranslation, percent };
  };

  // 檢查翻譯是否失敗
  const isTranslationFailed = (subtitle: Subtitle): boolean => {
    if (!shouldShowTranslation) return false;
    return (
      !!subtitle.sourceContent &&
      subtitle.sourceContent.trim() !== '' &&
      (!subtitle.targetContent || subtitle.targetContent.trim() === '')
    );
  };

  // 獲取翻譯失敗的索引
  const getFailedTranslationIndices = (): number[] => {
    if (!shouldShowTranslation) return [];
    return mergedSubtitles
      .map((subtitle, index) => (isTranslationFailed(subtitle) ? index : -1))
      .filter((index) => index !== -1);
  };

  // 導航到下一條失敗的翻譯
  const goToNextFailedTranslation = (): void => {
    const failedIndices = getFailedTranslationIndices();
    if (failedIndices.length === 0) return;
    const nextIndex = failedIndices.find(
      (index) => index > currentSubtitleIndex,
    );
    if (nextIndex !== undefined) {
      setCurrentSubtitleIndex(nextIndex);
    } else {
      setCurrentSubtitleIndex(failedIndices[0]);
    }
  };

  // 導航到上一條失敗的翻譯
  const goToPreviousFailedTranslation = (): void => {
    const failedIndices = getFailedTranslationIndices();
    if (failedIndices.length === 0) return;
    const previousIndex = failedIndices
      .slice()
      .reverse()
      .find((index) => index < currentSubtitleIndex);
    if (previousIndex !== undefined) {
      setCurrentSubtitleIndex(previousIndex);
    } else {
      setCurrentSubtitleIndex(failedIndices[failedIndices.length - 1]);
    }
  };

  // 更新字幕（批量操作入口：計算最小區間 diff 入棧）
  const updateSubtitles = useCallback(
    (newSubtitles: Subtitle[]) => {
      flushPendingEdit();
      const diff = computeRangeDiff(subtitlesRef.current, newSubtitles);
      if (diff) history.push(diff);
      applySubtitles(newSubtitles);
      setIsDirty(true);
    },
    [applySubtitles, flushPendingEdit, history.push],
  );

  // 撤銷：先提交合並窗口（保證「最後一次輸入」也可撤銷），再應用區間命令
  const handleUndo = useCallback(() => {
    flushPendingEdit();
    const next = history.undo(subtitlesRef.current);
    if (next) {
      applySubtitles(renormalizeIds(next));
      setIsDirty(true);
    }
  }, [applySubtitles, flushPendingEdit, history.undo]);

  // 重做：合併窗口若有內容會作為新命令清空 redo 分支（與主流編輯器一致）
  const handleRedo = useCallback(() => {
    flushPendingEdit();
    const next = history.redo(subtitlesRef.current);
    if (next) {
      applySubtitles(renormalizeIds(next));
      setIsDirty(true);
    }
  }, [applySubtitles, flushPendingEdit, history.redo]);

  // 是否可以撤銷/重做（合併窗口中有未提交輸入也算可撤銷）
  const canUndo = history.canUndo || pendingEditRef.current !== null;
  const canRedo = history.canRedo;

  // 失焦記錄：當切換字幕時，如果有編輯過，保存到歷史
  useEffect(() => {
    if (
      previousSubtitleIndex !== -1 &&
      previousSubtitleIndex !== currentSubtitleIndex
    ) {
      flushPendingEdit();
    }
    setPreviousSubtitleIndex(currentSubtitleIndex);
  }, [currentSubtitleIndex, flushPendingEdit]);

  // 行內編輯起止時間：鄰行鉗制校驗，通過則單行命令入棧；返回錯誤文案或 null
  const handleTimeChange = useCallback(
    (index: number, startSec: number, endSec: number): string | null => {
      const current = subtitlesRef.current;
      const row = current[index];
      if (!row) return null;

      if (!(startSec < endSec)) {
        return t('timeEditInvalidRange');
      }
      const prevRow = current[index - 1];
      if (
        prevRow &&
        startSec < (prevRow.endTimeInSeconds ?? 0) - TIME_EPSILON
      ) {
        return t('timeEditOverlapPrev');
      }
      const nextRow = current[index + 1];
      if (
        nextRow &&
        endSec > (nextRow.startTimeInSeconds ?? 0) + TIME_EPSILON
      ) {
        return t('timeEditOverlapNext');
      }

      // 無實際變化
      if (
        Math.abs((row.startTimeInSeconds ?? 0) - startSec) < TIME_EPSILON &&
        Math.abs((row.endTimeInSeconds ?? 0) - endSec) < TIME_EPSILON
      ) {
        return null;
      }

      flushPendingEdit();
      const updated: Subtitle = {
        ...row,
        startEndTime: `${secondsToTime(startSec)} --> ${secondsToTime(endSec)}`,
        startTimeInSeconds: startSec,
        endTimeInSeconds: endSec,
      };
      history.push({ start: index, removed: [row], inserted: [updated] });

      const next = current.slice();
      next[index] = updated;
      applySubtitles(next);
      setIsDirty(true);
      return null;
    },
    [applySubtitles, flushPendingEdit, history.push, t],
  );

  // 合併字幕（區間命令：N 行 → 1 行；id 由 renormalize 統一歸位）
  const handleMergeSubtitles = useCallback(
    (startIndex: number, endIndex: number) => {
      const current = subtitlesRef.current;
      if (startIndex < 0 || endIndex > current.length || startIndex >= endIndex)
        return;

      const toMerge = current.slice(startIndex, endIndex);
      if (toMerge.length < 2) return;

      flushPendingEdit();

      // 合併內容
      const mergedContent = toMerge
        .map((s) => s.sourceContent)
        .filter(Boolean)
        .join('\n');
      const mergedTarget = toMerge
        .map((s) => s.targetContent)
        .filter(Boolean)
        .join('\n');

      // 使用第一條的開始時間和最後一條的結束時間
      const startTime = toMerge[0].startTimeInSeconds || 0;
      const endTime = toMerge[toMerge.length - 1].endTimeInSeconds || 0;

      const merged: Subtitle = {
        ...toMerge[0],
        sourceContent: mergedContent,
        targetContent: mergedTarget,
        content: mergedContent.split('\n'),
        startEndTime: `${secondsToTime(startTime)} --> ${secondsToTime(endTime)}`,
        startTimeInSeconds: startTime,
        endTimeInSeconds: endTime,
      };

      history.push({ start: startIndex, removed: toMerge, inserted: [merged] });

      const next = current.slice();
      next.splice(startIndex, toMerge.length, merged);
      applySubtitles(renormalizeIds(next));
      setIsDirty(true);
      toast.success(t('mergeSuccess'));
    },
    [applySubtitles, flushPendingEdit, history.push, t],
  );

  // 拆分字幕（區間命令：1 行 → 2 行；支持自定義時間拆分點）
  const handleSplitSubtitle = useCallback(
    (index: number, splitPoint: number, splitTime?: number) => {
      const current = subtitlesRef.current;
      if (index < 0 || index >= current.length) return;

      const subtitle = current[index];
      const content = subtitle.sourceContent || '';
      const targetContent = subtitle.targetContent || '';

      if (content.length < 2) return;

      flushPendingEdit();

      // 計算拆分後的內容
      const content1 = content.slice(0, splitPoint);
      const content2 = content.slice(splitPoint);
      const targetSplitPoint = Math.floor(
        targetContent.length * (splitPoint / Math.max(content.length, 1)),
      );
      const target1 = targetContent.slice(0, targetSplitPoint);
      const target2 = targetContent.slice(targetSplitPoint);

      // 計算拆分後的時間（支持自定義時間拆分點）
      const startTime = subtitle.startTimeInSeconds || 0;
      const endTime = subtitle.endTimeInSeconds || 0;
      const midTime =
        splitTime !== undefined
          ? splitTime
          : startTime + (endTime - startTime) / 2;

      const sub1: Subtitle = {
        ...subtitle,
        sourceContent: content1,
        targetContent: target1,
        content: content1.split('\n'),
        startEndTime: `${secondsToTime(startTime)} --> ${secondsToTime(midTime)}`,
        endTimeInSeconds: midTime,
      };

      const sub2: Subtitle = {
        ...subtitle,
        id: String(index + 2),
        sourceContent: content2,
        targetContent: target2,
        content: content2.split('\n'),
        startEndTime: `${secondsToTime(midTime)} --> ${secondsToTime(endTime)}`,
        startTimeInSeconds: midTime,
      };

      history.push({
        start: index,
        removed: [subtitle],
        inserted: [sub1, sub2],
      });

      const next = current.slice();
      next.splice(index, 1, sub1, sub2);
      applySubtitles(renormalizeIds(next));
      setIsDirty(true);
      toast.success(t('splitSuccess'));
    },
    [applySubtitles, flushPendingEdit, history.push, t],
  );

  // 更新光標位置
  const handleCursorPositionChange = useCallback((position: number) => {
    cursorPositionRef.current = position;
  }, []);

  // 獲取當前光標位置
  const getCursorPosition = useCallback(() => {
    return cursorPositionRef.current;
  }, []);

  return {
    mergedSubtitles,
    setMergedSubtitles,
    updateSubtitles,
    getSubtitles,
    videoPath,
    currentSubtitleIndex,
    setCurrentSubtitleIndex,
    videoInfo,
    hasTranslationFile,
    shouldShowTranslation,
    subtitleTracksForPlayer,
    isLoading,
    handleSubtitleChange,
    handleSave,
    isDirty,
    flushPendingEdit,
    getSubtitleStats,
    isTranslationFailed,
    getFailedTranslationIndices,
    goToNextFailedTranslation,
    goToPreviousFailedTranslation,
    // 編輯增強功能
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    handleMergeSubtitles,
    handleSplitSubtitle,
    handleTimeChange,
    // 光標位置
    handleCursorPositionChange,
    getCursorPosition,
  };
};
