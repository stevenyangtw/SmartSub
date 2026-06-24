import axios from 'axios';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

interface AzureTranslateResponse {
  translations: {
    text: string;
    to: string;
  }[];
}

interface AzureTranslateRequest {
  text: string;
}

const azureTranslator = async (
  texts: string | string[],
  proof: {
    apiKey: string;
    apiSecret: string;
  },
  sourceLanguage?: string,
  targetLanguage?: string,
): Promise<string | string[]> => {
  try {
    const endpoint = 'https://api.cognitive.microsofttranslator.com';
    const route = '/translate';

    // 構建請求參數
    const params = new URLSearchParams({
      'api-version': '3.0',
      from: sourceLanguage || 'auto',
      to: targetLanguage || 'en',
    });

    // 構建請求體
    const requestBody: AzureTranslateRequest[] = Array.isArray(texts)
      ? texts.map((text) => ({ text }))
      : [{ text: texts as string }];

    // 發送請求
    const response = await axios({
      baseURL: endpoint,
      url: route,
      method: 'post',
      headers: {
        'Ocp-Apim-Subscription-Key': proof.apiKey,
        'Ocp-Apim-Subscription-Region': proof.apiSecret,
        'Content-type': 'application/json',
      },
      params: params,
      data: requestBody,
      responseType: 'json',
      timeout: TRANSLATION_REQUEST_TIMEOUT,
    });
    console.log(response, 'response');

    // 處理響應
    const results = response.data as AzureTranslateResponse[];
    const translations = results.map((result) => result.translations[0].text);

    // 根據輸入類型返回對應格式
    return Array.isArray(texts) ? translations : translations[0];
  } catch (error) {
    console.log(error, 'error');
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error?.message || error.message;
      throw new Error(`Azure翻譯服務錯誤: ${message}`);
    }
    throw error;
  }
};

export default azureTranslator;
