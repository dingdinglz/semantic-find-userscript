import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageSnapshot, LocalPassage } from '../../src/shared/types';
import type { PanelActions } from '../../src/userscript/ui/panel';
import { credential, mockGM, snapshot as makeSnapshot } from './helpers';
const state = vi.hoisted(() => ({ extract: vi.fn(), send: vi.fn(), actions: undefined as PanelActions | undefined,
  query: undefined as HTMLInputElement | undefined, shown: vi.fn(), status: vi.fn() }));
vi.mock('../../src/userscript/extract/passages', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/userscript/extract/passages')>(), extractSnapshot: state.extract,
}));
vi.mock('../../src/userscript/typesafe/client', () => ({ TypeSafeClient: class { evaluateBatch = state.send; } }));
vi.mock('../../src/userscript/highlight/css-highlight', () => ({ Highlighter: class {
  mode = 'css'; matches() {} active() {} clear() {} dispose() {}
} }));
vi.mock('../../src/userscript/ui/panel', () => ({ Panel: class {
  host = document.createElement('div'); query = document.createElement('input');
  constructor(actions: PanelActions) { state.actions = actions; state.query = this.query; }
  snapshot = state.shown; setStatus = state.status;
  waitForExtraction() {} clearResults() {} clearSnapshot() {} result() {} navigation() {} showSearch() {} showSettings() {} dispose() {}
} }));
let menus: Record<string, () => void>, snap: PageSnapshot;
const settle = () => vi.advanceTimersByTimeAsync(0);
const submit = () => { state.query!.value = 'find'; state.actions!.search(); };
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); document.body.replaceChildren(); mockGM(credential);
  menus = {}; vi.stubGlobal('GM_registerMenuCommand', (name: string, action: () => void) => { menus[name] = action; });
  snap = makeSnapshot(2); state.actions = undefined; state.shown.mockClear(); state.status.mockClear();
  state.extract.mockReset().mockResolvedValue(snap);
  state.send.mockReset().mockImplementation(async (_query: string, passages: LocalPassage[]) => passages.map(p => ({ id: p.id, value: 0.9, model: 'jev-1.13.0' })));
  await import('../../src/userscript/entry');
});
afterEach(async () => { state.actions?.close(); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('automatic extraction and explicit search intent', () => {
  it('waits for an in-flight extraction and searches without a second submit', async () => {
    let finish!: (snapshot: PageSnapshot) => void;
    state.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit();
    expect(state.send).not.toHaveBeenCalled(); expect(state.extract).toHaveBeenCalledOnce();
    finish(snap); await settle();
    expect(state.send).toHaveBeenCalledOnce(); expect(state.send.mock.calls[0][3]).toEqual(snap.passages);
  });
  it.each(['queryChanged', 'stop', 'settings', 'close'] as const)('cancels pending submission on %s even if extraction resolves late', async action => {
    let finish!: (snapshot: PageSnapshot) => void;
    state.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit(); state.actions![action](); finish(snap); await settle();
    expect(state.send).not.toHaveBeenCalled();
  });
  it('invalidates during extraction, discards the stale snapshot and submits only the refreshed one', async () => {
    const finishes: ((snapshot: PageSnapshot) => void)[] = [];
    state.extract.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
    menus['按意思查找'](); submit();
    document.querySelector('p')!.firstChild!.textContent = 'Changed during extraction'; await settle();
    finishes[0](snap); await settle();
    expect(state.shown).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250); expect(state.extract).toHaveBeenCalledTimes(2);
    const fresh = { ...snap, id: 'fresh-snapshot', revision: 2 };
    finishes[1](fresh); await settle();
    expect(state.shown).toHaveBeenCalledWith(fresh); expect(state.send).toHaveBeenCalledOnce();
  });
  it('automatically re-extracts changed text without replaying a completed search', async () => {
    menus['按意思查找'](); await settle(); submit(); await settle();
    expect(state.send).toHaveBeenCalledOnce();
    document.querySelector('p')!.firstChild!.textContent = 'New content'; await settle();
    await vi.advanceTimersByTimeAsync(250);
    expect(state.extract).toHaveBeenCalledTimes(2); expect(state.send).toHaveBeenCalledOnce();
  });
  it('clears the scheduled refresh on close', async () => {
    menus['按意思查找'](); await settle();
    document.querySelector('p')!.firstChild!.textContent = 'New content'; await settle(); state.actions!.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(state.extract).toHaveBeenCalledOnce(); expect(state.send).not.toHaveBeenCalled();
  });
});
