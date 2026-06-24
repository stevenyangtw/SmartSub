import { TranslationConfig, TranslationResult, Subtitle } from '../types';
import {
  THINK_TAG_REGEX,
  DEFAULT_BATCH_SIZE,
  JSON_CONTENT_REGEX,
} from '../constants';
import { renderTemplate, supportedLanguage } from '../../helpers/utils';
import { logMessage } from '../../helpers/storeManager';
import { defaultSystemPrompt, defaultUserPrompt } from '../../../types';
import { toJson } from 'really-relaxed-json';
import { jsonrepair } from 'jsonrepair';
import { isConfigurationError } from '../utils/error';
import {
  throwIfTaskCancelled,
  isTaskCancelledError,
} from '../../helpers/taskContext';

function getLanguageName(code: string): string {
  // 中文目標須向 AI 明確簡/繁，避免「中文」歧義導致譯文簡繁混雜（issue #332）。
  // UI 仍顯示「中文」，但提示詞裡替換為「簡體中文」/「繁體中文」以穩定輸出字形。
  const normalized = (code || '').toLowerCase();
  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-hans'
  ) {
    return '簡體中文';
  }
  if (
    normalized === 'zh-hant' ||
    normalized === 'zh-tw' ||
    normalized === 'zh-hk'
  ) {
    return '繁體中文';
  }
  const lang = supportedLanguage.find((l) => l.value === code);
  return lang?.name || code;
}

export async function handleAIBatchTranslation(
  subtitles: Subtitle[],
  config: TranslationConfig,
  batchSize: number = DEFAULT_BATCH_SIZE.AI,
  onProgress?: (progress: number) => void,
  onTranslationResult?: (results: TranslationResult[]) => Promise<void>,
  maxRetries: number = 0,
): Promise<TranslationResult[]> {
  const { provider, sourceLanguage, targetLanguage, translator } = config;
  const sourceLanguageName = getLanguageName(sourceLanguage);
  const targetLanguageName = getLanguageName(targetLanguage);
  const results: TranslationResult[] = [];
  const totalBatches = Math.ceil(subtitles.length / batchSize);
  let processedSubtitles = 0;

  logMessage(
    `開始AI批量翻譯：總共 ${subtitles.length} 條字幕，分為 ${totalBatches} 個批次，每批次 ${batchSize} 條`,
    'info',
  );

  const requestInterval = +(provider.requestInterval || 0) * 1000;

  for (let i = 0; i < subtitles.length; i += batchSize) {
    throwIfTaskCancelled();
    const batch = subtitles.slice(i, i + batchSize);
    const currentBatchIndex = Math.floor(i / batchSize) + 1;
    let retryCount = 0;
    let batchSuccess = false;
    let batchResults: TranslationResult[] = [];

    if (requestInterval > 0 && i > 0) {
      logMessage(`等待 ${provider.requestInterval}s (請求間隔)`, 'info');
      await new Promise((resolve) => setTimeout(resolve, requestInterval));
    }

    logMessage(
      `處理批次 ${currentBatchIndex}/${totalBatches}，包含 ${batch.length} 條字幕`,
      'info',
    );

    while (!batchSuccess && retryCount <= maxRetries) {
      throwIfTaskCancelled();
      try {
        let batchJsonContent: Record<string, string> = {};
        batch.forEach((item) => {
          batchJsonContent[item.id] = item.content.join('\n');
        });
        const fullContent = `${JSON.stringify(batchJsonContent, null, 2)}`;
        const translationContent = renderTemplate(
          provider.prompt || defaultUserPrompt,
          {
            sourceLanguage: sourceLanguageName,
            targetLanguage: targetLanguageName,
            content: fullContent,
          },
        );

        const systemPrompt = renderTemplate(
          provider.systemPrompt || defaultSystemPrompt,
          {
            sourceLanguage: sourceLanguageName,
            targetLanguage: targetLanguageName,
            content: fullContent,
          },
        );

        // 更新配置，保持原有的結構化輸出設置
        const translationConfig = {
          ...provider,
          systemPrompt,
          // 保留原有的 useJsonMode 配置或 structuredOutput 配置
          // 如果沒有配置，預設啟用 JSON 模式以保持向後兼容
          useJsonMode: provider.useJsonMode !== false,
        };

        logMessage(
          `AI translate batch ${currentBatchIndex}/${totalBatches} (嘗試 ${retryCount + 1}/${maxRetries + 1}): \n ${translationContent}`,
          'info',
        );
        const responseOrigin = await translator(
          translationContent,
          translationConfig,
          sourceLanguage,
          targetLanguage,
        );
        logMessage(`AI response: \n ${responseOrigin}`, 'info');
        const response = responseOrigin.replace(THINK_TAG_REGEX, '').trim();

        // 解析響應, 從結果中提取 json 裡面的內容
        const match = response.match(JSON_CONTENT_REGEX);
        const responseJsonString = match ? match[1] : response;

        // 嘗試解析JSON
        const parsedContent = parseJsonWithFallbacks(responseJsonString);

        // 檢查解析結果是否有效
        if (parsedContent && typeof parsedContent === 'object') {
          const parsedKeys = Object.keys(parsedContent);
          const parsedValues = Object.values(parsedContent);

          // 校驗返回條數是否與請求一致：
          // 若數量不一致（例如請求 50 條只回 40 條），按數組索引兜底會讓譯文與
          // 時間軸錯位，因此視為本批次失敗並觸發重試，避免產生錯位結果（issue #308）。
          if (parsedKeys.length !== batch.length) {
            throw new Error(
              `翻譯返回條數與請求不一致：請求 ${batch.length} 條，返回 ${parsedKeys.length} 條`,
            );
          }

          logMessage(`JSON parsing successful`, 'info');

          batchResults = batch.map((subtitle, index) => ({
            id: subtitle.id,
            startEndTime: subtitle.startEndTime,
            sourceContent: subtitle.content.join('\n'),
            // 優先使用ID匹配；數量已校驗一致，按索引兜底是安全的
            targetContent:
              parsedContent[subtitle.id] !== undefined
                ? parsedContent[subtitle.id]
                : (parsedValues[index] ?? ''),
          }));

          // 如果提供了結果處理函數，則實時處理每個翻譯結果
          if (onTranslationResult) {
            await onTranslationResult(batchResults);
          }

          results.push(...batchResults);
          processedSubtitles += batch.length;
          batchSuccess = true;

          logMessage(
            `批次 ${currentBatchIndex}/${totalBatches} 翻譯成功，已處理 ${processedSubtitles}/${subtitles.length} 條字幕`,
            'info',
          );
        } else {
          throw new Error(
            'Invalid response format: Failed to parse JSON structure',
          );
        }
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
          batchResults = batch.map((subtitle) => ({
            id: subtitle.id,
            startEndTime: subtitle.startEndTime,
            sourceContent: subtitle.content.join('\n'),
            targetContent: `[翻譯失敗: ${error.message}]`,
          }));

          // 對失敗的結果也進行處理和保存
          if (onTranslationResult) {
            await onTranslationResult(batchResults);
          }

          results.push(...batchResults);
          processedSubtitles += batch.length;
          batchSuccess = true; // 標記為完成，繼續下一批次

          logMessage(
            `批次 ${currentBatchIndex}/${totalBatches} 已標記為失敗完成，繼續下一批次`,
            'warning',
          );
        }
      }
    }

    // 更新翻譯進度 - 使用實際處理的字幕數量計算
    const progress = Math.min(
      (processedSubtitles / subtitles.length) * 100,
      100,
    );
    if (onProgress) {
      onProgress(progress);
    }

    logMessage(
      `進度更新: ${progress.toFixed(2)}% (${processedSubtitles}/${subtitles.length})`,
      'info',
    );
  }

  logMessage(
    `AI批量翻譯完成：共處理 ${processedSubtitles} 條字幕，成功 ${results.filter((r) => !r.targetContent.startsWith('[翻譯失敗:')).length} 條`,
    'info',
  );

  return results;
}

// 輔助函數：嘗試多種方式解析JSON內容
function parseJsonWithFallbacks(jsonContent: string): any {
  try {
    // 第一次嘗試：使用標準JSON解析
    return JSON.parse(jsonContent);
  } catch (jsonError) {
    try {
      // 第二次嘗試：使用toJson進行更寬鬆的解析
      return toJson(jsonContent);
    } catch (json5Error) {
      try {
        // 第三次嘗試：使用jsonrepair進行修復和解析
        const repairedJson = jsonrepair(jsonContent);
        return JSON.parse(repairedJson);
      } catch (jsonRepairError) {
        throw new Error(`無法解析AI返回的JSON內容: ${jsonRepairError.message}`);
      }
    }
  }
}
