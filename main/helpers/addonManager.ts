import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logMessage } from './storeManager';
import type {
  AddonConfig,
  InstalledAddon,
  AddonVariant,
} from '../../types/addon';
import { ALL_ADDON_VARIANTS } from '../../types/addon';
import { getEffectivePlatform } from './cudaUtils';

/**
 * 獲取 addons 目錄路徑
 */
export function getAddonsDir(): string {
  return path.join(app.getPath('userData'), 'addons');
}

/**
 * 獲取配置文件路徑
 */
function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'addon-config.json');
}

/**
 * 讀取加速包配置
 */
export function getAddonConfig(): AddonConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    logMessage(`Error reading addon config: ${error}`, 'error');
  }

  return {
    selectedVersion: null,
    installed: {},
  };
}

/**
 * 保存加速包配置
 */
export function saveAddonConfig(config: AddonConfig): void {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    logMessage('Addon config saved', 'info');
  } catch (error) {
    logMessage(`Error saving addon config: ${error}`, 'error');
  }
}

/**
 * 變體目錄名：cuda-1240 / vulkan
 */
export function getVariantDirName(variant: AddonVariant): string {
  return variant === 'vulkan' ? 'vulkan' : `cuda-${variant.replace(/\./g, '')}`;
}

/**
 * 獲取特定變體的 addon 目錄路徑
 */
export function getAddonVersionDir(variant: AddonVariant): string {
  return path.join(getAddonsDir(), getVariantDirName(variant));
}

/**
 * 檢查特定版本的 addon 是否已安裝
 */
export function isAddonInstalled(version: AddonVariant): boolean {
  const versionDir = getAddonVersionDir(version);
  const addonPath = path.join(versionDir, 'addon.node');
  return fs.existsSync(addonPath);
}

/**
 * 檢查目錄下是否有依賴的動態鏈接庫
 */
export function hasDependentLibs(versionDir: string): boolean {
  const platform = getEffectivePlatform();

  try {
    const files = fs.readdirSync(versionDir);

    if (platform === 'win32') {
      return files.some((f) => f.toLowerCase().endsWith('.dll'));
    } else if (platform === 'linux') {
      return files.some((f) => f.includes('.so'));
    }
  } catch {
    // 目錄不存在或無法讀取
  }

  return false;
}

/**
 * 獲取已安裝的加速包列表
 */
export function getInstalledAddons(): Array<{
  version: AddonVariant;
  info: InstalledAddon;
}> {
  const config = getAddonConfig();
  const result: Array<{ version: AddonVariant; info: InstalledAddon }> = [];

  // 遍歷所有可用變體
  for (const version of ALL_ADDON_VARIANTS) {
    if (isAddonInstalled(version)) {
      const info = config.installed[version] || {
        installedAt: new Date().toISOString(),
        remoteVersion: 'unknown',
        hasDlls: hasDependentLibs(getAddonVersionDir(version)),
        size: getAddonSize(version),
      };
      result.push({ version, info });
    }
  }

  return result;
}

/**
 * 獲取 addon 大小
 */
function getAddonSize(version: AddonVariant): number {
  const versionDir = getAddonVersionDir(version);
  let totalSize = 0;

  try {
    const files = fs.readdirSync(versionDir);
    for (const file of files) {
      const filePath = path.join(versionDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        totalSize += stat.size;
      }
    }
  } catch {
    // 忽略錯誤
  }

  return totalSize;
}

/**
 * 註冊已安裝的加速包
 */
export function registerInstalledAddon(
  version: AddonVariant,
  remoteVersion: string,
  checksum?: string,
): void {
  const config = getAddonConfig();
  const versionDir = getAddonVersionDir(version);

  config.installed[version] = {
    installedAt: new Date().toISOString(),
    remoteVersion,
    hasDlls: hasDependentLibs(versionDir),
    size: getAddonSize(version),
    checksum,
  };

  // 如果沒有選中版本，自動選中新安裝的
  if (!config.selectedVersion) {
    config.selectedVersion = version;
  }

  saveAddonConfig(config);
}

/**
 * 選擇加速包版本（與自定義路徑互斥）
 */
export function selectAddonVersion(version: AddonVariant | null): void {
  const config = getAddonConfig();

  // 如果指定了版本，檢查是否已安裝
  if (version && !isAddonInstalled(version)) {
    throw new Error(`Addon version ${version} is not installed`);
  }

  config.selectedVersion = version;
  // 選擇版本時清除自定義路徑（互斥）
  if (version) {
    config.customAddonPath = null;
  }
  saveAddonConfig(config);
  logMessage(`Selected addon version: ${version}`, 'info');
}

/**
 * 設置自定義 addon.node 文件路徑（與版本選擇互斥）
 */
export function setCustomAddonPath(filePath: string | null): void {
  const config = getAddonConfig();

  if (filePath) {
    // 驗證文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    // 驗證文件擴展名
    if (!filePath.endsWith('.node')) {
      throw new Error('File must have .node extension');
    }
  }

  config.customAddonPath = filePath;
  // 設置自定義路徑時清除版本選擇（互斥）
  if (filePath) {
    config.selectedVersion = null;
  }
  saveAddonConfig(config);
  logMessage(`Custom addon path set: ${filePath}`, 'info');
}

/**
 * 獲取自定義 addon.node 文件路徑
 */
export function getCustomAddonPath(): string | null {
  const config = getAddonConfig();
  const customPath = config.customAddonPath;

  // 驗證路徑是否仍然有效
  if (customPath && !fs.existsSync(customPath)) {
    logMessage(`Custom addon path no longer exists: ${customPath}`, 'warning');
    return customPath; // 仍然返回路徑，讓 UI 層決定如何處理
  }

  return customPath || null;
}

/**
 * 獲取當前選中的加速包版本
 */
export function getSelectedAddonVersion(): AddonVariant | null {
  const config = getAddonConfig();

  // 驗證選中的版本是否仍然存在
  if (config.selectedVersion && !isAddonInstalled(config.selectedVersion)) {
    // 版本不存在，清除選擇
    config.selectedVersion = null;
    saveAddonConfig(config);
  }

  return config.selectedVersion;
}

/**
 * 獲取 addon.node 文件路徑
 */
export function getAddonPath(version: AddonVariant): string | null {
  const versionDir = getAddonVersionDir(version);
  const addonPath = path.join(versionDir, 'addon.node');

  if (fs.existsSync(addonPath)) {
    return addonPath;
  }

  return null;
}

/**
 * 刪除加速包
 */
export async function removeAddon(version: AddonVariant): Promise<void> {
  const config = getAddonConfig();
  const versionDir = getAddonVersionDir(version);

  // 檢查是否是當前選中的版本
  if (config.selectedVersion === version) {
    config.selectedVersion = null;
  }

  // 從配置中移除
  delete config.installed[version];
  saveAddonConfig(config);

  // 刪除文件
  if (fs.existsSync(versionDir)) {
    await fs.promises.rm(versionDir, { recursive: true, force: true });
    logMessage(`Removed addon version ${version}`, 'info');
  }
}

/**
 * 備份加速包（更新前）
 */
export async function backupAddon(
  version: AddonVariant,
): Promise<string | null> {
  const versionDir = getAddonVersionDir(version);

  if (!fs.existsSync(versionDir)) {
    return null;
  }

  const backupDir = path.join(getAddonsDir(), 'backup');
  const backupPath = path.join(
    backupDir,
    `${getVariantDirName(version)}_backup`,
  );

  // 確保備份目錄存在
  fs.mkdirSync(backupDir, { recursive: true });

  // 刪除舊備份
  if (fs.existsSync(backupPath)) {
    await fs.promises.rm(backupPath, { recursive: true, force: true });
  }

  // 複製文件
  await copyDir(versionDir, backupPath);

  logMessage(`Backed up addon ${version} to ${backupPath}`, 'info');
  return backupPath;
}

/**
 * 恢復加速包備份
 */
export async function restoreAddonBackup(
  version: AddonVariant,
): Promise<boolean> {
  const backupDir = path.join(getAddonsDir(), 'backup');
  const backupPath = path.join(
    backupDir,
    `${getVariantDirName(version)}_backup`,
  );
  const versionDir = getAddonVersionDir(version);

  if (!fs.existsSync(backupPath)) {
    logMessage(`No backup found for addon ${version}`, 'warning');
    return false;
  }

  // 刪除當前版本
  if (fs.existsSync(versionDir)) {
    await fs.promises.rm(versionDir, { recursive: true, force: true });
  }

  // 恢復備份
  await copyDir(backupPath, versionDir);

  logMessage(`Restored addon ${version} from backup`, 'info');
  return true;
}

/**
 * 清理備份
 */
export async function cleanupBackup(version: AddonVariant): Promise<void> {
  const backupDir = path.join(getAddonsDir(), 'backup');
  const backupPath = path.join(
    backupDir,
    `${getVariantDirName(version)}_backup`,
  );

  if (fs.existsSync(backupPath)) {
    await fs.promises.rm(backupPath, { recursive: true, force: true });
    logMessage(`Cleaned up backup for addon ${version}`, 'info');
  }
}

/**
 * 複製目錄
 */
async function copyDir(src: string, dest: string): Promise<void> {
  fs.mkdirSync(dest, { recursive: true });

  const entries = await fs.promises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

/**
 * 檢查是否有任何已安裝的加速包
 */
export function hasAnyAddonInstalled(): boolean {
  const installed = getInstalledAddons();
  return installed.length > 0;
}

/**
 * 獲取加速包摘要信息
 */
export function getAddonSummary(): {
  hasInstalled: boolean;
  selectedVersion: AddonVariant | null;
  installedCount: number;
  installedVersions: AddonVariant[];
  customAddonPath: string | null;
} {
  const installed = getInstalledAddons();
  const selected = getSelectedAddonVersion();
  const customPath = getCustomAddonPath();

  return {
    hasInstalled: installed.length > 0,
    selectedVersion: selected,
    installedCount: installed.length,
    installedVersions: installed.map((i) => i.version),
    customAddonPath: customPath,
  };
}
