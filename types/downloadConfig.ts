/**
 * 下載源端點（鏡像 / 代理）配置。
 *
 * 集中管理所有「可被用戶覆蓋」的下載基礎地址，作為單一來源（single source of
 * truth）：main 進程各 downloader 統一從此讀取，renderer 設置頁統一編輯，避免鏡像 /
 * 代理地址散落在各處硬編碼、改一處不夠、還要發版的問題。
 *
 * 本文件必須保持「純 TS、無 electron/node 副作用」，以便 renderer 也能直接 import。
 */
export interface DownloadEndpointConfig {
  /** GitHub 站點 base（含協議、無末尾斜槓），如 https://github.com */
  githubBase: string;
  /** GitHub 代理前綴（含協議、無末尾斜槓），拼接時自動補 /，如 https://gh-proxy.com */
  githubProxyPrefix: string;
  /** GitCode 站點 base（含協議、無末尾斜槓），如 https://gitcode.com */
  gitcodeBase: string;
  /** HuggingFace 國內鏡像 base（含協議、無末尾斜槓），如 https://hf-mirror.com */
  huggingFaceMirror: string;
  /** HuggingFace 官方 base（含協議、無末尾斜槓），如 https://huggingface.co */
  huggingFaceOfficial: string;
  /** ModelScope 站點 base（含協議、無末尾斜槓），如 https://modelscope.cn */
  modelScopeBase: string;
}

export const DEFAULT_DOWNLOAD_ENDPOINTS: DownloadEndpointConfig = {
  githubBase: 'https://github.com',
  githubProxyPrefix: 'https://gh-proxy.com',
  gitcodeBase: 'https://gitcode.com',
  huggingFaceMirror: 'https://hf-mirror.com',
  huggingFaceOfficial: 'https://huggingface.co',
  modelScopeBase: 'https://modelscope.cn',
};

/**
 * P0 階段在設置頁暴露給用戶編輯的字段（其餘字段保留默認值，便於未來擴展）。
 * 順序即設置頁展示順序。
 */
export const EDITABLE_DOWNLOAD_ENDPOINT_KEYS: (keyof DownloadEndpointConfig)[] =
  ['githubProxyPrefix', 'huggingFaceMirror', 'modelScopeBase', 'gitcodeBase'];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** base：含協議、無末尾斜槓；缺協議自動補 https://；空回退默認。 */
function normalizeBase(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  let v = value.trim();
  if (!v) return fallback;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  v = stripTrailingSlash(v);
  return v || fallback;
}

/**
 * 將用戶覆蓋（可能為部分字段 / 空值 / 非法值）與默認值合併為一份完整、規範的配置。
 * 任何缺失或非法字段都會回退到對應默認值，保證下游永遠拿到可用地址。
 */
export function normalizeDownloadEndpoints(
  raw: Partial<DownloadEndpointConfig> | undefined | null,
): DownloadEndpointConfig {
  const r = raw ?? {};
  return {
    githubBase: normalizeBase(
      r.githubBase,
      DEFAULT_DOWNLOAD_ENDPOINTS.githubBase,
    ),
    githubProxyPrefix: normalizeBase(
      r.githubProxyPrefix,
      DEFAULT_DOWNLOAD_ENDPOINTS.githubProxyPrefix,
    ),
    gitcodeBase: normalizeBase(
      r.gitcodeBase,
      DEFAULT_DOWNLOAD_ENDPOINTS.gitcodeBase,
    ),
    huggingFaceMirror: normalizeBase(
      r.huggingFaceMirror,
      DEFAULT_DOWNLOAD_ENDPOINTS.huggingFaceMirror,
    ),
    huggingFaceOfficial: normalizeBase(
      r.huggingFaceOfficial,
      DEFAULT_DOWNLOAD_ENDPOINTS.huggingFaceOfficial,
    ),
    modelScopeBase: normalizeBase(
      r.modelScopeBase,
      DEFAULT_DOWNLOAD_ENDPOINTS.modelScopeBase,
    ),
  };
}
