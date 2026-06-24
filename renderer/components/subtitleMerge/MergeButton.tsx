/**
 * 輸出控件與合成按鈕組件（進度/成功/錯誤狀態由預覽區浮層呈現）
 */

import React from 'react';
import { useTranslation } from 'next-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HelpHint } from '@/components/HelpHint';
import { Loader2, Play, FolderOpen, Flame, Layers } from 'lucide-react';
import type {
  MergeStatus,
  MergeOutputMode,
  VideoQuality,
} from '../../../types/subtitleMerge';

interface MergeButtonProps {
  outputPath: string | null;
  outputMode: MergeOutputMode;
  videoQuality: VideoQuality;
  status: MergeStatus;
  canMerge: boolean;
  onSelectOutputPath: () => void;
  onOutputModeChange: (mode: MergeOutputMode) => void;
  onVideoQualityChange: (quality: VideoQuality) => void;
  onStartMerge: () => void;
}

export default function MergeButton({
  outputPath,
  outputMode,
  videoQuality,
  status,
  canMerge,
  onSelectOutputPath,
  onOutputModeChange,
  onVideoQualityChange,
  onStartMerge,
}: MergeButtonProps) {
  const { t } = useTranslation('subtitleMerge');
  const isProcessing = status === 'processing';
  // 畫質僅對硬字幕燒錄生效；軟封裝為流複製無損，無需該選項
  const isHardcode = outputMode === 'hardcode';
  const qualityOptions: Array<{ value: VideoQuality; label: string }> = [
    { value: 'original', label: t('videoQualityOriginal') },
    { value: 'high', label: t('videoQualityHigh') },
    { value: 'standard', label: t('videoQualityStandard') },
  ];

  const modeOptions: Array<{
    value: MergeOutputMode;
    icon: React.ReactNode;
    title: string;
    desc: string;
  }> = [
    {
      value: 'hardcode',
      icon: <Flame className="w-3.5 h-3.5" />,
      title: t('outputModeHardcode'),
      desc: t('outputModeHardcodeDesc'),
    },
    {
      value: 'softmux',
      icon: <Layers className="w-3.5 h-3.5" />,
      title: t('outputModeSoftmux'),
      desc: t('outputModeSoftmuxDesc'),
    },
  ];

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* 輸出方式 */}
        <div className="space-y-2">
          <Label className="text-sm">{t('outputMode')}</Label>
          <div className="grid grid-cols-2 gap-2">
            {modeOptions.map((option) => {
              const active = outputMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => onOutputModeChange(option.value)}
                  className={`rounded-md border p-2 text-left transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {option.icon}
                    {option.title}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {option.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 導出畫質（僅燒錄硬字幕生效；提示移入 HelpHint 以壓縮高度） */}
        {isHardcode && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">{t('videoQuality')}</Label>
              <HelpHint text={t('videoQualityHint')} />
            </div>
            <Select
              value={videoQuality}
              onValueChange={(v) => onVideoQualityChange(v as VideoQuality)}
              disabled={isProcessing}
            >
              <SelectTrigger className="h-8 w-[150px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {qualityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 輸出路徑：標籤 + 輸入框 + 選擇按鈕 同行 */}
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-sm">{t('outputPath')}</Label>
          <Input
            type="text"
            value={outputPath || ''}
            readOnly
            placeholder={t('selectOutputPath')}
            className="min-w-0 flex-1 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={onSelectOutputPath}
            className="shrink-0"
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
        </div>

        {/* 合併按鈕 */}
        <Button
          className="w-full"
          size="lg"
          onClick={onStartMerge}
          disabled={!canMerge || isProcessing}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              {t('processing')}
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-2" />
              {t('generateVideo')}
            </>
          )}
        </Button>
      </div>
    </TooltipProvider>
  );
}
