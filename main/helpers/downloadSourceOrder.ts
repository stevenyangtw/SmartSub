/** addon 與 py-engine 共用的二進制下載源（與 HuggingFace 模型源無關）。 */
export type BinaryDownloadSource = 'github' | 'ghproxy' | 'gitcode';

/**
 * 回退規範順序：國內優先（先域內 gitcode，再代理 ghproxy，最後直連 github）。
 * 所選源永遠排第一，其餘按此順序補齊。
 */
export const DEFAULT_SOURCE_ORDER: BinaryDownloadSource[] = [
  'gitcode',
  'ghproxy',
  'github',
];

export function getSourceFallbackOrder(
  selected: BinaryDownloadSource,
): BinaryDownloadSource[] {
  return [selected, ...DEFAULT_SOURCE_ORDER.filter((s) => s !== selected)];
}
