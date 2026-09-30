import type { LocalPassage, PageSnapshot, SearchRun } from '../shared/types';
import { safeMessage } from '../shared/errors';
import { Credentials, readCredential } from './settings/credentials';
import { preferences, SETTINGS_KEY, siteMode } from './settings/preferences';
import { captureSelection } from './extract/scope';
import { extractSnapshot } from './extract/passages';
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
  private epoch = 0; private revision = 0; private submission = 0;
  private extracting?: { query: string; abort: AbortController };
  private inSettings = false;
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
    this.panel = new Panel({ close: () => this.close(), settings: () => this.settings(), search: () => void this.search(), resume: () => void this.search(true),
      stop: () => {
        const waiting = !!this.extracting;
        this.cancelSubmission(); this.controller.cancel();
        if (waiting) { this.panel?.clearResults(); this.panel?.setStatus('已停止提取和搜索。再次查找时会读取最新页面文本。'); }
      },
      select: p => this.select(p), navigate: direction => this.navigate(direction),
      queryChanged: () => this.configurationChanged(),
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
    if (!this.snapshot && !this.extracting) panel.ready(preferences().scope);
  }
  private cancelSubmission(): void {
    this.submission++; this.extracting?.abort.abort(); this.extracting = undefined;
  }
  private reset(): void {
    this.cancelSubmission(); this.controller.clear(); this.snapshot = undefined; this.activeId = undefined;
    this.highlight?.clear(); this.panel?.clearResults(); this.panel?.clearSnapshot();
  }
  private settings(): void {
    this.inSettings = true; this.reset(); this.panel?.showSettings(this.credentials, this.client, () => this.open());
  }
  private configurationChanged(): void {
    this.reset();
    if (!readCredential()) this.panel?.setStatus('请先在设置中配置 API Key。');
    else if (preferences().sites[location.origin] === 'disabled') this.panel?.setStatus('本站已永久禁用检索，可在设置中恢复。');
    else if (!this.inSettings) this.panel?.ready(preferences().scope);
  }
  private close(): void {
    this.reset(); this.panel?.dispose(); this.panel = undefined; this.highlight?.dispose(); this.highlight = undefined;
    this.selection = undefined; clearInterval(this.routeTimer); this.routeTimer = undefined;
    if (this.focus?.isConnected) this.focus.focus({ preventScroll: true }); this.focus = undefined;
  }
  private route(): void {
    if (location.href === this.currentURL) return;
    this.currentURL = location.href; this.epoch++; this.selection = undefined;
    this.reset();
    if (this.panel && !this.inSettings) {
      this.panel.ready(preferences().scope); this.panel.setStatus('页面已导航，请重新搜索以读取最新文本。');
    }
  }
  private async search(resume = false): Promise<void> {
    this.route();
    const panel = this.panel; if (!panel || this.inSettings) return;
    const query = panel.query.value.trim(); if (!query) { panel.query.focus(); return; }
    const credentialId = readCredential()?.id; if (!credentialId) { this.settings(); return; }
    const prefs = preferences(); if (prefs.sites[location.origin] === 'disabled') return;
    const run = this.controller.run;
    if (this.extracting?.query === query || run?.status === 'running' && run.query === query) return;
    if (resume) {
      if (!this.snapshot || !run || run.snapshotId !== this.snapshot.id || run.query !== query || run.credentialId !== credentialId ||
        !['partial', 'cancelled'].includes(run.status)) return;
    } else this.reset();
    const submission = ++this.submission, epoch = this.epoch, url = location.href;
    const valid = () => this.panel === panel && this.submission === submission && !this.inSettings && this.epoch === epoch &&
      location.href === url && readCredential()?.id === credentialId && preferences().sites[location.origin] !== 'disabled';
    try {
      let snapshot = this.snapshot;
      if (!resume) {
        const abort = new AbortController(); this.extracting = { query, abort }; panel.waitForExtraction();
        // One bounded extraction per explicit search. DOM changes never cancel or refresh this run.
        snapshot = await extractSnapshot(prefs.scope, this.selection, epoch, ++this.revision, abort.signal);
        if (!valid() || abort.signal.aborted) return;
        this.extracting = undefined;
        snapshot = fitSnapshot(snapshot, query); this.snapshot = snapshot; panel.snapshot(snapshot); panel.clearResults();
      }
      if (!snapshot?.passages.length) { panel.setStatus('没有可搜索的文本，请在设置中调整范围。'); return; }
      await this.controller.start(snapshot, query, credentialId, () => valid() && this.snapshot === snapshot);
    } catch (error) {
      if (valid()) { if (!resume) panel.clearResults(); panel.setStatus(safeMessage(error)); }
    } finally { if (this.submission === submission) this.extracting = undefined; }
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
    } catch {
      this.highlight?.clearActive(); this.activeId = passage.id; this.render(this.controller.run);
      this.panel?.setStatus('该片段的原文已变化，暂时无法定位；搜索结果已保留。重新搜索可读取最新文本。');
    }
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
