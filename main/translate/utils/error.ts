/**
 * 檢查是否是配置相關的錯誤
 * 配置錯誤應該直接中止任務，不進行重試
 */
export function isConfigurationError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();

  // 明確的配置錯誤模式
  const explicitConfigErrors = [
    'missingkeyorsecret',
    'api key is required',
    'openai api key is required',
    'not supported language',
    'missing api key',
    'invalid api key',
    'api key not valid',
    'invalid credentials',
    'configuration error',
    'missing configuration',
    '請先配置',
  ];

  // 認證相關錯誤模式
  const authErrors = [
    'unauthorized',
    'authentication failed',
    'access denied',
    'forbidden',
    '401',
    '403',
  ];

  // 檢查是否包含明確的配置錯誤
  const hasExplicitConfigError = explicitConfigErrors.some((pattern) =>
    errorMessage.includes(pattern),
  );

  // 檢查是否是認證錯誤（但排除網絡相關的認證問題）
  const hasAuthError =
    authErrors.some((pattern) => errorMessage.includes(pattern)) &&
    !errorMessage.includes('network') &&
    !errorMessage.includes('timeout');

  // 檢查原始錯誤消息中的配置錯誤模式（保持大小寫敏感）
  const hasOriginalConfigError = [
    'missingKeyOrSecret',
    'OpenAI API key is required',
    'not supported language',
    'API key not valid',
  ].some((pattern) => error.message.includes(pattern));

  return hasExplicitConfigError || hasAuthError || hasOriginalConfigError;
}

/** 批量翻譯失敗時寫入 targetContent 的前綴 */
const TRANSLATION_FAILURE_PREFIX = '[翻譯失敗:';

export function extractTranslationFailure(
  text: string | undefined | null,
): string | null {
  if (!text || !text.trim()) return 'empty translation result';
  const trimmed = text.trim();
  if (!trimmed.startsWith(TRANSLATION_FAILURE_PREFIX)) return null;
  const inner = trimmed
    .slice(TRANSLATION_FAILURE_PREFIX.length)
    .replace(/\]\s*$/, '')
    .trim();
  return inner || trimmed;
}

export function assertValidTestTranslation(translation: string): void {
  const failure = extractTranslationFailure(translation);
  if (failure) {
    throw new Error(failure);
  }
}
