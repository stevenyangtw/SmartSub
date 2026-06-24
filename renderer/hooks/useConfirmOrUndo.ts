import { useCallback } from 'react';
import { useTranslation } from 'next-i18next';
import { toast } from 'sonner';

/**
 * 危險操作統一交互：立即執行 + 5 秒撤銷 toast（Linear/Notion 模式）。
 *
 * 調用方先自行快照舊狀態並應用變更，再調用本函數給出撤銷入口：
 *
 *   const confirmOrUndo = useConfirmOrUndo();
 *   const prev = files;
 *   setFiles([]);
 *   confirmOrUndo(t('listCleared'), () => setFiles(prev));
 */
export function useConfirmOrUndo() {
  const { t } = useTranslation('common');

  return useCallback(
    (message: string, undo: () => void) => {
      toast(message, {
        action: {
          label: t('undo'),
          onClick: undo,
        },
        duration: 5000,
      });
    },
    [t],
  );
}
