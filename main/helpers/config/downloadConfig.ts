import {
  DownloadEndpointConfig,
  normalizeDownloadEndpoints,
} from '../../../types/downloadConfig';

export type { DownloadEndpointConfig } from '../../../types/downloadConfig';
export {
  DEFAULT_DOWNLOAD_ENDPOINTS,
  EDITABLE_DOWNLOAD_ENDPOINT_KEYS,
  normalizeDownloadEndpoints,
} from '../../../types/downloadConfig';

/**
 * 實時讀取當前生效的下載端點配置（store 用戶覆蓋 + 預設值合併）。
 * 每次調用都重新讀取，因此用戶在設置頁改完即時生效，無需重啟 / 發版。
 */
export function getDownloadEndpoints(): DownloadEndpointConfig {
  let raw: Partial<DownloadEndpointConfig> | undefined;
  try {
    // 延遲 require：store 在模塊加載期會調用 electron app.getPath()，
    // 頂層 import 會讓任何引入本模塊的純函數（如各 model catalog）在非
    // Electron 環境（單測/腳本）下崩潰。改為調用時按需取，運行期行為不變。
    const { store } = require('../store') as typeof import('../store');
    const settings = store.get('settings') as
      | { downloadEndpoints?: Partial<DownloadEndpointConfig> }
      | undefined;
    raw = settings?.downloadEndpoints;
  } catch {
    raw = undefined;
  }
  return normalizeDownloadEndpoints(raw);
}

export function getGithubBase(): string {
  return getDownloadEndpoints().githubBase;
}

export function getGithubProxyPrefix(): string {
  return getDownloadEndpoints().githubProxyPrefix;
}

export function getGitcodeBase(): string {
  return getDownloadEndpoints().gitcodeBase;
}

export function getModelScopeBase(): string {
  return getDownloadEndpoints().modelScopeBase;
}

/**
 * 解析 HuggingFace base（含協議、無末尾斜槓）：source==='huggingface' 用官方，
 * 否則用國內鏡像。保持既有各 downloader 的語義（預設走鏡像）。
 */
export function getHfHost(source?: string): string {
  const ep = getDownloadEndpoints();
  return source === 'huggingface'
    ? ep.huggingFaceOfficial
    : ep.huggingFaceMirror;
}

/**
 * HuggingFace base 回退序列（含協議）：source==='huggingface' 官方優先，否則鏡像優先。
 * 供需要按序回退多個 base 的 downloader（如 funasr）使用。
 */
export function getHfHosts(source?: string): string[] {
  const ep = getDownloadEndpoints();
  return source === 'huggingface'
    ? [ep.huggingFaceOfficial, ep.huggingFaceMirror]
    : [ep.huggingFaceMirror, ep.huggingFaceOfficial];
}

/** 用當前配置的代理前綴包裹一個完整 github url（前綴與 url 間自動補 /）。 */
export function wrapGithubProxy(githubUrl: string): string {
  return `${getGithubProxyPrefix()}/${githubUrl}`;
}
