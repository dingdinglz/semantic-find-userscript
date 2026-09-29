import { beforeEach, describe, expect, it } from 'vitest';
import { ResultsView } from '../../src/userscript/ui/results';
import type { SearchRun } from '../../src/shared/types';
import { snapshot } from './helpers';
beforeEach(() => { document.body.replaceChildren(); });
describe('candidate probability display and ordering', () => {
  it('sorts uncertain results descending before pagination, with page-order ties and original anchors', () => {
    const snap = snapshot(45), view = new ResultsView(() => {});
    const run = { runId: 'run', judgments: new Map(snap.passages.map((p, i) => [p.id, { id: p.id, value: i === 44 ? 0.79 : 0.3, model: 'jev-1.13.0' }])) } as SearchRun;
    document.body.append(view.node); view.update(snap, run, 'b00045');
    const entries = [...view.node.querySelectorAll<HTMLElement>('.uncertain')];
    expect(entries).toHaveLength(40);
    expect(entries.slice(0, 3).map(li => li.dataset.passageId)).toEqual(['b00045', 'b00001', 'b00002']);
    expect(entries[0].querySelector('.probability')?.textContent).toBe('匹配概率 79%');
    expect(entries[0].querySelector('button')?.getAttribute('aria-current')).toBe('true');
    expect(view.node.querySelector('details')!.open).toBe(true);
    const focused = entries[2].querySelector('button')!; focused.focus();
    run.judgments.get('b00002')!.value = 0.7; view.update(snap, run);
    expect((document.activeElement as HTMLElement).dataset.passageId).toBe('b00002');
    expect(view.node.querySelectorAll<HTMLElement>('.uncertain')[1].dataset.passageId).toBe('b00002');
  });
  it('keeps matches in document order and labels sidebar locations', () => {
    const snap = snapshot(3), view = new ResultsView(() => {});
    snap.passages[0].region = 'sidebar'; snap.passages[0].kind = 'link';
    const run = { runId: 'run', judgments: new Map(snap.passages.map((p, i) => [p.id, { id: p.id, value: [0.85, 0.95, 0.2][i], model: 'jev-1.13.0' }])) } as SearchRun;
    view.update(snap, run);
    expect([...view.node.querySelectorAll<HTMLElement>('.result')].map(li => li.dataset.passageId)).toEqual(['b00001', 'b00002']);
    expect(view.node.querySelector('.heading')?.textContent).toContain('侧边栏');
    view.clear(); expect(view.node.querySelectorAll('.result')).toHaveLength(0);
  });
});
