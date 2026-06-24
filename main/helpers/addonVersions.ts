import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import { logMessage } from './storeManager';
import type {
  RemoteAddonVersions,
  AddonVariant,
  AddonUpdateInfo,
} from '../../types/addon';
import {
  getAddonConfig,
  getInstalledAddons,
  isAddonInstalled,
} from './addonManager';
import { getBuildInfo } from './buildInfo';
import {
  isPlatformCudaCapable,
  getBuiltinVulkanAddonPath,
  getEffectivePlatform,
} from './cudaUtils';
import { getDownloadUrl, getAddonVersionsUrl } from './addonDownloader';
import type { DownloadSource } from '../../types/addon';
import { getSourceFallbackOrder } from './downloadSourceOrder';
import { compareDateVersion } from './download/versionCompare';

/**
 * 緩存的遠程版本信息
 */
let cachedVersions: RemoteAddonVersions | null = null;
let lastFetchTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分鐘緩存

/**
 * 獲取遠程版本信息：按所選源回退順序依次嘗試拉取 addon-versions.json。
 */
export async function fetchRemoteVersions(
  source: DownloadSource = 'github',
): Promise<RemoteAddonVersions | null> {
  // 檢查緩存
  if (cachedVersions && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedVersions;
  }

  const order = getSourceFallbackOrder(source);
  for (const s of order) {
    try {
      const content = await fetchJson(getAddonVersionsUrl(s));
      cachedVersions = content as RemoteAddonVersions;
      lastFetchTime = Date.now();
      logMessage(`Fetched remote addon versions from ${s}`, 'info');
      return cachedVersions;
    } catch (error) {
      logMessage(`Fetch versions from ${s} failed: ${error}`, 'warning');
    }
  }
  return null;
}

/**
 * 獲取 JSON 數據
 */
function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const request = protocol.get(
      url,
      {
        headers: {
          'User-Agent': 'SmartSub-Electron',
          Accept: 'application/json',
        },
        timeout: 10000,
      },
      (response) => {
        // 處理重定向
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400
        ) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            fetchJson(redirectUrl).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`HTTP Error: ${response.statusCode}`));
          return;
        }

        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        });
      },
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * 檢查是否強制顯示更新（開發模式）
 */
function shouldForceUpdate(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.DEV_FORCE_ADDON_UPDATE === 'true';
}

/**
 * 檢查指定版本是否有更新
 */
export async function checkVersionUpdate(
  variant: AddonVariant,
): Promise<AddonUpdateInfo | null> {
  const config = getAddonConfig();
  const installedInfo = config.installed[variant];

  if (!installedInfo) {
    return null;
  }

  // 開發模式下強制顯示更新
  if (shouldForceUpdate()) {
    logMessage(`[DEV] Forcing update for version ${variant}`, 'info');
    return {
      variant,
      hasUpdate: true,
      localVersion: installedInfo.remoteVersion,
      remoteVersion: 'dev-force-update',
      updateNotes: '開發模式強制更新測試',
    };
  }

  const remoteVersions = await fetchRemoteVersions();
  if (!remoteVersions || !remoteVersions[variant]) {
    return null;
  }

  const remoteInfo = remoteVersions[variant];
  // 統一日期版本比較，避免 "2026.02.06" vs "2026-02-06" 因分隔符不同導致誤判
  const hasUpdate =
    compareDateVersion(remoteInfo.version, installedInfo.remoteVersion) > 0;

  return {
    variant,
    hasUpdate,
    localVersion: installedInfo.remoteVersion,
    remoteVersion: remoteInfo.version,
    updateNotes: remoteInfo.updateNotes,
  };
}

/**
 * 檢查所有已安裝版本的更新
 */
export async function checkAllUpdates(): Promise<AddonUpdateInfo[]> {
  const installed = getInstalledAddons();
  const updates: AddonUpdateInfo[] = [];

  for (const { version } of installed) {
    const updateInfo = await checkVersionUpdate(version);
    if (updateInfo) {
      updates.push(updateInfo);
    }
  }

  // 內置 Vulkan（尚未下載到 userData 時）也參與更新檢測：
  // 遠程版本比構建日期新 → 提示可下載更新版到 userData 覆蓋內置
  if (
    isPlatformCudaCapable() &&
    !isAddonInstalled('vulkan') &&
    fs.existsSync(getBuiltinVulkanAddonPath())
  ) {
    const builtinVersion = getBuiltinVulkanVersion();
    if (builtinVersion) {
      const remoteVersions = await fetchRemoteVersions();
      const remoteVulkan = remoteVersions?.vulkan;
      if (remoteVulkan) {
        const hasUpdate =
          compareDateVersion(remoteVulkan.version, builtinVersion) > 0;
        if (hasUpdate) {
          updates.push({
            variant: 'vulkan',
            hasUpdate: true,
            localVersion: builtinVersion,
            remoteVersion: remoteVulkan.version,
            updateNotes: remoteVulkan.updateNotes,
          });
        }
      }
    }
  }

  return updates;
}

/**
 * 獲取有更新的版本列表
 */
export async function getAvailableUpdates(): Promise<AddonUpdateInfo[]> {
  const allUpdates = await checkAllUpdates();
  return allUpdates.filter((u) => u.hasUpdate);
}

/**
 * 獲取特定版本的遠程信息
 */
export async function getRemoteVersionInfo(
  version: AddonVariant,
): Promise<{ version: string; updateNotes: string } | null> {
  const remoteVersions = await fetchRemoteVersions();
  if (!remoteVersions || !remoteVersions[version]) {
    return null;
  }

  const info = remoteVersions[version];
  return {
    version: info.version,
    updateNotes: info.updateNotes,
  };
}

/**
 * 獲取指定版本的校驗和信息
 */
export async function getVersionChecksum(
  version: AddonVariant,
  type: 'windows-tar' | 'windows-node' | 'linux-tar' | 'linux-node',
): Promise<string | null> {
  const remoteVersions = await fetchRemoteVersions();
  if (!remoteVersions || !remoteVersions[version]) {
    return null;
  }

  const info = remoteVersions[version];
  return info.checksum?.[type] || null;
}

/**
 * 清除版本緩存
 */
export function clearVersionCache(): void {
  cachedVersions = null;
  lastFetchTime = 0;
}

/**
 * 內置 Vulkan addon 的版本號（取 CI 注入的構建日期，如 "2026.06.10"）
 * 開發環境無 buildInfo 時返回 null（跳過更新提示）
 */
export function getBuiltinVulkanVersion(): string | null {
  const buildInfo = getBuildInfo();
  if (!buildInfo?.buildDate) {
    return null;
  }
  return buildInfo.buildDate.split('T')[0].replace(/-/g, '.');
}

type PackageSizeKey =
  | 'windows-tar'
  | 'windows-node'
  | 'linux-tar'
  | 'linux-node';

const packageSizeCache = new Map<string, { size: number; fetchedAt: number }>();
const PACKAGE_SIZE_CACHE_TTL = 30 * 60 * 1000;
// 真實加速包均為數十~數百 MB；小於 1MB 的 HEAD 結果視為無效佔位（如 GitCode 的 128B）。
const MIN_PLAUSIBLE_PACKAGE_BYTES = 1024 * 1024;

function getPackageSizeKey(
  downloadType: 'node.gz' | 'tar.gz',
): PackageSizeKey | null {
  const platform = getEffectivePlatform();
  if (platform !== 'win32' && platform !== 'linux') {
    return null;
  }
  const osPrefix = platform === 'win32' ? 'windows' : 'linux';
  return downloadType === 'tar.gz'
    ? (`${osPrefix}-tar` as PackageSizeKey)
    : (`${osPrefix}-node` as PackageSizeKey);
}

function headContentLength(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const request = protocol.request(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': 'SmartSub-Electron',
        },
        timeout: 10000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          headContentLength(response.headers.location).then(resolve);
          return;
        }
        const len = response.headers['content-length'];
        resolve(len ? parseInt(len, 10) : null);
        response.resume();
      },
    );

    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

/**
 * 獲取加速包下載體積：優先讀 addon-versions.json 的 sizes，否則 HEAD 探測
 */
export async function getPackageDownloadSize(
  variant: AddonVariant,
  downloadType: 'node.gz' | 'tar.gz',
  source: DownloadSource = 'github',
): Promise<number | null> {
  const sizeKey = getPackageSizeKey(downloadType);
  if (!sizeKey) return null;

  const cacheKey = `${variant}:${downloadType}:${source}`;
  const cached = packageSizeCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PACKAGE_SIZE_CACHE_TTL) {
    return cached.size;
  }

  const remoteVersions = await fetchRemoteVersions(source);
  const remoteSize = remoteVersions?.[variant]?.sizes?.[sizeKey];
  if (typeof remoteSize === 'number' && remoteSize > 0) {
    packageSizeCache.set(cacheKey, { size: remoteSize, fetchedAt: Date.now() });
    return remoteSize;
  }

  try {
    // 加速包在各鏡像為同一文件、體積一致，故體積探測固定走 GitHub 直鏈：
    // GitCode CDN 不支持 HEAD（會返回 128B 佔位），直接 HEAD 它會得到錯誤體積。
    // 同時拒絕明顯異常的過小值，避免界面顯示 128B，轉而回退到靜態體積提示。
    const url = getDownloadUrl('github', variant, downloadType);
    const size = await headContentLength(url);
    if (size && size >= MIN_PLAUSIBLE_PACKAGE_BYTES) {
      packageSizeCache.set(cacheKey, { size, fetchedAt: Date.now() });
      return size;
    }
    return null;
  } catch {
    return null;
  }
}
