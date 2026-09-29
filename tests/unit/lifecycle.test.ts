import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeSafeClient } from '../../src/userscript/typesafe/client';
import { SearchController } from '../../src/userscript/search/controller';
import { SearchCache } from '../../src/userscript/search/cache';
import { ContentObserver } from '../../src/userscript/extract/observe';
import { Highlighter } from '../../src/userscript/highlight/css-highlight';
import { classify, resultStatus } from '../../src/userscript/ui/results';
import { credential, mockGM, response, snapshot } from './helpers';
import type { SearchRun } from '../../src/shared/types';
import { FindError } from '../../src/shared/errors';
beforeEach(() => { document.body.innerHTML = ''; mockGM(credential); });
afterEach(() => vi.useRealTimers());
const payload = (body?: string) => response(Object.keys(JSON.parse(body!).state.targets));
describe('search lifecycle, retry and cache', () => {
  it('does not evaluate without authorization and caches all valid judgments for the same snapshot/query', async () => {
    const send = vi.fn(async (_path, _key, _signal, _timeout, body) => ({ status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' }));
    const c = new SearchController(new TypeSafeClient(send), () => {}), snap = snapshot(40);
    await c.start(snap, 'q', credential.id, () => false); expect(send).not.toHaveBeenCalled();
    await c.start(snap, 'q', credential.id, () => true); expect(c.run?.completed).toBe(40); expect(c.run?.status).toBe('complete');
    const count = send.mock.calls.length; await c.start(snap, 'q', credential.id, () => true); expect(send).toHaveBeenCalledTimes(count);
    expect(c.run?.judgments.size).toBe(40);
  });
  it('bounds concurrency to two batches and ignores repeated Enter during a run', async () => {
    let active = 0, max = 0;
    const send = vi.fn(async (_p, _k, _s, _t, body) => { max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return { status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' }; });
    const c = new SearchController(new TypeSafeClient(send), () => {}), snap = snapshot(60);
    const first = c.start(snap, 'q', credential.id, () => true); const run = c.run;
    await c.start(snap, 'q', credential.id, () => true); expect(c.run).toBe(run); await first; expect(max).toBe(2); expect(c.run?.completed).toBe(60);
  });
  it('drops late responses after new query, cancellation, credential replacement or clear', async () => {
    const pending: (() => void)[] = [];
    const send = vi.fn((_p, _k, _s, _t, body) => new Promise<any>(resolve => pending.push(() => resolve({ status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' }))));
    const c = new SearchController(new TypeSafeClient(send), () => {}), snap = snapshot(1);
    const old = c.start(snap, 'old', credential.id, () => true); const fresh = c.start(snap, 'new', credential.id, () => true);
    pending[0](); await old; expect(c.run?.query).toBe('new'); expect(c.run?.completed).toBe(0);
    c.clear(); pending[1](); await fresh; expect(c.run).toBeUndefined();
    const next = c.start(snap, 'next', credential.id, () => true); GM_deleteValue('semanticFind.credentials'); pending[2](); await next;
    expect(c.run?.completed).toBe(0); expect(c.run?.status).not.toBe('complete');
  });
  it('never says no match after protocol failure or a wait-budget stop', async () => {
    const client = new TypeSafeClient(async () => ({ status: 200, responseText: '{}', responseHeaders: '' }));
    const c = new SearchController(client, () => {}); await c.start(snapshot(3), 'q', credential.id, () => true);
    expect(c.run?.status).toBe('partial'); expect(resultStatus(c.run!)).not.toContain('没有找到');
    vi.useFakeTimers();
    const slow = new SearchController(new TypeSafeClient(async (_p, _k, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new FindError('cancelled'))))), () => {}, 50);
    const promise = slow.start(snapshot(1), 'q', credential.id, () => true); await vi.advanceTimersByTimeAsync(50); await promise;
    expect(slow.run?.status).toBe('partial'); expect(resultStatus(slow.run!)).not.toContain('没有找到');
  });
  it('honors Retry-After, retries only in client, and re-reads credential after backoff', async () => {
    vi.useFakeTimers(); const gm = mockGM(credential);
    const send = vi.fn(async () => ({ status: 429, responseText: '', responseHeaders: 'Retry-After: 2' }));
    const client = new TypeSafeClient(send), abort = new AbortController(); const ctx = { credentialId: credential.id, signal: abort.signal, deadline: Date.now() + 45000, valid: () => true, attempt: vi.fn(), used: vi.fn() };
    const pending = client.evaluateBatch('q', snapshot(1).passages, ctx); const assertion = expect(pending).rejects.toMatchObject({ code: 'auth' });
    await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(1);
    gm.set('semanticFind.credentials', { ...credential, id: 'new-version' }, true); await vi.advanceTimersByTimeAsync(1000); await assertion; expect(send).toHaveBeenCalledTimes(1);
  });
  it('retries recoverable errors at most twice; never retries auth or generic 422', async () => {
    vi.useFakeTimers();
    for (const status of [401, 422, 503]) {
      const send = vi.fn(async () => ({ status, responseText: '', responseHeaders: '' }));
      const pending = new TypeSafeClient(send).evaluateBatch('q', snapshot(1).passages, { credentialId: credential.id, signal: new AbortController().signal, deadline: Date.now() + 45000, valid: () => true, attempt() {}, used() {} });
      const assertion = expect(pending).rejects.toBeInstanceOf(FindError); await vi.runAllTimersAsync(); await assertion; expect(send).toHaveBeenCalledTimes(status === 503 ? 3 : 1);
    }
  });
  it('subdivides only explicit server length errors, including single long targets', async () => {
    const snap = snapshot(1); snap.passages[0].text = 'Original complete evidence. '.repeat(10);
    const send = vi.fn(async (_p, _k, _s, _t, body) => {
      const parsed = JSON.parse(body!), targets = Object.values(parsed.state.targets) as { text: string }[];
      if (targets[0].text.length > 180) return { status: 422, responseText: 'context_length_exceeded', responseHeaders: '' };
      return { status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' };
    });
    const c = new SearchController(new TypeSafeClient(send), () => {});
    await c.start(snap, 'q', credential.id, () => true);
    expect(c.run?.completed).toBe(1); expect(c.run?.judgments.get('b00001')?.value).toBe(0.9); expect(send).toHaveBeenCalledTimes(3);
  });
  it('cache separates credentials/context/model contract and evicts query groups', () => {
    const cache = new SearchCache(), snap = snapshot(1);
    const a = cache.key(snap, ' q ', 'id1'); expect(a).toBe(cache.key(snap, 'q', 'id1')); expect(a).not.toBe(cache.key(snap, 'q', 'id2'));
    cache.set(a, new Map([['b00001', { id: 'b00001', value: 0.9, model: 'jev-1.13.0' }]]));
    for (let i = 0; i < 11; i++) cache.set(cache.key(snap, String(i), 'id1'), new Map()); expect(cache.get(a).size).toBe(0);
    const before = cache.key(snap, 'q', 'id1'); snap.passages[0].before = 'Changed context'; expect(cache.key(snap, 'q', 'id1')).not.toBe(before);
  });
});
describe('DOM changes, highlights and honest result states', () => {
  it('invalidates text, added content and root replacement but ignores owned UI and layout-only changes', async () => {
    document.body.innerHTML = '<article><p>Original text.</p></article>'; const root = document.querySelector('article')!;
    const changed = vi.fn(), observer = new ContentObserver(); observer.watch(root, changed);
    root.setAttribute('style', 'width:500px'); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
    const panel = document.createElement('div'); panel.setAttribute('data-semantic-find-owned', 'panel'); root.append(panel); await Promise.resolve(); expect(changed).not.toHaveBeenCalled();
    root.querySelector('p')!.firstChild!.textContent = 'Changed'; await Promise.resolve(); expect(changed).toHaveBeenCalledOnce();
    observer.watch(root, changed); root.replaceWith(document.createElement('article')); await Promise.resolve(); expect(changed).toHaveBeenCalledTimes(2); observer.disconnect();
  });
  it('invalidates immediately when previously hidden content becomes readable', async () => {
    document.body.innerHTML = '<article><p>Readable</p><details><summary>Title</summary><p>Secret</p></details></article>';
    const observer = new ContentObserver(), changed = vi.fn(); observer.watch(document.querySelector('article')!, changed);
    document.querySelector('details')!.open = true; await Promise.resolve(); expect(changed).toHaveBeenCalledOnce(); observer.disconnect();
  });
  it('clears only owned CSS Highlights and never mutates article text nodes', () => {
    const registry = new Map(); const pageHighlight = {}; registry.set('page-highlight', pageHighlight);
    vi.stubGlobal('CSS', { highlights: registry, supports: () => true }); vi.stubGlobal('Highlight', class { priority = 0; });
    const snap = snapshot(1), node = snap.passages[0].slices[0].node; const highlighter = new Highlighter();
    highlighter.matches(snap.passages); highlighter.active(snap.passages[0]); expect(registry.size).toBe(3);
    highlighter.dispose(); expect(registry.size).toBe(1); expect(registry.get('page-highlight')).toBe(pageHighlight); expect(node.isConnected).toBe(true);
    vi.unstubAllGlobals();
  });
  it('distinguishes uncertainty, complete absence, failure and cancellation', () => {
    expect(classify(0.8)).toBe('match'); expect(classify(0.2)).toBe('no'); expect(classify(0.5)).toBe('uncertain');
    const run = { status: 'complete', completed: 1, total: 1, failed: 0, judgments: new Map([['b', { id: 'b', value: 0.1 }]]) } as SearchRun;
    expect(resultStatus(run)).toContain('在本次检索范围内没有找到');
    run.judgments.get('b')!.value = 0.5; expect(resultStatus(run)).toContain('待确认');
    for (const status of ['partial', 'cancelled', 'stale', 'running'] as const) { run.status = status; expect(resultStatus(run)).not.toContain('没有找到'); }
  });
});
