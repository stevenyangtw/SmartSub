import { app, BrowserWindow, Menu, shell } from 'electron';
import { store } from './store';
import { APP_DISPLAY_NAME } from './appBranding';

type MenuLanguage = 'zh' | 'en';

/**
 * 應用菜單本地化字典。
 * 主進程不引 i18n 運行時，菜單條目有限，直接維護雙語字典。
 */
const LABELS: Record<MenuLanguage, Record<string, string>> = {
  zh: {
    about: '關於 %s',
    hide: '隱藏 %s',
    hideOthers: '隱藏其他',
    unhide: '全部顯示',
    quit: '退出 %s',
    file: '文件',
    edit: '編輯',
    undo: '撤銷',
    redo: '重做',
    cut: '剪切',
    copy: '複製',
    paste: '粘貼',
    selectAll: '全選',
    view: '視圖',
    reload: '重新加載',
    toggleDevTools: '開發者工具',
    resetZoom: '實際大小',
    zoomIn: '放大',
    zoomOut: '縮小',
    togglefullscreen: '切換全屏',
    window: '窗口',
    minimize: '最小化',
    close: '關閉窗口',
    help: '幫助',
    checkUpdates: '檢查更新…',
    openLogs: '查看日誌',
    github: 'GitHub 倉庫',
    reportIssue: '反饋問題',
  },
  en: {
    about: 'About %s',
    hide: 'Hide %s',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit %s',
    file: 'File',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    toggleDevTools: 'Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close Window',
    help: 'Help',
    checkUpdates: 'Check for Updates…',
    openLogs: 'View Logs',
    github: 'GitHub Repository',
    reportIssue: 'Report an Issue',
  },
};

const REPO_URL = 'https://github.com/buxuku/SmartSub';

let mainWindowRef: BrowserWindow | null = null;

function resolveLanguage(): MenuLanguage {
  const settings = store.get('settings') as { language?: string } | undefined;
  if (settings?.language === 'zh' || settings?.language === 'en') {
    return settings.language;
  }
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 發事件給 renderer 前確保窗口可見（菜單可能在窗口隱藏時觸發） */
function sendToRenderer(channel: string) {
  const win = mainWindowRef;
  if (!win || win.isDestroyed()) return;
  win.show();
  win.webContents.send(channel);
}

export function buildAppMenu(language: MenuLanguage = resolveLanguage()) {
  const l = LABELS[language];
  const appName = APP_DISPLAY_NAME;
  const fmt = (s: string) => s.replace('%s', appName);
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: 'about', label: fmt(l.about) },
        { type: 'separator' },
        { role: 'hide', label: fmt(l.hide) },
        { role: 'hideOthers', label: l.hideOthers },
        { role: 'unhide', label: l.unhide },
        { type: 'separator' },
        { role: 'quit', label: fmt(l.quit) },
      ],
    });
  } else {
    template.push({
      label: l.file,
      submenu: [{ role: 'quit', label: fmt(l.quit) }],
    });
  }

  template.push({
    label: l.edit,
    submenu: [
      { role: 'undo', label: l.undo },
      { role: 'redo', label: l.redo },
      { type: 'separator' },
      { role: 'cut', label: l.cut },
      { role: 'copy', label: l.copy },
      { role: 'paste', label: l.paste },
      { role: 'selectAll', label: l.selectAll },
    ],
  });

  template.push({
    label: l.view,
    submenu: [
      { role: 'reload', label: l.reload },
      { role: 'toggleDevTools', label: l.toggleDevTools },
      { type: 'separator' },
      { role: 'resetZoom', label: l.resetZoom },
      { role: 'zoomIn', label: l.zoomIn },
      { role: 'zoomOut', label: l.zoomOut },
      { type: 'separator' },
      { role: 'togglefullscreen', label: l.togglefullscreen },
    ],
  });

  if (isMac) {
    template.push({
      label: l.window,
      submenu: [
        { role: 'minimize', label: l.minimize },
        { role: 'close', label: l.close },
      ],
    });
  }

  template.push({
    label: l.help,
    submenu: [
      {
        label: l.checkUpdates,
        click: () => sendToRenderer('menu-check-updates'),
      },
      {
        label: l.openLogs,
        click: () => sendToRenderer('menu-open-logs'),
      },
      { type: 'separator' },
      {
        label: l.github,
        click: () => shell.openExternal(REPO_URL),
      },
      {
        label: l.reportIssue,
        click: () => shell.openExternal(`${REPO_URL}/issues`),
      },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function setupAppMenu(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow;
  buildAppMenu();
}

/** 語言切換後重建菜單（由 setSettings 攔截調用） */
export function rebuildAppMenu(language?: string) {
  buildAppMenu(
    language === 'zh' || language === 'en' ? language : resolveLanguage(),
  );
}
