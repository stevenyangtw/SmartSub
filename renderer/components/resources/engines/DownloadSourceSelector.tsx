import React from 'react';
import { cn } from 'lib/utils';

export interface DownloadSourceOption<T extends string = string> {
  value: T;
  label: string;
}

interface DownloadSourceSelectorProps<T extends string = string> {
  label: string;
  value: T;
  options: DownloadSourceOption<T>[];
  onChange: (value: T) => void;
  hint?: string;
  className?: string;
}

/**
 * 統一的「下載源」選擇器：按鈕組形態 + 無障礙 radiogroup 語義。
 * 各引擎/模型的下載源選擇共用此組件，保證視覺、交互、可訪問性一致。
 */
function DownloadSourceSelector<T extends string = string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: DownloadSourceSelectorProps<T>) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                'flex-1 rounded-md border px-2 py-2 text-center text-xs leading-tight transition-all',
                selected
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-muted hover:border-primary/50',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default DownloadSourceSelector;
