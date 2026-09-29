import type { LocalPassage, PageSnapshot, Scope, SearchRun } from '../../shared/types';
import { button, element } from '../../shared/utils';
import { OWN_ATTR } from '../extract/walker';
import { buildRequest } from '../typesafe/prompts';
import { Credentials } from '../settings/credentials';
import { TypeSafeClient } from '../typesafe/client';
import { sensitiveSite } from '../settings/preferences';
import { PANEL_CSS } from './styles';
import { ResultsView, resultStatus } from './results';
import { SettingsPanel } from './settings-panel';
export type PanelActions = {
  close(): void; settings(): void; search(): void; stop(): void; refresh(): void; scope(scope: Scope): void;
  select(passage: LocalPassage): void; navigate(direction: number): void; queryChanged(): void; preferencesChanged(): void;
};
export class Panel {
  readonly host = element('div'); readonly shadow: ShadowRoot;
  private box = element('section', undefined, 'panel'); private content = element('div', undefined, 'content');
  private searchView = element('div'); private settingsView?: SettingsPanel;
  readonly query = element('input'); private scope = element('select');
  private range = element('p', '', 'muted'); private status = element('p', '', 'status'); private live = element('p', '', 'sr-only');
  private limitations = element('p', '', 'muted'); private usage = element('p', '', 'muted');
  private stopButton: HTMLButtonElement; private continueButton: HTMLButtonElement;
  private previous: HTMLButtonElement; private next: HTMLButtonElement; private position = element('span', '0 / 0');
  private resultView: ResultsView; private consent = element('section', undefined, 'notice');
  private consentResolve?: (value: 'once' | 'remember' | false) => void;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private title = element('h2', '按意思查找'); private settingsButton: HTMLButtonElement;
  constructor(private actions: PanelActions, selection: boolean) {
    this.host.setAttribute(OWN_ATTR, 'panel'); this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = element('style', PANEL_CSS); this.shadow.append(style, this.box);
    this.box.setAttribute('role', 'dialog'); this.box.setAttribute('aria-label', '按意思查找');
    this.settingsButton = button('设置', actions.settings);
    const collapse = button('折叠', () => { const collapsed = this.box.classList.toggle('collapsed'); collapse.textContent = collapsed ? '展开' : '折叠'; collapse.setAttribute('aria-expanded', String(!collapsed)); });
    collapse.setAttribute('aria-expanded', 'true');
    const close = button('×', actions.close); close.setAttribute('aria-label', '关闭按意思查找');
    const header = element('header'); header.append(this.title, this.settingsButton, collapse, close); this.box.append(header, this.content);
    this.query.placeholder = '作者在哪里承认没有把握？'; this.query.maxLength = 2000; this.query.setAttribute('aria-label', '按意思查找的查询');
    this.query.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.isTrusted && !event.isComposing) { event.preventDefault(); event.stopPropagation(); actions.search(); }
    });
    this.query.addEventListener('input', () => { this.cancelConsent(); actions.queryChanged(); });
    const search = button('查找', actions.search); search.className = 'primary';
    const row = element('div', undefined, 'row'); row.append(this.query, search);
    for (const [value, text] of [['article', '当前正文'], ['selection', '仅查找选中内容'], ['loaded-page', '已加载页面文本']]) {
      const option = element('option', text); option.value = value; option.disabled = value === 'selection' && !selection; this.scope.append(option);
    }
    this.scope.setAttribute('aria-label', '检索范围');
    this.scope.addEventListener('change', event => { if (event.isTrusted) { this.cancelConsent(); actions.scope(this.scope.value as Scope); } });
    this.stopButton = button('停止检索', actions.stop); this.stopButton.hidden = true;
    this.continueButton = button('继续检查未完成部分', actions.search); this.continueButton.hidden = true;
    const controls = element('div', undefined, 'row'); controls.append(button('重新提取', actions.refresh), this.stopButton, this.continueButton);
    this.resultView = new ResultsView(actions.select); this.resultView.clear();
    this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.consent.hidden = true;
    this.searchView.append(row, this.scope, this.range, controls, this.status, this.consent, this.resultView.node, this.live, this.usage, this.limitations);
    this.previous = button('上一处', () => actions.navigate(-1)); this.next = button('下一处', () => actions.navigate(1));
    this.previous.disabled = this.next.disabled = true;
    const nav = element('div', undefined, 'row'); nav.append(this.previous, this.next, this.position); this.searchView.append(nav);
    this.content.append(this.searchView); document.documentElement.append(this.host);
  }
  setScope(scope: Scope): void { this.scope.value = scope; }
  setStatus(text: string): void {
    this.status.textContent = text;
    clearTimeout(this.liveTimer); this.liveTimer = setTimeout(() => { this.live.textContent = text; }, 300);
  }
  snapshot(snapshot: PageSnapshot): void {
    this.range.textContent = `范围：${{ article: '当前正文', selection: '选中内容', 'loaded-page': '已加载页面文本' }[snapshot.scope]} · ${snapshot.passages.length} 段`;
    this.limitations.textContent = snapshot.limitations.join(' ');
  }
  result(snapshot: PageSnapshot, run: SearchRun, activeId?: string): void {
    this.setStatus(resultStatus(run)); this.resultView.update(snapshot, run, activeId);
    this.stopButton.hidden = run.status !== 'running';
    this.continueButton.hidden = !['partial', 'cancelled'].includes(run.status) || run.completed === run.total;
    this.usage.textContent = `已知调用 ${run.requests} 次，重试 ${run.retries} 次，输入 ${run.usage.input_tokens} tokens。超时、取消仍可能计费，用量不等于完整账单。`;
  }
  navigation(index: number, total: number): void { this.previous.disabled = this.next.disabled = !total; this.position.textContent = `${index + 1} / ${total}`; }
  clearResults(): void { this.resultView.clear(); this.navigation(-1, 0); this.usage.textContent = ''; this.stopButton.hidden = this.continueButton.hidden = true; }
  showSearch(): void { this.settingsView?.dispose(); this.settingsView = undefined; this.searchView.hidden = false; this.title.textContent = '按意思查找'; this.settingsButton.hidden = false; this.query.focus(); }
  showSettings(credentials: Credentials, client: TypeSafeClient, back: () => void): void {
    this.cancelConsent(); this.settingsView?.dispose(); this.searchView.hidden = true; this.title.textContent = '设置 API Key'; this.settingsButton.hidden = true;
    this.settingsView = new SettingsPanel(credentials, client, back, this.actions.preferencesChanged); this.content.append(this.settingsView.node);
    this.settingsView.node.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
  }
  askConsent(snapshot: PageSnapshot, query: string, count: number): Promise<'once' | 'remember' | false> {
    this.cancelConsent(); this.consent.replaceChildren(); this.consent.hidden = false;
    this.consent.append(element('h3', '确认发送范围'), element('p', `本次将把 ${snapshot.passages.length} 段原文、标题及邻文和查询直接发送给 TypeSafe，使用你的 API Key。预计 ${count} 批（UTF-8 预算估算）。不发送网页表单值、Cookie 或页面 URL。`),
      element('p', '请勿发送未经授权的私密资料。内部系统、邮箱、聊天或银行页面建议每次确认，或在设置中永久禁用。', 'warning'));
    const preview = element('details'); preview.append(element('summary', '查看将发送的全部正文与上下文'));
    // Only allowlisted state fields, exactly as in requests; never local IDs, nodes, or credentials.
    const targets = Object.assign({}, ...snapshot.passages.map(p => buildRequest(query, [p]).state.targets));
    preview.append(element('pre', JSON.stringify({ query, targets }, null, 2))); this.consent.append(preview);
    const remember = element('input'); remember.type = 'checkbox'; remember.disabled = sensitiveSite();
    const label = element('label'); label.append(remember, document.createTextNode(remember.disabled ? ' 敏感环境：仍将每次确认' : ' 记住此站点的主动检索授权'));
    const finish = (value: 'once' | 'remember' | false) => { const resolve = this.consentResolve; this.consentResolve = undefined; this.consent.hidden = true; this.consent.replaceChildren(); resolve?.(value); };
    const actions = element('div', undefined, 'row'); actions.append(button('确认发送', () => finish(remember.checked && !remember.disabled ? 'remember' : 'once')), button('取消', () => finish(false)));
    this.consent.append(label, actions); return new Promise(resolve => { this.consentResolve = resolve; });
  }
  cancelConsent(): void { this.consentResolve?.(false); this.consentResolve = undefined; this.consent.hidden = true; this.consent.replaceChildren(); }
  dispose(): void { clearTimeout(this.liveTimer); this.cancelConsent(); this.settingsView?.dispose(); this.resultView.clear(); this.query.value = ''; this.host.remove(); }
}
