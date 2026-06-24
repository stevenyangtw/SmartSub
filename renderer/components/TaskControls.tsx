import { useEffect, useRef, useState } from 'react';
import { CircleStop, Loader2, Pause, Play } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { cn } from 'lib/utils';
import { useTranslation } from 'next-i18next';
import type { TaskTypeDef } from 'lib/taskTypes';
import { getFileStages, isFileDone } from './tasks/stageUtils';
import { useHotkeys } from 'hooks/useHotkeys';

interface TaskControlsProps {
  files: any[];
  formData: any;
  typeDef: TaskTypeDef;
  projectId: string | null;
  className?: string;
  /** 可選：狀態變化時上拋（任務頁用於聯動重試按鈕/完成橫幅） */
  onStatusChange?: (status: string) => void;
  autoStart?: boolean;
}

type TaskCompletePayload = { projectId?: string; status?: string } | string;

const TaskControls = ({
  files,
  formData,
  typeDef,
  projectId,
  className,
  onStatusChange,
  autoStart,
}: TaskControlsProps) => {
  const [taskStatus, setTaskStatusState] = useState('idle');
  // 首次狀態同步是否已完成:autostart 必須等它,否則遲到的 'idle' 會覆蓋樂觀 'running'
  const [statusSynced, setStatusSynced] = useState(false);
  const { t } = useTranslation(['home', 'common']);

  const setTaskStatus = (status: string) => {
    setTaskStatusState(status);
    onStatusChange?.(status);
  };

  useEffect(() => {
    setStatusSynced(false);
    if (!projectId) return;
    let disposed = false;
    // 獲取當前工程的任務狀態
    const getCurrentTaskStatus = async () => {
      const status = await window?.ipc?.invoke('getTaskStatus', projectId);
      if (!disposed && status) setTaskStatus(status);
      if (!disposed) setStatusSynced(true);
    };
    getCurrentTaskStatus();

    // 監聽本工程的任務完成事件
    const cleanup = window?.ipc?.on(
      'taskComplete',
      (payload: TaskCompletePayload) => {
        const status = typeof payload === 'string' ? payload : payload?.status;
        const pid =
          typeof payload === 'string' ? undefined : payload?.projectId;
        if (pid && pid !== projectId) return;
        if (status) setTaskStatus(status);
      },
    );

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [projectId]);

  const handleTask = async () => {
    if (!files?.length) {
      toast(t('common:notification'), {
        description: t('home:noTask'),
      });
      return;
    }
    // 帶翻譯的任務必須有有效翻譯服務商（'-1' 為歷史「不翻譯」殘留值）
    if (typeDef.hasTranslate) {
      const provider = formData?.translateProvider;
      if (!provider || provider === '-1') {
        toast.error(t('home:selectProviderFirst'));
        return;
      }
    }
    // 需要模型的任務必須已選模型：自動選擇兜底後仍為空，說明確實沒有可用模型，攔截並指引下載
    if (typeDef.needsModel && !formData?.model) {
      toast.error(t('home:selectModelFirst'));
      return;
    }
    // 只派發未完成的文件（error 不算完成，可重跑；已完成文件不重做）
    const pendingFiles = files.filter(
      (file) => !isFileDone(file, getFileStages(file, typeDef, formData)),
    );
    if (!pendingFiles.length) {
      toast(t('common:notification'), {
        description: t('home:allFilesProcessed'),
      });
      return;
    }
    // 記錄"上次使用"的 (引擎,模型) 作為下次新任務預設（全局單條，二者作為整體）
    if (
      typeDef.needsModel &&
      formData?.transcriptionEngine &&
      formData?.model
    ) {
      window?.ipc?.invoke('setSettings', {
        lastUsedTranscription: {
          engine: formData.transcriptionEngine,
          model: formData.model,
        },
      });
    }
    setTaskStatus('running');
    window?.ipc?.send('handleTask', {
      files: pendingFiles,
      formData,
      projectId,
    });
  };

  // ?autostart=1 進入頁面時自動開始一次(僅 idle 態,ref 防 StrictMode/重渲染重複觸發)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!statusSynced) return;
    if (!autoStart || autoStartedRef.current) return;
    if (!files?.length) return;
    if (taskStatus !== 'idle') return;
    autoStartedRef.current = true;
    handleTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, files, taskStatus, statusSynced]);

  const handlePause = () => {
    window?.ipc?.send('pauseTask', projectId);
    setTaskStatus('paused');
  };

  const handleResume = () => {
    window?.ipc?.send('resumeTask', projectId);
    setTaskStatus('running');
  };

  const handleCancel = () => {
    window?.ipc?.send('cancelTask', projectId);
    setTaskStatus('cancelling');
  };

  const showStart =
    taskStatus === 'idle' ||
    taskStatus === 'completed' ||
    taskStatus === 'cancelled';

  // Cmd/Ctrl+Enter 等價點擊「開始任務」（僅可開始狀態下生效）
  useHotkeys([
    {
      combo: 'mod+enter',
      allowInInput: true,
      handler: () => {
        if (showStart && files.length) handleTask();
      },
    },
  ]);

  return (
    <div className={cn('flex items-center gap-2 ml-auto', className)}>
      {taskStatus === 'paused' && (
        <span className="text-xs text-muted-foreground">
          {t('home:pausedHint')}
        </span>
      )}
      {taskStatus === 'cancelling' && (
        <span className="text-xs text-muted-foreground">
          {t('home:cancellingHint')}
        </span>
      )}
      {showStart && (
        <Button
          className="gap-1.5"
          onClick={handleTask}
          disabled={!files.length}
        >
          <Play className="h-4 w-4" />
          {taskStatus === 'cancelled'
            ? t('home:restartTask')
            : t('home:startTask')}
        </Button>
      )}
      {taskStatus === 'running' && (
        <>
          <Button
            className="gap-1.5"
            onClick={handlePause}
            title={t('home:pauseTip')}
          >
            <Pause className="h-4 w-4" />
            {t('home:pauseTask')}
          </Button>
          <Button className="gap-1.5" onClick={handleCancel}>
            <CircleStop className="h-4 w-4" />
            {t('home:cancelTask')}
          </Button>
        </>
      )}
      {taskStatus === 'paused' && (
        <>
          <Button className="gap-1.5" onClick={handleResume}>
            <Play className="h-4 w-4" />
            {t('home:resumeTask')}
          </Button>
          <Button className="gap-1.5" onClick={handleCancel}>
            <CircleStop className="h-4 w-4" />
            {t('home:cancelTask')}
          </Button>
        </>
      )}
      {taskStatus === 'cancelling' && (
        <Button className="gap-1.5" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('home:cancelling')}
        </Button>
      )}
    </div>
  );
};

export default TaskControls;
