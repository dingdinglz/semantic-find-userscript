export type ErrorCode = 'compatibility' | 'cancelled' | 'timeout' | 'network' | 'auth' | 'protocol' | 'length' | 'rate' | 'server' | 'budget' | 'scope' | 'stale';
const messages: Record<ErrorCode, string> = {
  compatibility: '安全请求需要 Tampermonkey 5.4 或更新版本；无法确认拒绝重定向能力，已阻止发送。',
  cancelled: '已停止检索。', timeout: '请求超时，可继续检查；上游仍可能计费。',
  network: '网络连接失败，请检查网络或 Tampermonkey 连接授权。', auth: '请检查 API Key 或账户权限。',
  protocol: '服务响应或请求协议不符合预期，未完成的段落不会算作不匹配。',
  length: '请求过长，请缩小选区后重试。', rate: '服务限流，请稍后继续检查。', server: '服务暂时不可用，可稍后继续检查。',
  budget: '本轮 45 秒等待预算已用完，可继续检查未完成部分。',
  scope: '没有读到可靠正文，请选择“已加载页面文本”或选中一段文字。',
  stale: '页面内容已变化，旧结果已停止定位，请重新搜索。',
};
export class FindError extends Error {
  constructor(public code: ErrorCode, public retryAfter = 0) { super(messages[code]); this.name = 'FindError'; }
}
export function safeMessage(error: unknown): string { return error instanceof FindError ? error.message : '操作失败，请重试。'; }
export function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw new FindError('cancelled'); }
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new FindError('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
