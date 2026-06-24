import { app, BrowserWindow, dialog } from 'electron';
import { store } from './store';
import { getTranscriptionBusyCount } from './taskProcessor';
import { decideCloseIntent, type CloseAction } from './windowCloseDecision';

type DialogLanguage = 'zh' | 'zh-TW' | 'en';

/** Cmd+Q / 菜單退出 / 我們主動退出時置位：區分「關窗」與「真退出」 */
let isQuitting = false;
/** 防止連點紅叉時疊加多個對話框 */
let closePromptOpen = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function markQuitting(): void {
  isQuitting = true;
}

const LABELS: Record<DialogLanguage, Record<string, string>> = {
  zh: {
    bgTitle: '應用仍在後臺運行',
    bgDetailBusy:
      '仍在後臺處理 %d 個任務。要徹底退出，請用 Cmd+Q 或右鍵 Dock 圖標 → 退出。',
    bgDetailIdle:
      '應用將繼續在後臺運行。要徹底退出，請用 Cmd+Q 或右鍵 Dock 圖標 → 退出。',
    bgBackground: '轉入後臺',
    bgQuitNow: '立即退出',
    dontShowAgain: '不再提示',
    quitTitle: '仍有任務在運行',
    quitDetailBusy: '當前還有 %d 個任務正在處理，退出會中斷它們。確定退出嗎？',
    quitConfirm: '退出',
    cancel: '取消',
  },
  'zh-TW': {
    bgTitle: '應用仍在後臺運行',
    bgDetailBusy:
      '仍在後臺處理 %d 個任務。要徹底退出，請用 Cmd+Q 或右鍵 Dock 圖示 → 退出。',
    bgDetailIdle:
      '應用將繼續在後臺運行。要徹底退出，請用 Cmd+Q 或右鍵 Dock 圖示 → 退出。',
    bgBackground: '轉入後臺',
    bgQuitNow: '立即退出',
    dontShowAgain: '不再提示',
    quitTitle: '仍有任務在運行',
    quitDetailBusy: '目前還有 %d 個任務正在處理，退出會中斷它們。確定退出嗎？',
    quitConfirm: '退出',
    cancel: '取消',
  },
  en: {
    bgTitle: 'App keeps running in the background',
    bgDetailBusy:
      'Still processing %d task(s) in the background. To quit completely, use Cmd+Q or right-click the Dock icon → Quit.',
    bgDetailIdle:
      'The app will keep running in the background. To quit completely, use Cmd+Q or right-click the Dock icon → Quit.',
    bgBackground: 'Keep in Background',
    bgQuitNow: 'Quit Now',
    dontShowAgain: "Don't show again",
    quitTitle: 'Tasks still running',
    quitDetailBusy:
      '%d task(s) are still processing. Quitting will interrupt them. Quit anyway?',
    quitConfirm: 'Quit',
    cancel: 'Cancel',
  },
};

function resolveLanguage(): DialogLanguage {
  const settings = store.get('settings') as { language?: string } | undefined;
  if (
    settings?.language === 'zh' ||
    settings?.language === 'zh-TW' ||
    settings?.language === 'en'
  ) {
    return settings.language;
  }
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function resolveCloseAction(): CloseAction {
  const a = (store.get('settings') as { closeAction?: CloseAction } | undefined)
    ?.closeAction;
  return a === 'background' || a === 'quit' ? a : 'smart';
}

/** 二次確認退出：返回 true=用戶確認退出 */
function confirmQuit(win: BrowserWindow, count: number): boolean {
  const l = LABELS[resolveLanguage()];
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: [l.quitConfirm, l.cancel],
    defaultId: 1,
    cancelId: 1,
    title: l.quitTitle,
    message: l.quitTitle,
    detail: l.quitDetailBusy.replace('%d', String(count)),
    noLink: true,
  });
  return choice === 0;
}

/**
 * 轉入後臺：首次彈一次性提示（帶「不再提示」+「立即退出」），之後靜默隱藏。
 * 返回前已執行 hide 或 app.quit。
 */
async function goBackground(win: BrowserWindow, count: number): Promise<void> {
  const settings = store.get('settings');
  if (settings?.closeHintShown) {
    win.hide();
    return;
  }
  const l = LABELS[resolveLanguage()];
  const { response, checkboxChecked } = await dialog.showMessageBox(win, {
    type: 'info',
    buttons: [l.bgBackground, l.bgQuitNow],
    defaultId: 0,
    cancelId: 0,
    title: l.bgTitle,
    message: l.bgTitle,
    detail:
      count > 0 ? l.bgDetailBusy.replace('%d', String(count)) : l.bgDetailIdle,
    checkboxLabel: l.dontShowAgain,
    checkboxChecked: false,
    noLink: true,
  });
  if (checkboxChecked) {
    store.set('settings', { ...settings, closeHintShown: true });
  }
  if (response === 1) {
    app.quit();
    return;
  }
  win.hide();
}

async function handleWindowClose(win: BrowserWindow): Promise<void> {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const count = getTranscriptionBusyCount();
    const intent = decideCloseIntent({
      platform: process.platform,
      closeAction: resolveCloseAction(),
      busy: count > 0,
    });
    if (intent === 'quit') {
      app.quit();
    } else if (intent === 'confirm-quit') {
      if (confirmQuit(win, count)) app.quit();
    } else {
      await goBackground(win, count);
    }
  } finally {
    closePromptOpen = false;
  }
}

/** 裝配窗口關閉行為 + Dock 激活恢復（取代 background.ts 內聯邏輯） */
export function setupWindowCloseBehavior(mainWindow: BrowserWindow): void {
  mainWindow.on('close', (e) => {
    if (isQuitting) return; // 真退出進行中：放行
    e.preventDefault();
    void handleWindowClose(mainWindow);
  });

  // macOS：點擊 Dock 圖標恢復窗口
  app.on('activate', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
}
