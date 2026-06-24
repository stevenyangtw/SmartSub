import type { IFiles } from './types';
import type { ProofreadItem } from './proofread';

/** 流水線類工作項（轉寫 / 翻譯） */
export type PipelineWorkItemType =
  | 'generateAndTranslate'
  | 'generateOnly'
  | 'translateOnly';

/** 校對批次工作項 */
export type ProofreadWorkItemType = 'proofread';

export type WorkItemType = PipelineWorkItemType | ProofreadWorkItemType;

export type WorkItemStatus =
  | 'waiting'
  | 'running'
  | 'done'
  | 'error'
  | 'interrupted';

/** 流水線文件 — P19-1 先與 IFiles 對齊，後續正型 */
export type PipelineFile = IFiles;

/** 校對項 — 與 ProofreadItem 對齊 */
export type ProofreadEntry = ProofreadItem;

export interface WorkItemArtifact {
  kind: string;
  path: string;
}

export interface WorkItem {
  id: string;
  name: string;
  type: WorkItemType;
  status: WorkItemStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;

  /** generate* / translate* */
  pipelineFiles?: PipelineFile[];

  /** proofread */
  proofreadEntries?: ProofreadEntry[];
  currentProofreadIndex?: number;

  configSnapshot?: Record<string, unknown>;
  artifacts?: WorkItemArtifact[];
}

export const WORK_ITEM_MIGRATION_VERSION = 1;

export const PIPELINE_WORK_ITEM_TYPES: PipelineWorkItemType[] = [
  'generateAndTranslate',
  'generateOnly',
  'translateOnly',
];

export function isPipelineWorkItem(
  item: WorkItem,
): item is WorkItem & { pipelineFiles: PipelineFile[] } {
  return PIPELINE_WORK_ITEM_TYPES.includes(item.type as PipelineWorkItemType);
}

export function isProofreadWorkItem(
  item: WorkItem,
): item is WorkItem & { proofreadEntries: ProofreadEntry[] } {
  return item.type === 'proofread';
}
