import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'next-i18next';
import {
  decodeEngineModel,
  encodeEngineModel,
  getEngineModelGroups,
} from 'lib/engineModels';
import EngineIcon from '@/components/resources/engines/EngineIcon';
import type { EngineStatus, TranscriptionEngine } from '../../types/engine';

interface IProps {
  modelsInstalled?: string[];
  fasterWhisperModelsInstalled?: string[];
  funasrVadInstalled?: boolean;
  funasrAsrModelsInstalled?: string[];
  /** faster-whisper 運行時狀態（用於過濾未裝引擎的模型，state==='ready' 方可選） */
  pythonEngineStatus?: EngineStatus;
  /** funasr 運行庫是否已安裝（用於過濾未裝引擎的模型） */
  funasrEngineInstalled?: boolean;
  /** qwen 共享 silero VAD 是否就緒 */
  qwenVadInstalled?: boolean;
  /** qwen 已安裝模型 id 列表 */
  qwenModelsInstalled?: string[];
  /** qwen 運行庫（與 funasr 同庫）是否已安裝 */
  qwenEngineInstalled?: boolean;
  /** fireRed 共享 silero VAD 是否就緒 */
  fireRedVadInstalled?: boolean;
  /** fireRed 已安裝模型 id 列表 */
  fireRedModelsInstalled?: string[];
  /** fireRed 運行庫（與 funasr 同庫）是否已安裝 */
  fireRedEngineInstalled?: boolean;
  /** 是否把 localCli 作為獨立分組列出（內置規範模型名，保 `${whisperModel}` 替換）。 */
  includeLocalCli?: boolean;
  /** 當前選中的引擎與模型（二者共同決定選中項；任一缺失或不在分組內則視為未選）。 */
  engine?: TranscriptionEngine;
  model?: string;
  /** 選中某分組下某模型：同時回傳 (引擎, 模型)。 */
  onChange?: (engine: TranscriptionEngine, model: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * 「引擎 ▸ 模型」分組選擇器（逐任務引擎）。
 * 選項按引擎分組，每項 value 編碼 (引擎, 模型)；選中後同時確定二者，消除同名模型歧義。
 */
const Models = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  IProps
>((props, ref) => {
  const { t } = useTranslation('common');
  const {
    modelsInstalled,
    fasterWhisperModelsInstalled,
    funasrVadInstalled,
    funasrAsrModelsInstalled,
    pythonEngineStatus,
    funasrEngineInstalled,
    qwenVadInstalled,
    qwenModelsInstalled,
    qwenEngineInstalled,
    fireRedVadInstalled,
    fireRedModelsInstalled,
    fireRedEngineInstalled,
    includeLocalCli,
    engine,
    model,
    onChange,
    className,
    disabled,
  } = props;

  const groups = getEngineModelGroups(
    {
      modelsInstalled,
      fasterWhisperModelsInstalled,
      funasrVadInstalled,
      funasrAsrModelsInstalled,
      pythonEngineStatus,
      funasrEngineInstalled,
      qwenVadInstalled,
      qwenModelsInstalled,
      qwenEngineInstalled,
      fireRedVadInstalled,
      fireRedModelsInstalled,
      fireRedEngineInstalled,
    },
    { includeLocalCli },
  );

  const engineLabel = (e: TranscriptionEngine) =>
    t(`engineBadge.${e}`, { defaultValue: e });

  // 僅當 (引擎,模型) 確實存在於分組中才視為有效選中，避免殘留舊選擇懸空顯示
  const selected =
    engine &&
    model &&
    groups.some(
      (g) =>
        g.engine === engine &&
        g.models.some((m) => m.toLowerCase() === model.toLowerCase()),
    )
      ? { engine, model }
      : null;
  const currentValue = selected
    ? encodeEngineModel(selected.engine, selected.model)
    : undefined;

  const handleValueChange = (value: string) => {
    const decoded = decodeEngineModel(value);
    if (decoded) onChange?.(decoded.engine, decoded.model);
  };

  return (
    <Select
      value={currentValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectTrigger className={className} id="model" ref={ref}>
        {selected ? (
          // 用 div 承載（而非 span）：SelectTrigger 的 `[&>span]:line-clamp-1`
          // 會把直接子 span 設為豎排 -webkit-box，導致圖標/徽標/模型名換行豎排。
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
            <EngineIcon engine={selected.engine} className="h-4 w-4 shrink-0" />
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              {engineLabel(selected.engine)}
            </span>
            <span className="truncate font-medium text-foreground">
              {selected.model}
            </span>
          </div>
        ) : (
          <SelectValue placeholder={t('pleaseSelect')} />
        )}
      </SelectTrigger>
      <SelectContent>
        {groups.length > 0 ? (
          groups.map((group, index) => (
            <SelectGroup key={group.engine}>
              {index > 0 && <SelectSeparator />}
              <SelectLabel className="flex items-center gap-1.5 pl-2 text-foreground">
                <EngineIcon engine={group.engine} className="h-4 w-4" />
                <span>{engineLabel(group.engine)}</span>
              </SelectLabel>
              {group.models.map((m) => (
                <SelectItem
                  value={encodeEngineModel(group.engine, m)}
                  key={`${group.engine}:${m}`}
                  className="text-muted-foreground data-[state=checked]:text-foreground"
                >
                  {m}
                </SelectItem>
              ))}
            </SelectGroup>
          ))
        ) : (
          <SelectItem value="no-models" disabled>
            {t('noModelsInstalled')}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
});

Models.displayName = 'Models';

export default Models;
