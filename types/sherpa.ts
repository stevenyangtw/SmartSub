/** 本地 sherpa 原生庫安裝狀態（供 UI / systemInfo 展示）。 */
export interface SherpaLibStatus {
  installed: boolean;
  version?: string;
  platform?: string;
  installedAt?: string;
}
