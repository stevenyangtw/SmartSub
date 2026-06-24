import React, { createContext, useContext, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import DownloadSourceSelector, {
  DownloadSourceOption,
} from '@/components/resources/engines/DownloadSourceSelector';

/** 下載源配置：在「點擊下載」時於氣泡內選擇，不常駐佔位。 */
export interface DownloadSourceConfig {
  value: string;
  options: DownloadSourceOption[];
  onChange: (value: string) => void;
  /** 選擇器標題，如「下載源」。 */
  label: string;
  /** 確認按鈕文案，如「開始下載」。 */
  confirmLabel: string;
  hint?: string;
  /**
   * 可選：按「當前所選源」返回可複製的下載鏈接。
   * 提供時氣泡內會在「開始下載」左側顯示覆制按鈕，複製內容隨選中源自動切換。
   * 返回 null/undefined 表示該源無可複製鏈接（複製按鈕按下時給出失敗提示）。
   */
  getCopyUrl?: (
    source: string,
  ) => string | null | undefined | Promise<string | null | undefined>;
}

/**
 * 下載源在「點擊下載時」才選擇：上下文攜帶源配置，由真正發起下載的葉子組件
 * （DownModel / FunasrModelSection）消費並就地彈出 Popover。Provider 之外
 * （設置頁 / 引導頁等）取到 null，行為保持原樣（直接下載）。
 */
const DownloadSourceContext = createContext<DownloadSourceConfig | null>(null);

export const DownloadSourceProvider = DownloadSourceContext.Provider;

export function useDownloadSource(): DownloadSourceConfig | null {
  return useContext(DownloadSourceContext);
}

interface DownloadSourcePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: DownloadSourceConfig;
  onConfirm: () => void;
  /** 作為錨點的觸發元素（下載按鈕），需可轉發 ref。 */
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  /**
   * 可選：按「當前所選源」返回可複製鏈接。優先級高於 config.getCopyUrl，
   * 供「一份共享 config 對應多模型」的場景（ModelLibrarySection / Funasr 各行）
   * 由葉子按本行模型就地提供。
   */
  getCopyUrl?: DownloadSourceConfig['getCopyUrl'];
}

/**
 * 「下載源」氣泡：以傳入的觸發元素為錨點，內含分段選源 + 複製鏈接 + 「開始下載」。
 * 點擊確認即關閉併發起下載；複製按鈕按當前選中源解析鏈接並寫入剪貼板（不關閉氣泡）。
 * 零常駐佔位，符合「點下載再選」。
 */
const DownloadSourcePopover: React.FC<DownloadSourcePopoverProps> = ({
  open,
  onOpenChange,
  config,
  onConfirm,
  children,
  align = 'end',
  getCopyUrl: getCopyUrlProp,
}) => {
  const { t } = useTranslation('modelsControl');
  const [copying, setCopying] = useState(false);
  const getCopyUrl = getCopyUrlProp ?? config.getCopyUrl;

  const handleCopy = async () => {
    if (!getCopyUrl || copying) return;
    setCopying(true);
    try {
      const url = await Promise.resolve(getCopyUrl(config.value));
      if (!url) {
        toast.error(t('copyError'), { duration: 2000 });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t('copySuccess'), { duration: 2000 });
    } catch {
      toast.error(t('copyError'), { duration: 2000 });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align={align} className="w-80 space-y-3">
        <DownloadSourceSelector
          label={config.label}
          value={config.value}
          options={config.options}
          onChange={config.onChange}
          hint={config.hint}
        />
        <div className="flex items-center gap-2">
          {getCopyUrl && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              onClick={handleCopy}
              disabled={copying}
              aria-label={t('copyLink')}
              title={t('copyLink')}
            >
              <Copy className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            <Download className="h-4 w-4" />
            {config.confirmLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DownloadSourcePopover;
