import type { RemoteEngineManifest } from '../../../types/engine';

/**
 * app 支持的 sidecar 協議大版本區間（含端點）。
 * 引擎獨立發版後，憑此判斷"老 app + 新引擎"是否兼容；改協議須升上遊
 * PROTOCOL_VERSION 並同步這裡的 MAX。
 */
export const SUPPORTED_PROTOCOL_MIN = 1;
export const SUPPORTED_PROTOCOL_MAX = 1;

export function isProtocolSupported(
  version: number | undefined | null,
): boolean {
  return (
    typeof version === 'number' &&
    version >= SUPPORTED_PROTOCOL_MIN &&
    version <= SUPPORTED_PROTOCOL_MAX
  );
}

/**
 * 遠端 manifest 是否可安裝。
 * 老 release 無 manifest 或無 protocolVersion 時放行（向後兼容）；
 * 有則按區間判定。
 */
export function isRemoteProtocolInstallable(
  remote: RemoteEngineManifest | null,
): boolean {
  if (!remote || typeof remote.protocolVersion !== 'number') return true;
  return isProtocolSupported(remote.protocolVersion);
}
