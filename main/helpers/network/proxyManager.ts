import * as net from 'net';
import * as tls from 'tls';
import * as http from 'http';
import * as https from 'https';
import { once } from 'events';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { store } from '../store';
import { logMessage } from '../storeManager';
import { resolveProxyEnv, type ProxySettings } from './proxyEnv';

export type { ProxySettings, ProxyEnv } from './proxyEnv';
export { resolveProxyEnv } from './proxyEnv';

// 原始（直連）globalAgent，切回 none 時還原
const ORIGINAL_HTTP_AGENT = http.globalAgent;
const ORIGINAL_HTTPS_AGENT = https.globalAgent;

/** host 是否命中 NO_PROXY 列表（精確或子域匹配），命中則直連繞過代理。 */
function hostInNoProxy(host: string | undefined, noProxy: string): boolean {
  if (!host || !noProxy) return false;
  const list = noProxy
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const h = String(host).toLowerCase();
  return list.some((e) => h === e || h.endsWith('.' + e));
}

// 複用庫的精確類型，保證 override 簽名與父類一致
type HttpsConnect = HttpsProxyAgent<string>['connect'];
type HttpsConnectReq = Parameters<HttpsConnect>[0];
type HttpsConnectOpts = Parameters<HttpsConnect>[1];
type HttpConnect = HttpProxyAgent<string>['connect'];
type HttpAddReq = Parameters<HttpProxyAgent<string>['addRequest']>[0];

interface ConnectTarget {
  host?: string;
  port?: number;
  servername?: string;
  secureEndpoint?: boolean;
}

/**
 * https 目標的代理 Agent：子類化 HttpsProxyAgent，僅在 NO_PROXY 命中時直連，
 * 其餘沿用庫的 CONNECT 隧道 + TLS 升級邏輯（避免重新實現易錯的隧道）。
 */
class NoProxyHttpsAgent extends HttpsProxyAgent<string> {
  private noProxy: string;
  constructor(proxy: string, noProxy: string) {
    super(proxy);
    this.noProxy = noProxy;
  }
  async connect(
    req: HttpsConnectReq,
    opts: HttpsConnectOpts,
  ): ReturnType<HttpsConnect> {
    const t = opts as ConnectTarget;
    if (hostInNoProxy(t.host, this.noProxy)) {
      if (t.secureEndpoint) {
        const servername =
          t.servername || (net.isIP(t.host || '') ? undefined : t.host);
        return tls.connect({ host: t.host, port: t.port, servername });
      }
      return net.connect({ host: t.host, port: t.port });
    }
    return super.connect(req, opts);
  }
}

/**
 * http 目標的代理 Agent：子類化 HttpProxyAgent。NO_PROXY 命中時退回普通
 * http.Agent 行為（不改寫 req.path 為絕對 URL，直連目標）。
 */
class NoProxyHttpAgent extends HttpProxyAgent<string> {
  private noProxy: string;
  constructor(proxy: string, noProxy: string) {
    super(proxy);
    this.noProxy = noProxy;
  }
  addRequest(
    req: HttpAddReq,
    opts: Parameters<HttpProxyAgent<string>['addRequest']>[1],
  ): void {
    const t = opts as ConnectTarget;
    if (hostInNoProxy(t.host, this.noProxy)) {
      (
        http.Agent.prototype.addRequest as unknown as (
          r: HttpAddReq,
          o: unknown,
        ) => void
      ).call(this, req, opts);
      return;
    }
    super.addRequest(req, opts);
  }
  async connect(
    req: Parameters<HttpConnect>[0],
    opts: Parameters<HttpConnect>[1],
  ): ReturnType<HttpConnect> {
    const t = opts as ConnectTarget;
    if (hostInNoProxy(t.host, this.noProxy)) {
      const socket = net.connect({ host: t.host, port: t.port });
      await once(socket, 'connect');
      return socket;
    }
    return super.connect(req, opts);
  }
}

let activeProxyUrl = '';

/** 當前生效的代理地址（空串=直連）。用於診斷/日誌。 */
export function getActiveProxyUrl(): string {
  return activeProxyUrl;
}

/**
 * 按當前 settings 重建並安裝全局 Agent。
 * - custom 且有 url：http/https.globalAgent 切換為帶 NO_PROXY 繞過的代理 Agent。
 * - none/空：還原為原始直連 Agent。
 * 改完即時生效（下次請求讀取 globalAgent）。
 */
export function applyProxyFromSettings(): void {
  const settings = store.get('settings') as ProxySettings | undefined;
  const { httpProxy, noProxy } = resolveProxyEnv(settings || {});

  if (httpProxy) {
    http.globalAgent = new NoProxyHttpAgent(
      httpProxy,
      noProxy,
    ) as unknown as http.Agent;
    https.globalAgent = new NoProxyHttpsAgent(
      httpProxy,
      noProxy,
    ) as unknown as https.Agent;
  } else {
    http.globalAgent = ORIGINAL_HTTP_AGENT;
    https.globalAgent = ORIGINAL_HTTPS_AGENT;
  }

  activeProxyUrl = httpProxy;
  logMessage(
    `proxy applied: ${httpProxy ? `custom ${httpProxy}` : 'none (direct)'}`,
    'info',
  );
}

export interface ProxyTestResult {
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
}

/** 經當前 global agent 向輕量端點發請求，回報連通性。 */
export function testProxyConnectivity(
  testUrl = 'https://www.gstatic.com/generate_204',
): Promise<ProxyTestResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = https.get(
      testUrl,
      { headers: { 'User-Agent': 'SmartSub-Electron' }, timeout: 8000 },
      (res) => {
        const ms = Date.now() - startedAt;
        res.resume(); // 釋放 socket
        resolve({ ok: true, ms, status: res.statusCode });
      },
    );
    req.on('error', (err) => {
      resolve({
        ok: false,
        ms: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, ms: Date.now() - startedAt, error: 'timeout' });
    });
  });
}
