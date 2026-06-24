/**
 * 代理設置 → global-agent 運行時配置的純映射邏輯。
 * 單獨成文件、不引入 Electron/store，便於在 node 單測中直接引用。
 */

export interface ProxySettings {
  proxyMode?: 'none' | 'custom';
  proxyUrl?: string;
  proxyNoProxy?: string;
}

export interface ProxyEnv {
  httpProxy: string;
  noProxy: string;
}

export const DEFAULT_NO_PROXY = 'localhost,127.0.0.1';

/**
 * 純函數：把代理設置映射為 global-agent 需要的 {httpProxy, noProxy}。
 * none / 缺失 / custom 但無 URL → 全空（等於關閉代理）。
 */
export function resolveProxyEnv(settings: ProxySettings): ProxyEnv {
  const url = (settings?.proxyUrl || '').trim();
  if (settings?.proxyMode === 'custom' && url) {
    const noProxy = (settings.proxyNoProxy || DEFAULT_NO_PROXY).trim();
    return { httpProxy: url, noProxy };
  }
  return { httpProxy: '', noProxy: '' };
}
