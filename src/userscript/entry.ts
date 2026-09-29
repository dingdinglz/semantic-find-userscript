import type { LocalPassage, PageSnapshot, Scope, SearchRun } from '../shared/types';
import { safeMessage } from '../shared/errors';
import { Credentials, readCredential } from './settings/credentials';
import { preferences, SETTINGS_KEY, sensitiveSite, siteMode } from './settings/preferences';
import { captureSelection } from './extract/scope';
import { extractSnapshot } from './extract/passages';
import { ContentObserver } from './extract/observe';
import { scrollToPassage } from './extract/anchors';
import { TypeSafeClient } from './typesafe/client';
import { SearchController } from './search/controller';
import { batches, fitSnapshot } from './search/batcher';
import { Highlighter } from './highlight/css-highlight';
import { Panel } from './ui/panel';
import { classify } from './ui/results';
import { editablePath, matchesShortcut } from './ui/keyboard';
class SemanticFind {
  private credentials = new Credentials();
  private client = new TypeSafeClient();
  private controller = new SearchController(this.client, run => this.render(run));
  private panel?: Panel; private highlight?: Highlighter;
  private snapshot?: PageSnapshot; private selection?: Range; private focus?: HTMLElement;
  private scope: Scope = 'article'; private epoch = 0; private revision = 0; private extraction = 0; private submission = 0;
  private extracting?: AbortController; private observer = new ContentObserver();
  private activeId?: string; private currentURL = location.href; private routeTimer?: ReturnType<typeof setInterval>;
  constructor() {
    GM_registerMenuCommand('按意思查找', () => this.open());
    GM_registerMenuCommand('设置 API Key', () => { this.ensurePanel(); this.settings(); });
    GM_registerMenuCommand('禁用 / 启用本站检索', () => {
      const disabled = preferences().sites[location.origin] === 'disabled';
      if (confirm(disabled ? '恢复本站检索（每次发送前确认）？' : '永久禁用本站检索？可从此菜单恢复。')) { siteMode(disabled ? 'ask' : 'disabled'); this.configurationChanged(); }
    });
    this.credentials.subscribe(() => this.configurationChanged());
    GM_addValueChangeListener(SETTINGS_KEY, (_key, _oldValue, _newValue, remote) => {
      // Remembering an explicitly approved local send must not invalidate that consent.
      // Settings-panel edits call configurationChanged themselves; remote edits always cancel.
      if (remote || preferences().sites[location.origin] !== 'allow') this.configurationChanged();
    });
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
    this.selection = captureSelection(); this.scope = this.selection ? 'selection' : 'article';
    this.panel = new Panel({ close: () => this.close(), settings: () => this.settings(), search: () => void this.search(), stop: () => { this.submission++; this.panel?.cancelConsent(); this.controller.cancel(); },
      refresh: () => void this.extract(), scope: scope => { this.scope = scope; void this.extract(); },
      select: p => this.select(p), navigate: direction => this.navigate(direction),
      queryChanged: () => { this.submission++; this.controller.cancel(); this.controller.run = undefined; this.highlight?.clear(); this.panel?.clearResults(); this.activeId = undefined; },
      preferencesChanged: () => this.configurationChanged() }, !!this.selection);
    this.panel.setScope(this.scope); this.highlight = new Highlighter();
    this.currentURL = location.href; this.routeTimer = setInterval(() => this.route(), 750);
    return this.panel;
  }
  private open(): void {
    const panel = this.ensurePanel();
    if (!readCredential()) { this.settings(); return; }
    panel.showSearch();
    if (preferences().sites[location.origin] === 'disabled') { panel.setStatus('本站已永久禁用检索，可在设置中恢复。'); return; }
    if (!this.snapshot) void this.extract();
  }
  private reset(): void {
    this.submission++; this.extraction++; this.extracting?.abort(); this.extracting = undefined;
    this.observer.disconnect(); this.controller.clear(); this.snapshot = undefined; this.activeId = undefined;
    this.highlight?.clear(); this.panel?.cancelConsent(); this.panel?.clearResults();
  }
  private settings(): void {
    this.reset(); this.panel?.showSettings(this.credentials, this.client, () => this.open());
  }
  private configurationChanged(): void {
    this.reset(); this.panel?.setStatus('配置已变化，旧任务已停止。请重新提取正文后主动提交查询。');
  }
  private close(): void {
    this.reset(); this.panel?.dispose(); this.panel = undefined; this.highlight?.dispose(); this.highlight = undefined;
    this.selection = undefined; clearInterval(this.routeTimer); this.routeTimer = undefined;
    if (this.focus?.isConnected) this.focus.focus({ preventScroll: true }); this.focus = undefined;
  }
  private route(): void {
    if (location.href === this.currentURL) return;
    this.currentURL = location.href; this.epoch++; this.reset(); this.selection = undefined;
    this.panel?.setStatus('页面已导航，请重新提取并搜索。');
  }
  private invalidate(added: boolean): void {
    this.controller.cancel('stale'); this.reset();
    this.panel?.setStatus(added ? '页面有新增或替换内容，旧结果已失效；重新提取后才能纳入检索。' : '页面内容已变化，旧结果已停止定位，请重新搜索。');
  }
  private async extract(): Promise<void> {
    this.reset();
    const panel = this.panel; if (!panel) return;
    if (!readCredential()) { this.settings(); return; }
    if (preferences().sites[location.origin] === 'disabled') { panel.setStatus('本站已永久禁用检索。'); return; }
    const generation = this.extraction, abort = new AbortController(); this.extracting = abort;
    panel.setStatus('正在本地提取正文；尚未发送任何文本…');
    // Guard mutations DURING asynchronous extraction as well as after it.
    this.observer.watch(document.body, added => this.invalidate(added));
    try {
      const snapshot = await extractSnapshot(this.scope, this.selection, this.epoch, ++this.revision, abort.signal);
      if (generation !== this.extraction || panel !== this.panel || abort.signal.aborted) return;
      this.snapshot = snapshot; panel.snapshot(snapshot);
      panel.setStatus(snapshot.passages.length ? '正文已在本地准备好。输入查询后按 Enter，才会请求发送授权。' : '没有读到可搜索的正文；图片、Canvas、PDF 不受支持，请尝试选中一段文字。');
      this.observer.watch(snapshot.root, added => this.invalidate(added));
    } catch (error) { if (generation === this.extraction) { panel.setStatus(safeMessage(error)); this.observer.disconnect(); } }
    finally { if (generation === this.extraction) this.extracting = undefined; }
  }
  private async search(): Promise<void> {
    const panel = this.panel; if (!panel) return;
    const query = panel.query.value.trim(); if (!query) { panel.query.focus(); return; }
    const credentialId = readCredential()?.id; if (!credentialId) { this.settings(); return; }
    if (!this.snapshot || !this.snapshot.passages.length) { panel.setStatus('请先重新提取可读取的正文，再提交查询。'); return; }
    if (preferences().sites[location.origin] === 'disabled') return;
    if (this.controller.run?.status === 'running' && this.controller.run.query === query && this.controller.run.snapshotId === this.snapshot.id) return;
    const submission = ++this.submission;
    try {
      const snapshot = fitSnapshot(this.snapshot, query); this.snapshot = snapshot; panel.snapshot(snapshot);
      const count = batches(query, snapshot.passages).length;
      // A continuation is an explicit action, with the same original authorization and snapshot.
      const continuing = this.controller.run?.snapshotId === snapshot.id && this.controller.run.query === query && this.controller.run.credentialId === credentialId;
      if (!continuing && (preferences().sites[location.origin] !== 'allow' || sensitiveSite() || snapshot.passages.length > 200)) {
        const decision = await panel.askConsent(snapshot, query, count);
        if (!decision || submission !== this.submission || this.snapshot !== snapshot || this.panel !== panel || credentialId !== readCredential()?.id || query !== panel.query.value.trim()) return;
        if (decision === 'remember') {
          siteMode('allow');
        }
      }
      if (this.snapshot !== snapshot || this.panel !== panel || query !== panel.query.value.trim() || readCredential()?.id !== credentialId) return;
      const token = this.submission, url = location.href;
      this.highlight?.clear(); this.activeId = undefined;
      await this.controller.start(snapshot, query, credentialId, () => this.snapshot === snapshot && this.panel === panel && this.submission === token &&
        this.epoch === snapshot.pageEpoch && location.href === url && preferences().sites[location.origin] !== 'disabled');
    } catch (error) { if (this.panel === panel) panel.setStatus(safeMessage(error)); }
  }
  private render(run: SearchRun): void {
    const snapshot = this.snapshot; if (!snapshot || snapshot.id !== run.snapshotId || !this.panel) return;
    if (run.status === 'stale') { this.highlight?.clear(); this.panel.clearResults(); return; }
    this.panel.result(snapshot, run, this.activeId);
    const matches = snapshot.passages.filter(p => { const j = run.judgments.get(p.id); return j && classify(j.value) === 'match'; });
    this.highlight?.matches(matches); this.panel.navigation(matches.findIndex(p => p.id === this.activeId), matches.length);
  }
  private select(passage: LocalPassage): void {
    if (!this.snapshot?.passages.includes(passage) || !this.controller.run?.judgments.has(passage.id)) return;
    try {
      scrollToPassage(passage, preferences().scrollMargin); this.highlight?.active(passage); this.activeId = passage.id;
      this.render(this.controller.run);
      this.panel?.setStatus(`已定位：${passage.headingPath.join(' / ') || '正文'}。${this.highlight?.mode === 'css' ? '' : this.highlight?.mode === 'overlay' ? '当前使用单处覆盖高亮。' : '高亮不可用，已滚动到原文。'}`);
    } catch { this.invalidate(false); }
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
