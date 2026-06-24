import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DownModel from '@/components/DownModel';
import DownModelButton from '@/components/DownModelButton';
import useLocalStorageState from 'hooks/useLocalStorageState';
import {
  modelCategories,
  getRecommendedCategory,
  cn,
  type ModelInfo,
} from 'lib/utils';
import { isProviderConfigured } from 'lib/providerUtils';
import { resolveEngine, getInstalledModelsForEngine } from 'lib/engineModels';
import type { TranscriptionEngine } from '../../../types/engine';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clapperboard,
  Download,
  FileText,
  Languages,
  Loader2,
  PlayCircle,
  SkipForward,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { toast } from 'sonner';

enum DownSource {
  HuggingFace = 'huggingface',
  HfMirror = 'hf-mirror',
}

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打開時定位到的步驟（從「繼續引導」入口恢復） */
  initialStep?: number;
  /** 用戶從引導跳去配置頁時觸發：引導未完成，只是暫停 */
  onPause?: (step: number) => void;
}

interface AccelInfo {
  ready: boolean;
  descKey: string;
}

function FlowNode({
  icon: Icon,
  title,
  desc,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5 w-[120px]">
      <div
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-lg',
          highlight ? 'bg-primary/10 text-primary' : 'bg-muted text-foreground',
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs font-medium">{title}</div>
      {desc && (
        <div className="text-[11px] text-muted-foreground leading-snug">
          {desc}
        </div>
      )}
    </div>
  );
}

/** 引導內的語言切換項（語言名用本地寫法，方便不識別當前界面語言的新用戶辨認）。 */
const ONBOARDING_LANGS = [
  { value: 'zh', label: '簡體中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const OnboardingDialog: React.FC<OnboardingDialogProps> = ({
  open,
  onOpenChange,
  initialStep = 0,
  onPause,
}) => {
  const { t, i18n } = useTranslation('common');
  const router = useRouter();
  const { locale } = router.query;
  const currentLang = (i18n.language || '').toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';

  /**
   * 引導內切換界面語言：持久化到設置，並只替換當前路由的 locale 段（保留頁面與查詢），
   * 避免跳回首頁；界面語言隨路由 locale 由 next-i18next 切換。引導面板狀態在 Layout 持有，
   * 路由變化不會卸載，彈窗保持打開。
   */
  const switchLanguage = async (value: string) => {
    if (value === currentLang) return;
    try {
      await window?.ipc?.invoke('setSettings', { language: value });
    } catch (error) {
      console.error('Failed to persist language:', error);
    }
    router.push(router.asPath.replace(/^\/[^/]+/, `/${value}`));
  };

  const [step, setStep] = useState(0);
  const [totalMemoryGB, setTotalMemoryGB] = useState<number | undefined>();
  const [engine, setEngine] = useState<TranscriptionEngine>('builtin');
  const [installedCount, setInstalledCount] = useState(0);
  const [downloadDone, setDownloadDone] = useState(false);
  const [accel, setAccel] = useState<AccelInfo>({
    ready: false,
    descKey: 'onboarding.accelDescAvailable',
  });
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [downSource] = useLocalStorageState<DownSource>(
    'downSource',
    DownSource.HuggingFace,
    (val) => Object.values(DownSource).includes(val as DownSource),
  );
  const [sampleLoading, setSampleLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setDownloadDone(false);
    (async () => {
      try {
        const info = await window?.ipc?.invoke('getSystemInfo', null);
        setTotalMemoryGB(info?.totalMemoryGB);
        // 按當前轉寫引擎統計已安裝模型：faster-whisper 用自己的模型目錄，
        // 本地命令行引擎自備模型，避免“已下載模型卻提示無模型”
        const currentEngine = resolveEngine(info);
        setEngine(currentEngine);
        const modelCount =
          currentEngine === 'localCli'
            ? 1
            : getInstalledModelsForEngine(info).length;
        setInstalledCount(modelCount);

        const env = await window?.ipc?.invoke('get-gpu-environment');
        const active = await window?.ipc?.invoke('get-active-backend');
        if (env?.platform === 'darwin') {
          setAccel({ ready: true, descKey: 'onboarding.accelDescMac' });
        } else if (active?.backend === 'cuda') {
          setAccel({ ready: true, descKey: 'onboarding.accelDescNvidia' });
        } else if (active?.backend === 'vulkan') {
          setAccel({ ready: true, descKey: 'onboarding.accelDescVulkan' });
        } else {
          setAccel({
            ready: false,
            descKey: 'onboarding.accelDescAvailable',
          });
        }
      } catch (error) {
        console.error('Failed to load onboarding data:', error);
      }
    })();
  }, [open]);

  const recommendedId = getRecommendedCategory(totalMemoryGB ?? 8);
  const recommendedModel = modelCategories
    .find((c) => c.id === recommendedId)
    ?.models.find((m) => !m.isQuantized && !m.isEnglishOnly);
  const tinyModel = modelCategories
    .find((c) => c.id === 'tiny')
    ?.models.find((m) => !m.isQuantized && !m.isEnglishOnly);

  useEffect(() => {
    if (recommendedModel && !selectedModel) {
      setSelectedModel(recommendedModel);
    }
  }, [recommendedModel, selectedModel]);

  const markCompleted = async () => {
    try {
      await window?.ipc?.invoke('setSettings', { onboardingCompleted: true });
    } catch (error) {
      console.error('Failed to mark onboarding completed:', error);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      markCompleted();
    }
    onOpenChange(next);
  };

  /** 跳去配置頁：不算完成，記為暫停，由外層提供「繼續引導」入口 */
  const closeAndGo = (url: string) => {
    onPause?.(step);
    onOpenChange(false);
    router.push(url);
  };

  /**
   * 一鍵示例任務：固定 id，存在即刪除重建——示例音頻僅 10s，
   * 重建保證每次都是乾淨的演示，語義最簡單。
   */
  const SAMPLE_PROJECT_ID = 'sample-onboarding';
  const runSample = async () => {
    setSampleLoading(true);
    try {
      const samplePath = await window?.ipc?.invoke(
        'getOnboardingSamplePath',
        null,
      );
      const providers = await window?.ipc?.invoke('getTranslationProviders');
      const userConfig = await window?.ipc?.invoke('getUserConfig');
      // 任務實際使用的是 userConfig.translateProvider,必須判它本身是否已配置,
      // 而不是「任何服務商已配置」——否則示例會拿未配置的預設服務商去翻譯而報錯
      const activeProvider = (providers || []).find(
        (p: any) => p.id === userConfig?.translateProvider,
      );
      const hasProvider = activeProvider
        ? isProviderConfigured(activeProvider)
        : false;
      // 已配翻譯服務 → 完整鏈路；未配 → 純轉寫，零配置可跑
      const taskType = hasProvider ? 'generateAndTranslate' : 'generateOnly';
      const slug = hasProvider ? 'generate-translate' : 'generate';

      // 刪除舊示例工程後重建（deleteTaskProject 對不存在的 id 是安全 no-op）
      await window?.ipc?.invoke('deleteTaskProject', SAMPLE_PROJECT_ID);
      const dropped = await window?.ipc?.invoke('getDroppedFiles', {
        files: [samplePath],
        taskType: 'media',
      });
      if (!dropped?.length) {
        throw new Error('sample audio missing');
      }
      await window?.ipc?.invoke('saveTaskProject', {
        id: SAMPLE_PROJECT_ID,
        taskType,
        files: dropped,
        name: t('onboarding.sampleProjectName'),
      });
      markCompleted();
      onOpenChange(false);
      router.push(
        `/${locale}/tasks/${slug}?project=${SAMPLE_PROJECT_ID}&autostart=1`,
      );
    } catch (error) {
      console.error('Failed to run sample task:', error);
      toast.error(t('onboarding.sampleFailed'));
    } finally {
      setSampleLoading(false);
    }
  };

  const choices = [
    recommendedModel && {
      model: recommendedModel,
      title: t('onboarding.recommendedChoice', {
        model: recommendedModel.name,
      }),
      desc: `${recommendedModel.size}`,
    },
    tinyModel &&
      tinyModel.name !== recommendedModel?.name && {
        model: tinyModel,
        title: t('onboarding.quickChoice'),
        desc: `${tinyModel.size} · ${t('onboarding.quickChoiceDesc')}`,
      },
  ].filter(Boolean) as { model: ModelInfo; title: string; desc: string }[];

  const steps = [
    {
      title: t('onboarding.step1Title'),
      desc: t('onboarding.step1Desc'),
      body: (
        <div className="space-y-6 py-2">
          <div className="flex items-start justify-center gap-2 flex-wrap">
            <FlowNode icon={Clapperboard} title={t('onboarding.flowVideo')} />
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-3.5 flex-shrink-0" />
            <FlowNode
              icon={Bot}
              title={t('onboarding.flowModel')}
              desc={t('onboarding.flowModelDesc')}
              highlight
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-3.5 flex-shrink-0" />
            <FlowNode
              icon={Languages}
              title={t('onboarding.flowProvider')}
              desc={t('onboarding.flowProviderDesc')}
              highlight
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground mt-3.5 flex-shrink-0" />
            <FlowNode icon={FileText} title={t('onboarding.flowSubtitle')} />
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 flex-shrink-0" />
            {t('onboarding.gpuNote')}
          </div>
        </div>
      ),
    },
    {
      title: t('onboarding.step2Title'),
      desc: t('onboarding.step2Desc'),
      body: (
        <div className="space-y-3 py-2">
          {installedCount > 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" />
              {t('onboarding.modelReady')}
            </div>
          ) : engine === 'fasterWhisper' || engine === 'funasr' ? (
            // faster-whisper / FunASR 模型走專屬下載流程（資源中心-模型頁），不復用 ggml 一鍵下載
            <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
              <Bot className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t(
                    engine === 'funasr'
                      ? 'onboarding.funasrModelTitle'
                      : 'onboarding.fasterWhisperModelTitle',
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t(
                    engine === 'funasr'
                      ? 'onboarding.funasrModelDesc'
                      : 'onboarding.fasterWhisperModelDesc',
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs flex-shrink-0"
                onClick={() => closeAndGo(`/${locale}/engines`)}
              >
                <Download className="h-4 w-4" />
                {t('onboarding.goDownloadModel')}
              </Button>
            </div>
          ) : (
            <>
              {choices.map(({ model, title, desc }) => (
                <button
                  key={model.name}
                  type="button"
                  onClick={() => setSelectedModel(model)}
                  className={cn(
                    'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                    selectedModel?.name === model.name
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {desc}
                  </div>
                </button>
              ))}
              {selectedModel && (
                <div className="flex items-center gap-3 pt-1">
                  <DownModel
                    modelName={selectedModel.name}
                    callBack={() => setDownloadDone(true)}
                    downSource={downSource}
                    needsCoreML={selectedModel.needsCoreML}
                  >
                    <DownModelButton />
                  </DownModel>
                  {downloadDone && (
                    <span className="flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('onboarding.downloadStarted')}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      title: t('onboarding.step3Title'),
      desc: '',
      body: (
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
            <Languages className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {t('onboarding.providerTitle')}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t('onboarding.providerDesc')}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs flex-shrink-0"
              onClick={() => closeAndGo(`/${locale}/translation`)}
            >
              <Languages className="h-4 w-4" />
              {t('onboarding.goConfigure')}
            </Button>
          </div>
          <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
            <Zap className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                {t('onboarding.accelTitle')}
                {accel.ready && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-success/40 text-success"
                  >
                    {t('onboarding.enabled')}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t(accel.descKey)}
              </div>
            </div>
            {!accel.ready && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs flex-shrink-0"
                onClick={() => {
                  // GPU 加速已摺疊進 builtin 引擎面板：先選中 builtin 再跳引擎 Tab，直達加速區。
                  try {
                    localStorage.setItem(
                      'engineModelSelectedView',
                      JSON.stringify('builtin'),
                    );
                  } catch {
                    // 忽略：localStorage 不可用時仍跳轉，EngineModelTab 回落預設 builtin
                  }
                  closeAndGo(`/${locale}/engines`);
                }}
              >
                <Zap className="h-4 w-4" />
                {t('onboarding.goEnable')}
              </Button>
            )}
          </div>
        </div>
      ),
    },
    {
      title: t('onboarding.step4Title'),
      desc: t('onboarding.step4Desc'),
      body: (
        <div className="space-y-3 py-2">
          <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm text-muted-foreground leading-relaxed">
            {t('onboarding.sampleExplain')}
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={runSample}
              disabled={
                sampleLoading || (installedCount === 0 && !downloadDone)
              }
            >
              {sampleLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              {sampleLoading
                ? t('onboarding.sampleRunning')
                : t('onboarding.sampleRun')}
            </Button>
            {installedCount === 0 && !downloadDone && (
              <span className="text-xs text-muted-foreground">
                {t('onboarding.sampleNeedsModel')}
              </span>
            )}
          </div>
        </div>
      ),
    },
  ];

  const isLast = step === steps.length - 1;
  const current = steps[step];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* 語言切換：置於右上角（關閉按鈕左側），讓英文用戶首啟即可切換、避免無從下手 */}
        <div className="absolute right-12 top-3.5 z-10 flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          {ONBOARDING_LANGS.map((lang) => (
            <button
              key={lang.value}
              type="button"
              onClick={() => switchLanguage(lang.value)}
              className={cn(
                'rounded px-2 py-0.5 text-xs transition-colors',
                currentLang === lang.value
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>

        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>
            {current.desc || t('onboarding.step1Desc')}
          </DialogDescription>
        </DialogHeader>

        {current.body}

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {t('onboarding.stepLabel', {
                current: step + 1,
                total: steps.length,
              })}
            </span>
            <span className="inline-flex gap-1">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    i === step ? 'bg-primary' : 'bg-muted',
                  )}
                />
              ))}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => handleOpenChange(false)}
            >
              <SkipForward className="h-4 w-4" />
              {t('onboarding.skip')}
            </Button>
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft className="h-4 w-4" />
                {t('onboarding.back')}
              </Button>
            )}
            {isLast ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => handleOpenChange(false)}
              >
                <Check className="h-4 w-4" />
                {t('onboarding.finish')}
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => setStep(step + 1)}
              >
                <ArrowRight className="h-4 w-4" />
                {t('onboarding.next')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingDialog;
