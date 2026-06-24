/**
 * 影片預覽組件
 * 按真實影片比例顯示影片和字幕效果；使用原生播放控制條，處理狀態以浮層呈現
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import ReactPlayer from 'react-player';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle, XCircle, Folder } from 'lucide-react';
import type {
  SubtitleStyle,
  VideoInfo,
  MergeProgress,
  MergeStatus,
} from '../../../types/subtitleMerge';
import SubtitlePreviewOverlay from './SubtitlePreviewOverlay';
import { LIBASS_SRT_PLAYRES_Y } from './utils/styleUtils';

interface VideoPreviewProps {
  videoPath: string | null;
  videoInfo: VideoInfo | null;
  style: SubtitleStyle;
  subtitlePath?: string | null;
  sampleText?: string;
  /** 合成進度（用於處理中/錯誤浮層） */
  progress?: MergeProgress;
  /** 合成狀態（驅動浮層顯隱） */
  status?: MergeStatus;
  /** 取消中標記 */
  isCancelling?: boolean;
  /** 取消合成 */
  onCancelMerge?: () => void;
  /** 打開輸出資料夾 */
  onOpenOutputFolder?: () => void;
}

interface PreviewCue {
  startSec: number;
  endSec: number;
  text: string;
}

// SRT 時間 "HH:MM:SS,mmm" → 秒
const srtTimeToSeconds = (time: string): number => {
  const match = time.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return NaN;
  const [, h, m, s, ms] = match;
  return (
    Number(h) * 3600 +
    Number(m) * 60 +
    Number(s) +
    Number(ms.padEnd(3, '0')) / 1000
  );
};

// 二分查找當前時間所在條目：最後一個 startSec <= t 的候選，再驗 endSec
const findCueAtTime = (cues: PreviewCue[], time: number): PreviewCue | null => {
  let lo = 0;
  let hi = cues.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startSec <= time) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return null;
  return cues[candidate].endSec > time ? cues[candidate] : null;
};

export default function VideoPreview({
  videoPath,
  videoInfo,
  style,
  subtitlePath = null,
  sampleText = '字幕預覽效果',
  progress,
  status = 'idle',
  isCancelling = false,
  onCancelMerge,
  onOpenOutputFolder,
}: VideoPreviewProps) {
  const { t } = useTranslation('subtitleMerge');
  const playerRef = useRef<ReactPlayer>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [cues, setCues] = useState<PreviewCue[]>([]);
  // 預覽框尺寸：按可視區寬高擬合最大矩形，保證完整可見且不撐出滾動條
  const [box, setBox] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // 預覽盒寬高比：優先用真實影片比例（非 16:9 影片也能所見即所得），否則回退 16:9
  const aspect =
    videoInfo && videoInfo.width > 0 && videoInfo.height > 0
      ? videoInfo.width / videoInfo.height
      : 16 / 9;

  // 監聽預覽區尺寸變化，重算最大可容納的盒子（取按寬/按高撐滿中較小者）
  useEffect(() => {
    const el = previewAreaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const compute = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      let width = w;
      let height = w / aspect;
      if (height > h) {
        height = h;
        width = h * aspect;
      }
      setBox({ width, height });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // 選中字幕文件後解析真實條目（清除則回退樣例文字）
  useEffect(() => {
    if (!subtitlePath) {
      setCues([]);
      return;
    }
    let stale = false;
    (async () => {
      try {
        const entries: Array<{ startEndTime: string; content: string[] }> =
          await window.ipc.invoke('readSubtitleFile', {
            filePath: subtitlePath,
          });
        if (stale) return;
        const parsed = (entries || [])
          .map((entry) => {
            const [start, end] = (entry.startEndTime || '').split('-->');
            return {
              startSec: srtTimeToSeconds(start || ''),
              endSec: srtTimeToSeconds(end || ''),
              text: (entry.content || []).join('\n'),
            };
          })
          .filter(
            (cue) =>
              Number.isFinite(cue.startSec) &&
              Number.isFinite(cue.endSec) &&
              cue.text.trim() !== '',
          );
        setCues(parsed);
      } catch (error) {
        console.error('解析預覽字幕失敗:', error);
        if (!stale) setCues([]);
      }
    })();
    return () => {
      stale = true;
    };
  }, [subtitlePath]);

  // 疊加層文字：有字幕文件時所見即所得（空檔期不顯示），否則用樣例文字調樣式
  const currentCue = cues.length > 0 ? findCueAtTime(cues, currentTime) : null;
  const overlayText =
    subtitlePath && cues.length > 0 ? (currentCue?.text ?? null) : sampleText;

  // 處理進度更新（原生控制條拖動同樣會觸發，保證字幕疊加層同步）
  const handleProgress = ({ playedSeconds }: { playedSeconds: number }) => {
    setCurrentTime(playedSeconds);
  };

  const isProcessing = status === 'processing';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 預覽區域 - 自適應高度，保持真實比例完整可見 */}
      <div
        ref={previewAreaRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          className="relative bg-black rounded-lg overflow-hidden"
          style={
            box.width > 0
              ? { width: box.width, height: box.height }
              : { width: '100%', aspectRatio: String(aspect) }
          }
        >
          <div className="absolute inset-0 flex items-center justify-center">
            {videoPath ? (
              <>
                {/* 影片播放器：原生控制條 */}
                <ReactPlayer
                  ref={playerRef}
                  url={`media://${encodeURIComponent(videoPath)}`}
                  width="100%"
                  height="100%"
                  playing={isPlaying}
                  controls={true}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onProgress={handleProgress}
                  progressInterval={100}
                  style={{ position: 'absolute', top: 0, left: 0 }}
                />

                {/* CSS 模擬字幕疊加層（真實條目優先，未選字幕時顯示樣例）。
                  scale=盒高/333：讓預覽字號隨預覽框大小等比縮放，≈燒錄後字號 */}
                {overlayText !== null && (
                  <SubtitlePreviewOverlay
                    style={style}
                    text={overlayText}
                    scale={
                      box.height > 0 ? box.height / LIBASS_SRT_PLAYRES_Y : 1
                    }
                  />
                )}
              </>
            ) : (
              <div className="text-muted-foreground text-center">
                <p className="text-sm">{t('selectVideoToPreview')}</p>
              </div>
            )}
          </div>

          {/* 處理中浮層：不撐高佈局，居中半透明面板 + 進度 + 取消 */}
          {isProcessing && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
              <div className="w-2/3 max-w-xs space-y-1.5">
                <div className="flex items-center justify-between text-xs text-white/90">
                  <span>{t('processing')}</span>
                  <span className="font-medium">
                    {Math.round(progress?.percent ?? 0)}%
                  </span>
                </div>
                <Progress value={progress?.percent ?? 0} className="h-1.5" />
                {progress?.timeMark && (
                  <p className="text-[11px] text-white/70">
                    {t('currentTime')}: {progress.timeMark}
                  </p>
                )}
              </div>
              {onCancelMerge && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={onCancelMerge}
                  disabled={isCancelling}
                >
                  <XCircle className="mr-1 h-3 w-3" />
                  {isCancelling ? t('cancelling') : t('cancel')}
                </Button>
              )}
            </div>
          )}

          {/* 成功浮層：右上角卡片，不全遮擋畫面 */}
          {status === 'completed' && (
            <div className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded-lg border border-success/40 bg-background/95 px-3 py-2 shadow-lg">
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-xs text-success">{t('mergeSuccess')}</span>
              {onOpenOutputFolder && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={onOpenOutputFolder}
                >
                  <Folder className="mr-1 h-3 w-3" />
                  {t('openFolder')}
                </Button>
              )}
            </div>
          )}

          {/* 錯誤浮層：底部條 */}
          {status === 'error' && progress?.errorMessage && (
            <div className="absolute inset-x-2 bottom-2 z-20 flex items-start gap-2 rounded-lg border border-destructive/40 bg-background/95 px-3 py-2 shadow-lg">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-destructive">
                  {t('mergeError')}
                </p>
                <p className="mt-0.5 break-all text-[11px] text-destructive/70">
                  {progress.errorMessage}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
