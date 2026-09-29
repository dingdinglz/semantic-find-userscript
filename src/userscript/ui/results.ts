import type { LocalPassage, PageSnapshot, SearchRun } from '../../shared/types';
import { button, element, safeEnd } from '../../shared/utils';
export function classify(value: number): 'match' | 'uncertain' | 'no' { return value >= 0.8 ? 'match' : value > 0.2 ? 'uncertain' : 'no'; }
export function resultStatus(run: SearchRun): string {
  if (run.status === 'stale') return '页面内容已变化，旧结果已停止定位，请重新搜索。';
  if (run.status === 'cancelled') return `已停止，仅检查了 ${run.completed} / ${run.total} 段。`;
  if (run.status === 'running') return `已检查 ${run.completed} / ${run.total} 段`;
  if (run.status === 'partial' || run.completed !== run.total || run.failed > 0 || run.total === 0) return `检索未完成，已检查 ${run.completed} / ${run.total} 段。${run.error ?? '可继续检查。'}`;
  const values = [...run.judgments.values()]; const matches = values.filter(j => classify(j.value) === 'match').length;
  const uncertain = values.filter(j => classify(j.value) === 'uncertain').length;
  if (matches) return `找到 ${matches} 处匹配，已检查全部 ${run.total} 段。${uncertain ? `另有 ${uncertain} 处待确认。` : ''}`;
  if (uncertain) return `没有确定匹配，有 ${uncertain} 处待确认片段。`;
  return '在本次检索范围内没有找到匹配片段。';
}
export class ResultsView {
  readonly node = element('div');
  private matches = element('ol', undefined, 'results');
  private uncertain = element('details');
  private summary = element('summary');
  private unsureList = element('ol', undefined, 'results');
  private more = button('显示更多片段', () => { this.limit += 40; this.render(); });
  private limit = 40;
  private snapshot?: PageSnapshot; private run?: SearchRun; private activeId?: string;
  constructor(private select: (p: LocalPassage) => void) { this.uncertain.append(this.summary, this.unsureList); this.node.append(this.matches, this.uncertain, this.more); }
  update(snapshot: PageSnapshot, run: SearchRun, activeId?: string): void {
    if (this.run?.runId !== run.runId) this.limit = 40;
    this.snapshot = snapshot; this.run = run; this.activeId = activeId; this.render();
  }
  clear(): void { this.snapshot = undefined; this.run = undefined; this.matches.replaceChildren(); this.unsureList.replaceChildren(); this.uncertain.hidden = this.more.hidden = true; }
  private render(): void {
    if (!this.snapshot || !this.run) return;
    const root = this.node.getRootNode() as ShadowRoot | Document;
    const focused = root.activeElement instanceof HTMLElement && this.node.contains(root.activeElement) ? root.activeElement.dataset.passageId : undefined;
    const expanded = new Set([...this.node.querySelectorAll('li details[open]')].map(d => (d.parentElement as HTMLElement).dataset.passageId));
    const matched: LocalPassage[] = [], unsure: LocalPassage[] = [];
    for (const p of this.snapshot.passages) {
      const j = this.run.judgments.get(p.id); if (!j) continue;
      if (classify(j.value) === 'match') matched.push(p); else if (classify(j.value) === 'uncertain') unsure.push(p);
    }
    const render = (p: LocalPassage, i: number, uncertain: boolean) => {
      const li = element('li', undefined, `result${uncertain ? ' uncertain' : ''}`);
      li.dataset.passageId = p.id;
      const jump = button('', () => this.select(p)); jump.dataset.passageId = p.id; jump.setAttribute('aria-current', String(this.activeId === p.id));
      jump.append(element('span', `${uncertain ? '待确认' : '匹配'} ${i + 1} · ${p.headingPath.join(' / ') || '正文'}`, 'heading'), element('span', p.text.length > 260 ? p.text.slice(0, safeEnd(p.text, 260)) + '…' : p.text, 'quote'));
      li.append(jump);
      if (p.text.length > 260) { const details = element('details'); details.open = expanded.has(p.id); details.append(element('summary', '完整原文'), element('div', p.text, 'full')); li.append(details); }
      return li;
    };
    this.matches.replaceChildren(...matched.slice(0, this.limit).map((p, i) => render(p, i, false)));
    this.unsureList.replaceChildren(...unsure.slice(0, this.limit).map((p, i) => render(p, i, true)));
    this.summary.textContent = `待确认片段（${unsure.length}）`; this.uncertain.hidden = !unsure.length;
    this.more.hidden = matched.length <= this.limit && unsure.length <= this.limit;
    if (focused) [...this.node.querySelectorAll<HTMLButtonElement>('button[data-passage-id]')].find(b => b.dataset.passageId === focused)?.focus({ preventScroll: true });
  }
}
