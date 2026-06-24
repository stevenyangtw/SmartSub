import { useEffect } from 'react';

// 當前是否還有「會鎖 body」的 Radix 浮層處於打開狀態：
// - 模態彈窗：[role="dialog"|"alertdialog"][data-state="open"]
// - 基於 popper 的浮層（DropdownMenu/Select/Popover 等）：[data-radix-popper-content-wrapper]
const hasOpenRadixOverlay = (): boolean =>
  !!document.querySelector(
    '[data-state="open"][role="dialog"],' +
      '[data-state="open"][role="alertdialog"],' +
      '[data-radix-popper-content-wrapper]',
  );

/**
 * 兜底修復 Radix 已知問題：從 DropdownMenu 中打開 Dialog（或浮層快速開關）時，
 * body 的 `pointer-events: none` 鎖可能在關閉後未被還原，導致整頁無法點擊、只能刷新。
 *
 * 不修改組件庫：在應用層全局監聽 body 的 style / 子節點（浮層 portal 掛載在 body 下）變化，
 * 當確實沒有任何浮層打開、但 body 仍殘留 `pointer-events: none` 時清除它。
 * 浮層正常打開期間不會誤清除（此時本就應鎖定背景）。
 */
export function useRadixPointerEventsGuard(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;

    const restoreIfStuck = () => {
      if (body.style.pointerEvents !== 'none') return;
      if (hasOpenRadixOverlay()) return; // 仍有浮層打開，保持鎖定
      body.style.pointerEvents = '';
    };

    // 延後到下一幀，等 Radix 完成本輪 DOM 變更後再判定，避免與其開關時序競爭
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(restoreIfStuck);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);
}
