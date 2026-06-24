import { TranslationConfig, TranslationResult, Subtitle } from '../types';
import { DEFAULT_BATCH_SIZE } from '../constants';
import { logMessage } from '../../helpers/storeManager';
import { isConfigurationError } from '../utils/error';
import {
  throwIfTaskCancelled,
  isTaskCancelledError,
} from '../../helpers/taskContext';

export async function handleAPIBatchTranslation(
  subtitles: Subtitle[],
  config: TranslationConfig,
  batchSize: number = DEFAULT_BATCH_SIZE.API,
  onProgress?: (progress: number) => void,
  onTranslationResult?: (results: TranslationResult[]) => Promise<void>,
  maxRetries: number = 0,
): Promise<TranslationResult[]> {
  const { provider, sourceLanguage, targetLanguage, translator } = config;
  const results: TranslationResult[] = [];
  const totalBatches = Math.ceil(subtitles.length / batchSize);

  const requestInterval = +(provider.requestInterval || 0) * 1000;

  for (let i = 0; i < subtitles.length; i += batchSize) {
    throwIfTaskCancelled();
    const batch = subtitles.slice(i, i + batchSize);
    const batchContents = batch.map((s) => s.content.join('\n'));
    const currentBatchIndex = Math.floor(i / batchSize) + 1;
    let retryCount = 0;
    let batchSuccess = false;

    if (requestInterval > 0 && i > 0) {
      logMessage(`等待 ${provider.requestInterval}s (請求間隔)`, 'info');
      await new Promise((resolve) => setTimeout(resolve, requestInterval));
    }

    while (!batchSuccess && retryCount <= maxRetries) {
      throwIfTaskCancelled();
      try {
        logMessage(
          `API翻譯批次 ${currentBatchIndex}/${totalBatches} (嘗試 ${retryCount + 1}/${maxRetries + 1})`,
        );
        const translatedContent = await translator(
          batchContents,
          provider,
          sourceLanguage,
          targetLanguage,
        );

        const translatedLines = Array.isArray(translatedContent)
          ? translatedContent
          : translatedContent.split('\n');

        if (translatedLines.length !== batch.length) {
          throw new Error(
            'Translation result count does not match source count',
          );
        }

        const batchResults = batch.map((subtitle, index) => ({
          id: subtitle.id,
          startEndTime: subtitle.startEndTime,
          sourceContent: subtitle.content.join('\n'),
          targetContent: translatedLines[index],
        }));

        // 如果提供了結果處理函數，則實時處理每個翻譯結果
        if (onTranslationResult) {
          await onTranslationResult(batchResults);
        }

        results.push(...batchResults);
        batchSuccess = true;
      } catch (error) {
        if (isTaskCancelledError(error)) throw error;
        // 檢查是否是配置錯誤，如果是則直接拋出，不進行重試
        if (isConfigurationError(error)) {
          throw new Error(
            `翻譯服務配置不完整，請檢查相關配置: ${error.message}`,
          );
        }

        retryCount++;
        if (retryCount <= maxRetries) {
          logMessage(
            `批次 ${currentBatchIndex}/${totalBatches} 翻譯失敗，重試 ${retryCount}/${maxRetries}: ${error.message}`,
            'warning',
          );
          // 添加短暫延遲，避免頻繁重試
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          );
        } else {
          logMessage(
            `批次 ${currentBatchIndex}/${totalBatches} 翻譯失敗，已達到最大重試次數 ${maxRetries}，跳過該批次: ${error.message}`,
            'error',
          );
          // 如果全部重試都失敗，則添加失敗記錄，並繼續下一批
          const failedResults = batch.map((subtitle) => ({
            id: subtitle.id,
            startEndTime: subtitle.startEndTime,
            sourceContent: subtitle.content.join('\n'),
            targetContent: `[翻譯失敗: ${error.message}]`,
          }));

          // 對失敗的結果也進行處理和保存
          if (onTranslationResult) {
            await onTranslationResult(failedResults);
          }

          results.push(...failedResults);
          batchSuccess = true; // 標記為完成，繼續下一批次
        }
      }
    }

    // 更新翻譯進度
    const progress = Math.min(((i + batchSize) / subtitles.length) * 100, 100);
    if (onProgress) {
      onProgress(progress);
    }
  }

  return results;
}
