/**
 * 字幕合併主面板組件
 * 左欄：文件 + 樣式 + 輸出控件（滾動）；右欄：預覽獨佔並最大化，處理狀態以浮層呈現
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import FileSelector from './FileSelector';
import StylePresets from './StylePresets';
import BasicStyleSettings from './BasicStyleSettings';
import AdvancedStyleSettings from './AdvancedStyleSettings';
import VideoPreview from './VideoPreview';
import MergeButton from './MergeButton';
import {
  useSubtitleMerge,
  type UseSubtitleMergeOptions,
} from './hooks/useSubtitleMerge';

interface SubtitleMergePanelProps extends UseSubtitleMergeOptions {
  /** 面板標題 */
  title?: string;
  /** 是否顯示標題 */
  showTitle?: boolean;
  /** 自定義類名 */
  className?: string;
}

/**
 * 字幕合併主面板
 * 可獨立使用，也可嵌入到其他頁面中
 */
export default function SubtitleMergePanel({
  title,
  showTitle = true,
  className = '',
  ...hookOptions
}: SubtitleMergePanelProps) {
  const { t } = useTranslation('subtitleMerge');

  const {
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
    status,

    // 文件操作方法
    selectVideo,
    selectSubtitle,
    clearVideo,
    clearSubtitle,

    // 樣式操作方法
    updateStyle,
    applyPreset,

    // 輸出操作方法
    selectOutputPath,
    setOutputMode,
    setVideoQuality,

    // 合併操作方法
    startMerge,
    cancelMerge,
    isCancelling,
    canMerge,

    // 其他方法
    openOutputFolder,
  } = useSubtitleMerge(hookOptions);

  const isProcessing = status === 'processing';
  // 軟字幕樣式由播放器決定，樣式設置僅對燒錄生效
  const isSoftMux = outputMode === 'softmux';
  const styleDisabled = isProcessing || isSoftMux;

  return (
    <div className={`h-full flex flex-col ${className}`}>
      {videoPath && subtitlePath && !outputPath && status !== 'processing' && (
        <div className="flex-shrink-0 mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-muted-foreground">
          {t('outputPathRequiredHint')}
        </div>
      )}
      {/* 文件選擇區域 - 緊湊型，置頂全寬 */}
      <div className="flex-shrink-0 mb-3">
        <FileSelector
          videoPath={videoPath}
          subtitlePath={subtitlePath}
          videoInfo={videoInfo}
          subtitleInfo={subtitleInfo}
          onSelectVideo={selectVideo}
          onSelectSubtitle={selectSubtitle}
          onClearVideo={clearVideo}
          onClearSubtitle={clearSubtitle}
          disabled={isProcessing}
        />
      </div>

      {/* 主內容區域 - 左：設置+輸出（窄欄滾動）；右：預覽獨佔（最大化） */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(340px,400px)_1fr] gap-3">
        {/* 左側：樣式設置 + 輸出控件 */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <CardContent className="flex-1 min-h-0 p-0">
            <ScrollArea className="h-full">
              <div className="space-y-3 p-4">
                {/* 軟字幕模式提示：樣式僅對燒錄生效 */}
                {isSoftMux && (
                  <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                    {t('styleOnlyForHardcode')}
                  </p>
                )}

                {/* 預設樣式 */}
                <StylePresets
                  activePresetId={activePresetId}
                  onSelectPreset={applyPreset}
                  disabled={styleDisabled}
                />

                <Separator />

                {/* 基礎設置 */}
                <div>
                  <h3 className="label-caps mb-2">{t('basicSettings')}</h3>
                  <BasicStyleSettings
                    style={style}
                    onUpdateStyle={updateStyle}
                    disabled={styleDisabled}
                  />
                </div>

                <Separator />

                {/* 高級設置 */}
                <AdvancedStyleSettings
                  style={style}
                  onUpdateStyle={updateStyle}
                  disabled={styleDisabled}
                />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* 右側：上=預覽（最大化），下=輸出控件，填滿預覽之外的豎向空間 */}
        <div className="flex flex-col min-h-0 gap-3">
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardContent className="flex-1 min-h-0 p-3 overflow-hidden">
              <VideoPreview
                videoPath={videoPath}
                videoInfo={videoInfo}
                style={style}
                subtitlePath={subtitlePath}
                progress={progress}
                status={status}
                isCancelling={isCancelling}
                onCancelMerge={cancelMerge}
                onOpenOutputFolder={openOutputFolder}
              />
            </CardContent>
          </Card>

          {/* 輸出方式 + 畫質 + 路徑 + 生成 */}
          <Card className="flex-shrink-0">
            <CardContent className="p-4">
              <MergeButton
                outputPath={outputPath}
                outputMode={outputMode}
                videoQuality={videoQuality}
                status={status}
                canMerge={canMerge}
                onSelectOutputPath={selectOutputPath}
                onOutputModeChange={setOutputMode}
                onVideoQualityChange={setVideoQuality}
                onStartMerge={startMerge}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
