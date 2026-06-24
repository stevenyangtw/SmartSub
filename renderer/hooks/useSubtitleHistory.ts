/**
 * 命令模式撤銷歷史：統一的連續區間 diff 命令棧。
 * 單行編輯 / 合併 / 拆分 / 批量替換都表達為同一種命令，
 * 相比整數組快照，內存佔用從 O(n×歷史數) 降到 O(改動行數×歷史數)。
 */

import { useCallback, useRef, useState } from 'react';
import { Subtitle } from './useSubtitles';

export interface RangeCommand {
  /** 區間起點（應用前數組中的下標） */
  start: number;
  /** undo 時回填的原始行 */
  removed: Subtitle[];
  /** redo 時回填的新行 */
  inserted: Subtitle[];
}

const MAX_HISTORY = 200;

/** 行內容等價（用於批量操作的最小區間 diff 計算） */
export const subtitleRowEquals = (a: Subtitle, b: Subtitle): boolean =>
  a === b ||
  (a.id === b.id &&
    a.startEndTime === b.startEndTime &&
    (a.sourceContent ?? '') === (b.sourceContent ?? '') &&
    (a.targetContent ?? '') === (b.targetContent ?? ''));

/**
 * 計算 before → after 的最小連續區間 diff；無變化返回 null。
 * 公共前綴/後綴按行內容等價跳過，中間段作為命令區間。
 */
export const computeRangeDiff = (
  before: Subtitle[],
  after: Subtitle[],
): RangeCommand | null => {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (
    prefix < maxPrefix &&
    subtitleRowEquals(before[prefix], after[prefix])
  ) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (
    suffix < maxSuffix &&
    subtitleRowEquals(
      before[before.length - 1 - suffix],
      after[after.length - 1 - suffix],
    )
  ) {
    suffix++;
  }

  const removed = before.slice(prefix, before.length - suffix);
  const inserted = after.slice(prefix, after.length - suffix);
  if (removed.length === 0 && inserted.length === 0) return null;
  return { start: prefix, removed, inserted };
};

export function useSubtitleHistory() {
  const commandsRef = useRef<RangeCommand[]>([]);
  const cursorRef = useRef(0);
  // 僅用於在棧變化後觸發重渲染，讓 canUndo/canRedo 反映最新值
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const push = useCallback(
    (cmd: RangeCommand) => {
      // 新命令入棧：丟棄 redo 分支
      const cmds = commandsRef.current.slice(0, cursorRef.current);
      cmds.push(cmd);
      while (cmds.length > MAX_HISTORY) cmds.shift();
      commandsRef.current = cmds;
      cursorRef.current = cmds.length;
      bump();
    },
    [bump],
  );

  const reset = useCallback(() => {
    commandsRef.current = [];
    cursorRef.current = 0;
    bump();
  }, [bump]);

  /** 應用撤銷：返回新數組；無可撤銷或數據漂移時返回 null */
  const undo = useCallback(
    (current: Subtitle[]): Subtitle[] | null => {
      if (cursorRef.current <= 0) return null;
      const cmd = commandsRef.current[cursorRef.current - 1];
      // 區間防禦：命令與當前數組不再吻合時清棧，避免錯位應用
      if (cmd.start < 0 || cmd.start + cmd.inserted.length > current.length) {
        reset();
        return null;
      }
      const next = current.slice();
      next.splice(cmd.start, cmd.inserted.length, ...cmd.removed);
      cursorRef.current -= 1;
      bump();
      return next;
    },
    [bump, reset],
  );

  /** 應用重做：返回新數組；無可重做或數據漂移時返回 null */
  const redo = useCallback(
    (current: Subtitle[]): Subtitle[] | null => {
      if (cursorRef.current >= commandsRef.current.length) return null;
      const cmd = commandsRef.current[cursorRef.current];
      if (cmd.start < 0 || cmd.start + cmd.removed.length > current.length) {
        reset();
        return null;
      }
      const next = current.slice();
      next.splice(cmd.start, cmd.removed.length, ...cmd.inserted);
      cursorRef.current += 1;
      bump();
      return next;
    },
    [bump, reset],
  );

  return {
    push,
    undo,
    redo,
    reset,
    canUndo: cursorRef.current > 0,
    canRedo: cursorRef.current < commandsRef.current.length,
  };
}
