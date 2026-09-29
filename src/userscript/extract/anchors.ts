import type { LocalPassage } from '../../shared/types';
import { FindError } from '../../shared/errors';
export function validAnchor(passage: LocalPassage): boolean {
  return passage.slices.length > 0 && passage.slices.every(s => s.node.isConnected && s.node.ownerDocument === document &&
    passage.container.contains(s.node) && s.node.data.slice(s.nodeStart, s.nodeEnd) === passage.text.slice(s.rawStart, s.rawEnd));
}
export function passageRanges(passage: LocalPassage): Range[] {
  if (!validAnchor(passage)) throw new FindError('stale');
  return passage.slices.map(s => { const range = document.createRange(); range.setStart(s.node, s.nodeStart); range.setEnd(s.node, s.nodeEnd); return range; });
}
// Only exact, unique matches within the original connected container and identical context qualify.
// Lifecycle invalidation takes precedence: this helper must not revive stale model judgments.
export function exactReanchor(passage: LocalPassage, candidates: LocalPassage[]): LocalPassage | undefined {
  if (!passage.container.isConnected) return undefined;
  const matches = candidates.filter(p => passage.container.contains(p.container) && p.text === passage.text &&
    p.before === passage.before && p.after === passage.after && p.headingPath.join('\0') === passage.headingPath.join('\0'));
  return matches.length === 1 ? matches[0] : undefined;
}
export function scrollToPassage(passage: LocalPassage, margin = 80): void {
  const ranges = passageRanges(passage);
  const target = passage.slices[0].node.parentElement!;
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  // Adjust nested scrolling ancestors too, without changing page styles.
  for (let el = target.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    if (/(auto|scroll)/u.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) {
      const rect = ranges[0].getBoundingClientRect(), box = el.getBoundingClientRect();
      if (rect.top < box.top + margin) el.scrollTop += rect.top - box.top - margin;
    }
  }
  const rect = ranges[0].getBoundingClientRect();
  if (rect.top < margin) window.scrollBy({ top: rect.top - margin, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
