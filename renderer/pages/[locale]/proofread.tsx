import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { getStaticPaths, makeStaticProperties } from '../../lib/get-static';
import ProofreadImport from '@/components/proofread/ProofreadImport';
import ProofreadFileList from '@/components/proofread/ProofreadFileList';
import ProofreadEditor from '@/components/proofread/ProofreadEditor';
import Txt2SrtDialog from '@/components/proofread/Txt2SrtDialog';
import PageHeader from '@/components/PageHeader';
import { ProofreadTask } from '../../../types/proofread';
import {
  PendingFile,
  loadPendingFileFromItem,
  pendingFileToSaveFormat,
} from '@/lib/proofreadUtils';
import { useConfirmOrUndo } from '../../hooks/useConfirmOrUndo';

// 工作流階段
type WorkflowStage = 'import' | 'list' | 'edit';

// 重新導出 PendingFile 類型供其他組件使用
export type { PendingFile } from '@/lib/proofreadUtils';

export default function ProofreadPage() {
  const router = useRouter();
  const { workItem: workItemQuery } = router.query;
  const { t } = useTranslation('home');
  const confirmOrUndo = useConfirmOrUndo();

  // 工作流狀態
  const [stage, setStage] = useState<WorkflowStage>('import');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [currentEditIndex, setCurrentEditIndex] = useState<number>(-1);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [taskName, setTaskName] = useState<string>('');
  const [importType, setImportType] = useState<'video' | 'subtitle'>('video');
  const [txt2SrtOpen, setTxt2SrtOpen] = useState(false);

  // 從歷史任務加載
  const handleLoadTask = useCallback(async (task: ProofreadTask) => {
    // 使用工具函數為每個項目加載可用字幕
    const files: PendingFile[] = await Promise.all(
      task.items.map((item) => loadPendingFileFromItem(item)),
    );

    // 判斷導入類型
    const hasVideo = task.items.some((item) => item.videoPath);
    setImportType(hasVideo ? 'video' : 'subtitle');

    setPendingFiles(files);
    setSavedTaskId(task.id);
    setTaskName(task.name);
    setStage('list');
  }, []);

  // 從啟動臺 deep link 加載已保存的校對批次
  useEffect(() => {
    if (typeof workItemQuery !== 'string' || !workItemQuery) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await window.ipc.invoke('getProofreadTaskById', {
          id: workItemQuery,
        });
        if (cancelled || !result?.success || !result.data) return;
        await handleLoadTask(result.data as ProofreadTask);
      } catch (error) {
        console.error('Failed to load proofread work item:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workItemQuery, handleLoadTask]);

  // 導入完成後進入列表
  const handleImportComplete = useCallback(
    (files: PendingFile[], type: 'video' | 'subtitle') => {
      setPendingFiles(files);
      setSavedTaskId(null);
      setImportType(type);
      // 預設任務名為第一個文件名（去除擴展名）
      const defaultName = files[0]?.fileName?.replace(/\.[^.]+$/, '') || '';
      setTaskName(defaultName);
      setStage('list');
    },
    [],
  );

  // 開始對齊任務
  const handleAlignStart = useCallback(
    async (videoPath: string, txtPath: string, payload: any) => {
      import('path').then((path) => {
        import('uuid').then(({ v4: uuidv4 }) => {
          const fileId = uuidv4();
          const pendingFile: PendingFile = {
            id: fileId,
            fileName: path.basename(videoPath),
            videoPath,
            detectedSubtitles: [],
            status: 'aligning',
          };

          setPendingFiles((prev) => [...prev, pendingFile]);
          // 如果是第一筆，則重置 taskId 等
          setSavedTaskId((prev) => prev); // keep existing if any
          setImportType('video');
          setTaskName(
            (prevName) =>
              prevName || pendingFile.fileName.replace(/\.[^.]+$/, ''),
          );
          setStage('list');

          // 開始背景處理
          window.ipc
            .invoke('python-engine:align', payload)
            .then((res) => {
              if (res.success && res.result?.srtPath) {
                setPendingFiles((prev) =>
                  prev.map((f) => {
                    if (f.id === fileId) {
                      return {
                        ...f,
                        status: 'pending',
                        detectedSubtitles: [
                          {
                            filePath: res.result.srtPath,
                            type: 'source',
                            confidence: 100,
                          },
                        ],
                        selectedSource: res.result.srtPath,
                      };
                    }
                    return f;
                  }),
                );
              } else {
                setPendingFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId ? { ...f, status: 'error' } : f,
                  ),
                );
              }
            })
            .catch((err) => {
              console.error('Background align error:', err);
              setPendingFiles((prev) =>
                prev.map((f) =>
                  f.id === fileId ? { ...f, status: 'error' } : f,
                ),
              );
            });
        });
      });
    },
    [],
  );

  // 開始校對某個文件
  const handleStartProofread = useCallback((index: number) => {
    setCurrentEditIndex(index);
    setPendingFiles((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], status: 'proofreading' };
      return next;
    });
    setStage('edit');
  }, []);

  // 標記完成，返回列表
  const handleMarkComplete = useCallback(() => {
    setPendingFiles((prev) => {
      const next = [...prev];
      next[currentEditIndex] = {
        ...next[currentEditIndex],
        status: 'completed',
      };
      return next;
    });
    setCurrentEditIndex(-1);
    setStage('list');
  }, [currentEditIndex]);

  // 返回列表（不標記完成）
  const handleBackToList = useCallback(() => {
    setCurrentEditIndex(-1);
    setStage('list');
  }, []);

  // 更新文件配置
  const handleUpdateFile = useCallback(
    (index: number, updates: Partial<PendingFile>) => {
      setPendingFiles((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    },
    [],
  );

  // 刪除文件（可撤銷）
  const handleRemoveFile = useCallback(
    (index: number) => {
      let removed: PendingFile | undefined;
      setPendingFiles((prev) => {
        removed = prev[index];
        return prev.filter((_, i) => i !== index);
      });
      confirmOrUndo(t('fileRemoved'), () => {
        if (!removed) return;
        const item = removed;
        setPendingFiles((prev) => {
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, item);
          return next;
        });
      });
    },
    [confirmOrUndo, t],
  );

  // 追加文件
  const handleAddFiles = useCallback((newFiles: PendingFile[]) => {
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  // 保存任務
  const handleSaveTask = useCallback(async () => {
    // 使用工具函數轉換為保存格式
    const items = pendingFiles.map(pendingFileToSaveFormat);

    if (savedTaskId) {
      // 更新現有任務
      await window.ipc.invoke('updateProofreadTask', {
        taskId: savedTaskId,
        updates: { items, name: taskName },
      });
    } else {
      // 創建新任務
      const result = await window.ipc.invoke('createProofreadTask', {
        items,
        name:
          taskName ||
          pendingFiles[0]?.fileName?.replace(/\.[^.]+$/, '') ||
          'Untitled',
      });
      if (result.success) {
        setSavedTaskId(result.data.id);
      }
    }
    return true;
  }, [pendingFiles, savedTaskId, taskName]);

  // 重置，開始新的導入（可撤銷）
  const handleReset = useCallback(() => {
    const prev = {
      pendingFiles,
      currentEditIndex,
      savedTaskId,
      taskName,
      importType,
      stage,
    };
    setPendingFiles([]);
    setCurrentEditIndex(-1);
    setSavedTaskId(null);
    setTaskName('');
    setImportType('video');
    setStage('import');
    if (prev.pendingFiles.length > 0) {
      confirmOrUndo(t('importReset'), () => {
        setPendingFiles(prev.pendingFiles);
        setCurrentEditIndex(prev.currentEditIndex);
        setSavedTaskId(prev.savedTaskId);
        setTaskName(prev.taskName);
        setImportType(prev.importType);
        setStage(prev.stage);
      });
    }
  }, [
    pendingFiles,
    currentEditIndex,
    savedTaskId,
    taskName,
    importType,
    stage,
    confirmOrUndo,
    t,
  ]);

  // 自動保存：當已保存的任務有變化時自動更新
  const isInitialMount = useRef(true);
  useEffect(() => {
    // 跳過首次加載
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // 只有在已保存任務且列表不為空時才自動保存
    if (savedTaskId && pendingFiles.length > 0 && stage === 'list') {
      const autoSaveTimeout = setTimeout(async () => {
        try {
          await handleSaveTask();
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }, 500); // 防抖 500ms

      return () => clearTimeout(autoSaveTimeout);
    }
  }, [pendingFiles, savedTaskId, stage]);

  // 渲染當前階段
  const renderStage = () => {
    switch (stage) {
      case 'import':
        return (
          <ProofreadImport
            onImportComplete={handleImportComplete}
            onAlignStart={handleAlignStart}
            onTxt2SrtClick={() => {
              setStage('list');
              setTxt2SrtOpen(true);
            }}
          />
        );

      case 'list':
        return (
          <ProofreadFileList
            files={pendingFiles}
            savedTaskId={savedTaskId}
            taskName={taskName}
            importType={importType}
            onTaskNameChange={setTaskName}
            onStartProofread={handleStartProofread}
            onUpdateFile={handleUpdateFile}
            onRemoveFile={handleRemoveFile}
            onAddFiles={handleAddFiles}
            onSaveTask={handleSaveTask}
            onReset={handleReset}
            onTxt2SrtClick={() => setTxt2SrtOpen(true)}
          />
        );

      case 'edit':
        const currentFile = pendingFiles[currentEditIndex];
        return (
          <ProofreadEditor
            file={currentFile}
            onMarkComplete={handleMarkComplete}
            onBack={handleBackToList}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-full p-4 overflow-hidden flex flex-col gap-4">
      {/* 僅導入階段顯示樞紐頁大標題；列表/編輯階段為工作頁，用自帶的返回箭頭頭部 */}
      {stage === 'import' && (
        <PageHeader
          title={t('proofreadPageTitle')}
          description={t('proofreadPageDesc')}
        />
      )}
      <div className="flex-1 overflow-auto min-h-0">{renderStage()}</div>

      <Txt2SrtDialog
        open={txt2SrtOpen}
        onOpenChange={setTxt2SrtOpen}
        onAlignStart={handleAlignStart}
      />
    </div>
  );
}

export const getStaticProps = makeStaticProperties(['common', 'home']);
export { getStaticPaths };
