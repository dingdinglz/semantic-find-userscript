import type { LocalPassage, PageSnapshot } from '../../shared/types';
import { FindError } from '../../shared/errors';
import { buildRequest } from '../typesafe/prompts';
import { sliceBlock } from '../extract/passages';
import { context, hash, normalize, safeEnd, uid } from '../../shared/utils';
// Jev 1.13: 32k state + longest question, 64k total. UTF-8 bytes are a
// conservative upper bound, not a chars/4 token estimate (especially for CJK).
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const STATE_BUDGET = 30000, TOTAL_BUDGET = 60000;
export type SearchBatch = { passages: LocalPassage[]; context: LocalPassage[] };
export function requestBudget(query: string, passages: LocalPassage[], context: LocalPassage[] = passages): { longest: number; total: number } {
  const request = buildRequest(query, passages, context), state = bytes(request.state);
  return { longest: state + Math.max(...Object.values(request.questions).map(bytes)) + 256, total: bytes(request) + 256 };
}
export function fits(query: string, passages: LocalPassage[], context: LocalPassage[] = passages): boolean {
  if (!passages.length || passages.length > 16) return false;
  const budget = requestBudget(query, passages, context); return budget.longest <= STATE_BUDGET && budget.total <= TOTAL_BUDGET;
}
export function bisect(passage: LocalPassage): LocalPassage[] {
  if (passage.text.length < 2) throw new FindError('length');
  const middle = safeEnd(passage.text, Math.ceil(passage.text.length / 2));
  if (!middle) throw new FindError('length');
  return [[0, middle], [middle, passage.text.length]].map(([start, end], i) => {
    const block = sliceBlock(passage, start, end);
    return { ...passage, ...block, normalizedText: normalize(block.text), textHash: hash(block.text),
      before: i === 0 ? passage.before : context(passage.text.slice(0, start), true),
      after: i === 1 ? passage.after : context(passage.text.slice(end)) };
  });
}
export function fitSnapshot(snapshot: PageSnapshot, query: string): PageSnapshot {
  let changed = false;
  const fitOne = (p: LocalPassage): LocalPassage[] => {
    if (fits(query, [p])) return [p];
    changed = true;
    if (p.text.length < 80) throw new FindError('length');
    return bisect(p).flatMap(fitOne);
  };
  const passages = snapshot.passages.flatMap(fitOne).map((p, i) => ({ ...p, order: i, id: `b${String(i + 1).padStart(5, '0')}` }));
  if (!changed) return snapshot;
  return { ...snapshot, passages, id: uid(), revision: snapshot.revision + 1, digest: hash(JSON.stringify(passages.map(p => [p.text, p.headingPath, p.kind, p.region]))) };
}
export function batches(query: string, passages: LocalPassage[]): SearchBatch[] {
  if (!passages.length) return [];
  const windows: { start: number; end: number }[] = [];
  // Prefer the ENTIRE scope, even when candidate questions need several requests.
  if (fits(query, [passages.at(-1)!], passages)) windows.push({ start: 0, end: passages.length });
  else {
    let start = 0;
    while (start < passages.length) {
      if (!fits(query, [passages[start]])) throw new FindError('length');
      let end = start + 1;
      // Reserve space for overlapping context at window boundaries.
      while (end < passages.length && requestBudget(query, [passages[end]], passages.slice(start, end + 1)).longest <= STATE_BUDGET - 4000) end++;
      windows.push({ start, end }); start = end;
    }
  }
  const result: SearchBatch[] = [];
  for (const window of windows) {
    let { start, end } = window;
    for (let i = 0; i < 2; i++) {
      if (start > 0 && fits(query, [passages[window.end - 1]], passages.slice(start - 1, end))) start--;
      if (end < passages.length && fits(query, [passages[window.end - 1]], passages.slice(start, end + 1))) end++;
    }
    const context = passages.slice(start, end); let current: LocalPassage[] = [];
    for (const passage of passages.slice(window.start, window.end)) {
      if (current.length && !fits(query, [...current, passage], context)) { result.push({ passages: current, context }); current = []; }
      if (!fits(query, [passage], context)) throw new FindError('length');
      current.push(passage);
    }
    if (current.length) result.push({ passages: current, context });
  }
  return result;
}
