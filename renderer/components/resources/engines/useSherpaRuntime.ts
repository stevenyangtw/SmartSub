import { useCallback, useEffect, useState } from 'react';
import type { SherpaLibStatus } from '../../../../types/sherpa';

export interface SherpaRuntime {
  libStatus: SherpaLibStatus | null;
  installed: boolean;
  reload: () => Promise<void>;
}

/**
 * FunASR / Qwen / FireRed 共用的 sherpa-onnx 原生運行庫已隨安裝包內置（不再運行時下載）。
 * 此 hook 僅查詢內置狀態（installed + 內置版本），供各引擎面板展示「已隨應用內置」。
 * 狀態上提到常駐掛載的父組件（EngineModelTab）統一持有，避免各面板重複查詢。
 */
export function useSherpaRuntime(): SherpaRuntime {
  const [libStatus, setLibStatus] = useState<SherpaLibStatus | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await window?.ipc?.invoke('sherpa-lib-status');
      if (r) setLibStatus(r as SherpaLibStatus);
    } catch {
      // 忽略：保持上次狀態
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    libStatus,
    installed: libStatus?.installed === true,
    reload,
  };
}
