/**
 * 失敗字幕批量重翻：調用主進程 retranslateSubtitles（與正式任務同翻譯鏈路），
 * 支持進度展示與取消；完成/取消後按 id+時間戳一次性回填（一條撤銷命令）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'next-i18next';
import { Subtitle } from './useSubtitles';

export interface RetranslateControl {
  running: boolean;
  cancelling: boolean;
  done: number;
  total: number;
  start: () => void;
  cancel: () => void;
}

interface UseRetranslateFailedOptions {
  /** 讀取最新字幕數組（避免異步結束後拿過期快照） */
  getSubtitles: () => Subtitle[];
  getFailedTranslationIndices: () => number[];
  /** 一次性應用回填（內部產生一條撤銷命令） */
  updateSubtitles: (subtitles: Subtitle[]) => void;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export function useRetranslateFailed({
  getSubtitles,
  getFailedTranslationIndices,
  updateSubtitles,
  sourceLanguage,
  targetLanguage,
}: UseRetranslateFailedOptions): RetranslateControl {
  const { t } = useTranslation('home');
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const batchIdRef = useRef<string | null>(null);

  // 最新依賴引用，保持 start/cancel 引用穩定
  const latestRef = useRef({
    getSubtitles,
    getFailedTranslationIndices,
    updateSubtitles,
    sourceLanguage,
    targetLanguage,
  });
  latestRef.current = {
    getSubtitles,
    getFailedTranslationIndices,
    updateSubtitles,
    sourceLanguage,
    targetLanguage,
  };

  // 進度事件（按 batchId 過濾）
  useEffect(() => {
    const cleanup = window.ipc.on(
      'retranslateProgress',
      (data: { batchId?: string; done?: number; total?: number }) => {
        if (!batchIdRef.current || data?.batchId !== batchIdRef.current) return;
        setDone(data.done ?? 0);
        setTotal(data.total ?? 0);
      },
    );
    return cleanup;
  }, []);

  const start = useCallback(async () => {
    if (batchIdRef.current) return;
    const {
      getSubtitles: getSubs,
      getFailedTranslationIndices: getFailed,
      sourceLanguage: from,
      targetLanguage: to,
    } = latestRef.current;

    const current = getSubs();
    const failedIndices = getFailed();
    if (failedIndices.length === 0) return;

    const payload = failedIndices
      .map((i) => current[i])
      .filter(Boolean)
      .map((row) => ({
        id: row.id,
        startEndTime: row.startEndTime,
        content: (row.sourceContent || '').split('\n'),
      }));

    const batchId = `retranslate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    batchIdRef.current = batchId;
    setRunning(true);
    setCancelling(false);
    setDone(0);
    setTotal(payload.length);

    try {
      const result = await window.ipc.invoke('retranslateSubtitles', {
        subtitles: payload,
        sourceLanguage: from,
        targetLanguage: to,
        batchId,
      });

      if (!result?.success && result?.error === 'NO_DEFAULT_PROVIDER') {
        toast.error(t('retranslateNoProvider'));
        return;
      }

      const results: Array<{
        id: string;
        startEndTime: string;
        targetContent: string;
      }> = result?.data || [];

      if (!result?.success && results.length === 0) {
        toast.error(result?.error || t('retranslateFailed'));
        return;
      }

      // 按 id+時間戳回填；運行期間被用戶改動過結構/時間的行自然匹配失敗跳過
      const resultMap = new Map<string, string>();
      results.forEach((r) => {
        if (r.targetContent && r.targetContent.trim()) {
          resultMap.set(`${r.id}|${r.startEndTime}`, r.targetContent);
        }
      });

      let applied = 0;
      if (resultMap.size > 0) {
        const latest = latestRef.current.getSubtitles();
        const next = latest.map((row) => {
          const hit = resultMap.get(`${row.id}|${row.startEndTime}`);
          // 只回填仍為空的行，避免覆蓋用戶在重翻期間手動填寫的內容
          if (hit && (!row.targetContent || !row.targetContent.trim())) {
            applied += 1;
            return { ...row, targetContent: hit };
          }
          return row;
        });
        if (applied > 0) {
          latestRef.current.updateSubtitles(next);
        }
      }

      if (result?.cancelled) {
        toast.info(
          t('retranslateCancelledPartial', { count: applied }) ||
            `已取消，已回填 ${applied} 條`,
        );
      } else if (applied > 0) {
        toast.success(
          t('retranslateDone', { count: applied }) ||
            `重翻完成，已回填 ${applied} 條`,
        );
      } else {
        toast.warning(t('retranslateNoResult'));
      }
    } catch (error) {
      console.error('Retranslate error:', error);
      toast.error(t('retranslateFailed'));
    } finally {
      setRunning(false);
      setCancelling(false);
      batchIdRef.current = null;
    }
  }, [t]);

  const cancel = useCallback(async () => {
    if (!batchIdRef.current) return;
    setCancelling(true);
    try {
      await window.ipc.invoke('cancelProofreadBatch', {
        batchId: batchIdRef.current,
      });
    } catch (error) {
      console.error('Cancel retranslate error:', error);
    }
  }, []);

  return { running, cancelling, done, total, start, cancel };
}
