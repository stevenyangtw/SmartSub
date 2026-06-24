import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Provider, TranslationResult } from './types';
import { CONTENT_TEMPLATES } from './constants';
import { createOrClearFile, appendToFile } from './utils/file';
import {
  detectSubtitleFormat,
  parseSubtitleEntries,
} from '../helpers/subtitleFormats';
import {
  translateWithProvider,
  TRANSLATOR_MAP,
} from './services/translationProvider';
import { getSrtFileName, renderTemplate } from '../helpers/utils';
import { logMessage } from '../helpers/storeManager';
import { IFiles, IFormData } from '../../types';
import { ensureTempDir } from '../helpers/fileUtils';
import { isTaskCancelledError } from '../helpers/taskContext';
import { assertValidTestTranslation } from './utils/error';
import {
  getDesiredChineseScript,
  convertChineseText,
  removeChineseSubtitlePunctuation,
} from '../helpers/chineseConvert';

/**
 * 解析「中文標點去除」生效值：任務級單開關（issue #330）。
 */
function resolveRemoveChinesePunctuation(
  formData: IFormData | undefined,
): boolean {
  return formData?.removeChinesePunctuation === true;
}

export default async function translate(
  event,
  file: IFiles,
  formData: IFormData,
  provider: Provider,
  onProgress?: (progress: number) => void,
  maxRetries?: number,
): Promise<boolean> {
  const {
    translateContent,
    targetSrtSaveOption,
    customTargetSrtFileName,
    sourceLanguage,
    targetLanguage,
    translateRetryTimes,
  } = formData || {};
  const { fileName, directory, srtFile } = file;

  // 如果參數中有指定重試次數，則使用參數值，否則使用表單中的值或預設為2
  const retryCount =
    maxRetries !== undefined
      ? maxRetries
      : translateRetryTimes
        ? parseInt(translateRetryTimes)
        : 0;
  const renderContentTemplate = CONTENT_TEMPLATES[translateContent];

  // 譯文後處理：
  // 1) 目標為中文時按簡/繁做確定性歸一，兜底 Ai 概率性輸出繁體（issue #332）。
  // 2) 按「中文標點去除」生效值，把中文標點替換為空格（issue #330）。
  const desiredTargetScript = getDesiredChineseScript(targetLanguage);
  const isChineseTarget = desiredTargetScript !== null;
  const removePunctuation = resolveRemoveChinesePunctuation(formData);
  const postProcessTarget = (content: string): string => {
    if (!content) return content;
    let out = content;
    if (desiredTargetScript) {
      out = convertChineseText(out, desiredTargetScript).text;
    }
    if (removePunctuation && isChineseTarget) {
      out = removeChineseSubtitlePunctuation(out);
    }
    return out;
  };

  // 雙語字幕內嵌「源文行」的標點後處理（issue #330）：
  // 僅當源為中文、開關開啟、且源字幕由 ASR 生成（generateAndTranslate）時才去標點；
  // translateOnly 的源為用戶導入字幕，保持原樣。源字幕簡繁歸一已在 fileProcessor 完成，
  // 翻譯輸入仍保留標點（不影響斷句質量），此處只清理寫入雙語文件的源文展示。
  const isChineseSource = getDesiredChineseScript(sourceLanguage) !== null;
  const isGeneratedSource = formData?.taskType === 'generateAndTranslate';
  const removeSourcePunctuation =
    removePunctuation && isChineseSource && isGeneratedSource;
  const postProcessBilingualSource = (content: string): string => {
    if (!content) return content;
    return removeSourcePunctuation
      ? removeChineseSubtitlePunctuation(content)
      : content;
  };

  try {
    const translator = TRANSLATOR_MAP[provider.type];
    if (!translator) {
      throw new Error(`Unknown translation provider: ${provider.type}`);
    }

    logMessage(
      `Translation started using ${provider.type}, max retries: ${retryCount}`,
      'info',
    );

    // 源字幕按擴展名自動識別格式（srt/vtt/ass/lrc），統一解析為內部 Subtitle 結構
    const rawSourceContent = await fs.promises.readFile(srtFile, 'utf-8');
    const subtitles = parseSubtitleEntries(
      rawSourceContent,
      detectSubtitleFormat(srtFile),
    );

    const templateData = {
      fileName,
      sourceLanguage,
      targetLanguage,
      model: '',
      translateProvider: provider.name,
    };
    const targetSrtFileName = getSrtFileName(
      targetSrtSaveOption,
      fileName,
      targetLanguage,
      customTargetSrtFileName,
      templateData,
    );

    const fileSave = path.join(directory, `${targetSrtFileName}.srt`);
    file.translatedSrtFile = fileSave;
    await createOrClearFile(fileSave);

    // 生成臨時純翻譯文件，無論是否是雙語字幕
    const tempDir = ensureTempDir();
    const tempTranslatedFileName = `${uuidv4()}.srt`;
    const tempTranslatedFilePath = path.join(tempDir, tempTranslatedFileName);
    file.tempTranslatedSrtFile = tempTranslatedFilePath;
    await createOrClearFile(tempTranslatedFilePath);

    logMessage(
      `Created temporary pure translation file: ${tempTranslatedFilePath}`,
      'info',
    );

    const handleTranslationResult = async (results: TranslationResult[]) => {
      let concatContent = '';
      let tempTranslatedContent = '';

      results.forEach(async (result) => {
        // 目標譯文後處理（簡繁歸一 + 可選中文標點去除）
        const targetContent = postProcessTarget(result.targetContent);
        // 雙語內嵌源文行後處理（僅生成並翻譯 + 中文源 + 開關開啟時去標點）
        const sourceContent = postProcessBilingualSource(result.sourceContent);

        // 根據用戶設置的模板生成目標文件內容
        const content = `${result.id}\n${result.startEndTime}\n${renderTemplate(
          renderContentTemplate,
          {
            sourceContent,
            targetContent,
          },
        )}`;
        concatContent += content;

        // 對臨時文件，只添加純翻譯內容
        const pureTranslatedContent = `${result.id}\n${result.startEndTime}\n${targetContent}\n\n`;
        tempTranslatedContent += pureTranslatedContent;
      });

      // 保存到目標文件
      logMessage(`append to file ${fileSave}`);
      await appendToFile(fileSave, concatContent);

      // 保存到臨時純翻譯文件
      logMessage(`append to temp file ${tempTranslatedFilePath}`);
      await appendToFile(tempTranslatedFilePath, tempTranslatedContent);
    };

    await translateWithProvider(
      provider,
      subtitles,
      sourceLanguage,
      targetLanguage,
      translator,
      onProgress,
      handleTranslationResult,
      retryCount,
    );

    logMessage('Translation completed', 'info');
    return true;
  } catch (error) {
    if (!isTaskCancelledError(error)) {
      event.sender.send('message', error.message || error);
    }
    throw error;
  }
}

export async function testTranslation(
  provider: Provider,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<{ translation: string; analysis?: any }> {
  // 樣本文本跟隨源語言，避免「中文源」卻拿英文樣本測試
  const sampleText = sourceLanguage?.startsWith('zh') ? '你好' : 'Hello';
  const testSubtitle = {
    id: '1',
    startEndTime: '00:00:01,000 --> 00:00:04,000',
    content: [sampleText],
  };

  try {
    const translator = TRANSLATOR_MAP[provider.type];
    if (!translator) {
      throw new Error(`Unknown translation provider: ${provider.type}`);
    }

    const startTime = Date.now();
    const results = await translateWithProvider(
      provider,
      [testSubtitle],
      sourceLanguage,
      targetLanguage,
      translator,
    );

    let translation: string;
    if (provider.isAi && provider.useBatchTranslation) {
      translation = (results as string[])[0];
    } else {
      translation = (results as TranslationResult[])[0].targetContent;
    }

    assertValidTestTranslation(translation);

    // For now, return basic result until we implement full analysis
    // TODO: Add thinking mode analysis when we have access to raw API response
    return {
      translation,
      analysis: {
        response_time_ms: Date.now() - startTime,
        provider_name: provider.name,
        model_name: provider.modelName,
        test_completed: true,
      },
    };
  } catch (error) {
    throw error;
  }
}
