import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logMessage } from './storeManager';

/**
 * 構建信息接口
 */
export interface BuildInfo {
  platform: string;
  arch: string;
  buildDate: string | null;
  version?: string;
}

/**
 * 獲取構建信息
 * 從package.json中讀取構建時寫入的平臺和架構信息
 *
 * 注意：CUDA 加速包已改為運行時動態下載，不再在構建時綁定
 * CUDA 相關信息請使用 addonManager 模塊獲取
 */
export function getBuildInfo(): BuildInfo {
  try {
    // 在生產環境中，package.json位於應用程序資源目錄
    const packagePath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'package.json')
      : path.join(app.getAppPath(), 'package.json');

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    // 返回構建信息，如果不存在則返回基本信息
    return (
      packageJson.buildInfo || {
        platform: process.platform,
        arch: process.arch,
        version: app.getVersion(),
        buildDate: null,
      }
    );
  } catch (error) {
    logMessage(`Error reading build info: ${error}`, 'error');
    return {
      platform: process.platform,
      arch: process.arch,
      version: app.getVersion(),
      buildDate: null,
    };
  }
}
