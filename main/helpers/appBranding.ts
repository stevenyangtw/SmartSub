import path from 'path';
import fs from 'fs';
import { app, nativeImage } from 'electron';

/** 與 electron-builder.yml productName 一致 */
export const APP_DISPLAY_NAME = 'SmartSub';

const APP_VERSION = process.env.npm_package_version ?? '2.17.0-beta.1';
const APP_COPYRIGHT = 'Copyright © 2024 buxuku';

export function resolveAppIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, 'icon.png'),
    path.join(app.getAppPath(), 'resources', 'icon.png'),
    path.join(__dirname, '../../resources/icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 儘早調用：macOS 菜單欄應用名（開發態 Electron 預設為 Electron） */
export function setAppDisplayNameEarly(): void {
  if (process.platform === 'darwin') {
    app.setName(APP_DISPLAY_NAME);
  }
}

/** app ready 後：About 面板 + Dock 圖標（開發態） */
export function applyMacAppBranding(): void {
  if (process.platform !== 'darwin') return;

  app.setName(APP_DISPLAY_NAME);

  const iconPath = resolveAppIcon();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: APP_VERSION,
    version: APP_VERSION,
    copyright: APP_COPYRIGHT,
    ...(iconPath ? { iconPath } : {}),
  });

  if (iconPath && app.dock) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  }
}
