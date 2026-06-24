import path from 'path';
import fs from 'fs';
import { getExtraResourcesPath } from '../utils';

/**
 * sherpa-onnx 原生庫的「內置」佈局與平臺解析。
 *
 * 原生庫隨安裝包內置在 `extraResources/sherpa/native/<platformKey>/`（構建期由
 * `scripts/fetch-sherpa-native.mjs` 落地，electron-builder 的 `sherpa/` 塊一併打包並簽名），
 * 運行時直接從該目錄 dlopen——不再下載到 userData，也無 staging/current/previous 概念。
 */

/** 內置 sherpa-onnx 原生庫版本（隨 App 固定發佈；與 fetch-sherpa-native.mjs 一致）。 */
export const SHERPA_VERSION = '1.13.2';

/** 當前平臺 key，與引擎倉產物命名一致（sherpa-onnx-<platformKey>）。 */
export function getSherpaPlatformKey(): string {
  const arch = process.arch === 'ia32' ? 'ia32' : process.arch; // x64 / arm64 / ia32
  if (process.platform === 'win32') {
    // Windows 僅發佈 x64 / ia32；arm64 主機走 x64 仿真。
    return `win-${arch === 'arm64' ? 'x64' : arch}`;
  }
  if (process.platform === 'darwin') return `darwin-${arch}`;
  return `linux-${arch}`;
}

/** 內置原生庫目錄：`extraResources/sherpa/native/<platformKey>/`。 */
export function getSherpaLibDir(): string {
  return path.join(
    getExtraResourcesPath(),
    'sherpa',
    'native',
    getSherpaPlatformKey(),
  );
}

export function getSherpaNativePath(): string {
  return path.join(getSherpaLibDir(), 'sherpa-onnx.node');
}

/** 已安裝 = 內置目錄下存在 sherpa-onnx.node（打包產物恆真；dev 下需先 `yarn sherpa:fetch`）。 */
export function isSherpaLibInstalled(): boolean {
  return fs.existsSync(getSherpaNativePath());
}
