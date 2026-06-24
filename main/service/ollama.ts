import axios from 'axios';
import { TRANSLATION_JSON_SCHEMA } from '../translate/constants/schema';
import { OLLAMA_REQUEST_TIMEOUT } from '../translate/constants';

interface OllamaConfig {
  apiUrl: string;
  modelName: string;
  prompt: string;
  systemPrompt: string;
  useJsonMode?: boolean;
}

export default async function translateWithOllama(
  text: string,
  config: OllamaConfig,
) {
  const { apiUrl, modelName, systemPrompt, useJsonMode } = config;
  const url = apiUrl.replace('generate', 'chat'); // 兼容舊版本的ollama

  try {
    // 為JSON模式增強system prompt
    let enhancedSystemPrompt = systemPrompt;

    // 如果開啟了JSON模式，添加JSON格式說明
    if (useJsonMode !== false) {
      enhancedSystemPrompt = `${systemPrompt}\n\n你必須以JSON格式返回數據，不要包含任何其他文本或說明。輸出應該是一個有效的JSON對象，其中鍵是字幕ID，值是翻譯後的內容。\n\n下面是返回的JSON Schema:\n${JSON.stringify(TRANSLATION_JSON_SCHEMA, null, 2)}`;
    }

    const response = await axios.post(
      `${url}`,
      {
        model: modelName,
        messages: [
          { role: 'system', content: enhancedSystemPrompt },
          { role: 'user', content: text },
        ],
        stream: false,
        format: 'json',
      },
      { timeout: OLLAMA_REQUEST_TIMEOUT },
    );

    if (response.data && response.data.message) {
      return response.data.message?.content?.trim();
    } else {
      throw new Error(
        response?.data?.error || 'Unexpected response from Ollama',
      );
    }
  } catch (error) {
    throw error;
  }
}
