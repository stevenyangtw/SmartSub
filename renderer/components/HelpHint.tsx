import React from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from 'lib/utils';

/**
 * 可聚焦的幫助提示圖標。
 * 替代此前「TooltipTrigger 直接包裸 HelpCircle」的寫法——那種寫法非 button、
 * 鍵盤與讀屏無法觸達。這裡用真正的 button 承載，並補 aria-label。
 * 需在祖先存在 TooltipProvider。
 */
export function HelpHint({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className={cn(
            'inline-flex rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-[260px]">{text}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export default HelpHint;
