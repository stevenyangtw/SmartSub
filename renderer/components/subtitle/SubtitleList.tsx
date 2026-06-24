import React, {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
  memo,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Sparkles,
  Scissors,
  RotateCcw,
  Loader2,
  CheckCircle2,
  Combine,
  CircleStop,
  X,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Subtitle } from '../../hooks/useSubtitles';
import { useTranslation } from 'next-i18next';
import TimeRangeEditor from './TimeRangeEditor';
import type { RetranslateControl } from '../../hooks/useRetranslateFailed';

interface SubtitleListProps {
  mergedSubtitles: Subtitle[];
  currentSubtitleIndex: number;
  shouldShowTranslation: boolean;
  handleSubtitleClick: (index: number) => void;
  handleSubtitleChange: (
    index: number,
    field: 'sourceContent' | 'targetContent',
    value: string,
  ) => void;
  isTranslationFailed: (subtitle: Subtitle) => boolean;
  getFailedTranslationIndices: () => number[];
  goToNextFailedTranslation: () => void;
  goToPreviousFailedTranslation: () => void;
  onCursorPositionChange?: (position: number) => void;
  onAiOptimizeClick?: (index: number) => void;
  onSplitClick?: (index: number) => void;
  /** 行內時間編輯提交；返回錯誤文案（不應用）或 null（已應用） */
  onTimeChange?: (
    index: number,
    startSec: number,
    endSec: number,
  ) => string | null;
  /** 失敗字幕批量重翻控制（不傳則不顯示重翻按鈕） */
  retranslate?: RetranslateControl;
  /** 合併選中區間 [start, endExclusive)；不傳則禁用多選 */
  onMergeRange?: (start: number, endExclusive: number) => void;
  /** 視圖偏好由父級（編輯工具欄）統一控制 */
  expandAll: boolean;
  fontScale: 's' | 'm' | 'l';
}

interface RowLabels {
  currentPlaying: string;
  translationFailedLabel: string;
  originalSubtitle: string;
  translatedSubtitle: string;
  translationFailedPlaceholder: string;
  aiOptimize: string;
  split: string;
  timeInvalidFormat: string;
  timeEditHint: string;
}

// 秒數 → 緊湊時間（m:ss 或 h:mm:ss），用於緊湊行
const compactTime = (seconds: number | undefined): string => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// 多行文本壓成單行預覽
const toPreview = (text: string | undefined): string =>
  (text || '').replace(/\s*\n\s*/g, ' ').trim();

interface SubtitleRowProps {
  subtitle: Subtitle;
  index: number;
  isCurrent: boolean;
  isFailed: boolean;
  isSelected: boolean;
  shouldShowTranslation: boolean;
  forceExpanded: boolean;
  fontScale: 's' | 'm' | 'l';
  showAiOptimize: boolean;
  showSplit: boolean;
  labels: RowLabels;
  onRowClick: (index: number, shiftKey: boolean) => void;
  onFieldChange: (
    index: number,
    field: 'sourceContent' | 'targetContent',
    value: string,
  ) => void;
  onSelectionEvent: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  onSourceKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => void;
  onTargetKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    index: number,
  ) => void;
  onAiOptimize: (index: number) => void;
  onSplit: (index: number) => void;
  onTimeCommit: (
    index: number,
    startSec: number,
    endSec: number,
  ) => string | null;
}

// 行組件：緊湊單行（預設） / 展開編輯（當前行）
const SubtitleRow = memo(function SubtitleRow({
  subtitle,
  index,
  isCurrent,
  isFailed,
  isSelected,
  shouldShowTranslation,
  forceExpanded,
  fontScale,
  showAiOptimize,
  showSplit,
  labels,
  onRowClick,
  onFieldChange,
  onSelectionEvent,
  onSourceKeyDown,
  onTargetKeyDown,
  onAiOptimize,
  onSplit,
  onTimeCommit,
}: SubtitleRowProps) {
  // 失敗行降噪：左緣紅條 + ⚠，不再整行紅底
  const failedEdge = isFailed
    ? 'border-l-2 border-l-red-500'
    : 'border-l-2 border-l-transparent';

  const expanded = isCurrent || forceExpanded;
  const bodyFont =
    fontScale === 's'
      ? 'text-[11px]'
      : fontScale === 'l'
        ? 'text-sm'
        : 'text-xs';

  if (!expanded) {
    const src = toPreview(subtitle.sourceContent);
    const tgt = shouldShowTranslation ? toPreview(subtitle.targetContent) : '';
    return (
      <div
        id={`subtitle-${index}`}
        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs cursor-pointer transition-colors select-none ${
          isSelected ? 'bg-accent' : 'bg-card hover:bg-accent/50'
        } ${failedEdge}`}
        onClick={(e) => onRowClick(index, e.shiftKey)}
      >
        {isFailed && (
          <AlertTriangle className="h-3 w-3 flex-shrink-0 text-destructive" />
        )}
        <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          #{subtitle.id} {compactTime(subtitle.startTimeInSeconds)}→
          {compactTime(subtitle.endTimeInSeconds)}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-foreground/90 ${bodyFont}`}
        >
          {src}
          {tgt && <span className="text-muted-foreground"> / {tgt}</span>}
        </span>
        {isFailed && (
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-destructive" />
        )}
      </div>
    );
  }

  return (
    <div
      id={`subtitle-${index}`}
      className={`rounded-md ${isCurrent ? 'bg-accent' : 'bg-card'} p-1.5 text-xs ${failedEdge}`}
      onClick={(e) => {
        // 展開行：點擊行內任意位置（含字幕文本框）都選中並跳轉影片。
        // 僅「按鈕 / 時間輸入框」自行處理、不跳轉，避免打斷這些操作。
        const target = e.target as HTMLElement;
        if (target.closest('button, input')) return;
        // 點擊文本框時也跳轉，但不觸發行範圍選擇，保留文本框內的原生光標/選擇
        const inTextarea = !!target.closest('textarea');
        onRowClick(index, inTextarea ? false : e.shiftKey);
      }}
    >
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1">
          {isFailed && <AlertTriangle className="h-3 w-3 text-destructive" />}
          <TimeRangeEditor
            rowId={subtitle.id}
            startEndTime={subtitle.startEndTime}
            onCommit={(startSec, endSec) =>
              onTimeCommit(index, startSec, endSec)
            }
            labels={{
              invalidFormat: labels.timeInvalidFormat,
              editHint: labels.timeEditHint,
            }}
            suffix={
              isCurrent
                ? `${labels.currentPlaying}${
                    isFailed ? ` ${labels.translationFailedLabel}` : ''
                  }`
                : ''
            }
          />
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="flex items-center gap-0.5">
            {showAiOptimize && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAiOptimize(index);
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{labels.aiOptimize}</TooltipContent>
              </Tooltip>
            )}
            {showSplit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSplit(index);
                    }}
                  >
                    <Scissors className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{labels.split}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>

      <Textarea
        id={`subtitle-src-${index}`}
        className={`mb-2 min-h-[24px] resize-none p-1 ${bodyFont}`}
        value={subtitle.sourceContent}
        onChange={(e) => onFieldChange(index, 'sourceContent', e.target.value)}
        onClick={onSelectionEvent}
        onKeyUp={onSelectionEvent}
        onKeyDown={(e) => onSourceKeyDown(e, index)}
        placeholder={labels.originalSubtitle}
      />

      {shouldShowTranslation && (
        <Textarea
          id={`subtitle-tgt-${index}`}
          className={`resize-none p-1 ${bodyFont} ${
            subtitle.targetContent ? 'min-h-[24px]' : 'min-h-[20px]'
          } ${
            isFailed ? 'border-destructive/40 focus:border-destructive' : ''
          }`}
          value={subtitle.targetContent || ''}
          onChange={(e) =>
            onFieldChange(index, 'targetContent', e.target.value)
          }
          onKeyDown={(e) => onTargetKeyDown(e, index)}
          placeholder={
            isFailed
              ? labels.translationFailedPlaceholder
              : labels.translatedSubtitle
          }
        />
      )}
    </div>
  );
});

const SubtitleList: React.FC<SubtitleListProps> = ({
  mergedSubtitles,
  currentSubtitleIndex,
  shouldShowTranslation,
  handleSubtitleClick,
  handleSubtitleChange,
  isTranslationFailed,
  getFailedTranslationIndices,
  goToNextFailedTranslation,
  goToPreviousFailedTranslation,
  onCursorPositionChange,
  onAiOptimizeClick,
  onSplitClick,
  onTimeChange,
  retranslate,
  onMergeRange,
  expandAll,
  fontScale,
}) => {
  const { t } = useTranslation('home');

  // 獲取翻譯失敗的字幕索引
  const failedIndices = getFailedTranslationIndices();
  const hasFailedTranslations = failedIndices.length > 0;

  // 只看失敗：開啟時記錄基線 N0，隨失敗行減少展示"已處理 x/N0"
  const [failedOnly, setFailedOnly] = useState(false);
  const [failedBaseline, setFailedBaseline] = useState(0);

  const handleFailedOnlyChange = useCallback(
    (on: boolean) => {
      setFailedOnly(on);
      setFailedBaseline(on ? failedIndices.length : 0);
    },
    [failedIndices.length],
  );

  const processedCount = Math.max(0, failedBaseline - failedIndices.length);

  // 釘住正在編輯的失敗行：填上譯文後行不再"失敗"，但在用戶切走前
  // 必須留在過濾視圖裡，否則輸入第一個字符時編輯框會被卸載
  const pinnedIndexRef = useRef(-1);
  const lastCurrentRef = useRef(-2);
  if (lastCurrentRef.current !== currentSubtitleIndex) {
    lastCurrentRef.current = currentSubtitleIndex;
    pinnedIndexRef.current =
      currentSubtitleIndex >= 0 && failedIndices.includes(currentSubtitleIndex)
        ? currentSubtitleIndex
        : -1;
  }

  // 過濾映射：null = 不過濾（虛擬索引即真實索引）
  let displayIndices: number[] | null = null;
  if (failedOnly) {
    const pinned = pinnedIndexRef.current;
    displayIndices =
      pinned >= 0 && !failedIndices.includes(pinned)
        ? [...failedIndices, pinned].sort((a, b) => a - b)
        : failedIndices;
  }
  const displayCount = displayIndices
    ? displayIndices.length
    : mergedSubtitles.length;

  // 滾動容器引用
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 用戶主動點擊字幕時跳過一次自動滾動：被點擊的字幕已經在視野內，
  // 再觸發自動滾動會導致列表跳動
  const skipNextAutoScrollRef = useRef(false);

  // 最新回調引用：行回調經此分發，保持行 props 恆定讓 memo 生效
  const latestRef = useRef({
    handleSubtitleClick,
    handleSubtitleChange,
    onCursorPositionChange,
    onAiOptimizeClick,
    onSplitClick,
    onTimeChange,
    currentSubtitleIndex,
  });
  latestRef.current = {
    handleSubtitleClick,
    handleSubtitleChange,
    onCursorPositionChange,
    onAiOptimizeClick,
    onSplitClick,
    onTimeChange,
    currentSubtitleIndex,
  };

  const virtualizer = useVirtualizer({
    count: displayCount,
    getScrollElement: () => scrollContainerRef.current,
    // 緊湊行 ~30px；展開行由 measureElement 動態測量
    estimateSize: () => 34,
    overscan: 10,
    // 以真實索引作為 key，過濾切換/失敗行減少時測量緩存仍對得上行
    getItemKey: (i) => (displayIndices ? displayIndices[i] : i),
  });

  // 展開/收起全部或字號變化會改變行高，強制虛擬列表重算。
  // 注意：measure() 清空緩存後依賴 ResizeObserver 回填，但「高度未變化」的當前展開行
  // 不會觸發 ResizeObserver，會停留在估算高度（34px）導致下一行壓上來重疊。
  // 因此清空後再對所有已渲染行強制重新測量，確保當前行也拿到真實高度。
  useEffect(() => {
    virtualizer.measure();
    const container = scrollContainerRef.current;
    if (!container) return;
    container
      .querySelectorAll<HTMLElement>('[data-index]')
      .forEach((node) => virtualizer.measureElement(node));
  }, [expandAll, fontScale, virtualizer]);

  // 多選區間（歸一化 [lo, hi]，含兩端）；anchor 為最後一次普通點擊的行
  const [selRange, setSelRange] = useState<[number, number] | null>(null);
  const selAnchorRef = useRef(-1);
  const selectionEnabled = !!onMergeRange;

  // 行點擊：普通點擊 = 選中 + 展開 + 影片跳轉（沿用現有聯動）並清選區；
  // Shift+點擊 = 僅擴展選區（不展開不跳轉）；失敗過濾視圖下退化為普通點擊
  const onRowClick = useCallback(
    (index: number, shiftKey: boolean) => {
      if (shiftKey && selectionEnabled && !failedOnly) {
        const anchor =
          selAnchorRef.current >= 0
            ? selAnchorRef.current
            : latestRef.current.currentSubtitleIndex >= 0
              ? latestRef.current.currentSubtitleIndex
              : index;
        selAnchorRef.current = anchor;
        setSelRange([Math.min(anchor, index), Math.max(anchor, index)]);
        return;
      }
      selAnchorRef.current = index;
      setSelRange(null);
      if (index !== latestRef.current.currentSubtitleIndex) {
        skipNextAutoScrollRef.current = true;
      }
      latestRef.current.handleSubtitleClick(index);
    },
    [selectionEnabled, failedOnly],
  );

  // Esc 清除選區
  useEffect(() => {
    if (!selRange) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelRange(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selRange]);

  // 字幕數量變化（合併/拆分）後索引錯位，選區失效
  const subtitleCount = mergedSubtitles.length;
  useEffect(() => {
    setSelRange(null);
    selAnchorRef.current = -1;
  }, [subtitleCount]);

  // 選區合併：hook 端 slice(start, endExclusive)
  const selCount = selRange ? selRange[1] - selRange[0] + 1 : 0;
  const handleMergeSelection = useCallback(() => {
    if (!selRange || selRange[1] <= selRange[0]) return;
    onMergeRange?.(selRange[0], selRange[1] + 1);
    selAnchorRef.current = -1;
    setSelRange(null);
  }, [selRange, onMergeRange]);

  const onFieldChange = useCallback(
    (
      index: number,
      field: 'sourceContent' | 'targetContent',
      value: string,
    ) => {
      latestRef.current.handleSubtitleChange(index, field, value);
    },
    [],
  );

  // 光標位置變化（用於拆分功能）
  const onSelectionEvent = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement;
      latestRef.current.onCursorPositionChange?.(target.selectionStart || 0);
    },
    [],
  );

  // Tab/Shift+Tab：同一行內原文⇄譯文切換焦點（阻斷瀏覽器預設的順序跳轉）
  const focusRowField = (index: number, field: 'src' | 'tgt') => {
    const el = document.getElementById(
      `subtitle-${field}-${index}`,
    ) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      el.select?.();
    }
  };

  const onSourceKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (e.key === 'Tab' && !e.shiftKey && shouldShowTranslation) {
        e.preventDefault();
        focusRowField(index, 'tgt');
      }
    },
    [shouldShowTranslation],
  );

  const onTargetKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        focusRowField(index, 'src');
      }
    },
    [],
  );

  const onAiOptimize = useCallback((index: number) => {
    latestRef.current.onAiOptimizeClick?.(index);
  }, []);

  const onSplit = useCallback((index: number) => {
    latestRef.current.onSplitClick?.(index);
  }, []);

  const onTimeCommit = useCallback(
    (index: number, startSec: number, endSec: number): string | null => {
      return latestRef.current.onTimeChange?.(index, startSec, endSec) ?? null;
    },
    [],
  );

  // 行內文案（memo 化保持引用穩定）
  const labels = useMemo<RowLabels>(
    () => ({
      currentPlaying: t('currentPlaying'),
      translationFailedLabel: t('translationFailedLabel'),
      originalSubtitle: t('originalSubtitle'),
      translatedSubtitle: t('translatedSubtitle'),
      translationFailedPlaceholder: t('translationFailedPlaceholder'),
      aiOptimize: t('aiOptimize'),
      split: t('split'),
      timeInvalidFormat: t('timeEditInvalidFormat'),
      timeEditHint: t('timeEditHint'),
    }),
    [t],
  );

  // 自動滾動到當前字幕（播放跟隨 / 失敗翻譯跳轉 / 上下條導航時生效）
  // 用戶主動點擊的字幕不滾動；等一幀讓展開行完成測量後再定位
  // 過濾模式下需把真實索引映射為列表位置；不在列表中則不滾動
  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    if (currentSubtitleIndex < 0) return;
    const listIndex = displayIndices
      ? displayIndices.indexOf(currentSubtitleIndex)
      : currentSubtitleIndex;
    if (listIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(listIndex, { align: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
    // displayIndices 內容隨失敗行變化，僅在當前行/過濾開關變化時重定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSubtitleIndex, failedOnly, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="h-full flex flex-col border rounded-md overflow-hidden">
      {/* 狀態/失敗操作欄（視圖控制已上移至編輯工具欄；窄寬下換行避免重疊）
          純轉寫模式無翻譯狀態與失敗操作，整條隱藏避免空欄 */}
      {shouldShowTranslation && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 p-2 border-b bg-muted/30 flex-shrink-0">
          <div className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground">
            <>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {failedIndices.length === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-warning" />
                )}
                <span className="tabular-nums">
                  {t('transStatTotal', { count: mergedSubtitles.length })}
                  {' · '}
                  {t('transStatSuccess', {
                    count: mergedSubtitles.length - failedIndices.length,
                  })}
                  {' · '}
                  <span
                    className={
                      failedIndices.length > 0
                        ? 'text-destructive font-semibold'
                        : ''
                    }
                  >
                    {t('transStatFailed', { count: failedIndices.length })}
                  </span>
                </span>
              </div>
              {(hasFailedTranslations || failedOnly) && (
                <label className="flex flex-shrink-0 cursor-pointer select-none items-center gap-1.5 text-xs">
                  <Switch
                    checked={failedOnly}
                    onCheckedChange={handleFailedOnlyChange}
                    className="scale-75"
                  />
                  {t('failedOnlyLabel')}
                </label>
              )}
              {failedOnly && failedBaseline > 0 && (
                <span className="flex-shrink-0 text-xs tabular-nums">
                  {t('failedProcessedProgress')
                    .replace('{{done}}', String(processedCount))
                    .replace('{{total}}', String(failedBaseline))}
                </span>
              )}
            </>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {shouldShowTranslation &&
              retranslate &&
              hasFailedTranslations &&
              (retranslate.running ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="tabular-nums">
                    {retranslate.done}/{retranslate.total}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={retranslate.cancel}
                    disabled={retranslate.cancelling}
                  >
                    <CircleStop className="h-4 w-4" />
                    {retranslate.cancelling ? t('cancelling') : t('cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={retranslate.start}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  {t('retranslateFailedBtn').replace(
                    '{{count}}',
                    String(failedIndices.length),
                  )}
                </Button>
              ))}
            {shouldShowTranslation && hasFailedTranslations && (
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousFailedTranslation}
                  className="h-7 px-2"
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToNextFailedTranslation}
                  className="h-7 px-2"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 多選操作條：Shift+點選連續區間後出現 */}
      {selRange && selCount >= 2 && (
        <div className="flex items-center justify-between gap-2 border-b bg-accent/40 p-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('selectionInfo', {
              count: selCount,
              from: selRange[0] + 1,
              to: selRange[1] + 1,
            })}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="default"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleMergeSelection}
            >
              <Combine className="mr-1 h-3 w-3" />
              {t('mergeSelected', { count: selCount })}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setSelRange(null)}
            >
              <X className="h-4 w-4" />
              {t('clearSelection')}
            </Button>
          </div>
        </div>
      )}

      {/* 字幕列表（虛擬化；只看失敗時為過濾視圖） */}
      <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
        {failedOnly && displayCount === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <span>{t('failedAllClear')}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => handleFailedOnlyChange(false)}
            >
              {t('showAllSubtitles')}
            </Button>
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => {
              const index = displayIndices
                ? displayIndices[virtualItem.index]
                : virtualItem.index;
              const subtitle = mergedSubtitles[index];
              if (subtitle === undefined) return null;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full px-1 pb-1"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <SubtitleRow
                    subtitle={subtitle}
                    index={index}
                    isCurrent={index === currentSubtitleIndex}
                    isFailed={isTranslationFailed(subtitle)}
                    isSelected={
                      !!selRange && index >= selRange[0] && index <= selRange[1]
                    }
                    shouldShowTranslation={shouldShowTranslation}
                    forceExpanded={expandAll}
                    fontScale={fontScale}
                    showAiOptimize={!!onAiOptimizeClick}
                    showSplit={!!onSplitClick}
                    labels={labels}
                    onRowClick={onRowClick}
                    onFieldChange={onFieldChange}
                    onSelectionEvent={onSelectionEvent}
                    onSourceKeyDown={onSourceKeyDown}
                    onTargetKeyDown={onTargetKeyDown}
                    onAiOptimize={onAiOptimize}
                    onSplit={onSplit}
                    onTimeCommit={onTimeCommit}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SubtitleList;
