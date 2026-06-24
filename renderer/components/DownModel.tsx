import React, { useEffect, useRef, useCallback, FC, ReactNode } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'next-i18next';
import DownloadSourcePopover, {
  useDownloadSource,
} from '@/components/resources/engines/DownloadSourcePopover';

export type ModelDownloadFormat = 'ggml' | 'ct2';

interface DownloadDetail {
  status: string;
  progress: number;
  downloaded: number;
  total: number;
  speed: number;
  eta: number;
  error?: string;
}

interface IProps {
  modelName: string;
  callBack: () => void;
  downSource: string;
  children: ReactNode;
  needsCoreML?: boolean;
  globalDownloading?: boolean;
  format?: ModelDownloadFormat;
  /** 氣泡內「複製鏈接」：按當前所選源返回本模型可複製的下載鏈接（不提供則不顯示覆制）。 */
  getCopyUrl?: (source: string) => string | null | undefined;
}

function getProgressKey(
  modelName: string,
  format: ModelDownloadFormat,
): string {
  return format === 'ct2' ? `ct2:${modelName}` : modelName;
}

// 代理/VPN 攔截國內鏡像時的典型底層報錯特徵（TLS 握手中途 socket 被斷、連接重置等）。
// 命中即在失敗提示裡追加一句中文引導，避免用戶對著英文一頭霧水。
const PROXY_ERROR_PATTERNS = [
  'socket disconnected',
  'econnreset',
  'etimedout',
  'enotfound',
  'eai_again',
  'econnrefused',
  'tunneling socket',
  'network socket',
  'tls',
  'certificate',
];

function isLikelyProxyError(error?: string): boolean {
  if (!error) return false;
  const e = String(error).toLowerCase();
  return PROXY_ERROR_PATTERNS.some((p) => e.includes(p));
}

const DownModel: FC<IProps> = ({
  modelName,
  callBack,
  downSource,
  children,
  needsCoreML = true,
  globalDownloading = false,
  format = 'ggml',
  getCopyUrl,
}) => {
  const { t } = useTranslation('common');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [detail, setDetail] = React.useState<DownloadDetail | null>(null);
  const callBackRef = useRef(callBack);
  callBackRef.current = callBack;
  const progressKey = getProgressKey(modelName, format);

  useEffect(() => {
    const handleProgress = (model: string, progressValue: number) => {
      if (model?.toLowerCase() === progressKey?.toLowerCase()) {
        setProgress(progressValue);
      }
    };

    const handleDetail = (model: string, detailData: DownloadDetail) => {
      if (model?.toLowerCase() === progressKey?.toLowerCase()) {
        setDetail(detailData);
      }
    };

    const unsubProgress = window?.ipc?.on('downloadProgress', handleProgress);
    const unsubDetail = window?.ipc?.on('modelDownloadDetail', handleDetail);

    return () => {
      unsubProgress?.();
      unsubDetail?.();
    };
  }, [progressKey]);

  const handleDownModel = useCallback(async () => {
    if (globalDownloading) return;
    try {
      setLoading(true);
      setProgress(0);
      setDetail(null);
      const result =
        format === 'ct2'
          ? await window?.ipc?.invoke('downloadCt2Model', {
              model: modelName,
              source: downSource,
            })
          : await window?.ipc?.invoke('downloadModel', {
              model: modelName,
              source: downSource,
              needsCoreML,
            });
      setLoading(false);
      if (result?.success) {
        setProgress(1);
        callBackRef.current();
      } else if (result?.error === 'anotherDownloadInProgress') {
        toast.error(t('downloadBusy'));
      } else if (
        result?.error &&
        !String(result.error).toLowerCase().includes('cancelled')
      ) {
        // 用戶主動取消時 download promise 以 "Download cancelled" reject，
        // 主進程同樣返回 success:false，但不應視為失敗提示
        toast.error(
          t('downloadFailedToast', { error: result.error }),
          isLikelyProxyError(result.error)
            ? { description: t('downloadProxyHint'), duration: 8000 }
            : undefined,
        );
      }
    } catch (error) {
      console.error('Download model failed:', error);
      setLoading(false);
    }
  }, [modelName, downSource, needsCoreML, globalDownloading, format, t]);

  const handleCancel = useCallback(async () => {
    try {
      await window?.ipc?.invoke('cancelModelDownload');
    } catch (error) {
      console.error('Cancel model download failed:', error);
    }
  }, []);

  const isDisabled = globalDownloading && !loading;

  // 下載源在「點擊下載時」才選擇：上層通過 DownloadSourceProvider 注入源配置時，
  // 點擊下載先彈氣泡選源，確認後再真正下載；無配置時（設置頁 / 引導頁）保持直接下載。
  const sourceConfig = useDownloadSource();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const triggerDownload = sourceConfig
    ? () => setPickerOpen(true)
    : handleDownModel;

  const child = React.isValidElement<{
    loading?: boolean;
    progress?: number;
    detail?: DownloadDetail | null;
    handleDownModel?: () => void;
    handleCancel?: () => void;
    disabled?: boolean;
  }>(children)
    ? React.cloneElement(children, {
        loading,
        progress,
        detail,
        handleDownModel: triggerDownload,
        handleCancel,
        disabled: isDisabled,
      })
    : children;

  const anchor = <span className="inline-block">{child}</span>;

  if (!sourceConfig) return anchor;

  return (
    <DownloadSourcePopover
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      config={sourceConfig}
      onConfirm={handleDownModel}
      getCopyUrl={getCopyUrl}
    >
      {anchor}
    </DownloadSourcePopover>
  );
};

export default DownModel;
