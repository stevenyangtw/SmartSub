import {
  contextBridge,
  ipcRenderer,
  webUtils,
  IpcRendererEvent,
} from 'electron';

const handler = {
  send(channel: string, value: unknown) {
    ipcRenderer.send(channel, value);
  },
  invoke(channel: string, ...args): Promise<any> {
    return ipcRenderer.invoke(channel, ...args);
  },
  // Electron 32+ 移除了 File.path，統一經 webUtils 取拖拽文件的磁盤路徑
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  /** 渲染層平臺判斷統一來源（替代 userAgent 嗅探） */
  platform: process.platform,
};

contextBridge.exposeInMainWorld('ipc', handler);

export type IpcHandler = typeof handler;
