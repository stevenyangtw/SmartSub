/**
 * 字幕校對相關的 IPC 處理器
 */

import { ipcMain } from 'electron';
import {
  detectSubtitlesForVideo,
  matchSubtitlesByRules,
  scanDirectoryForSubtitles,
  smartScanDirectory,
  validateSubtitleFile,
} from './subtitleDetector';
import {
  getProofreadTasks,
  getProofreadTaskById,
  createProofreadTask,
  updateProofreadTask,
  deleteProofreadTask,
  clearProofreadTasks,
  updateProofreadItem,
  completeProofreadItem,
  addItemsToTask,
  removeItemFromTask,
  getTaskProgress,
  getProofreadHistories,
  clearProofreadHistories,
} from './proofreadStore';
import {
  detectLanguageFromFilename,
  getSupportedLanguages,
  detectLanguagePair,
} from './languageDetector';
import { logMessage, store } from './storeManager';
import { ProofreadItem } from '../../types/proofread';
import {
  TRANSLATOR_MAP,
  translateWithProvider,
} from '../translate/services/translationProvider';
import {
  Provider,
  TranslationResult,
  TranslatorFunction,
} from '../translate/types';
import { runWithTaskContext, isTaskCancelledError } from './taskContext';

// 校對批量操作（批量 AI 優化 / 重翻失敗）取消註冊表
const batchAbortControllers = new Map<string, AbortController>();

/**
 * 設置字幕校對相關的 IPC 處理器
 */
export function setupProofreadHandlers(): void {
  // 取消進行中的校對批量操作
  ipcMain.handle(
    'cancelProofreadBatch',
    async (_event, { batchId }: { batchId: string }) => {
      const controller = batchAbortControllers.get(batchId);
      if (controller) {
        controller.abort();
        logMessage(`Proofread batch cancelled: ${batchId}`, 'info');
        return { success: true };
      }
      return { success: false };
    },
  );

  // ============ 字幕檢測相關 ============

  // 檢測影片對應的字幕文件（不再需要語言參數）
  ipcMain.handle(
    'detectSubtitles',
    async (_event, { videoPath }: { videoPath: string }) => {
      try {
        logMessage(`Detecting subtitles for video: ${videoPath}`, 'info');
        // 使用空字符串讓檢測器自動從文件名推斷
        const result = await detectSubtitlesForVideo(videoPath, '', '');
        logMessage(
          `Found ${result.detectedSubtitles.length} subtitle files`,
          'info',
        );
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error detecting subtitles: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 根據規則匹配字幕文件（不再需要語言參數）
  ipcMain.handle(
    'matchSubtitleFiles',
    async (_event, { files }: { files: string[] }) => {
      try {
        logMessage(`Matching ${files.length} subtitle files`, 'info');
        const result = await matchSubtitlesByRules(files, '', '');
        logMessage(`Matched ${result.length} subtitle pairs`, 'info');
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error matching subtitles: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 掃描目錄獲取字幕文件
  ipcMain.handle(
    'scanDirectorySubtitles',
    async (_event, { directoryPath }: { directoryPath: string }) => {
      try {
        logMessage(
          `Scanning directory for subtitles: ${directoryPath}`,
          'info',
        );
        const files = await scanDirectoryForSubtitles(directoryPath);
        logMessage(`Found ${files.length} subtitle files in directory`, 'info');
        return { success: true, data: files };
      } catch (error) {
        logMessage(`Error scanning directory: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 智能掃描目錄（同時獲取影片和字幕）
  ipcMain.handle(
    'smartScanDirectory',
    async (_event, { directoryPath }: { directoryPath: string }) => {
      try {
        logMessage(`Smart scanning directory: ${directoryPath}`, 'info');
        const result = await smartScanDirectory(directoryPath);
        logMessage(
          `Found ${result.videos.length} videos and ${result.subtitles.length} subtitles`,
          'info',
        );
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error smart scanning directory: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 驗證字幕文件
  ipcMain.handle(
    'validateSubtitleFile',
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const isValid = await validateSubtitleFile(filePath);
        return { success: true, data: isValid };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // ============ 語言檢測相關 ============

  // 從文件名檢測語言
  ipcMain.handle(
    'detectLanguage',
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const result = detectLanguageFromFilename(filePath);
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error detecting language: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 從多個字幕文件檢測語言對
  ipcMain.handle(
    'detectLanguagePair',
    async (_event, { files }: { files: string[] }) => {
      try {
        const userConfig = store.get('userConfig') || {};
        const result = detectLanguagePair(
          files,
          userConfig.sourceLanguage,
          userConfig.targetLanguage,
        );
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error detecting language pair: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 獲取支持的語言列表
  ipcMain.handle('getSupportedLanguages', async () => {
    try {
      const languages = getSupportedLanguages();
      return { success: true, data: languages };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ============ 任務管理相關 ============

  // 獲取所有校對任務
  ipcMain.handle('getProofreadTasks', async () => {
    try {
      const tasks = getProofreadTasks();
      return { success: true, data: tasks };
    } catch (error) {
      logMessage(`Error getting proofread tasks: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  });

  // 根據 ID 獲取單個任務
  ipcMain.handle(
    'getProofreadTaskById',
    async (_event, { id }: { id: string }) => {
      try {
        const task = getProofreadTaskById(id);
        return { success: true, data: task };
      } catch (error) {
        logMessage(`Error getting proofread task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 創建新任務
  ipcMain.handle(
    'createProofreadTask',
    async (
      _event,
      {
        items,
        name,
      }: {
        items: (Omit<
          ProofreadItem,
          'id' | 'lastPosition' | 'totalCount' | 'modifiedCount'
        > & { status?: ProofreadItem['status'] })[];
        name?: string;
      },
    ) => {
      try {
        logMessage(
          `Creating proofread task with ${items.length} items`,
          'info',
        );
        const task = createProofreadTask(items, name);
        return { success: true, data: task };
      } catch (error) {
        logMessage(`Error creating proofread task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 更新任務
  ipcMain.handle(
    'updateProofreadTask',
    async (
      _event,
      {
        taskId,
        updates,
      }: {
        taskId: string;
        updates: any;
      },
    ) => {
      try {
        const task = updateProofreadTask(taskId, updates);
        return { success: true, data: task };
      } catch (error) {
        logMessage(`Error updating proofread task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 刪除任務
  ipcMain.handle(
    'deleteProofreadTask',
    async (_event, { taskId }: { taskId: string }) => {
      try {
        logMessage(`Deleting proofread task: ${taskId}`, 'info');
        const deleted = deleteProofreadTask(taskId);
        return { success: true, data: deleted };
      } catch (error) {
        logMessage(`Error deleting proofread task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 清空所有任務
  ipcMain.handle('clearProofreadTasks', async () => {
    try {
      logMessage('Clearing all proofread tasks', 'info');
      clearProofreadTasks();
      return { success: true };
    } catch (error) {
      logMessage(`Error clearing proofread tasks: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  });

  // ============ 項目管理相關 ============

  // 更新任務中的單個項目
  ipcMain.handle(
    'updateProofreadItem',
    async (
      _event,
      {
        taskId,
        itemId,
        updates,
      }: {
        taskId: string;
        itemId: string;
        updates: Partial<Omit<ProofreadItem, 'id'>>;
      },
    ) => {
      try {
        const item = updateProofreadItem(taskId, itemId, updates);
        return { success: true, data: item };
      } catch (error) {
        logMessage(`Error updating proofread item: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 完成當前項目並移動到下一個
  ipcMain.handle(
    'completeProofreadItem',
    async (
      _event,
      {
        taskId,
        itemId,
      }: {
        taskId: string;
        itemId: string;
      },
    ) => {
      try {
        logMessage(
          `Completing proofread item: ${itemId} in task ${taskId}`,
          'info',
        );
        const result = completeProofreadItem(taskId, itemId);
        return { success: true, data: result };
      } catch (error) {
        logMessage(`Error completing proofread item: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 向任務添加新項目
  ipcMain.handle(
    'addItemsToTask',
    async (
      _event,
      {
        taskId,
        items,
      }: {
        taskId: string;
        items: Omit<
          ProofreadItem,
          'id' | 'status' | 'lastPosition' | 'totalCount' | 'modifiedCount'
        >[];
      },
    ) => {
      try {
        logMessage(`Adding ${items.length} items to task ${taskId}`, 'info');
        const task = addItemsToTask(taskId, items);
        return { success: true, data: task };
      } catch (error) {
        logMessage(`Error adding items to task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 從任務中移除項目
  ipcMain.handle(
    'removeItemFromTask',
    async (
      _event,
      {
        taskId,
        itemId,
      }: {
        taskId: string;
        itemId: string;
      },
    ) => {
      try {
        logMessage(`Removing item ${itemId} from task ${taskId}`, 'info');
        const task = removeItemFromTask(taskId, itemId);
        return { success: true, data: task };
      } catch (error) {
        logMessage(`Error removing item from task: ${error}`, 'error');
        return { success: false, error: String(error) };
      }
    },
  );

  // 獲取任務進度
  ipcMain.handle(
    'getTaskProgress',
    async (_event, { taskId }: { taskId: string }) => {
      try {
        const task = getProofreadTaskById(taskId);
        if (!task) {
          return { success: false, error: 'Task not found' };
        }
        const progress = getTaskProgress(task);
        return { success: true, data: progress };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  // ============ 兼容舊版本 ============

  // 獲取舊版歷史記錄（用於遷移）
  ipcMain.handle('getProofreadHistories', async () => {
    try {
      const histories = getProofreadHistories();
      return { success: true, data: histories };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // 清空舊版歷史記錄
  ipcMain.handle('clearProofreadHistories', async () => {
    try {
      clearProofreadHistories();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ============ AI 優化相關 ============

  // 獲取可用的 AI 翻譯服務商列表
  ipcMain.handle('getAiTranslationProviders', async () => {
    try {
      const providers = store.get('translationProviders') || [];
      const aiProviders = providers.filter((p: Provider) => p.isAi);
      return { success: true, data: aiProviders };
    } catch (error) {
      logMessage(`Error getting AI providers: ${error}`, 'error');
      return { success: false, error: String(error) };
    }
  });

  // 優化單條字幕翻譯
  ipcMain.handle(
    'optimizeSubtitle',
    async (
      _event,
      {
        sourceText,
        targetText,
        providerId,
        customPrompt,
      }: {
        sourceText: string;
        targetText: string;
        providerId?: string;
        customPrompt?: string;
      },
    ) => {
      try {
        logMessage(`Optimizing subtitle translation`, 'info');

        // 獲取用戶配置
        const userConfig = store.get('userConfig') || {};

        // 使用傳入的 providerId 或用戶配置中的預設服務商
        const translateProviderId = providerId || userConfig.translateProvider;

        if (!translateProviderId || translateProviderId === '-1') {
          return {
            success: false,
            error: '請先選擇一個 AI 翻譯服務',
          };
        }

        // 獲取翻譯提供商
        const providers = store.get('translationProviders') || [];
        const provider = providers.find(
          (p: Provider) => p.id === translateProviderId,
        );

        if (!provider) {
          return {
            success: false,
            error: '未找到選擇的翻譯服務',
          };
        }

        // 檢查是否為 AI 翻譯服務
        if (!provider.isAi) {
          return {
            success: false,
            error: 'AI 優化功能僅支持 AI 翻譯服務（如 OpenAI、Ollama 等）',
          };
        }

        // 獲取翻譯器
        const translator =
          TRANSLATOR_MAP[provider.type as keyof typeof TRANSLATOR_MAP];
        if (!translator) {
          return {
            success: false,
            error: `不支持的翻譯服務類型: ${provider.type}`,
          };
        }

        // 獲取源語言和目標語言
        const sourceLanguage = userConfig.sourceLanguage || 'en';
        const targetLanguage = userConfig.targetLanguage || 'zh';

        // 根據是否有翻譯內容選擇不同的預設提示詞
        const hasTranslation = targetText && targetText.trim();
        const defaultPrompt = hasTranslation
          ? `You are a professional subtitle translator and proofreader. Your task is to improve the translation of the following subtitle.

Original text (${sourceLanguage}):
${sourceText}

Current translation (${targetLanguage}):
${targetText}

Please provide an improved translation that:
1. More accurately conveys the meaning of the original
2. Uses natural and fluent ${targetLanguage} expressions
3. Is appropriate for subtitle display (concise but complete)
4. Maintains the tone and style of the original

Only respond with the improved translation, nothing else.`
          : `You are a professional subtitle translator. Your task is to translate the following subtitle.

Original text (${sourceLanguage}):
${sourceText}

Please translate to ${targetLanguage}:
1. Accurately convey the meaning of the original
2. Use natural and fluent ${targetLanguage} expressions
3. Be appropriate for subtitle display (concise but complete)
4. Maintain the tone and style of the original

Only respond with the translation, nothing else.`;

        // 如果有自定義提示詞，替換變量
        let optimizePrompt = defaultPrompt;
        if (customPrompt && customPrompt.trim()) {
          // 處理簡單的條件模板 {{#if targetText}}...{{else}}...{{/if}}
          let processedPrompt = customPrompt;
          if (hasTranslation) {
            // 有翻譯內容：保留 if 塊，移除 else 塊
            processedPrompt = processedPrompt.replace(
              /\{\{#if\s+targetText\}\}([\s\S]*?)\{\{else\}\}[\s\S]*?\{\{\/if\}\}/g,
              '$1',
            );
          } else {
            // 無翻譯內容：移除 if 塊，保留 else 塊
            processedPrompt = processedPrompt.replace(
              /\{\{#if\s+targetText\}\}[\s\S]*?\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g,
              '$1',
            );
          }

          optimizePrompt = processedPrompt
            .replace(/\{\{sourceLanguage\}\}/g, sourceLanguage)
            .replace(/\{\{targetLanguage\}\}/g, targetLanguage)
            .replace(/\{\{sourceText\}\}/g, sourceText)
            .replace(/\{\{targetText\}\}/g, targetText || '');
        }

        // 調用翻譯服務
        const optimizedProvider = {
          ...provider,
          systemPrompt:
            'You are a professional subtitle translation optimizer. Provide improved translations only, no explanations.',
          useJsonMode: false,
          structuredOutput: 'disabled' as const,
        };

        const result = await translator(
          optimizePrompt,
          optimizedProvider,
          sourceLanguage,
          targetLanguage,
        );

        if (result) {
          // 清理結果，移除可能的引號或多餘空白
          const cleanedResult = result
            .trim()
            .replace(/^["']|["']$/g, '')
            .trim();
          logMessage(`Subtitle optimization successful`, 'info');
          return { success: true, data: cleanedResult };
        } else {
          return {
            success: false,
            error: 'AI 優化返回空結果',
          };
        }
      } catch (error) {
        logMessage(`Error optimizing subtitle: ${error}`, 'error');
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  // 批量優化字幕
  ipcMain.handle(
    'batchOptimizeSubtitles',
    async (
      event,
      {
        subtitles,
        providerId,
        customPrompt,
        batchSize = 5,
        maxRetries = 2,
        batchId,
      }: {
        subtitles: Array<{
          id: string;
          index: number;
          sourceContent: string;
          targetContent: string;
        }>;
        providerId?: string;
        customPrompt?: string;
        batchSize?: number;
        maxRetries?: number;
        batchId?: string;
      },
    ) => {
      const abortController = new AbortController();
      if (batchId) batchAbortControllers.set(batchId, abortController);
      try {
        logMessage(
          `Starting batch optimization: ${subtitles.length} subtitles in batches of ${batchSize}`,
          'info',
        );

        // 獲取用戶配置
        const userConfig = store.get('userConfig') || {};
        const translateProviderId = providerId || userConfig.translateProvider;

        if (!translateProviderId || translateProviderId === '-1') {
          return {
            success: false,
            error: '請先選擇一個 AI 翻譯服務',
          };
        }

        // 獲取翻譯提供商
        const providers = store.get('translationProviders') || [];
        const provider = providers.find(
          (p: Provider) => p.id === translateProviderId,
        );

        if (!provider) {
          return {
            success: false,
            error: '未找到選擇的翻譯服務',
          };
        }

        if (!provider.isAi) {
          return {
            success: false,
            error: 'AI 優化功能僅支持 AI 翻譯服務',
          };
        }

        const translator =
          TRANSLATOR_MAP[provider.type as keyof typeof TRANSLATOR_MAP];
        if (!translator) {
          return {
            success: false,
            error: `不支持的翻譯服務類型: ${provider.type}`,
          };
        }

        const sourceLanguage = userConfig.sourceLanguage || 'en';
        const targetLanguage = userConfig.targetLanguage || 'zh';

        // 構建預設批量優化提示詞
        const defaultBatchPrompt = `You are a professional subtitle translator and proofreader. Optimize the following subtitle translations.

For each subtitle, improve the translation to:
1. More accurately convey the original meaning
2. Use natural and fluent expressions
3. Be appropriate for subtitle display (concise but complete)
4. Maintain the original tone and style

Input format: JSON object with subtitle IDs as keys and {source, target} as values
Output format: JSON object with the same IDs and optimized translations as values

IMPORTANT: You MUST return a valid JSON object. Do NOT include any text before or after the JSON. Only output the JSON object.`;

        const results: Array<{
          id: string;
          index: number;
          sourceContent: string;
          originalTarget: string;
          optimizedTarget: string;
          status: 'success' | 'error' | 'skipped';
          error?: string;
        }> = [];

        const totalBatches = Math.ceil(subtitles.length / batchSize);
        let processedCount = 0;
        let cancelled = false;

        // 分批處理
        for (let i = 0; i < subtitles.length; i += batchSize) {
          // 每批邊界檢查取消信號
          if (abortController.signal.aborted) {
            cancelled = true;
            break;
          }
          const batch = subtitles.slice(i, i + batchSize);
          const currentBatchIndex = Math.floor(i / batchSize) + 1;
          let retryCount = 0;
          let batchSuccess = false;

          logMessage(
            `Processing batch ${currentBatchIndex}/${totalBatches} with ${batch.length} subtitles`,
            'info',
          );

          // 發送進度更新
          const progress = Math.round(
            (processedCount / subtitles.length) * 100,
          );
          event.sender.send('batchOptimizeProgress', {
            progress,
            currentBatch: currentBatchIndex,
            totalBatches,
            processedCount,
            totalCount: subtitles.length,
          });

          while (!batchSuccess && retryCount <= maxRetries) {
            if (abortController.signal.aborted) {
              cancelled = true;
              break;
            }
            try {
              // 構建批量輸入
              const batchInput: Record<
                string,
                { source: string; target: string }
              > = {};
              batch.forEach((sub) => {
                batchInput[sub.id] = {
                  source: sub.sourceContent,
                  target: sub.targetContent || '',
                };
              });

              // 構建提示詞
              let optimizePrompt = customPrompt || defaultBatchPrompt;
              optimizePrompt = optimizePrompt
                .replace(/\{\{sourceLanguage\}\}/g, sourceLanguage)
                .replace(/\{\{targetLanguage\}\}/g, targetLanguage);

              const fullPrompt = `${optimizePrompt}\n\nSubtitles to optimize:\n${JSON.stringify(batchInput, null, 2)}`;

              // 配置翻譯器
              const optimizedProvider = {
                ...provider,
                systemPrompt:
                  'You are a professional subtitle optimizer. Output ONLY valid JSON. No explanations, no markdown, just the JSON object.',
                useJsonMode: true,
                structuredOutput: 'disabled' as const,
              };

              logMessage(
                `Batch ${currentBatchIndex} attempt ${retryCount + 1}/${maxRetries + 1}`,
                'info',
              );

              const response = await translator(
                fullPrompt,
                optimizedProvider,
                sourceLanguage,
                targetLanguage,
              );

              logMessage(
                `Batch ${currentBatchIndex} response: ${response}`,
                'info',
              );

              // 解析響應
              const parsedResponse = parseOptimizationResponse(response);

              if (parsedResponse && typeof parsedResponse === 'object') {
                // 處理結果
                batch.forEach((sub) => {
                  const optimized = parsedResponse[sub.id];
                  if (optimized !== undefined) {
                    results.push({
                      id: sub.id,
                      index: sub.index,
                      sourceContent: sub.sourceContent,
                      originalTarget: sub.targetContent,
                      optimizedTarget:
                        typeof optimized === 'string'
                          ? optimized
                          : optimized?.target ||
                            optimized?.translation ||
                            String(optimized),
                      status: 'success',
                    });
                  } else {
                    results.push({
                      id: sub.id,
                      index: sub.index,
                      sourceContent: sub.sourceContent,
                      originalTarget: sub.targetContent,
                      optimizedTarget: sub.targetContent,
                      status: 'skipped',
                      error: '未在響應中找到對應結果',
                    });
                  }
                });

                processedCount += batch.length;
                batchSuccess = true;
                logMessage(
                  `Batch ${currentBatchIndex}/${totalBatches} completed successfully`,
                  'info',
                );
              } else {
                throw new Error('無法解析 AI 響應');
              }
            } catch (error) {
              retryCount++;
              if (retryCount <= maxRetries) {
                logMessage(
                  `Batch ${currentBatchIndex} failed, retry ${retryCount}/${maxRetries}: ${error}`,
                  'warning',
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, 1000 * retryCount),
                );
              } else {
                logMessage(
                  `Batch ${currentBatchIndex} failed after ${maxRetries} retries: ${error}`,
                  'error',
                );
                // 批次失敗，標記所有字幕為錯誤
                batch.forEach((sub) => {
                  results.push({
                    id: sub.id,
                    index: sub.index,
                    sourceContent: sub.sourceContent,
                    originalTarget: sub.targetContent,
                    optimizedTarget: sub.targetContent,
                    status: 'error',
                    error: String(error),
                  });
                });
                processedCount += batch.length;
                batchSuccess = true; // 繼續下一批
              }
            }
          }
          if (cancelled) break;
        }

        // 發送完成進度
        event.sender.send('batchOptimizeProgress', {
          progress: cancelled
            ? Math.round((processedCount / subtitles.length) * 100)
            : 100,
          currentBatch: totalBatches,
          totalBatches,
          processedCount: cancelled ? processedCount : subtitles.length,
          totalCount: subtitles.length,
          completed: true,
        });

        logMessage(
          `Batch optimization ${cancelled ? 'cancelled' : 'completed'}: ${results.filter((r) => r.status === 'success').length}/${subtitles.length} successful`,
          'info',
        );

        return {
          success: true,
          cancelled,
          data: {
            results,
            summary: {
              total: subtitles.length,
              success: results.filter((r) => r.status === 'success').length,
              error: results.filter((r) => r.status === 'error').length,
              skipped: results.filter((r) => r.status === 'skipped').length,
            },
          },
        };
      } catch (error) {
        logMessage(`Error in batch optimization: ${error}`, 'error');
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (batchId) batchAbortControllers.delete(batchId);
      }
    },
  );

  // 重翻字幕（失敗集中處理）：複用正式任務翻譯鏈路，支持取消與部分結果
  ipcMain.handle(
    'retranslateSubtitles',
    async (
      event,
      {
        subtitles,
        providerId,
        sourceLanguage,
        targetLanguage,
        batchId,
      }: {
        subtitles: Array<{
          id: string;
          startEndTime: string;
          content: string[];
        }>;
        providerId?: string;
        sourceLanguage?: string;
        targetLanguage?: string;
        batchId?: string;
      },
    ) => {
      const abortController = new AbortController();
      if (batchId) batchAbortControllers.set(batchId, abortController);
      const collected: TranslationResult[] = [];
      try {
        const userConfig: any = store.get('userConfig') || {};
        const translateProviderId = providerId || userConfig.translateProvider;
        if (!translateProviderId || translateProviderId === '-1') {
          return { success: false, error: 'NO_DEFAULT_PROVIDER' };
        }

        const providers = store.get('translationProviders') || [];
        const provider = providers.find(
          (p: Provider) => p.id === translateProviderId,
        );
        if (!provider) {
          return { success: false, error: 'NO_DEFAULT_PROVIDER' };
        }

        const translator = TRANSLATOR_MAP[
          provider.type as keyof typeof TRANSLATOR_MAP
        ] as unknown as TranslatorFunction;
        if (!translator) {
          return {
            success: false,
            error: `不支持的翻譯服務類型: ${provider.type}`,
          };
        }

        const from = sourceLanguage || userConfig.sourceLanguage || 'en';
        const to = targetLanguage || userConfig.targetLanguage || 'zh';

        logMessage(
          `Retranslating ${subtitles.length} subtitles with ${provider.name} (${from} -> ${to})`,
          'info',
        );

        // 跑在任務上下文中：翻譯鏈路批次邊界的取消檢查可感知 signal
        await runWithTaskContext(
          { signal: abortController.signal },
          async () => {
            await translateWithProvider(
              provider,
              subtitles,
              from,
              to,
              translator,
              undefined,
              async (batchResults) => {
                collected.push(...batchResults);
                event.sender.send('retranslateProgress', {
                  batchId,
                  done: collected.length,
                  total: subtitles.length,
                });
              },
              1,
            );
          },
        );

        logMessage(
          `Retranslate completed: ${collected.length}/${subtitles.length}`,
          'info',
        );
        return { success: true, cancelled: false, data: collected };
      } catch (error) {
        if (isTaskCancelledError(error)) {
          logMessage(
            `Retranslate cancelled with ${collected.length}/${subtitles.length} done`,
            'info',
          );
          return { success: true, cancelled: true, data: collected };
        }
        logMessage(`Error in retranslate: ${error}`, 'error');
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          data: collected,
        };
      } finally {
        if (batchId) batchAbortControllers.delete(batchId);
      }
    },
  );

  logMessage('Proofread IPC handlers initialized', 'info');
}

// 輔助函數：解析優化響應
function parseOptimizationResponse(
  response: string,
): Record<string, any> | null {
  const cleanResponse = response
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

  // 嘗試直接解析
  try {
    return JSON.parse(cleanResponse);
  } catch {}

  // 嘗試提取 JSON 塊
  const jsonMatch = cleanResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {}
  }

  // 嘗試找到 JSON 對象
  const objectMatch = cleanResponse.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // 嘗試修復常見的 JSON 錯誤
      try {
        const { jsonrepair } = require('jsonrepair');
        const repaired = jsonrepair(objectMatch[0]);
        return JSON.parse(repaired);
      } catch {}
    }
  }

  return null;
}
