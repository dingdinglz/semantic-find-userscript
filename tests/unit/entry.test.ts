import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageSnapshot, LocalPassage, Judgment, SearchRun } from '../../src/shared/types';
import type { PanelActions } from '../../src/userscript/ui/panel';
import { passageRanges } from '../../src/userscript/extract/anchors';
import { FindError } from '../../src/shared/errors';
import { DEFAULTS, SETTINGS_KEY } from '../../src/userscript/settings/preferences';
import { credential, mockGM, snapshot as makeSnapshot } from './helpers';
const state = vi.hoisted(() => ({ extract: vi.fn(), send: vi.fn(), actions: undefined as PanelActions | undefined,
  query: undefined as HTMLInputElement | undefined, shown: vi.fn(), status: vi.fn(), result: vi.fn(), clear: vi.fn(), scroll: vi.fn() }));
vi.mock('../../src/userscript/extract/passages', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/userscript/extract/passages')>(), extractSnapshot: state.extract,
}));
vi.mock('../../src/userscript/extract/anchors', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/userscript/extract/anchors')>(), scrollToPassage: state.scroll,
}));
vi.mock('../../src/userscript/typesafe/client', () => ({ TypeSafeClient: class { evaluateBatch = state.send; } }));
vi.mock('../../src/userscript/highlight/css-highlight', () => ({ Highlighter: class {
  mode = 'css'; matches() {} active() {} clearActive() {} clear() {} dispose() {}
} }));
vi.mock('../../src/userscript/ui/panel', () => ({ Panel: class {
  host = document.createElement('div'); query = document.createElement('input');
  constructor(actions: PanelActions) { state.actions = actions; state.query = this.query; }
  snapshot = state.shown; setStatus = state.status; result = state.result; clearResults = state.clear;
  ready() { this.setStatus('ready'); }
  waitForExtraction() {} clearSnapshot() {} navigation() {} showSearch() {} showSettings() {} dispose() {}
} }));
let menus: Record<string, () => void>, snap: PageSnapshot, gm: ReturnType<typeof mockGM>;
const settle = () => vi.advanceTimersByTimeAsync(0);
const submit = (query = 'find') => { state.query!.value = query; state.actions!.search(); };
const judgments = (passages: LocalPassage[]): Judgment[] => passages.map(p => ({ id: p.id, value: 0.9, model: 'jev-1.13.0' }));
const lastRun = () => state.result.mock.calls.at(-1)![1] as SearchRun;
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); document.body.replaceChildren(); gm = mockGM(credential);
  menus = {}; vi.stubGlobal('GM_registerMenuCommand', (name: string, action: () => void) => { menus[name] = action; });
  snap = makeSnapshot(2); state.actions = undefined;
  for (const mock of [state.shown, state.status, state.result, state.clear]) mock.mockClear();
  state.scroll.mockReset().mockImplementation(passageRanges);
  state.extract.mockReset().mockResolvedValue(snap);
  state.send.mockReset().mockImplementation(async (_query: string, passages: LocalPassage[]) => judgments(passages));
  await import('../../src/userscript/entry');
});
afterEach(async () => { state.actions?.close(); await vi.runOnlyPendingTimersAsync(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('explicit search snapshots on dynamic pages', () => {
  it('does not extract on open, empty submit, settings changes or idle DOM updates', async () => {
    menus['按意思查找'](); submit(''); state.actions!.preferencesChanged();
    document.querySelector('p')!.textContent = 'Changed while idle'; await vi.advanceTimersByTimeAsync(1000);
    expect(state.extract).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });
  it('extracts once on submit and starts without a second submit, even during continuous mutations', async () => {
    let finish!: (snapshot: PageSnapshot) => void;
    state.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit(); submit();
    const updating = setInterval(() => { document.querySelector('p')!.textContent = String(Date.now()); }, 20);
    await vi.advanceTimersByTimeAsync(1000); clearInterval(updating);
    expect(state.send).not.toHaveBeenCalled(); expect(state.extract).toHaveBeenCalledOnce();
    expect(state.extract.mock.calls[0][4].aborted).toBe(false);
    finish(snap); await settle();
    expect(state.send).toHaveBeenCalledOnce(); expect(state.send.mock.calls[0][3]).toEqual(snap.passages);
    expect(lastRun()).toMatchObject({ status: 'complete', completed: 2 });
  });
  it.each(['queryChanged', 'stop', 'settings', 'close', 'preferencesChanged'] as const)('cancels extraction on %s even if it resolves late', async action => {
    let finish!: (snapshot: PageSnapshot) => void;
    state.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit(); state.actions![action](); finish(snap); await settle();
    expect(state.extract.mock.calls[0][4].aborted).toBe(true);
    expect(state.send).not.toHaveBeenCalled(); expect(state.shown).not.toHaveBeenCalled();
  });
  it('drops an old extraction after a newer query is submitted', async () => {
    const finishes: ((snapshot: PageSnapshot) => void)[] = [];
    state.extract.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
    menus['按意思查找'](); submit('old'); state.actions!.queryChanged(); submit('new');
    finishes[0](snap); await settle(); expect(state.send).not.toHaveBeenCalled();
    finishes[1]({ ...snap, id: 'fresh' }); await settle();
    expect(state.send).toHaveBeenCalledOnce(); expect(state.send.mock.calls[0][0]).toBe('new');
  });
  it('keeps running on its original snapshot after text changes, removal and append', async () => {
    let finish!: (value: Judgment[]) => void;
    state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit(); await settle();
    const context = state.send.mock.calls[0][2];
    document.querySelector('p')!.remove(); document.body.append(document.createTextNode('New content'));
    await vi.advanceTimersByTimeAsync(1000); submit();
    expect(state.extract).toHaveBeenCalledOnce(); expect(state.send).toHaveBeenCalledOnce();
    expect(context.signal.aborted).toBe(false); expect(context.valid()).toBe(true);
    finish(judgments(snap.passages)); await settle();
    expect(lastRun()).toMatchObject({ status: 'complete', completed: 2 });
    expect(state.result.mock.calls.at(-1)![0]).toBe(snap);
  });
  it('preserves completed results through DOM changes and refreshes only on a new search', async () => {
    menus['按意思查找'](); submit(); await settle();
    const rendered = state.result.mock.calls.length, cleared = state.clear.mock.calls.length;
    document.querySelector('p')!.textContent = 'New content'; await vi.advanceTimersByTimeAsync(1000);
    expect(state.extract).toHaveBeenCalledOnce(); expect(state.send).toHaveBeenCalledOnce();
    expect(state.result).toHaveBeenCalledTimes(rendered); expect(state.clear).toHaveBeenCalledTimes(cleared);
    const fresh = { ...snap, id: 'fresh-snapshot', revision: 2, passages: makeSnapshot(3).passages };
    state.extract.mockResolvedValueOnce(fresh); submit(); await settle();
    expect(state.extract).toHaveBeenCalledTimes(2); expect(state.send).toHaveBeenCalledTimes(2);
    expect(state.shown).toHaveBeenLastCalledWith(fresh);
    expect(lastRun()).toMatchObject({ snapshotId: fresh.id, status: 'complete', completed: 3 });
  });
  it('does not clear results or re-extract when a saved passage can no longer be located', async () => {
    menus['按意思查找'](); submit(); await settle();
    const cleared = state.clear.mock.calls.length;
    snap.passages[0].container.remove(); state.actions!.select(snap.passages[0]); await settle();
    expect(state.status).toHaveBeenLastCalledWith(expect.stringContaining('搜索结果已保留'));
    expect(state.clear).toHaveBeenCalledTimes(cleared); expect(state.extract).toHaveBeenCalledOnce();
    expect(lastRun().judgments.size).toBe(2);
    state.actions!.navigate(1);
    expect(state.scroll).toHaveBeenLastCalledWith(snap.passages[1], expect.any(Number));
    expect(state.status).toHaveBeenLastCalledWith(expect.stringContaining('已定位'));
  });
  it('continues only unfinished candidates using the original text and shared context after DOM updates', async () => {
    snap = makeSnapshot(20); state.extract.mockResolvedValue(snap);
    state.send.mockImplementation(async (_query: string, passages: LocalPassage[]) => {
      if (passages.some(p => p.id === 'b00020')) throw new FindError('protocol');
      return judgments(passages);
    });
    menus['按意思查找'](); submit(); await settle();
    expect(lastRun()).toMatchObject({ status: 'partial', completed: 16 });
    document.body.replaceChildren(document.createTextNode('Completely replaced page'));
    state.send.mockImplementation(async (_query: string, passages: LocalPassage[]) => judgments(passages));
    state.actions!.resume(); await settle();
    expect(state.extract).toHaveBeenCalledOnce(); expect(lastRun()).toMatchObject({ status: 'complete', completed: 20 });
    const resumed = state.send.mock.calls.at(-1)!;
    expect(resumed[1]).toHaveLength(4); expect(resumed[3]).toEqual(snap.passages);
  });
  it('resumes a stopped search without refreshing and ignores its late cancelled response', async () => {
    let finish!: (value: Judgment[]) => void;
    state.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit(); await settle(); state.actions!.stop();
    expect(lastRun().status).toBe('cancelled');
    document.querySelector('p')!.textContent = 'Changed after stop';
    state.actions!.resume(); await settle();
    const resumed = lastRun(); expect(resumed).toMatchObject({ status: 'complete', completed: 2 });
    finish(judgments(snap.passages)); await settle();
    expect(lastRun()).toBe(resumed); expect(state.extract).toHaveBeenCalledOnce();
    expect(state.send.mock.calls.at(-1)![3]).toEqual(snap.passages);
  });
  it.each(['empty', 'error'] as const)('allows another submit after an %s extraction', async outcome => {
    if (outcome === 'empty') state.extract.mockResolvedValueOnce({ ...snap, passages: [] });
    else state.extract.mockRejectedValueOnce(new FindError('scope'));
    menus['按意思查找'](); submit(); await settle(); expect(state.send).not.toHaveBeenCalled();
    submit(); await settle();
    expect(state.extract).toHaveBeenCalledTimes(2); expect(lastRun().status).toBe('complete');
  });
  it('keeps the disabled-site warning when the query changes, without extracting', async () => {
    gm.set(SETTINGS_KEY, { ...DEFAULTS, sites: { [location.origin]: 'disabled' } }, true);
    menus['按意思查找'](); state.actions!.queryChanged(); submit(); await settle();
    expect(state.status).toHaveBeenLastCalledWith(expect.stringContaining('本站已永久禁用'));
    expect(state.extract).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled();
  });
  it.each(['credential', 'navigation'] as const)('still rejects a late extraction after %s changes', async change => {
    let finish!: (snapshot: PageSnapshot) => void;
    state.extract.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    menus['按意思查找'](); submit();
    const url = location.href;
    if (change === 'credential') gm.set('semanticFind.credentials', { ...credential, id: 'replaced' }, true);
    else { history.pushState({}, '', '?next-page'); await vi.advanceTimersByTimeAsync(750); }
    finish(snap); await settle();
    expect(state.send).not.toHaveBeenCalled(); expect(state.shown).not.toHaveBeenCalled();
    expect(state.extract).toHaveBeenCalledOnce();
    history.replaceState({}, '', url);
  });
});
