import axios from 'axios';
import { convertLanguageCode } from '../helpers/utils';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

const NIUTRANS_API = 'https://api.niutrans.com/NiuTransServer/translation';

/**
 * 小牛翻譯（NiuTrans）文本翻譯
 * 文檔：https://niutrans.com/documents/contents/trans_text
 * 僅需 API-KEY（控制台 -> 個人中心），無需簽名。
 * 文本翻譯接口一次翻譯一段文本，為保證與時間軸一一對應，預設 batchSize=1，
 * 這裡對數組逐條翻譯並返回等長數組。
 */
export default async function niutrans(
  query: string | string[],
  proof: { apiKey?: string },
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string | string[]> {
  const { apiKey } = proof || {};
  if (!apiKey) {
    console.log('請先配置小牛翻譯 API Key');
    throw new Error('missingKeyOrSecret');
  }

  const from = convertLanguageCode(sourceLanguage, 'niutrans') || 'auto';
  const to = convertLanguageCode(targetLanguage, 'niutrans');
  if (!to) {
    console.log('不支持的語言');
    throw new Error('not supported language');
  }

  const translateOne = async (text: string): Promise<string> => {
    const body = new URLSearchParams({
      from,
      to,
      apikey: apiKey,
      src_text: text,
    });
    const res = await axios.post(NIUTRANS_API, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: TRANSLATION_REQUEST_TIMEOUT,
    });
    const data = res?.data || {};
    if (data.error_code) {
      throw new Error(
        `${data.error_code}: ${data.error_msg || 'NiuTrans translation failed'}`,
      );
    }
    if (typeof data.tgt_text !== 'string') {
      throw new Error(data.error_msg || 'NiuTrans translation failed');
    }
    return data.tgt_text;
  };

  if (Array.isArray(query)) {
    const results: string[] = [];
    for (const text of query) {
      results.push(await translateOne(text));
    }
    return results;
  }

  return translateOne(query);
}
