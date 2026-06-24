import * as React from 'react';

import { cn } from 'lib/utils';

/**
 * 骨架佔位：基於既有 `bg-muted` token + Tailwind `animate-pulse`，無新依賴。
 * 用於「加載中且無緩存數據」時渲染與最終佈局同構的佔位，避免「居中轉圈 + 跳變」。
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
