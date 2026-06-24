export type ProviderField = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'password'
    | 'textarea'
    | 'url'
    | 'number'
    | 'switch'
    | 'select';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  step?: string | number;
  tips?: string;
  options?: string[];
};

export type ProviderType = {
  id: string;
  name: string;
  fields: ProviderField[];
  isBuiltin?: boolean;
  icon?: string;
  isAi?: boolean;
  iconImg?: string;
  /** 左列分組：free=免費起步，ai=AI 翻譯，mt=傳統機翻 */
  group?: 'free' | 'ai' | 'mt';
};

export type Provider = {
  id: string;
  name: string;
  type: string;
  isAi: boolean;
  [key: string]: any;
};

export type ParameterValue = string | number | boolean | object | any[];

export interface CustomParameterConfig {
  headerParameters: Record<string, ParameterValue>;
  bodyParameters: Record<string, ParameterValue>;
  configVersion: string;
  lastModified: number;
}

export interface ExtendedProvider extends Provider {
  customParameters?: CustomParameterConfig;
}

export interface ParameterDefinition {
  key: string;
  type: 'string' | 'integer' | 'float' | 'boolean' | 'object' | 'array';
  category: 'core' | 'behavior' | 'response' | 'provider' | 'performance';
  required: boolean;
  defaultValue?: ParameterValue;
  validation?: ValidationRule;
  description: string;
  providerSupport: string[];
}

export interface ValidationRule {
  min?: number;
  max?: number;
  enum?: any[];
  pattern?: string;
  dependencies?: Record<string, any>;
}

export type ParameterCategory =
  | 'provider'
  | 'performance'
  | 'quality'
  | 'experimental';

export interface ProcessedParameters {
  headers: Record<string, string | number>;
  body: Record<string, any>;
  appliedParameters: string[];
  skippedParameters: string[];
  validationErrors: ValidationError[];
}

export interface ValidationError {
  key: string;
  type: 'type' | 'range' | 'format' | 'dependency' | 'system';
  message: string;
  suggestion?: string;
}

export interface ParameterTemplate {
  id: string;
  name: string;
  description: string;
  category: ParameterCategory;
  headerParameters: Record<string, ParameterValue>;
  bodyParameters: Record<string, ParameterValue>;
  modelCompatibility?: string[];
  useCase?: string;
  provider?: string;
}

export const defaultUserPrompt = '${content}';
export const TENCENT_DEFAULT_REQUEST_INTERVAL_SECONDS = 0.25;

/**
 * 歷史版本的默認系統提示詞，用於遷移時判斷用戶是否修改過
 * 每次修改 defaultSystemPrompt 時，將舊版本追加到此數組末尾
 */
export const HISTORICAL_DEFAULT_PROMPTS: string[] = [
  `# Role: 資深翻譯專家
您是一位經驗豐富的字幕翻譯專家,精通\${targetLanguage}的翻譯,擅長將視頻字幕譯成流暢易懂的\${targetLanguage}。

# Attention:
在整個翻譯過程中，您需要注意以下幾點：

1. 保持每條字幕的獨立性和完整性，不合並或拆分。
2. 使用口語化的\${targetLanguage}，避免過於書面化的表達，以符合字幕的特點。
3. 適當使用標點符號，如逗號、句號，甚至省略號，來增強語氣和節奏感。
4. 確保專業術語的準確性，並且在上下文中保持一致性。

# 輸出格式要求：
1. 您必須嚴格按照輸入的JSON格式進行輸出，保留原始的鍵（ID），僅翻譯值的內容。
2. 不要添加任何額外的文本、註釋或解釋，只返回純JSON。
3. 不要改變鍵值對的數量，確保輸出的JSON對象與輸入包含相同數量的鍵值對。
4. 確保輸出是有效的JSON格式，不能有語法錯誤。

最後，您需要檢查整個翻譯是否流暢，是否有語法錯誤，以及是否忠實於原文意思。特別是要注意譯文與原文之間的差異，比如英語中常用被動語態，而中文則更多使用主動語態，所以在翻譯時可能會做一些調整，以適應\${targetLanguage}的表達習慣。

# Examples

Input:
{"0": "Welcome to China", "1": "China is a beautiful country"}

Output:
{"0": "歡迎來到中國", "1": "中國是一個美麗的國家"}
`,
];

export const defaultSystemPrompt = `# Role: 資深翻譯專家
您是一位經驗豐富的字幕翻譯專家,精通\${sourceLanguage}的翻譯,擅長將視頻字幕譯成流暢易懂的\${targetLanguage}。

# Attention:
在整個翻譯過程中，您需要注意以下幾點：

1. 保持每條字幕的獨立性和完整性，不合並或拆分。
2. 使用口語化的\${targetLanguage}，避免過於書面化的表達，以符合字幕的特點。
3. 適當使用標點符號，如逗號、句號，甚至省略號，來增強語氣和節奏感。
4. 確保專業術語的準確性，並且在上下文中保持一致性。

# 輸出格式要求：
1. 您必須嚴格按照輸入的JSON格式進行輸出，保留原始的鍵（ID），僅翻譯值的內容。
2. 不要添加任何額外的文本、註釋或解釋，只返回純JSON。
3. 不要改變鍵值對的數量，確保輸出的JSON對象與輸入包含相同數量的鍵值對。
4. 確保輸出是有效的JSON格式，不能有語法錯誤。

最後，您需要檢查整個翻譯是否流暢，是否有語法錯誤，以及是否忠實於原文意思。特別是要注意譯文與原文之間的差異，比如英語中常用被動語態，而中文則更多使用主動語態，所以在翻譯時可能會做一些調整，以適應\${targetLanguage}的表達習慣。

# Examples

Input:
{\"0\": \"Welcome to China\", \"1\": \"China is a beautiful country\"}

Output:
{\"0\": \"歡迎來到中國\", \"1\": \"中國是一個美麗的國家\"}
`;

// ============================================================
// 共享字段定義
// ============================================================

const FIELD_REQUEST_INTERVAL: ProviderField = {
  key: 'requestInterval',
  label: 'requestInterval',
  type: 'number',
  defaultValue: 0,
  step: 0.1,
  tips: 'requestIntervalTip',
  placeholder: 'phRequestInterval',
};

const tencentRequestIntervalField: ProviderField = {
  ...FIELD_REQUEST_INTERVAL,
  defaultValue: TENCENT_DEFAULT_REQUEST_INTERVAL_SECONDS,
};

const FIELD_SYSTEM_PROMPT: ProviderField = {
  key: 'systemPrompt',
  label: 'systemPrompt',
  type: 'textarea',
  tips: 'systemPromptTips',
  defaultValue: defaultSystemPrompt,
};

const FIELD_USER_PROMPT: ProviderField = {
  key: 'prompt',
  label: 'prompt',
  type: 'textarea',
  defaultValue: defaultUserPrompt,
  tips: 'userPromptTips',
};

const batchSizeField = (
  defaultValue: number = 1,
  tips: string = 'batchSizeTip',
): ProviderField => ({
  key: 'batchSize',
  label: 'Batch Size',
  type: 'number',
  defaultValue,
  tips,
  placeholder: 'phBatchSize',
});

const structuredOutputField = (
  defaultValue: string = 'json_object',
): ProviderField => ({
  key: 'structuredOutput',
  label: 'structuredOutput',
  type: 'select',
  required: false,
  defaultValue,
  options: ['disabled', 'json_object', 'json_schema'],
  tips: 'structuredOutputTips',
});

const aiCommonFields = (overrides?: {
  batchSize?: number;
  batchSizeTips?: string;
  structuredOutput?: string;
}): ProviderField[] => [
  FIELD_SYSTEM_PROMPT,
  FIELD_USER_PROMPT,
  structuredOutputField(overrides?.structuredOutput),
  batchSizeField(overrides?.batchSize, overrides?.batchSizeTips),
  FIELD_REQUEST_INTERVAL,
];

const apiBatchFields = (
  defaultBatchSize: number,
  batchSizeTips: string,
  requestIntervalField: ProviderField = FIELD_REQUEST_INTERVAL,
): ProviderField[] => [
  batchSizeField(defaultBatchSize, batchSizeTips),
  requestIntervalField,
];

// ============================================================
// Provider 定義
// ============================================================

export const PROVIDER_TYPES: ProviderType[] = [
  {
    id: 'baidu',
    name: 'baidu',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🔤',
    iconImg: '/images/providers/baidu-color.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'APP ID',
        type: 'password',
        required: true,
        tips: 'baiduApiKeyTips',
        placeholder: 'phBaiduAppId',
      },
      {
        key: 'apiSecret',
        label: 'Secret Key',
        type: 'password',
        required: true,
        placeholder: 'phBaiduSecretKey',
      },
      ...apiBatchFields(18, 'batchSizeBaiduTips'),
    ],
  },
  {
    id: 'google',
    name: 'Google Translate',
    isBuiltin: true,
    isAi: false,
    group: 'free',
    icon: '🇬',
    iconImg: '/images/providers/googletranslate.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'googleApiKeyTips',
        placeholder: 'phGoogleApiKey',
      },
      ...apiBatchFields(50, 'batchSizeGoogleTips'),
    ],
  },
  {
    id: 'aliyun',
    name: 'aliyun',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '☁️',
    iconImg: '/images/providers/alibabacloud.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'AccessKey ID',
        type: 'password',
        required: true,
        tips: 'aliyunApiKeyTips',
        placeholder: 'phAliyunAccessKeyId',
      },
      {
        key: 'apiSecret',
        label: 'AccessKey Secret',
        type: 'password',
        required: true,
        placeholder: 'phAliyunAccessKeySecret',
      },
      {
        key: 'endpoint',
        label: 'Endpoint',
        type: 'text',
        required: false,
        defaultValue: 'mt.aliyuncs.com',
        tips: 'endpointAliyunTips',
        placeholder: 'phAliyunEndpoint',
      },
      ...apiBatchFields(15, 'batchSizeAliyunTips'),
    ],
  },
  {
    id: 'volc',
    name: 'volc',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🌋',
    iconImg: '/images/providers/volcengine-color.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'Access Key ID',
        type: 'password',
        required: true,
        tips: 'volcApiKeyTips',
        placeholder: 'phVolcAccessKeyId',
      },
      {
        key: 'apiSecret',
        label: 'Secret Access Key',
        type: 'password',
        required: true,
        placeholder: 'phVolcSecretAccessKey',
      },
      ...apiBatchFields(15, 'batchSizeVolcTips'),
    ],
  },
  {
    id: 'doubao',
    name: '豆包翻譯',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🫛',
    iconImg: '/images/providers/doubao-color.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'doubaoApiKeyTips',
        placeholder: 'phDoubaoApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'text',
        required: false,
        defaultValue: 'doubao-seed-translation-250915',
        tips: 'doubaoModelNameTips',
        placeholder: 'doubao-seed-translation-250915',
      },
      ...apiBatchFields(1, 'batchSizeDoubaoTips'),
    ],
  },
  {
    id: 'niutrans',
    name: 'niutrans',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🐮',
    iconImg: '/images/providers/niutrans.png',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'niutransApiKeyTips',
        placeholder: 'phNiutransApiKey',
      },
      ...apiBatchFields(1, 'batchSizeNiutransTips'),
    ],
  },
  {
    id: 'tencent',
    name: 'tencent',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🐧',
    iconImg: '/images/providers/tencentcloud-color.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'SecretId',
        type: 'password',
        required: true,
        tips: 'tencentApiKeyTips',
        placeholder: 'phTencentSecretId',
      },
      {
        key: 'apiSecret',
        label: 'SecretKey',
        type: 'password',
        required: true,
        placeholder: 'phTencentSecretKey',
      },
      {
        key: 'region',
        label: 'Region',
        type: 'text',
        required: false,
        defaultValue: 'ap-guangzhou',
        tips: 'regionTencentTips',
        placeholder: 'phTencentRegion',
      },
      ...apiBatchFields(1, 'batchSizeTencentTips', tencentRequestIntervalField),
    ],
  },
  {
    id: 'xunfei',
    name: 'xunfei',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '🗣️',
    iconImg: '/images/providers/spark-color.svg',
    fields: [
      {
        key: 'appId',
        label: 'APPID',
        type: 'password',
        required: true,
        tips: 'xunfeiApiKeyTips',
        placeholder: 'phXunfeiAppId',
      },
      {
        key: 'apiKey',
        label: 'APIKey',
        type: 'password',
        required: true,
        placeholder: 'phXunfeiApiKey',
      },
      {
        key: 'apiSecret',
        label: 'APISecret',
        type: 'password',
        required: true,
        placeholder: 'phXunfeiApiSecret',
      },
      ...apiBatchFields(1, 'batchSizeXunfeiTips'),
    ],
  },
  {
    id: 'deeplx',
    name: 'DeepLX',
    isBuiltin: true,
    isAi: false,
    group: 'free',
    icon: '🌐',
    iconImg: '/images/providers/deepl-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'ApiUrl',
        type: 'url',
        required: true,
        defaultValue: 'http://localhost:1188/translate',
        tips: 'deeplxApiUrlTips',
        placeholder: 'phDeeplxApiUrl',
      },
    ],
  },
  {
    id: 'azure',
    name: 'azure',
    isBuiltin: true,
    isAi: false,
    group: 'mt',
    icon: '☁️',
    iconImg: '/images/providers/azure-color.svg',
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'azureApiKeyTips',
        placeholder: 'phAzureApiKey',
      },
      {
        key: 'apiSecret',
        label: 'Region',
        type: 'password',
        required: true,
        placeholder: 'phAzureRegion',
      },
      ...apiBatchFields(20, 'batchSizeAzureTips'),
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    isBuiltin: true,
    isAi: true,
    group: 'free',
    icon: '🤖',
    iconImg: '/images/providers/ollama.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'ApiUrl',
        type: 'url',
        required: true,
        tips: 'ollamaApiUrlTips',
        placeholder: 'phOllamaApiUrl',
        defaultValue: 'http://localhost:11434/api/chat',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'select',
        required: true,
        placeholder: 'selectModel',
        options: [],
      },
      ...aiCommonFields({ batchSize: 10 }),
    ],
  },
  {
    id: 'deepseek',
    name: 'Deepseek',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '🧠',
    iconImg: '/images/providers/deepseek-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        placeholder: 'https://api.deepseek.com/v1',
        defaultValue: 'https://api.deepseek.com/v1',
        tips: 'deepseekApiUrlTips',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'deepseekApiKeyTips',
        placeholder: 'phDeepseekApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'select',
        required: true,
        placeholder: 'selectModel',
        options: [],
      },
      ...aiCommonFields(),
    ],
  },
  {
    id: 'azureopenai',
    name: 'Azure OpenAI',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '☁️',
    iconImg: '/images/providers/azureai-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'ApiUrl',
        type: 'url',
        required: true,
        placeholder:
          'https://{your-resource-name}.openai.azure.com/openai/deployments/{deployment-id}',
        tips: 'azureOpenAiApiUrlTips',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'azureOpenAiApiKeyTips',
        placeholder: 'phAzureOpenAiApiKey',
      },
      ...aiCommonFields({ structuredOutput: 'json_schema' }),
    ],
  },
  {
    id: 'DeerAPI',
    name: 'DeerAPI',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '🐺',
    iconImg: '/images/deerapi.png',
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        tips: 'DeerApiUrlTips',
        placeholder: 'https://api.deerapi.com/v1',
        defaultValue: 'https://api.deerapi.com/v1',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'deerApiKeyTips',
        placeholder: 'phDeerApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'select',
        required: true,
        placeholder: 'selectModel',
        options: [],
      },
      ...aiCommonFields({ batchSize: 10 }),
    ],
  },
  {
    id: 'Gemini',
    name: 'Gemini',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '🌀',
    iconImg: '/images/providers/gemini-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        placeholder: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        defaultValue:
          'https://generativelanguage.googleapis.com/v1beta/openai/',
        tips: 'geminiApiUrlTips',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'geminiApiKeyTips',
        placeholder: 'phGeminiApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'text',
        required: true,
        placeholder: 'gemini-2.0-flash',
        defaultValue: 'gemini-2.0-flash',
      },
      ...aiCommonFields({ structuredOutput: 'json_schema' }),
    ],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '🔮',
    iconImg: '/images/providers/siliconcloud-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        placeholder: 'https://api.siliconflow.cn/v1',
        defaultValue: 'https://api.siliconflow.cn/v1',
        tips: 'siliconflowApiUrlTips',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'siliconflowApiKeyTips',
        placeholder: 'phSiliconflowApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'select',
        required: true,
        placeholder: 'selectModel',
        options: [],
      },
      ...aiCommonFields(),
    ],
  },
  {
    id: 'qwen',
    name: '通義千問',
    isBuiltin: true,
    isAi: true,
    group: 'ai',
    icon: '🐋',
    iconImg: '/images/providers/qwen-color.svg',
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultValue: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        tips: 'qwenApiUrlTips',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'qwenApiKeyTips',
        placeholder: 'phQwenApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'select',
        required: true,
        placeholder: 'selectModel',
        options: [],
      },
      ...aiCommonFields(),
    ],
  },
];

export const CONFIG_TEMPLATES: Record<string, ProviderType> = {
  openai: {
    id: 'openai_template',
    name: 'OpenAI API',
    isAi: true,
    fields: [
      {
        key: 'apiUrl',
        label: 'Base url',
        type: 'url',
        required: true,
        tips: 'openaiApiUrlTips',
        placeholder: 'phOpenaiApiUrl',
        defaultValue: 'https://api.openai.com/v1',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'password',
        required: true,
        tips: 'openaiApiKeyTips',
        placeholder: 'phOpenaiApiKey',
      },
      {
        key: 'modelName',
        label: 'modelName',
        type: 'text',
        required: true,
        placeholder: 'hunyuan-3.0-preview',
        tips: 'openaiModelNameTips',
      },
      ...aiCommonFields({ structuredOutput: 'json_object' }),
    ],
  },
};
