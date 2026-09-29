import type { GMRequest, GMResponse } from '../../shared/types';
import { checkAbort, FindError } from '../../shared/errors';
export const ORIGIN = 'https://api.typesafe.ai';
export function validateEndpoint(url: string, method: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash ||
    !((method === 'GET' && parsed.pathname === '/v1/models') || (method === 'POST' && parsed.pathname === '/v1/systemone')) || url !== `${ORIGIN}${parsed.pathname}`) throw new FindError('protocol');
}
export function requireSafeTransport(): void {
  // redirect:error was introduced in build 6180. Require a conservative, known-newer stable line.
  // Never try an authenticated request to discover whether an older manager ignores this flag.
  const info = typeof GM_info === 'object' ? GM_info : undefined;
  const version = info?.version?.match(/^(\d+)\.(\d+)/u);
  if (info?.scriptHandler !== 'Tampermonkey' || !version || !(Number(version[1]) > 5 || (Number(version[1]) === 5 && Number(version[2]) >= 4))) throw new FindError('compatibility');
}
export function request(path: '/v1/models' | '/v1/systemone', apiKey: string, signal: AbortSignal, timeoutMs: number,
  data?: string, send: GMRequest = GM_xmlhttpRequest): Promise<GMResponse> {
  const method = path === '/v1/models' ? 'GET' : 'POST', url = ORIGIN + path;
  validateEndpoint(url, method); checkAbort(signal); requireSafeTransport();
  return new Promise((resolve, reject) => {
    let settled = false; let handle: { abort(): void } | undefined;
    const finish = (error?: FindError, response?: GMResponse) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(response!);
    };
    const abortHandle = () => { try { handle?.abort(); } catch { /* Cancellation is best-effort. */ } };
    const abort = () => { finish(new FindError('cancelled')); abortHandle(); };
    // anonymous enables fetch mode, whose native XHR timeout is not reliable in Chrome.
    const timer = setTimeout(() => { finish(new FindError('timeout')); abortHandle(); }, Math.max(1, timeoutMs));
    signal.addEventListener('abort', abort, { once: true });
    try {
      handle = send({ method, url, data, anonymous: true, fetch: true, redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}), Referer: '' },
        onload: response => {
          if (signal.aborted) return finish(new FindError('cancelled'));
          // Defense in depth only; redirect:error must prevent the redirect BEFORE forwarding credentials.
          if (response.finalUrl && response.finalUrl !== url) return finish(new FindError('protocol'));
          finish(undefined, response);
        },
        onerror: () => finish(new FindError('network')), ontimeout: () => finish(new FindError('timeout')), onabort: () => finish(new FindError('cancelled')),
      });
      if (signal.aborted) abort();
    } catch { finish(new FindError('network')); }
  });
}
export function retryAfter(headers: string, now = Date.now()): number {
  const value = /^retry-after:\s*(.+)$/imu.exec(headers)?.[1].trim();
  if (!value) return 0;
  const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value); return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}
export function parseHTTP(response: GMResponse): unknown {
  const { status, responseText } = response;
  if (status === 401 || status === 403) throw new FindError('auth');
  if (status === 429 || status === 529) throw new FindError('rate', retryAfter(response.responseHeaders));
  if (status >= 500) throw new FindError('server', retryAfter(response.responseHeaders));
  if (status === 0) throw new FindError('network');
  if (status === 413 || status === 422) {
    // Only explicit context/token-length errors trigger subdivision, never a generic 422.
    if (status === 413 || /context_length_exceeded|too_many_tokens|maximum context length|token limit exceeded/iu.test(responseText)) throw new FindError('length');
  }
  if (status < 200 || status >= 300) throw new FindError('protocol');
  try { return JSON.parse(responseText); } catch { throw new FindError('protocol'); }
}
