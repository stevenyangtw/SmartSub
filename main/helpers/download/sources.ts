import type { BinaryDownloadSource } from '../downloadSourceOrder';
import {
  getGithubBase,
  getGitcodeBase,
  getGithubProxyPrefix,
} from '../config/downloadConfig';

/** 同一發佈物在 GitHub 與 GitCode 上的倉庫 slug 往往不同，必須分開聲明。 */
export interface ReleaseRepoSlugs {
  github: string;
  gitcode: string;
}

/**
 * 統一解析某下載源下的 release 基礎 URL（不含末尾斜槓）。
 * 各源 base / 代理前綴均來自可配置的下載端點（用戶可在設置頁覆蓋）。
 * - github:  {githubBase}/{slugs.github}/releases/download/{tag}
 * - ghproxy: {githubProxyPrefix}/{github url}
 * - gitcode: {gitcodeBase}/{slugs.gitcode}/releases/download/{tag}
 */
export function resolveReleaseBaseUrl(
  source: BinaryDownloadSource,
  slugs: ReleaseRepoSlugs,
  tag: string,
): string {
  if (source === 'gitcode') {
    return `${getGitcodeBase()}/${slugs.gitcode}/releases/download/${tag}`;
  }
  const github = `${getGithubBase()}/${slugs.github}/releases/download/${tag}`;
  return source === 'ghproxy' ? `${getGithubProxyPrefix()}/${github}` : github;
}
