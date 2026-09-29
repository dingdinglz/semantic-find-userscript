import type { GMRequestDetails } from '../../src/shared/types';
// Test-only GM adapter. Never bundled into dist or used for live TypeSafe requests.
const values = new Map<string, unknown>(), listeners = new Map<number, { key: string; fn: Function }>(); let next = 0;
const state = { calls: [] as { method: string; url: string; data?: string; anonymous: boolean; redirect: string; referer: string; auth: string }[],
  delay: 80, status: 200, value: 0.93, ignoreAbort: false, traversals: 0, aborts: 0, menus: {} as Record<string, () => void>,
  setCredential: (id: string | null) => set('semanticFind.credentials', id ? { schemaVersion: 1, id, apiKey: 'browser-test-placeholder' } : undefined, true),
};
const walker = document.createTreeWalker.bind(document);
document.createTreeWalker = (...args: Parameters<Document['createTreeWalker']>) => { state.traversals++; return walker(...args); };
function set(key: string, value: unknown, remote = false) { const old = values.get(key); if (value === undefined) values.delete(key); else values.set(key, value); listeners.forEach(l => { if (l.key === key) l.fn(key, old, value, remote); }); }
Object.assign(globalThis, {
  __sfTest: state,
  GM_info: { scriptHandler: 'Tampermonkey', version: '5.4.6226' },
  GM_getValue: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
  GM_setValue: (key: string, value: unknown) => set(key, value), GM_deleteValue: (key: string) => set(key, undefined),
  GM_addValueChangeListener: (key: string, fn: Function) => { listeners.set(++next, { key, fn }); return next; }, GM_removeValueChangeListener: (id: number) => listeners.delete(id),
  GM_registerMenuCommand: (label: string, fn: () => void) => { state.menus[label] = fn; return 1; },
  GM_addStyle: (css: string) => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return style; },
  GM_xmlhttpRequest: (details: GMRequestDetails) => {
    state.calls.push({ method: details.method, url: details.url, data: details.data, anonymous: details.anonymous, redirect: details.redirect, referer: details.headers.Referer, auth: details.headers.Authorization });
    const captured = { status: state.status, value: state.value, ignoreAbort: state.ignoreAbort };
    const timer = setTimeout(() => {
      const body = details.data ? JSON.parse(details.data) : undefined;
      const answers = body ? Object.fromEntries(Object.entries(body.state.targets).map(([id, target]: [string, any]) => [`match_${id}`, { type: 'noul', noul: body.state.query === 'absence' ? 0.02 : body.state.query === 'uncertain' ? 0.5 : /不足以支持|不能创建新项目|不能给出确定|这句话重复/u.test(target.text) ? captured.value : 0.02 }])) : undefined;
      details.onload({ status: captured.status, finalUrl: details.url, responseHeaders: '', responseText: JSON.stringify(body ? { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 10 } } : { models: [{ name: 'jev-latest', description: 'Test alias', release_date: '2026-01-01' }] }) });
    }, state.delay);
    return { abort() { state.aborts++; if (!captured.ignoreAbort) { clearTimeout(timer); details.onabort(); } } };
  },
});
if (location.pathname === '/fallback') Object.defineProperty(globalThis, 'Highlight', { value: undefined });
