import { convertLanguageCode } from '../helpers/utils';
import alimt20181012 from '@alicloud/alimt20181012';
import * as $OpenApi from '@alicloud/openapi-client';
import * as $Util from '@alicloud/tea-util';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

// 客戶端實例
let client: any = null;

/**
 * 阿里雲翻譯服務
 * @param query 待翻譯文本，可以是字符串或字符串數組
 * @param proof 認證信息，包含apiKey(AccessKeyId)和apiSecret(AccessKeySecret)
 * @param sourceLanguage 源語言代碼
 * @param targetLanguage 目標語言代碼
 * @returns 翻譯結果
 */
export default async function translate(
  query: string | string[],
  proof: { apiKey: string; apiSecret: string; endpoint?: string },
  sourceLanguage: string,
  targetLanguage: string,
) {
  const {
    apiKey: accessKeyId,
    apiSecret: accessKeySecret,
    endpoint = 'mt.aliyuncs.com',
  } = proof || {};
  if (!accessKeyId || !accessKeySecret) {
    console.log('請先配置阿里雲 AccessKey ID 和 AccessKey Secret');
    throw new Error('missingKeyOrSecret');
  }

  // 語言代碼轉換
  const formatSourceLanguage =
    convertLanguageCode(sourceLanguage, 'aliyun') || sourceLanguage;
  const formatTargetLanguage =
    convertLanguageCode(targetLanguage, 'aliyun') || targetLanguage;

  if (!formatSourceLanguage || !formatTargetLanguage) {
    console.log('不支持的語言');
    throw new Error('not supported language');
  }

  // 初始化客戶端
  if (!client) {
    client = createClient(accessKeyId, accessKeySecret, endpoint);
  }

  try {
    // 處理單個文本或文本數組
    if (Array.isArray(query)) {
      if (query.length === 0) {
        return [];
      }

      // 批量翻譯處理
      return await batchTranslate(
        client,
        query,
        formatSourceLanguage,
        formatTargetLanguage,
      );
    } else {
      // 單文本翻譯，包裝成批量處理
      const results = await batchTranslate(
        client,
        [query],
        formatSourceLanguage,
        formatTargetLanguage,
      );
      return results[0];
    }
  } catch (error) {
    console.error('阿里雲翻譯錯誤:', error);
    throw new Error(error?.message || '翻譯失敗');
  }
}

/**
 * 創建阿里雲翻譯客戶端
 */
function createClient(
  accessKeyId: string,
  accessKeySecret: string,
  endpoint: string,
): any {
  const config = new $OpenApi.Config({
    accessKeyId,
    accessKeySecret,
  });
  // 設置服務端點
  config.endpoint = endpoint;
  return new alimt20181012(config);
}

/**
 * 批量翻譯處理
 * 使用GetBatchTranslate API進行批量翻譯
 */
async function batchTranslate(
  client: any,
  texts: string[],
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string[]> {
  // 準備批量翻譯的輸入格式
  // 格式: { "1": "text1", "2": "text2", ... }
  const sourceTextObj: Record<string, string> = {};
  texts.forEach((text, index) => {
    sourceTextObj[`${index}`] = text;
  });

  // 阿里雲批量翻譯API需要JSON字符串
  const sourceTextJson = JSON.stringify(sourceTextObj);

  // API請求參數
  const request = {
    formatType: 'text',
    sourceLanguage: sourceLanguage,
    targetLanguage: targetLanguage,
    scene: 'general',
    apiType: 'translate_standard', // 使用通用版翻譯服務
    sourceText: sourceTextJson,
  };

  // 運行時選項：設置讀寫超時，避免請求無限掛起導致翻譯流程卡死（issue #269）
  const runtime = new $Util.RuntimeOptions({
    readTimeout: TRANSLATION_REQUEST_TIMEOUT,
    connectTimeout: TRANSLATION_REQUEST_TIMEOUT,
  });

  try {
    // 發起批量翻譯請求
    const response = await client.getBatchTranslateWithOptions(
      request,
      runtime,
    );

    // 處理返回結果
    if (response?.body?.code === 200 && response?.body?.translatedList) {
      // 構建結果數組，保持原始順序
      const resultMap: Record<string, string> = {};
      for (const item of response.body.translatedList) {
        if (item.index && item.translated) {
          resultMap[item.index] = item.translated;
        }
      }

      // 按原始順序返回結果
      return texts.map((_, index) => resultMap[`${index}`] || '');
    }

    throw new Error(response?.body?.message || '批量翻譯請求返回錯誤');
  } catch (error) {
    console.error('阿里雲批量翻譯錯誤:', error);
    throw error;
  }
}
