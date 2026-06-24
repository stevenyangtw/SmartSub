/**
 * 關閉窗口意圖決策（純函數，無 Electron 依賴，便於 test:engines 覆蓋）。
 * 行為矩陣見 docs/superpowers/specs/2026-06-15-macos-close-behavior-design.md §2。
 */
export type CloseAction = 'smart' | 'background' | 'quit';

/**
 * - 'quit'：直接真退出（由調用方走 app.quit → before-quit 優雅關閉）
 * - 'confirm-quit'：有任務在跑，先二次確認再退
 * - 'background'：轉入後臺（隱藏窗口；首次提示由 UI 層處理）
 */
export type CloseIntent = 'quit' | 'confirm-quit' | 'background';

export function decideCloseIntent(input: {
  platform: NodeJS.Platform;
  closeAction: CloseAction;
  busy: boolean;
}): CloseIntent {
  const { platform, closeAction, busy } = input;

  // 非 macOS：不做隱藏到後臺（無託盤會找不到窗口）。忙碌則二次確認防誤殺，空閒直接退。
  if (platform !== 'darwin') {
    return busy ? 'confirm-quit' : 'quit';
  }

  // macOS：按設置走。
  if (closeAction === 'background') return 'background';
  if (closeAction === 'quit') return busy ? 'confirm-quit' : 'quit';
  // 'smart'（預設/兜底）：有任務轉後臺，空閒直接退。
  return busy ? 'background' : 'quit';
}
