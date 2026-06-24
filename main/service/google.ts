import axios from 'axios';
import { convertLanguageCode } from '../helpers/utils';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

export default async function google(
  query,
  proof,
  sourceLanguage,
  targetLanguage,
) {
  const { apiKey } = proof || {};
  if (!apiKey) {
    console.log('請先配置 Google Translate API Key');
    throw new Error('missingApiKey');
  }

  // 支持字符串數組輸入
  const queryText = Array.isArray(query) ? query : [query];

  const formatSourceLanguage = convertLanguageCode(sourceLanguage, 'google');
  const formatTargetLanguage = convertLanguageCode(targetLanguage, 'google');
  console.log(
    formatSourceLanguage,
    formatTargetLanguage,
    'formatSourceLanguage, formatTargetLanguage',
    sourceLanguage,
    targetLanguage,
  );
  if (!formatSourceLanguage || !formatTargetLanguage) {
    console.log('不支持的語言');
    throw new Error('not supported language');
  }

  try {
    const response = await axios.post(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        q: queryText,
        source: formatSourceLanguage,
        target: formatTargetLanguage,
        format: 'text',
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: TRANSLATION_REQUEST_TIMEOUT,
      },
    );

    if (!response?.data?.data?.translations) {
      throw new Error(response?.data?.error?.message || '翻譯失敗');
    }

    const translations = response.data.data.translations.map(
      (translation) => translation.translatedText,
    );

    // 如果輸入是數組，返回結果也轉換為數組
    if (Array.isArray(query)) {
      return translations;
    }
    return translations.join('\n');
  } catch (error) {
    console.log(error, 'google error');
    if (error.response) {
      // API 返回錯誤
      const errorMsg = error.response.data?.error?.message || '翻譯請求失敗';
      throw new Error(errorMsg);
    } else if (error.request) {
      // 網絡錯誤
      throw new Error('網絡連接失敗');
    } else {
      // 其他錯誤
      throw new Error(error.message || '未知錯誤');
    }
  }
}
