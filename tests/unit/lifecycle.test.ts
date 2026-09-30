import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeSafeClient } from '../../src/userscript/typesafe/client';
import { SearchController } from '../../src/userscript/search/controller';
import { SearchCache } from '../../src/userscript/search/cache';
import { Highlighter } from '../../src/userscript/highlight/css-highlight';
import { classify, resultStatus } from '../../src/userscript/ui/results';
import { credential, mockGM, response, snapshot } from './helpers';
import type { SearchRun } from '../../src/shared/types';
import { FindError } from '../../src/shared/errors';
beforeEach(() => { document.body.innerHTML = ''; mockGM(credential); });
afterEach(() => vi.useRealTimers());
const payload = (body?: string) => response(JSON.parse(body!).state.candidates);
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
  it('subdivides explicit server length errors without dropping the shared context', async () => {
    const snap = snapshot(2);
    const send = vi.fn(async (_p, _k, _s, _t, body) => {
      const parsed = JSON.parse(body!);
      expect(Object.keys(parsed.state.document)).toEqual(['b00001', 'b00002']);
      if (parsed.state.candidates.length > 1) return { status: 422, responseText: 'context_length_exceeded', responseHeaders: '' };
      return { status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' };
    });
    const c = new SearchController(new TypeSafeClient(send), () => {});
    await c.start(snap, 'q', credential.id, () => true);
    expect(c.run?.completed).toBe(2); expect(send).toHaveBeenCalledTimes(3);
  });
  it('reports incomplete if the server rejects even one question with its context', async () => {
    const send = vi.fn(async () => ({ status: 422, responseText: 'context_length_exceeded', responseHeaders: '' }));
    const c = new SearchController(new TypeSafeClient(send), () => {});
    await c.start(snapshot(1), 'q', credential.id, () => true);
    expect(c.run?.completed).toBe(0); expect(c.run?.status).toBe('partial');
    expect(resultStatus(c.run!)).not.toContain('没有找到'); expect(send).toHaveBeenCalledOnce();
  });
  it('retains already-judged passages as context when continuing a partial run', async () => {
    let fail = true;
    const snap = snapshot(20);
    const send = vi.fn(async (_p, _k, _s, _t, body) => {
      const parsed = JSON.parse(body!);
      expect(Object.keys(parsed.state.document)).toHaveLength(20);
      if (fail && parsed.state.candidates.includes('b00020')) return { status: 422, responseText: 'invalid', responseHeaders: '' };
      return { status: 200, responseText: JSON.stringify(payload(body)), responseHeaders: '' };
    });
    const c = new SearchController(new TypeSafeClient(send), () => {});
    await c.start(snap, 'q', credential.id, () => true);
    expect(c.run?.completed).toBe(16);
    fail = false; await c.start(snap, 'q', credential.id, () => true);
    expect(c.run?.completed).toBe(20);
    expect(JSON.parse(send.mock.calls.at(-1)![4]!).state.candidates).toHaveLength(4);
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
  it('skips changed anchors without removing other matches or disabling CSS highlights', () => {
    const registry = new Map();
    vi.stubGlobal('CSS', { highlights: registry, supports: () => true });
    const Highlight = vi.fn(function (...ranges: Range[]) { return { ranges, priority: 0 }; });
    vi.stubGlobal('Highlight', Highlight);
    const snap = snapshot(3), highlighter = new Highlighter();
    snap.passages[0].slices[0].node.data = 'Changed'; snap.passages[1].container.remove();
    highlighter.matches(snap.passages);
    expect(highlighter.mode).toBe('css'); expect(registry.size).toBe(1);
    expect(Highlight.mock.calls.at(-1)).toHaveLength(1);
    expect(Highlight.mock.calls.at(-1)![0].startContainer).toBe(snap.passages[2].slices[0].node);
    highlighter.dispose(); vi.unstubAllGlobals();
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
