import crypto from 'crypto';
import axios from 'axios';
import { convertLanguageCode } from '../helpers/utils';
import { TRANSLATION_REQUEST_TIMEOUT } from '../translate/constants';

const HOST = 'ntrans.xfyun.cn';
const REQUEST_LINE = 'POST /v2/ots HTTP/1.1';
const API_URL = `https://${HOST}/v2/ots`;

/**
 * 訊飛機器翻譯（機器翻譯 niutrans 版 /v2/ots）
 * 文檔：https://www.xfyun.cn/doc/nlp/niutrans/API.html
 * 鑑權：使用 APIKey/APISecret 對 host/date/request-line/digest 做 HMAC-SHA256 簽名。
 * 單次請求翻譯一段文本，預設 batchSize=1，對數組逐條翻譯返回等長數組。
 */
export default async function xunfei(
  query: string | string[],
  proof: { appId?: string; apiKey?: string; apiSecret?: string },
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string | string[]> {
  const { appId, apiKey, apiSecret } = proof || {};
  if (!appId || !apiKey || !apiSecret) {
    console.log('請先配置訊飛 APPID、APIKey 和 APISecret');
    throw new Error('missingKeyOrSecret');
  }

  const from = convertLanguageCode(sourceLanguage, 'xunfei') || 'auto';
  const to = convertLanguageCode(targetLanguage, 'xunfei');
  if (!to) {
    console.log('不支持的語言');
    throw new Error('not supported language');
  }

  const translateOne = async (text: string): Promise<string> => {
    const body = JSON.stringify({
      common: { app_id: appId },
      business: { from, to },
      data: { text: Buffer.from(text, 'utf-8').toString('base64') },
    });

    const date = new Date().toUTCString();
    const digest =
      'SHA-256=' + crypto.createHash('sha256').update(body).digest('base64');
    const signatureOrigin = `host: ${HOST}\ndate: ${date}\n${REQUEST_LINE}\ndigest: ${digest}`;
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(signatureOrigin)
      .digest('base64');
    const authorization = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line digest", signature="${signature}"`;

    const res = await axios.post(API_URL, body, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json,version=1.0',
        Host: HOST,
        Date: date,
        Digest: digest,
        Authorization: authorization,
      },
      timeout: TRANSLATION_REQUEST_TIMEOUT,
    });

    const data = res?.data;
    if (!data || data.code !== 0) {
      throw new Error(
        `${data?.code ?? 'unknown'}: ${data?.message || 'iFlytek translation failed'}`,
      );
    }
    const dst = data?.data?.result?.trans_result?.dst;
    if (typeof dst !== 'string') {
      throw new Error(data?.message || 'iFlytek translation failed');
    }
    return dst;
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
