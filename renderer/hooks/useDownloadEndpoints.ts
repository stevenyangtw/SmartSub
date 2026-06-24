import { useEffect, useState } from 'react';
import {
  DEFAULT_DOWNLOAD_ENDPOINTS,
  normalizeDownloadEndpoints,
  type DownloadEndpointConfig,
} from '../../types/downloadConfig';

/**
 * 讀取「當前生效的下載端點配置」（用戶在設置頁的覆蓋 + 預設值規範化）。
 *
 * 僅用於 renderer 側展示用途（如「複製下載鏈接」），讓複製出的鏡像地址與用戶配置一致。
 * 通過模塊級緩存保證：無論掛載多少行，整個會話只發一次 getSettings IPC。
 */
let cache: DownloadEndpointConfig | null = null;
let inflight: Promise<DownloadEndpointConfig> | null = null;

/** 設置頁保存 / 重置下載端點後調用，使緩存失效，下次掛載即讀取最新配置。 */
export function invalidateDownloadEndpointsCache(): void {
  cache = null;
  inflight = null;
}

async function loadEndpoints(): Promise<DownloadEndpointConfig> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const settings = await window?.ipc?.invoke('getSettings');
        cache = normalizeDownloadEndpoints(settings?.downloadEndpoints);
      } catch {
        cache = { ...DEFAULT_DOWNLOAD_ENDPOINTS };
      }
      return cache;
    })();
  }
  return inflight;
}

export default function useDownloadEndpoints(): DownloadEndpointConfig {
  const [endpoints, setEndpoints] = useState<DownloadEndpointConfig>(
    cache ?? DEFAULT_DOWNLOAD_ENDPOINTS,
  );

  useEffect(() => {
    let mounted = true;
    if (cache) {
      setEndpoints(cache);
      return;
    }
    void loadEndpoints().then((ep) => {
      if (mounted) setEndpoints(ep);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return endpoints;
}
