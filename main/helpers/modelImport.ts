import fs from 'fs';
import path from 'path';

/**
 * 模型路徑與本地導入的純邏輯（僅依賴 fs/path，無 Electron），便於 test:engines 在 node 下單測。
 * 路徑覆蓋解析 / 資料夾佈局校驗 / CT2 導入常量集中於此。
 */

/**
 * 解析模型根目錄：用戶覆蓋值（非空字符串）優先，否則回退預設路徑。
 * 空串 / 僅空白 / undefined 視為未設置。
 */
export function resolveOverridePath(
  override: string | undefined | null,
  fallback: string,
): string {
  const trimmed = typeof override === 'string' ? override.trim() : '';
  return trimmed.length > 0 ? trimmed : fallback;
}

export interface LayoutCheckResult {
  ok: boolean;
  missing: string[];
}

/**
 * 校驗源目錄是否含某模型的全部必需文件。
 * requiredFiles 支持嵌套相對路徑（如 `tokenizer/vocab.json`），逐項檢查存在性。
 */
export function validateModelLayout(
  srcDir: string,
  requiredFiles: string[],
): LayoutCheckResult {
  const missing = requiredFiles.filter(
    (rel) => !fs.existsSync(path.join(srcDir, rel)),
  );
  return { ok: missing.length === 0, missing };
}

/**
 * sherpa 系共享 VAD（silero）隨應用內置的相對子路徑（相對 extraResources 根）。
 * funasr / qwen / fireRedAsr 共用這一份；與各引擎可自定義的模型根目錄解耦。
 */
export const SHERPA_VAD_SUBPATH = path.join('sherpa', 'vad', 'silero_vad.onnx');

/** 由 extraResources 根拼出內置 silero VAD 的絕對路徑（純函數，便於單測）。 */
export function resolveBundledVadPath(extraResourcesRoot: string): string {
  return path.join(extraResourcesRoot, SHERPA_VAD_SUBPATH);
}

/** CT2(faster-whisper) 模型導入的最小必需文件集（模型權重 + 配置）。 */
export const CT2_REQUIRED_FILES: string[] = ['model.bin', 'config.json'];

/** 導入的 CT2 模型落地的合成快照 revision 名，供 resolveCt2ModelSnapshotDir 命中。 */
export const CT2_IMPORT_SNAPSHOT_REV = 'imported';
