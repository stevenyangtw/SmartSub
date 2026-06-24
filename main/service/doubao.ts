import axios from 'axios';
import { convertLanguageCode } from '../helpers/utils';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

const DOUBAO_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
const DEFAULT_MODEL = 'doubao-seed-translation-250915';

export default async function translate(
  query: string | string[],
  proof: { apiKey?: string; modelName?: string },
  sourceLanguage: string,
  targetLanguage: string,
) {
  const { apiKey, modelName } = proof || {};
  if (!apiKey) {
    console.log('請先配置 API KEY');
    throw new Error('missingKeyOrSecret');
  }

  const formatSourceLanguage = convertLanguageCode(sourceLanguage, 'doubao');
  const formatTargetLanguage = convertLanguageCode(targetLanguage, 'doubao');
  if (!formatTargetLanguage) {
    console.log('不支持的目標語言');
    throw new Error('not supported language');
  }

  // 支持字符串數組輸入
  const queryArray = Array.isArray(query) ? query : [query];
  const results: string[] = [];

  // 豆包翻譯API每次只能翻譯一條文本，需要循環調用
  for (const text of queryArray) {
    const requestBody = {
      model: modelName || DEFAULT_MODEL,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: text,
              translation_options: {
                source_language: formatSourceLanguage || undefined, // 如果是 auto 則不傳
                target_language: formatTargetLanguage,
              },
            },
          ],
        },
      ],
    };

    try {
      const res = await axios.post(DOUBAO_API_URL, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: TRANSLATION_REQUEST_TIMEOUT,
      });

      // 解析響應
      const output = res?.data?.output;
      if (!output || output.length === 0) {
        throw new Error(res?.data?.error?.message || '翻譯返回為空');
      }

      // 從 output 中提取翻譯結果
      const translatedText = extractTranslation(output);
      results.push(translatedText);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage =
          error.response?.data?.error?.message ||
          error.response?.data?.message ||
          error.message;
        throw new Error(errorMessage);
      }
      throw error;
    }
  }

  // 如果輸入是數組，返回結果數組
  if (Array.isArray(query)) {
    return results;
  }
  return results[0];
}

/**
 * 從 Responses API 的 output 中提取翻譯文本
 */
function extractTranslation(output: any[]): string {
  for (const item of output) {
    if (item.type === 'message' && item.content) {
      for (const content of item.content) {
        if (content.type === 'output_text' && content.text) {
          return content.text;
        }
      }
    }
  }
  throw new Error('無法從響應中提取翻譯結果');
}
