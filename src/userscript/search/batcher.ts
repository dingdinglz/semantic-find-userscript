import type { LocalPassage, PageSnapshot } from '../../shared/types';
import { FindError } from '../../shared/errors';
import { buildRequest } from '../typesafe/prompts';
import { sliceBlock } from '../extract/passages';
import { context, hash, normalize, safeEnd, uid } from '../../shared/utils';
// Deliberately conservative: UTF-8 bytes, not the misleading universal chars/4 rule.
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
export function requestBudget(query: string, passages: LocalPassage[]): { longest: number; total: number } {
  const request = buildRequest(query, passages), state = bytes(request.state);
  return { longest: state + Math.max(...Object.values(request.questions).map(bytes)) + 256, total: bytes(request) + 256 };
}
export function fits(query: string, passages: LocalPassage[]): boolean {
  if (passages.length > 16) return false;
  const budget = requestBudget(query, passages); return budget.longest <= 12000 && budget.total <= 24000;
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
// Called BEFORE consent. Any extra subdivision becomes part of the previewed, immutable snapshot.
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
  return { ...snapshot, passages, id: uid(), revision: snapshot.revision + 1, digest: hash(JSON.stringify(passages.map(p => [p.text, p.headingPath, p.before, p.after]))) };
}
export function batches(query: string, passages: LocalPassage[]): LocalPassage[][] {
  const result: LocalPassage[][] = []; let current: LocalPassage[] = [];
  for (const passage of passages) {
    if (!fits(query, [passage])) throw new FindError('length');
    if (current.length && !fits(query, [...current, passage])) { result.push(current); current = []; }
    current.push(passage);
  }
  if (current.length) result.push(current); return result;
}
