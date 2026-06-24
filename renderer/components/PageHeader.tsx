import React from 'react';
import { cn } from 'lib/utils';

/**
 * 樞紐頁統一頭部：大標題 + 可選描述 + 可選右側操作區。
 * 工作頁（任務頁/校對編輯器）的「返回 + 上下文標題 + 操作組」模式不使用本組件。
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="space-y-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export default PageHeader;
