import type { LocalPassage, PageSnapshot, SearchRun } from '../../shared/types';
import { button, element } from '../../shared/utils';
import { OWN_ATTR } from '../extract/walker';
import { Credentials } from '../settings/credentials';
import { TypeSafeClient } from '../typesafe/client';
import { SCOPE_LABELS } from '../settings/preferences';
import { PANEL_CSS } from './styles';
import { ResultsView, resultStatus } from './results';
import { SettingsPanel } from './settings-panel';
export type PanelActions = {
  close(): void; settings(): void; search(): void; stop(): void;
  select(passage: LocalPassage): void; navigate(direction: number): void; queryChanged(): void; preferencesChanged(): void;
};
export class Panel {
  readonly host = element('div'); readonly shadow: ShadowRoot;
  private box = element('section', undefined, 'panel'); private content = element('div', undefined, 'content');
  private searchView = element('div'); private settingsView?: SettingsPanel;
  readonly query = element('input');
  private range = element('p', '', 'muted'); private status = element('p', '', 'status'); private live = element('p', '', 'sr-only');
  private limitations = element('p', '', 'muted'); private usage = element('p', '', 'muted'); private context = element('p', '', 'muted');
  private stopButton: HTMLButtonElement; private continueButton: HTMLButtonElement;
  private previous: HTMLButtonElement; private next: HTMLButtonElement; private position = element('span', '0 / 0');
  private resultView: ResultsView;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private title = element('h2', '按意思查找'); private settingsButton: HTMLButtonElement;
  constructor(private actions: PanelActions) {
    this.host.setAttribute(OWN_ATTR, 'panel'); this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = element('style', PANEL_CSS); this.shadow.append(style, this.box);
    this.box.setAttribute('role', 'dialog'); this.box.setAttribute('aria-label', '按意思查找');
    this.settingsButton = button('设置', actions.settings);
    const collapse = button('折叠', () => { const collapsed = this.box.classList.toggle('collapsed'); collapse.textContent = collapsed ? '展开' : '折叠'; collapse.setAttribute('aria-expanded', String(!collapsed)); });
    collapse.setAttribute('aria-expanded', 'true');
    const close = button('×', actions.close); close.setAttribute('aria-label', '关闭按意思查找');
    const header = element('header'); header.append(this.title, this.settingsButton, collapse, close); this.box.append(header, this.content);
    this.query.placeholder = '例如：Python 的用法'; this.query.maxLength = 2000; this.query.setAttribute('aria-label', '按意思查找的查询');
    this.query.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.isTrusted && !event.isComposing) { event.preventDefault(); event.stopPropagation(); actions.search(); }
    });
    this.query.addEventListener('input', actions.queryChanged);
    const search = button('查找', actions.search); search.className = 'primary';
    const row = element('div', undefined, 'row'); row.append(this.query, search);
    this.stopButton = button('停止检索', actions.stop); this.stopButton.hidden = true;
    this.continueButton = button('继续检查未完成部分', actions.search); this.continueButton.hidden = true;
    const controls = element('div', undefined, 'row'); controls.append(this.stopButton, this.continueButton);
    this.resultView = new ResultsView(actions.select); this.resultView.clear();
    this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.searchView.append(row, this.range, element('p', '按 Enter 直接搜索，查询与范围内文本将发送给 TypeSafe。范围可在设置中修改。', 'muted'), controls, this.status, this.context, this.resultView.node, this.live, this.usage, this.limitations);
    this.previous = button('上一处', () => actions.navigate(-1)); this.next = button('下一处', () => actions.navigate(1));
    this.previous.disabled = this.next.disabled = true;
    const nav = element('div', undefined, 'row'); nav.append(this.previous, this.next, this.position); this.searchView.append(nav);
    this.content.append(this.searchView); document.documentElement.append(this.host);
  }
  setStatus(text: string): void {
    this.status.textContent = text;
    clearTimeout(this.liveTimer); this.liveTimer = setTimeout(() => { this.live.textContent = text; }, 300);
  }
  waitForExtraction(): void { this.setStatus('正在自动提取最新文本，完成后开始搜索…'); this.stopButton.hidden = false; this.continueButton.hidden = true; }
  snapshot(snapshot: PageSnapshot): void {
    this.range.textContent = `范围：${SCOPE_LABELS[snapshot.scope]} · ${snapshot.passages.length} 个片段`;
    this.limitations.textContent = snapshot.limitations.join(' ');
  }
  clearSnapshot(): void { this.range.textContent = ''; this.limitations.textContent = ''; }
  result(snapshot: PageSnapshot, run: SearchRun, activeId?: string): void {
    this.setStatus(resultStatus(run)); this.resultView.update(snapshot, run, activeId);
    this.stopButton.hidden = run.status !== 'running';
    this.continueButton.hidden = !['partial', 'cancelled'].includes(run.status) || run.completed === run.total;
    this.context.textContent = run.windowed ? '页面超出单次上下文预算，已分窗覆盖全部片段；跨窗口的远距离上下文可能缺失。' : '每批候选均使用检索范围内的完整文本作为共享上下文。';
    this.usage.textContent = `已知调用 ${run.requests} 次，重试 ${run.retries} 次，输入 ${run.usage.input_tokens} tokens。超时、取消仍可能计费，用量不等于完整账单。`;
  }
  navigation(index: number, total: number): void { this.previous.disabled = this.next.disabled = !total; this.position.textContent = `${index + 1} / ${total}`; }
  clearResults(): void { this.resultView.clear(); this.navigation(-1, 0); this.usage.textContent = this.context.textContent = ''; this.stopButton.hidden = this.continueButton.hidden = true; }
  showSearch(): void { this.settingsView?.dispose(); this.settingsView = undefined; this.searchView.hidden = false; this.title.textContent = '按意思查找'; this.settingsButton.hidden = false; this.query.focus(); }
  showSettings(credentials: Credentials, client: TypeSafeClient, back: () => void): void {
    this.settingsView?.dispose(); this.searchView.hidden = true; this.title.textContent = '设置'; this.settingsButton.hidden = true;
    this.settingsView = new SettingsPanel(credentials, client, back, this.actions.preferencesChanged); this.content.append(this.settingsView.node);
    this.settingsView.node.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }
  dispose(): void { clearTimeout(this.liveTimer); this.settingsView?.dispose(); this.resultView.clear(); this.query.value = ''; this.host.remove(); }
}
