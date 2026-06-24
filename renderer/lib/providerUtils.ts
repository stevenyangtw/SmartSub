import {
  PROVIDER_TYPES,
  CONFIG_TEMPLATES,
  type Provider,
} from '../../types/provider';

/**
 * 服務商是否已完成必填配置。
 * 按類型模板的 required 字段逐一檢查實例值；無必填字段的服務商（如本地服務）視為已配置。
 * 自定義服務商（type 為 openai）的模板在 CONFIG_TEMPLATES 中。
 * 實例不存在（如用戶 store 中尚無該內置類型的數據）視為未配置。
 */
export function isProviderConfigured(provider: Provider | undefined): boolean {
  if (!provider) return false;
  const template =
    PROVIDER_TYPES.find((type) => type.id === provider.type) ??
    CONFIG_TEMPLATES[provider.type];
  if (!template) return true;
  return template.fields
    .filter((field) => field.required)
    .every((field) => {
      const value = provider[field.key];
      return (
        value !== undefined && value !== null && String(value).trim() !== ''
      );
    });
}
