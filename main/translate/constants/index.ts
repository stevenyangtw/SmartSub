export const CONTENT_TEMPLATES = {
  onlyTranslate: '${targetContent}\n\n',
  sourceAndTranslate: '${sourceContent}\n${targetContent}\n\n',
  translateAndSource: '${targetContent}\n${sourceContent}\n\n',
} as const;

export const DEFAULT_BATCH_SIZE = {
  AI: 10,
  API: 1,
} as const;

// 翻譯請求超時時間（毫秒）。
// 防止單個請求無限掛起導致整個翻譯流程卡死、進度永久停留（issue #269）。
export const TRANSLATION_REQUEST_TIMEOUT = 60_000;
// 本地大模型（Ollama）響應可能較慢，使用更寬鬆的超時時間。
export const OLLAMA_REQUEST_TIMEOUT = 300_000;

export const THINK_TAG_REGEX = /<think>[\s\S]*?<\/think>\n/g;
export const RESULT_TAG_REGEX = /<result[^>]*>([\s\S]*?)<\/result>/;

// 獲取 ```json\n{content}\n``` 中的 content
export const JSON_CONTENT_REGEX = /```json\n([\s\S]*?)\n```/;
