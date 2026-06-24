/**
 * 測試專用全局聲明（僅供 scripts/test-engine-units.ts 的 tsc 編譯使用）。
 *
 * 純邏輯測試現在會通過 renderer/lib/engineModels → renderer/lib/utils 間接引入
 * `window.ipc`，而該全局類型由 renderer/preload.d.ts 聲明（其又 import 了
 * main/preload，會牽連 electron）。為保持測試無 electron 依賴，這裡給出最小化的
 * 結構化兜底聲明，避免把 preload.d.ts/electron 拖進測試編譯。
 */
interface Window {
  // 形狀對齊 main/preload.ts 的 IpcHandler（invoke 返回 Promise<any>），
  // 避免該兜底聲明被根 tsconfig 掃到後把渲染層 window.ipc 調用誤判為 unknown。
  ipc: {
    send: (channel: string, value?: unknown) => void;
    invoke: (channel: string, ...args: unknown[]) => Promise<any>;
    getPathForFile: (file: File) => string;
    on: (
      channel: string,
      callback: (...args: any[]) => void,
    ) => (() => void) | undefined;
    platform: string;
  };
}
