import React, { useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { CheckCircle2, ChevronDown, Settings2 } from 'lucide-react';
import EngineIcon from '@/components/resources/engines/EngineIcon';
import ModelLibrarySection from '@/components/resources/ModelLibrarySection';
import type { SherpaRuntime } from '@/components/resources/engines/useSherpaRuntime';
import type { EngineStatus } from '../../../../types/engine';
import type { ISystemInfo } from '../../../../types/types';

/** sherpa 系（funasr / qwen / fireRedAsr）共享同一原生運行庫，僅模型與少量參數不同。 */
export type SherpaFamilyKey = 'funasr' | 'qwen' | 'fireRedAsr';

interface SherpaFamily {
  engine: SherpaFamilyKey;
  /** 該族模型是否就緒（可轉寫）。運行庫隨包內置，不再參與判斷。 */
  modelsReady: boolean;
  status?: EngineStatus;
}

interface SherpaEngineGroupPanelProps {
  runtime: SherpaRuntime;
  families: SherpaFamily[];
  systemInfo: ISystemInfo;
  systemInfoLoaded: boolean;
  globalDownloading: boolean;
  onUpdate: () => void;
}

const THREAD_OPTIONS = ['1', '2', '4', '8'];

/**
 * 合併後的「高級設置」：FunASR · Qwen · FireRed 共用同一 sherpa-onnx 運行庫，
 * 故線程數為統一一項（更改時同步寫入三引擎設置，保持行為一致）；
 * 逆文本規整（ITN）僅 FunASR（SenseVoice）生效，單獨備註說明。
 */
const SherpaAdvancedSettings: React.FC = () => {
  const { t } = useTranslation('resources');
  const [useItn, setUseItn] = useState(true);
  const [numThreads, setNumThreads] = useState(4);

  useEffect(() => {
    (async () => {
      try {
        const s = await window?.ipc?.invoke('getSettings');
        if (!s) return;
        if (typeof s.funasrUseItn === 'boolean') setUseItn(s.funasrUseItn);
        const persisted = [
          s.funasrNumThreads,
          s.qwenNumThreads,
          s.fireRedNumThreads,
        ].find((x) => typeof x === 'number');
        if (typeof persisted === 'number') setNumThreads(persisted);
      } catch {
        // 忽略：保持預設
      }
    })();
  }, []);

  const handleItnChange = async (value: boolean) => {
    setUseItn(value);
    await window?.ipc?.invoke('set-funasr-settings', { useItn: value });
  };

  const handleThreadsChange = async (value: string) => {
    const n = Number(value);
    setNumThreads(n);
    // 三族共用同一運行庫，線程數統一應用到三引擎設置。
    await Promise.all([
      window?.ipc?.invoke('set-funasr-settings', { numThreads: n }),
      window?.ipc?.invoke('set-qwen-settings', { numThreads: n }),
      window?.ipc?.invoke('set-firered-settings', { numThreads: n }),
    ]);
  };

  return (
    <div className="space-y-3 border-t p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-sm">{t('engines.sherpa.numThreads')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('engines.sherpa.numThreadsHint')}
          </p>
        </div>
        <Select value={String(numThreads)} onValueChange={handleThreadsChange}>
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THREAD_OPTIONS.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="sherpa-itn" className="text-sm">
            {t('engines.sherpa.itn')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('engines.sherpa.itnHint')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground/80">
            {t('engines.sherpa.itnFunasrOnly')}
          </p>
        </div>
        <Switch
          id="sherpa-itn"
          checked={useItn}
          onCheckedChange={handleItnChange}
        />
      </div>
    </div>
  );
};

/**
 * sherpa 系引擎（FunASR · Qwen · FireRed）合併管理面板。
 *
 * 三者共用同一 sherpa-onnx 原生運行庫（已隨應用內置），差異僅在模型與少量參數。
 * 運行庫內置故不再做安裝檢測：狀態只看「是否已下載模型」。
 * 頂部一次性聲明運行庫已內置；下方按模型族分區（僅模型清單）；
 * 全部高級設置（線程數 + ITN）合併到底部單獨一處。
 * 未裝任何模型的族預設摺疊以收斂縱向長度。
 */
const SherpaEngineGroupPanel: React.FC<SherpaEngineGroupPanelProps> = ({
  runtime,
  families,
  systemInfo,
  systemInfoLoaded,
  globalDownloading,
  onUpdate,
}) => {
  const { t } = useTranslation('resources');
  const anyReady = families.some((f) => f.modelsReady);

  // 運行庫內置，無「未安裝」態：僅區分「可用」與「需下載模型」。
  const familyBadge = (f: SherpaFamily) =>
    f.modelsReady ? (
      <Badge variant="outline" className="border-success/40 text-success">
        {t('engines.statusAvailable')}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-primary/40 text-primary">
        {t(`engines.${f.engine}.needsModels`)}
      </Badge>
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t('engines.sherpa.desc')}
      </p>

      {/* 共享運行庫卡：三族同一份內置運行庫，恆為就緒，只此一處 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/60 p-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        <span className="text-sm">{t('engines.sherpa.builtinRuntime')}</span>
        {runtime.libStatus?.version && (
          <span className="text-xs text-muted-foreground">
            {t('engines.sherpa.installedVersion', {
              version: runtime.libStatus.version,
            })}
          </span>
        )}
      </div>

      {!anyReady && (
        <p className="text-xs text-muted-foreground">
          {t('engines.sherpa.needsModels')}
        </p>
      )}

      {/* 三族分區：僅模型清單（複用 ModelLibrarySection 的下載/導入/刪除/換路徑） */}
      <div className="space-y-3">
        {families.map((f, index) => (
          <Collapsible
            key={f.engine}
            defaultOpen={f.modelsReady || (!anyReady && index === 0)}
            className="rounded-lg border"
          >
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left">
              <EngineIcon engine={f.engine} className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">
                {t(`engines.${f.engine}.name`)}
              </span>
              {familyBadge(f)}
              <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t p-3">
                <ModelLibrarySection
                  engine={f.engine}
                  systemInfo={systemInfo}
                  systemInfoLoaded={systemInfoLoaded}
                  globalDownloading={globalDownloading}
                  onUpdate={onUpdate}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      {/* 合併的高級設置：線程數（三族統一）+ ITN（僅 FunASR） */}
      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left">
          <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t('engines.sherpa.advanced')}
          </span>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SherpaAdvancedSettings />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default SherpaEngineGroupPanel;
