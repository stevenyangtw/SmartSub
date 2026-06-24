import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'lib/utils';
import FasterWhisperPanel from '@/components/resources/engines/panels/FasterWhisperPanel';
import SherpaEngineGroupPanel, {
  type SherpaFamilyKey,
} from '@/components/resources/engines/SherpaEngineGroupPanel';
import LocalCliPanel from '@/components/resources/engines/panels/LocalCliPanel';
import BuiltinPanel from '@/components/resources/engines/panels/BuiltinPanel';
import EngineIcon from '@/components/resources/engines/EngineIcon';
import ModelLibrarySection from '@/components/resources/ModelLibrarySection';
import { type DownloadSourceConfig } from '@/components/resources/engines/DownloadSourcePopover';
import { resolveModelDownloadUrl } from 'lib/resolveModelDownloadUrl';
import { useSherpaRuntime } from '@/components/resources/engines/useSherpaRuntime';
import useLocalStorageState from 'hooks/useLocalStorageState';
import {
  readPersistedDownloadSource,
  persistDownloadSource,
} from '@/components/settings/gpu/gpuDownloadUtils';
import type { DownloadSource } from '../../../types/addon';
import type {
  EngineStatus,
  PyEngineDownloadProgress,
  PyEngineUpdateInfo,
  TranscriptionEngine,
} from '../../../types/engine';
import { ISystemInfo } from '../../../types/types';

type EngineStatuses = Partial<Record<TranscriptionEngine, EngineStatus>>;
type StatusTone = 'ready' | 'pending' | 'downloading' | 'error';

/**
 * 左欄「視圖」單位：多數與真實引擎 id 一一對應；'sherpa' 是把同源（共用 sherpa-onnx
 * 運行庫）的 FunASR · Qwen · FireRed 合併為一項展示（僅 UI 合併，後端引擎 id 不變）。
 */
type EngineView = TranscriptionEngine | 'sherpa';

/** sherpa 展示組覆蓋的真實引擎 id（順序即組內分區順序）。 */
const SHERPA_FAMILIES: SherpaFamilyKey[] = ['funasr', 'qwen', 'fireRedAsr'];

const ENGINE_VIEWS: EngineView[] = [
  'builtin',
  'fasterWhisper',
  'sherpa',
  'localCli',
];

function isQueueBusy(status: string | undefined): boolean {
  return status === 'running' || status === 'paused' || status === 'cancelling';
}

function StatusDot({ tone, label }: { tone: StatusTone; label?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        tone === 'ready' && 'bg-success',
        tone === 'error' && 'bg-destructive',
        tone === 'downloading' && 'bg-primary animate-pulse',
        tone === 'pending' && 'bg-muted-foreground/40',
      )}
    />
  );
}

/**
 * 統一「引擎與模型」主從雙欄視圖：左欄引擎列表（狀態點，無啟用開關），
 * 右欄 = 選中引擎的運行時管理（內聯各引擎面板，無彈窗）+ 該引擎模型清單。
 * 選中態為本地 state，不寫全局；不提供"設為當前/啟用"。
 */
const EngineModelTab: React.FC = () => {
  const { t } = useTranslation('resources');
  const { t: commonT } = useTranslation('common');

  // 記住上次選中的視圖，避免每次進入頁面都跳回 builtin。
  // 用新 key（engineModelSelectedView）：舊 key 可能存了 funasr/qwen/fireRedAsr，
  // 現已併入 'sherpa' 組，換 key 自然回落預設，避免讀到失效選項。
  const [selectedView, setSelectedView] = useLocalStorageState<EngineView>(
    'engineModelSelectedView',
    'builtin',
    (v) => (ENGINE_VIEWS as string[]).includes(v as string),
  );

  // FunASR 與 Qwen 共用的 sherpa-onnx 運行庫狀態（上提到此常駐組件，切換引擎不丟進度）。
  const sherpa = useSherpaRuntime();

  // 引擎運行時狀態
  const [engineStatuses, setEngineStatuses] = useState<EngineStatuses>({});
  const [device, setDevice] = useState<'auto' | 'cpu' | 'cuda'>('auto');
  const [computeType, setComputeType] = useState('auto');
  const [whisperCommand, setWhisperCommand] = useState('');
  const [localCliEnabled, setLocalCliEnabled] = useState(false);
  const [platform, setPlatform] = useState('');
  // 運行時變體：cpu=預設包（所有平臺），cuda=Full GPU 包（僅 Win/Linux，捆綁 cuBLAS/cuDNN）。
  // 下載前的選擇記憶在本地；已安裝變體以引擎狀態(manifest)為準。
  const [selectedVariant, setSelectedVariant] = useLocalStorageState<
    'cpu' | 'cuda'
  >('fasterWhisperVariant', 'cpu', (v) => v === 'cpu' || v === 'cuda');
  // 是否檢測到可用的 NVIDIA(CUDA) 顯卡（用於 GPU 選項的「推薦」標記/提示）。
  const [nvidiaSupported, setNvidiaSupported] = useState(false);
  const [downloadProgress, setDownloadProgress] =
    useState<PyEngineDownloadProgress | null>(null);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const taskBusyRef = useRef(false);
  const [updateInfo, setUpdateInfo] = useState<PyEngineUpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  // 運行庫（sherpa-onnx）隨包內置，不再做安裝檢測；三族狀態只看「是否已下載模型」。
  const [funasrModelsReady, setFunasrModelsReady] = useState(false);
  const [qwenModelsReady, setQwenModelsReady] = useState(false);
  const [fireRedModelsReady, setFireRedModelsReady] = useState(false);
  const [binarySource, setBinarySource] = useState<DownloadSource>(() =>
    typeof window === 'undefined' ? 'github' : readPersistedDownloadSource(),
  );

  // 模型清單數據（供右欄 ModelLibrarySection 與左欄 builtin 就緒點）
  const [systemInfo, setSystemInfo] = useState<ISystemInfo>({
    modelsInstalled: [],
    downloadingModels: [],
    modelsPath: '',
  });
  const [systemInfoLoaded, setSystemInfoLoaded] = useState(false);
  const [globalDownloading, setGlobalDownloading] = useState(false);

  const updateSystemInfo = useCallback(async () => {
    try {
      const res = await window?.ipc?.invoke('getSystemInfo', null);
      if (res) setSystemInfo(res);
    } catch (error) {
      console.error('Failed to load system info:', error);
    } finally {
      setSystemInfoLoaded(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    // GPU 環境探測（首次含 nvidia-smi）較慢，獨立異步加載、不進首屏 Promise.all，
    // 避免拖慢引擎/模型狀態渲染；platform 就緒後再補設（僅用於平臺相關展示）。
    void Promise.resolve(window?.ipc?.invoke('get-gpu-environment'))
      .then((env) => {
        if (env?.platform) setPlatform(env.platform);
        setNvidiaSupported(!!env?.nvidia?.gpuSupport?.supported);
      })
      .catch(() => {});
    try {
      const [statuses, settings, progress, taskStatus] = await Promise.all([
        window?.ipc?.invoke('get-engine-status'),
        window?.ipc?.invoke('getSettings'),
        window?.ipc?.invoke('get-py-engine-download-progress'),
        window?.ipc?.invoke('getTaskStatus'),
      ]);
      if (statuses) setEngineStatuses(statuses);
      if (settings) {
        setDevice(settings.fasterWhisperDevice || 'auto');
        setComputeType(settings.fasterWhisperComputeType || 'auto');
        setWhisperCommand(settings.whisperCommand || '');
        setLocalCliEnabled(!!settings.useLocalWhisper);
      }
      if (progress) setDownloadProgress(progress);
      const busy = isQueueBusy(taskStatus);
      setTaskBusy(busy);
      taskBusyRef.current = busy;

      const fr = await window?.ipc?.invoke('getFunasrModelStatus');
      if (fr?.success) {
        setFunasrModelsReady(!!fr.ready);
      }

      const qr = await window?.ipc?.invoke('getQwenModelStatus');
      if (qr?.success) {
        setQwenModelsReady(!!qr.ready);
      }

      const frr = await window?.ipc?.invoke('getFireRedModelStatus');
      if (frr?.success) {
        setFireRedModelsReady(!!frr.ready);
      }
    } catch (error) {
      console.error('Failed to refresh engine status:', error);
    }
  }, []);

  useEffect(() => {
    refresh();
    updateSystemInfo();

    const unsubProgress = window?.ipc?.on(
      'py-engine-download-progress',
      (_progress: PyEngineDownloadProgress) => {
        // 僅反映 faster-whisper 引擎包進度；sherpa 運行庫已內置無下載進度。
        if (_progress.engineId && _progress.engineId !== 'faster-whisper') {
          return;
        }
        setDownloadProgress(_progress);
        if (_progress.status === 'completed') {
          // 下載完成後引擎仍需冷啟動校驗，期間保持「檢測中」，擋住重複點擊。
          setVerifying(true);
          setUpdateInfo(null);
          (async () => {
            try {
              await window?.ipc?.invoke('python-engine:ping', {
                engineId: 'faster-whisper',
              });
            } catch {
              // 校驗失敗交給 refresh() 反映真實狀態（broken → 顯示修復入口）
            } finally {
              await refresh();
              setVerifying(false);
            }
          })();
        } else if (_progress.status === 'error') {
          if (_progress.error === 'protocol_unsupported') {
            toast.error(t('engines.fasterWhisper.protocolUnsupported'));
          }
          refresh();
        }
      },
    );
    const unsubTask = window?.ipc?.on('taskStatusChange', (status: string) => {
      const busy = isQueueBusy(status);
      setTaskBusy(busy);
      taskBusyRef.current = busy;
    });
    const unsubUpdate = window?.ipc?.on(
      'py-engine-update-available',
      (info: PyEngineUpdateInfo & { engineId?: string }) => {
        if (info.engineId && info.engineId !== 'faster-whisper') return;
        setUpdateInfo(info);
      },
    );
    const unsubDownload = window?.ipc?.on(
      'downloadProgress',
      (_model: string, progressValue: number) => {
        setGlobalDownloading(progressValue >= 0 && progressValue < 1);
        if (progressValue >= 1) void updateSystemInfo();
      },
    );
    return () => {
      unsubProgress?.();
      unsubTask?.();
      unsubUpdate?.();
      unsubDownload?.();
    };
  }, [refresh, updateSystemInfo, t]);

  // 模型/引擎變更後同時刷新清單與引擎狀態，保證左欄就緒點即時更新
  const handleResourcesUpdate = useCallback(() => {
    void updateSystemInfo();
    void refresh();
  }, [updateSystemInfo, refresh]);

  const handleSaveWhisperCommand = async () => {
    try {
      await window?.ipc?.invoke('setSettings', { whisperCommand });
      toast.success(t('engines.localCli.commandSaved'));
      void refresh();
    } catch {
      toast.error(t('engines.localCli.commandSaveFailed'));
    }
  };

  // localCli「啟用」沿用 useLocalWhisper：開啟後任務頁「引擎 ▸ 模型」選擇器才會列出本地命令行。
  const handleToggleLocalCli = async (value: boolean) => {
    setLocalCliEnabled(value);
    try {
      await window?.ipc?.invoke('setSettings', { useLocalWhisper: value });
      void refresh();
    } catch {
      setLocalCliEnabled(!value);
    }
  };

  // 當前已安裝變體（manifest 來源）；未安裝/老安裝按 cpu 兜底。
  const installedVariantOf = (): 'cpu' | 'cuda' =>
    engineStatuses.fasterWhisper?.variant === 'cuda' ? 'cuda' : 'cpu';
  const isGpuVariantPlatform = () =>
    platform === 'win32' || platform === 'linux';

  /**
   * 統一的運行時下載入口。coupleDevice=true（僅在「選擇/切換變體」時）聯動計算設備：
   * GPU 包→auto；CPU 包→cpu（CPU 包無 CUDA 運行庫，置 cpu 可規避 cublas 加載報錯）。
   */
  const startEngineDownload = async (
    variant: 'cpu' | 'cuda',
    coupleDevice = false,
  ) => {
    const result = await window?.ipc?.invoke('start-py-engine-download', {
      source: binarySource,
      variant,
    });
    if (!result?.success) {
      toast.error(
        result?.error === 'engine_busy'
          ? t('engines.fasterWhisper.engineBusy')
          : result?.error || 'Failed to start download',
      );
      return;
    }
    if (coupleDevice) {
      const nextDevice: 'auto' | 'cpu' = variant === 'cuda' ? 'auto' : 'cpu';
      setDevice(nextDevice);
      try {
        await window?.ipc?.invoke('set-faster-whisper-settings', {
          device: nextDevice,
        });
      } catch {
        // 設備偏好寫入失敗不影響下載本身
      }
    }
  };

  const handleStartDownload = () =>
    startEngineDownload(isGpuVariantPlatform() ? selectedVariant : 'cpu', true);

  // 修復/升級沿用已安裝變體；切換變體則顯式下載目標變體並聯動設備。
  const handleRepair = () => startEngineDownload(installedVariantOf());

  const handleSwitchVariant = (target: 'cpu' | 'cuda') => {
    setSelectedVariant(target);
    return startEngineDownload(target, true);
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const result = await window?.ipc?.invoke('check-py-engine-update', {
        source: binarySource,
        variant: installedVariantOf(),
      });
      if (!result?.success) {
        toast.error(t('engines.fasterWhisper.checkFailed'));
        return;
      }
      const info = result.info as PyEngineUpdateInfo;
      setUpdateInfo(info);
      if (!info.protocolSupported) {
        toast.error(t('engines.fasterWhisper.protocolUnsupported'));
      } else if (info.hasUpdate) {
        toast.success(t('engines.fasterWhisper.updateAvailable'));
      } else {
        toast.success(t('engines.fasterWhisper.upToDate'));
      }
    } catch {
      toast.error(t('engines.fasterWhisper.checkFailed'));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleUpgrade = () => startEngineDownload(installedVariantOf());

  const handleUninstall = async () => {
    setShowUninstallConfirm(false);
    const result = await window?.ipc?.invoke('uninstall-py-engine');
    if (result?.success) {
      setVerifying(false);
      setUpdateInfo(null);
      await refresh();
    } else {
      toast.error(result?.error || 'Failed to uninstall');
    }
  };

  const handleDeviceChange = async (value: string) => {
    const next = value as 'auto' | 'cpu' | 'cuda';
    setDevice(next);
    await window?.ipc?.invoke('set-faster-whisper-settings', { device: next });
  };

  const handleComputeTypeChange = async (value: string) => {
    setComputeType(value);
    await window?.ipc?.invoke('set-faster-whisper-settings', {
      computeType: value,
    });
  };

  const fasterStatus = engineStatuses.fasterWhisper;
  const localCliStatus = engineStatuses.localCli;
  const installedVariant: 'cpu' | 'cuda' | undefined = fasterStatus?.variant;
  // GPU 包僅 Win/Linux 提供；其餘平臺強制 cpu。
  const gpuVariantAvailable = platform === 'win32' || platform === 'linux';
  const effectiveSelectedVariant: 'cpu' | 'cuda' = gpuVariantAvailable
    ? selectedVariant
    : 'cpu';
  const isDownloading =
    downloadProgress?.status === 'downloading' ||
    downloadProgress?.status === 'extracting' ||
    fasterStatus?.state === 'downloading';
  const fasterInstalled = fasterStatus?.state === 'ready';
  const fasterBroken = fasterStatus?.state === 'error';
  const showVerifying = verifying || downloadProgress?.status === 'verifying';
  const hasUpdate = !!(updateInfo?.hasUpdate && updateInfo.protocolSupported);
  const localCliReady =
    localCliEnabled &&
    (localCliStatus?.state === 'ready' || whisperCommand.trim().length > 0);

  // 安全網：引擎一旦確認 ready/broken，立即清掉「檢測中」標誌
  useEffect(() => {
    if (verifying && (fasterInstalled || fasterBroken)) setVerifying(false);
  }, [verifying, fasterInstalled, fasterBroken]);

  // 設備選項隨已安裝變體收斂：CPU 包不暴露 cuda（用不了，避免誤選後 cublas 報錯）；
  // GPU 包(cuda) 才提供 auto/cpu/cuda；macOS 恆無 cuda。
  const deviceOptions =
    platform === 'darwin'
      ? ['auto', 'cpu']
      : installedVariant === 'cuda'
        ? ['auto', 'cpu', 'cuda']
        : ['auto', 'cpu'];

  // sherpa 展示組三族就緒態（共用內置運行庫，差異在模型）；供合併面板、左欄狀態點、徽標聚合。
  const sherpaFamilies = SHERPA_FAMILIES.map((engine) => {
    if (engine === 'funasr') {
      return {
        engine,
        modelsReady: funasrModelsReady,
        status: engineStatuses.funasr,
      };
    }
    if (engine === 'qwen') {
      return {
        engine,
        modelsReady: qwenModelsReady,
        status: engineStatuses.qwen,
      };
    }
    return {
      engine,
      modelsReady: fireRedModelsReady,
      status: engineStatuses.fireRedAsr,
    };
  });
  const sherpaAnyReady = sherpaFamilies.some((f) => f.modelsReady);

  const readyBadge = (
    <Badge variant="outline" className="border-success/40 text-success">
      {t('engines.statusAvailable')}
    </Badge>
  );

  const renderEngineBadge = (view: EngineView) => {
    if (view === 'sherpa') {
      // 組徽標：任一族就緒即視為可用；否則提示去下載模型（運行庫已內置，無"未安裝"態）。
      return sherpaAnyReady ? (
        readyBadge
      ) : (
        <Badge variant="outline" className="border-primary/40 text-primary">
          {t('engines.sherpa.needsModels')}
        </Badge>
      );
    }
    const engine = view;
    if (engine === 'fasterWhisper') {
      if (isDownloading) {
        return (
          <Badge variant="secondary" className="shrink-0">
            {t('engines.fasterWhisper.downloading')}
          </Badge>
        );
      }
      if (showVerifying) {
        return (
          <Badge variant="secondary" className="shrink-0">
            {t('engines.fasterWhisper.verifying')}
          </Badge>
        );
      }
      if (fasterInstalled) return readyBadge;
      if (fasterBroken) {
        return (
          <Badge variant="destructive" className="shrink-0">
            {t('engines.fasterWhisper.installError')}
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          {t('engines.fasterWhisper.notInstalled')}
        </Badge>
      );
    }
    if (engine === 'localCli') {
      return localCliReady ? (
        readyBadge
      ) : (
        <Badge variant="outline" className="shrink-0 text-muted-foreground">
          {t('engines.localCli.notConfigured')}
        </Badge>
      );
    }
    // builtin：內置運行時無需安裝；未裝任何 ggml 模型時提示去下載模型。
    if ((systemInfo.modelsInstalled?.length ?? 0) > 0) return readyBadge;
    return (
      <Badge variant="outline" className="border-primary/40 text-primary">
        {t('engines.builtin.needsModels')}
      </Badge>
    );
  };

  const engineTone = (view: EngineView): StatusTone => {
    if (view === 'sherpa') return sherpaAnyReady ? 'ready' : 'pending';
    if (view === 'fasterWhisper') {
      if (isDownloading || showVerifying) return 'downloading';
      if (fasterInstalled) return 'ready';
      if (fasterBroken) return 'error';
      return 'pending';
    }
    if (view === 'localCli') return localCliReady ? 'ready' : 'pending';
    // builtin：內置運行時始終可用，但未裝任何模型則無法轉寫，按待辦呈現。
    return (systemInfo.modelsInstalled?.length ?? 0) > 0 ? 'ready' : 'pending';
  };

  const engineName = (view: EngineView) => t(`engines.${view}.name`);

  // 引擎特色標籤：sherpa 組展示 FunASR / Qwen3-ASR / FireRedASR 三平臺，讓用戶一眼看出
  // 該引擎同時支持這三個平臺；其餘引擎展示能力關鍵詞（如 NVIDIA / 高速 / Apple 芯片）。
  const engineTags = (view: EngineView): string[] => {
    const raw = t(`engines.${view}.tags`, { returnObjects: true });
    return Array.isArray(raw) ? (raw as string[]) : [];
  };

  const statusLabel = (tone: StatusTone) => t(`engines.status.${tone}`);

  const handleBinarySourceChange = (s: DownloadSource) => {
    setBinarySource(s);
    persistDownloadSource(s);
  };

  // 引擎二進制下載源（GitHub / 國內加速 / GitCode）：在「點擊下載/升級時」於氣泡內選擇，
  // 與各模型下載源統一為同款氣泡交互。
  const binarySourceConfig: DownloadSourceConfig = {
    value: binarySource,
    options: (['github', 'ghproxy', 'gitcode'] as DownloadSource[]).map(
      (s) => ({
        value: s,
        label:
          s === 'github'
            ? 'GitHub'
            : s === 'gitcode'
              ? 'GitCode'
              : t('ghProxy'),
      }),
    ),
    onChange: (s) => handleBinarySourceChange(s as DownloadSource),
    label: t('engines.fasterWhisper.downloadSource'),
    confirmLabel: commonT('startDownload'),
    // 複製鏈接反映目標變體：已安裝時取已裝變體（升級氣泡），未安裝時取當前選擇（安裝氣泡）。
    getCopyUrl: (s) =>
      resolveModelDownloadUrl(
        'pyEngine',
        s,
        undefined,
        fasterInstalled ? installedVariant || 'cpu' : effectiveSelectedVariant,
      ),
  };

  const fasterWhisperPanelProps = {
    status: fasterStatus,
    isDownloading,
    downloadProgress,
    showVerifying,
    fasterInstalled,
    fasterBroken,
    hasUpdate,
    checkingUpdate,
    taskBusy,
    device,
    computeType,
    deviceOptions,
    updateInfo,
    binarySourceConfig,
    selectedVariant: effectiveSelectedVariant,
    onSelectedVariantChange: (v: 'cpu' | 'cuda') => setSelectedVariant(v),
    installedVariant,
    gpuVariantAvailable,
    nvidiaSupported,
    onDownload: handleStartDownload,
    onRepair: handleRepair,
    onSwitchVariant: handleSwitchVariant,
    onUninstall: () => setShowUninstallConfirm(true),
    onCheckUpdate: handleCheckUpdate,
    onUpgrade: handleUpgrade,
    onDeviceChange: handleDeviceChange,
    onComputeTypeChange: handleComputeTypeChange,
  };

  const renderRuntimePanel = () => {
    if (selectedView === 'fasterWhisper') {
      return <FasterWhisperPanel {...fasterWhisperPanelProps} />;
    }
    if (selectedView === 'sherpa') {
      return (
        <SherpaEngineGroupPanel
          runtime={sherpa}
          families={sherpaFamilies}
          systemInfo={systemInfo}
          systemInfoLoaded={systemInfoLoaded}
          globalDownloading={globalDownloading}
          onUpdate={handleResourcesUpdate}
        />
      );
    }
    if (selectedView === 'localCli') {
      return (
        <LocalCliPanel
          whisperCommand={whisperCommand}
          onCommandChange={setWhisperCommand}
          onSave={handleSaveWhisperCommand}
          enabled={localCliEnabled}
          onToggleEnabled={handleToggleLocalCli}
        />
      );
    }
    return <BuiltinPanel />;
  };

  return (
    <TooltipProvider delayDuration={150}>
      {/* 左欄固定、僅右欄滾動：根容器撐滿父高，左 nav 整列常駐，右欄獨立縱向滾動。 */}
      <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
        {/* 左欄：引擎列表（狀態點，無啟用開關）——md 下整列固定，不隨右欄滾動 */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:pr-2">
          {ENGINE_VIEWS.map((id) => {
            const active = selectedView === id;
            const tone = engineTone(id);
            const tags = engineTags(id);
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => setSelectedView(id)}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  'shrink-0 md:w-full',
                  active
                    ? 'bg-primary/10 font-medium text-primary ring-1 ring-inset ring-primary/20'
                    : 'text-foreground hover:bg-muted/60',
                )}
              >
                <EngineIcon engine={id} className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate">{engineName(id)}</span>
                    <span className="ml-auto flex shrink-0">
                      <StatusDot tone={tone} label={statusLabel(tone)} />
                    </span>
                  </span>
                  {tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[10px] font-normal leading-none',
                            active
                              ? 'bg-primary/15 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>

        {/* 右欄：選中引擎運行時 + 模型清單（獨立縱向滾動） */}
        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto pb-4 md:pl-1">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {engineName(selectedView)}
              </h2>
              {selectedView === 'sherpa' && (
                <p className="text-xs text-muted-foreground">
                  {t('engines.sherpa.subtitle')}
                </p>
              )}
            </div>
            {renderEngineBadge(selectedView)}
          </div>

          {renderRuntimePanel()}

          {/* sherpa 組的模型清單由組面板按族內聯渲染，這裡不再外掛統一清單 */}
          {selectedView !== 'sherpa' && (
            <div className="border-t pt-4">
              <ModelLibrarySection
                engine={selectedView}
                systemInfo={systemInfo}
                systemInfoLoaded={systemInfoLoaded}
                globalDownloading={globalDownloading}
                onUpdate={handleResourcesUpdate}
              />
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={showUninstallConfirm}
        onOpenChange={setShowUninstallConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('engines.fasterWhisper.uninstall')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('engines.fasterWhisper.uninstallConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="gap-1.5">
              <X className="h-4 w-4" />
              {commonT('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleUninstall}
            >
              <Trash2 className="h-4 w-4" />
              {t('engines.fasterWhisper.uninstall')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
};

export default EngineModelTab;
