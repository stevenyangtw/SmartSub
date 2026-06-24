import { useEffect, useRef } from 'react';

export interface HotkeyBinding {
  /** 組合鍵：'mod+s' / 'shift+mod+z' / 'space' / 'arrowup' / '?' / 'escape' / 'mod+enter' */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** 焦點在輸入框/文本域/可編輯元素時是否仍生效（預設 false，帶修飾鍵的組合建議開啟） */
  allowInInput?: boolean;
  /** 匹配後是否阻止預設行為（預設 true） */
  preventDefault?: boolean;
}

/** mod 鍵平臺適配：macOS 用 Cmd，其餘用 Ctrl（供 UI 顯示 ⌘/Ctrl 時也用它判斷） */
export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform || navigator.userAgent);

const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
};

interface ParsedCombo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

const parseCombo = (combo: string): ParsedCombo => {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    key: key === 'space' ? ' ' : key,
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
};

const comboMatches = (
  e: KeyboardEvent,
  p: ParsedCombo,
  isMac: boolean,
): boolean => {
  if (e.key.toLowerCase() !== p.key) return false;
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  if (p.mod !== modPressed) return false;
  if (!p.mod && otherMod) return false;
  // '?' 這類必須藉助 shift 才能輸入的鍵，按 e.key 匹配即可，不再校驗 shift
  if (p.key !== '?' && p.shift !== e.shiftKey) return false;
  if (p.alt !== e.altKey) return false;
  return true;
};

/**
 * 註冊一組快捷鍵，組件卸載自動清理。
 * 綁定表通過 ref 每次事件時讀取，handler 可安全閉包最新 state。
 */
export function useHotkeys(bindings: HotkeyBinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const isMac = isMacPlatform();
    const onKeyDown = (e: KeyboardEvent) => {
      for (const binding of bindingsRef.current) {
        if (!comboMatches(e, parseCombo(binding.combo), isMac)) continue;
        if (!binding.allowInInput && isEditableTarget(e.target)) continue;
        if (binding.preventDefault !== false) e.preventDefault();
        binding.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
