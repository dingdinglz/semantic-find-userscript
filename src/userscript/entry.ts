import type { LocalPassage, PageSnapshot, SearchRun } from '../shared/types';
import { safeMessage } from '../shared/errors';
import { Credentials, readCredential } from './settings/credentials';
import { preferences, SETTINGS_KEY, siteMode } from './settings/preferences';
import { captureSelection } from './extract/scope';
import { extractSnapshot } from './extract/passages';
import { ContentObserver } from './extract/observe';
import { scrollToPassage } from './extract/anchors';
import { TypeSafeClient } from './typesafe/client';
import { SearchController } from './search/controller';
import { fitSnapshot } from './search/batcher';
import { Highlighter } from './highlight/css-highlight';
import { Panel } from './ui/panel';
import { classify, passageLabel } from './ui/results';
import { editablePath, matchesShortcut } from './ui/keyboard';
class SemanticFind {
  private credentials = new Credentials();
  private client = new TypeSafeClient();
  private controller = new SearchController(this.client, run => this.render(run));
  private panel?: Panel; private highlight?: Highlighter;
  private snapshot?: PageSnapshot; private selection?: Range; private focus?: HTMLElement;
  private epoch = 0; private revision = 0; private extraction = 0; private submission = 0;
  private extracting?: AbortController; private observer = new ContentObserver();
  private inSettings = false; private refreshTimer?: ReturnType<typeof setTimeout>;
  private pendingSearch?: { query: string; credentialId: string };
  private activeId?: string; private currentURL = location.href; private routeTimer?: ReturnType<typeof setInterval>;
  constructor() {
    GM_registerMenuCommand('按意思查找', () => this.open());
    GM_registerMenuCommand('设置 API Key', () => { this.ensurePanel(); this.settings(); });
    GM_registerMenuCommand('禁用 / 启用本站检索', () => {
      const disabled = preferences().sites[location.origin] === 'disabled';
      if (confirm(disabled ? '恢复本站检索（主动搜索时直接发送）？' : '永久禁用本站检索？可从此菜单恢复。')) { siteMode(disabled ? 'allow' : 'disabled'); this.configurationChanged(); }
    });
    this.credentials.subscribe(() => this.configurationChanged());
    GM_addValueChangeListener(SETTINGS_KEY, (_key, _oldValue, _newValue, remote) => { if (remote) this.configurationChanged(); });
    document.addEventListener('keydown', event => {
      if (!event.isTrusted || event.isComposing) return;
      const inside = !!this.panel && event.composedPath().includes(this.panel.host);
      if (event.key === 'Escape' && this.panel) { event.preventDefault(); this.close(); return; }
      if ((!inside && editablePath(event)) || !matchesShortcut(event, preferences()) || preferences().sites[location.origin] === 'disabled') return;
      event.preventDefault(); this.open();
    }, true);
    for (const name of ['urlchange', 'popstate', 'hashchange']) window.addEventListener(name, () => this.route());
    window.addEventListener('pagehide', () => this.close());
  }
  private ensurePanel(): Panel {
    if (this.panel) return this.panel;
    this.focus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.selection = captureSelection();
    this.panel = new Panel({ close: () => this.close(), settings: () => this.settings(), search: () => void this.search(),
      stop: () => {
        const waiting = !!this.pendingSearch;
        this.submission++; this.pendingSearch = undefined; this.controller.cancel();
        if (waiting) { this.panel?.clearResults(); this.panel?.setStatus('已停止等待搜索。页面文本仍会在本地自动更新。'); }
      },
      select: p => this.select(p), navigate: direction => this.navigate(direction),
      queryChanged: () => { this.submission++; this.pendingSearch = undefined; this.controller.cancel(); this.controller.run = undefined; this.highlight?.clear(); this.panel?.clearResults(); this.activeId = undefined; },
      preferencesChanged: () => this.configurationChanged() });
    this.highlight = new Highlighter();
    this.currentURL = location.href; this.routeTimer = setInterval(() => this.route(), 750);
    return this.panel;
  }
  private open(): void {
    const selection = captureSelection(), panel = this.ensurePanel();
    if (preferences().scope === 'selection' && selection) { this.reset(); this.selection = selection; }
    if (!readCredential()) { this.settings(); return; }
    this.inSettings = false; panel.showSearch(); this.route();
    if (preferences().sites[location.origin] === 'disabled') { panel.setStatus('本站已永久禁用检索，可在设置中恢复。'); return; }
    if (!this.snapshot && !this.extracting && !this.refreshTimer) void this.extract();
  }
  private reset(keepPending = false): void {
    this.submission++; this.extraction++; this.extracting?.abort(); this.extracting = undefined;
    clearTimeout(this.refreshTimer); this.refreshTimer = undefined;
    if (!keepPending) this.pendingSearch = undefined;
    this.observer.disconnect(); this.controller.clear(); this.snapshot = undefined; this.activeId = undefined;
    this.highlight?.clear(); this.panel?.clearResults(); this.panel?.clearSnapshot();
  }
  private settings(): void {
    this.inSettings = true; this.reset(); this.panel?.showSettings(this.credentials, this.client, () => this.open());
  }
  private configurationChanged(): void {
    this.refresh('配置已变化，旧任务已停止，正在自动重新提取。');
    if (!readCredential()) this.panel?.setStatus('请先在设置中配置 API Key。');
    else if (preferences().sites[location.origin] === 'disabled') this.panel?.setStatus('本站已永久禁用检索，可在设置中恢复。');
  }
  private close(): void {
    this.reset(); this.panel?.dispose(); this.panel = undefined; this.highlight?.dispose(); this.highlight = undefined;
    this.selection = undefined; clearInterval(this.routeTimer); this.routeTimer = undefined;
    if (this.focus?.isConnected) this.focus.focus({ preventScroll: true }); this.focus = undefined;
  }
  private route(): void {
    if (location.href === this.currentURL) return;
    this.currentURL = location.href; this.epoch++; this.selection = undefined;
    this.refresh('页面已导航，正在自动重新提取。');
  }
  private refresh(message: string, keepPending = false): void {
    this.reset(keepPending);
    if (!this.panel || this.inSettings) return;
    if (this.pendingSearch) this.panel.waitForExtraction(); else this.panel.setStatus(message);
    if (!readCredential() || preferences().sites[location.origin] === 'disabled') return;
    // Invalidate immediately, coalesce re-extraction. Refreshing locally never starts a new API search.
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.extract(); }, 250);
  }
  private invalidate(): void {
    this.refresh('页面内容已变化，旧结果已清除，正在自动重新提取。', true);
  }
  private async extract(): Promise<void> {
    this.reset(true);
    const panel = this.panel; if (!panel || this.inSettings) return;
    if (!readCredential()) { this.settings(); return; }
    const prefs = preferences();
    if (prefs.sites[location.origin] === 'disabled') { panel.setStatus('本站已永久禁用检索。'); return; }
    const generation = this.extraction, abort = new AbortController(); this.extracting = abort;
    if (this.pendingSearch) panel.waitForExtraction(); else panel.setStatus('正在本地提取页面文本；尚未发送任何文本…');
    // Guard mutations DURING asynchronous extraction as well as after it.
    this.observer.watch(document.body, () => this.invalidate(), prefs.scope);
    try {
      const snapshot = await extractSnapshot(prefs.scope, this.selection, this.epoch, ++this.revision, abort.signal);
      if (generation !== this.extraction || panel !== this.panel || abort.signal.aborted) return;
      this.snapshot = snapshot; panel.snapshot(snapshot); panel.clearResults();
      panel.setStatus(snapshot.passages.length ? '页面文本已在本地准备好。输入查询后按 Enter 即可搜索。' : '没有读到可搜索的文本；可在设置中调整范围，或先选中文字再打开搜索。');
      this.observer.watch(snapshot.root, () => this.invalidate(), prefs.scope);
      const pending = this.pendingSearch; this.pendingSearch = undefined;
      if (pending && pending.query === panel.query.value.trim() && pending.credentialId === readCredential()?.id) void this.search();
    } catch (error) { if (generation === this.extraction) { this.pendingSearch = undefined; panel.clearResults(); panel.setStatus(safeMessage(error)); } }
    finally { if (generation === this.extraction) this.extracting = undefined; }
  }
  private async search(): Promise<void> {
    this.route();
    const panel = this.panel; if (!panel || this.inSettings) return;
    const query = panel.query.value.trim(); if (!query) { panel.query.focus(); return; }
    const credentialId = readCredential()?.id; if (!credentialId) { this.settings(); return; }
    if (preferences().sites[location.origin] === 'disabled') return;
    if (!this.snapshot) {
      this.pendingSearch = { query, credentialId };
      if (!this.extracting && !this.refreshTimer) void this.extract();
      else panel.waitForExtraction();
      return;
    }
    if (!this.snapshot.passages.length) { panel.setStatus('没有可搜索的文本，请在设置中调整范围。'); return; }
    if (this.controller.run?.status === 'running' && this.controller.run.query === query && this.controller.run.snapshotId === this.snapshot.id) return;
    const submission = ++this.submission;
    try {
      const snapshot = fitSnapshot(this.snapshot, query); this.snapshot = snapshot; panel.snapshot(snapshot);
      const url = location.href;
      this.highlight?.clear(); this.activeId = undefined;
      await this.controller.start(snapshot, query, credentialId, () => this.snapshot === snapshot && this.panel === panel && this.submission === submission &&
        this.epoch === snapshot.pageEpoch && location.href === url && preferences().sites[location.origin] !== 'disabled');
    } catch (error) { if (this.panel === panel && this.submission === submission) panel.setStatus(safeMessage(error)); }
  }
  private render(run: SearchRun): void {
    const snapshot = this.snapshot; if (!snapshot || snapshot.id !== run.snapshotId || !this.panel) return;
    if (run.status === 'stale') { this.highlight?.clear(); this.panel.clearResults(); return; }
    this.panel.result(snapshot, run, this.activeId);
    const matches = snapshot.passages.filter(p => { const j = run.judgments.get(p.id); return j && classify(j.value) === 'match'; });
    this.highlight?.matches(matches); this.panel.navigation(matches.findIndex(p => p.id === this.activeId), matches.length);
  }
  private select(passage: LocalPassage): void {
    this.route();
    if (!this.snapshot?.passages.includes(passage) || !this.controller.run?.judgments.has(passage.id)) return;
    try {
      scrollToPassage(passage, preferences().scrollMargin); this.highlight?.active(passage); this.activeId = passage.id;
      this.render(this.controller.run);
      this.panel?.setStatus(`已定位：${passageLabel(passage)}。${this.highlight?.mode === 'css' ? '' : this.highlight?.mode === 'overlay' ? '当前使用单处覆盖高亮。' : '高亮不可用，已滚动到原文。'}`);
    } catch { this.invalidate(); }
  }
  private navigate(direction: number): void {
    if (!this.snapshot || !this.controller.run) return;
    const run = this.controller.run;
    const matches = this.snapshot.passages.filter(p => { const j = run.judgments.get(p.id); return j && classify(j.value) === 'match'; });
    if (!matches.length) return;
    const current = matches.findIndex(p => p.id === this.activeId);
    this.select(matches[(current < 0 ? direction > 0 ? 0 : matches.length - 1 : (current + direction + matches.length) % matches.length)]);
  }
}
if (window.top === window.self && ['http:', 'https:'].includes(location.protocol) && typeof GM_getValue === 'function') new SemanticFind();
