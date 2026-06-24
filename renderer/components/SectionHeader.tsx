import React from 'react';
import { cn } from 'lib/utils';

interface SectionHeaderProps {
  /** 左側圖標，統一放入主色圓角容器，保證資源中心各 Tab 頭部觀感一致 */
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  /** 右側操作位（按鈕、開關、下拉等） */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * 資源中心各 Tab 統一的區塊頭部：圖標容器 + 標題 + 描述 + 右側操作。
 * 收斂此前每個 Tab 各寫一套頭部導致的視覺不一致。
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({
  icon: Icon,
  title,
  description,
  actions,
  className,
}) => (
  <div className={cn('flex items-start justify-between gap-3', className)}>
    <div className="flex min-w-0 items-start gap-3">
      {Icon && (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
    {actions && (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {actions}
      </div>
    )}
  </div>
);

export default SectionHeader;
