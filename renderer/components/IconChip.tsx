import React from 'react';
import { cn } from 'lib/utils';

/**
 * 卡片/區塊標題左側的統一圖標容器。
 * 收斂此前「裸圖標 + mr-2（24px 無約束）」與「圖標容器」並存的不一致。
 * 預設中性底（bg-muted），可通過 className 覆蓋語義色（如危險區用 destructive）。
 */
export function IconChip({
  icon: Icon,
  className,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground/70',
        className,
      )}
    >
      <Icon className={cn('h-4 w-4', iconClassName)} />
    </span>
  );
}

export default IconChip;
