import {
  isSherpaLibInstalled,
  getSherpaPlatformKey,
  SHERPA_VERSION,
} from './sherpaLibPaths';
import type { SherpaLibStatus } from '../../../types/sherpa';

/**
 * sherpa 原生庫隨安裝包內置，狀態即「內置文件是否存在」+ 內置版本常量。
 * 運行時下載方案（staging→current 原子替換 / rollback / remove）已退役，故不再提供
 * promote/rollback/remove——內置庫隨 App 升級整體替換。
 */
export function getSherpaLibStatus(): SherpaLibStatus {
  const installed = isSherpaLibInstalled();
  return {
    installed,
    version: installed ? SHERPA_VERSION : undefined,
    platform: installed ? getSherpaPlatformKey() : undefined,
  };
}
