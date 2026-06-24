import { z } from 'zod';

// 定義翻譯結果的JSON Schema
export const TRANSLATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: {
    type: 'string',
    description: '字幕翻譯結果',
  },
  description: '字幕翻譯結果，鍵為字幕ID，值為翻譯後的內容',
};

// Zod schema for translation results - compatible with Gemini
export const TranslationResultSchema = z
  .record(z.string(), z.string())
  .describe('字幕翻譯結果，鍵為字幕ID，值為翻譯後的內容');

// 類型定義
export type TranslationJsonResult = Record<string, string>;
