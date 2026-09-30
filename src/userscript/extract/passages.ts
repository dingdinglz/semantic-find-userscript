import type { LocalPassage, PageSnapshot, Scope, TextSlice } from '../../shared/types';
import { context, hash, normalize, safeEnd, uid } from '../../shared/utils';
import { collectText } from './walker';
import { resolveScope } from './scope';
export const SPLIT_VERSION = 'utf16-page-blocks-2';
const LANDMARKS = 'nav,aside,header,footer,article,main,[role="main"],[role="navigation"],[role="complementary"],[role="menu"],[role="banner"],[role="contentinfo"]';
function region(container: Element): LocalPassage['region'] {
  const landmark = container.closest(LANDMARKS);
  if (landmark?.matches('nav,[role="navigation"],[role="menu"]')) return 'navigation';
  if (landmark?.matches('aside,[role="complementary"]')) return 'sidebar';
  if (landmark?.matches('header,[role="banner"]')) return 'header';
  if (landmark?.matches('footer,[role="contentinfo"]')) return 'footer';
  return landmark ? 'content' : 'page';
}
function kind(container: Element): LocalPassage['kind'] {
  if (container.matches('h1,h2,h3,h4,h5,h6')) return 'heading';
  if (container.matches('a,[role="link"],[role="menuitem"]')) return 'link';
  return container.matches('button,[role="button"],summary') ? 'control' : 'content';
}
type Block = { container: Element; text: string; slices: TextSlice[]; headingPath: string[] };
function owner(el: Element, root: Element): Element {
  let block: Element | undefined;
  const standalone = ['navigation', 'sidebar', 'header', 'footer'].includes(region(el)) || !el.closest('p,blockquote,pre,td,th');
  while (true) {
    // Keep navigation entries separate so a short label highlights only its own link.
    if (standalone && el.matches('a,button,[role="link"],[role="button"],[role="menuitem"]')) return el;
    if (el.matches('pre,tr,li,blockquote,h1,h2,h3,h4,h5,h6')) return el;
    if (!block && el.matches(`p,div,section,dt,dd,figcaption,summary,address,${LANDMARKS}`)) block = el;
    if (el === root || !el.parentElement) return block ?? el;
    el = el.parentElement;
  }
}
export function sliceBlock(block: Block, start: number, end: number): Block {
  return { ...block, text: block.text.slice(start, end), slices: block.slices.flatMap(s => {
    const from = Math.max(start, s.rawStart), to = Math.min(end, s.rawEnd);
    return from < to ? [{ node: s.node, nodeStart: s.nodeStart + from - s.rawStart, nodeEnd: s.nodeStart + to - s.rawStart, rawStart: from - start, rawEnd: to - start }] : [];
  }) };
}
function trimBlock(block: Block): Block {
  const start = block.text.length - block.text.trimStart().length;
  return sliceBlock(block, start, block.text.trimEnd().length);
}
function split(block: Block): Block[] {
  if (block.text.length <= 1200) return [block];
  const boundaries = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block.text)].map(p => p.index + p.segment.length);
  const result: Block[] = []; let start = 0;
  while (start < block.text.length) {
    let end = boundaries.filter(n => n > start && n - start <= 1000).at(-1);
    // Keep a complete long sentence/clause when it fits a conservative single-target budget.
    end ??= boundaries.find(n => n > start && n - start <= 2400);
    if (!end) {
      end = start + safeEnd(block.text.slice(start), Math.min(1500, block.text.length - start));
      const space = block.text.lastIndexOf(' ', end);
      if (space > start + 800) end = space + 1;
    }
    result.push(sliceBlock(block, start, end)); start = end;
  }
  return result;
}
export async function extractSnapshot(scope: Scope, selection: Range | undefined, pageEpoch: number, revision: number, signal?: AbortSignal): Promise<PageSnapshot> {
  const root = await resolveScope(scope, selection, signal);
  const entries = await collectText(root, scope === 'selection' ? selection : undefined, signal, scope);
  const blocks: Block[] = []; let previous: Text | undefined;
  for (const { node, parent, text, start, end } of entries) {
    const container = owner(parent, root);
    let block = blocks.at(-1);
    if (!block || block.container !== container) {
      block = { container, text: '', slices: [], headingPath: [] }; blocks.push(block); previous = undefined;
    }
    // Separators have no TextSlice: never highlight excluded DOM between visible slices.
    if (previous && (previous.parentElement?.closest('td,th,p') !== node.parentElement?.closest('td,th,p') || previous.nextSibling?.nodeName === 'BR')) block.text += '\n';
    const rawStart = block.text.length; block.text += text;
    block.slices.push({ node, nodeStart: start, nodeEnd: end, rawStart, rawEnd: block.text.length }); previous = node;
  }
  const headingsByRegion = new Map<Element, string[]>(); const targets: Block[] = [];
  for (let block of blocks) {
    block = trimBlock(block); if (!block.text.trim()) continue;
    const landmark = block.container.closest(LANDMARKS) ?? root;
    const headings = headingsByRegion.get(landmark) ?? [];
    headingsByRegion.set(landmark, headings);
    if (/^H[1-6]$/u.test(block.container.tagName)) {
      const level = Number(block.container.tagName[1]); headings.length = level;
      headings[level - 1] = block.text;
    }
    // Headings are searchable too; sidebar headings never leak into article attribution.
    block.headingPath = headings.filter(Boolean);
    if (scope !== 'selection' && block.container.tagName === 'TR') {
      const table = block.container.closest('table');
      const header = table?.querySelector('tr');
      const headerBlock = blocks.find(b => b.container === header);
      if (header?.querySelector('th') && header !== block.container && headerBlock) block.headingPath = [...block.headingPath, context(headerBlock.text)];
    }
    // Tiny inline fragments may be joined only inside the same container/section, never globally deduplicated.
    const last = targets.at(-1);
    if (last && last.container === block.container && last.text.length < 40 && !/[.!?。！？:：]$/u.test(last.text) && last.text.length + block.text.length < 1000) {
      const offset = last.text.length + 1; last.text += '\n' + block.text;
      last.slices.push(...block.slices.map(s => ({ ...s, rawStart: s.rawStart + offset, rawEnd: s.rawEnd + offset })));
    } else targets.push(block);
  }
  const pieces = targets.flatMap(split);
  const passages: LocalPassage[] = pieces.map((b, order) => ({ ...b, id: `b${String(order + 1).padStart(5, '0')}`, order,
    normalizedText: normalize(b.text), textHash: hash(b.text), kind: kind(b.container), region: region(b.container), before: context(pieces[order - 1]?.text ?? '', true), after: context(pieces[order + 1]?.text ?? '') }));
  return { id: uid(), pageEpoch, revision, root, scope, passages,
    digest: hash(JSON.stringify(passages.map(({ text, headingPath, kind, region }) => ({ text, headingPath, kind, region })))),
    limitations: ['只检索范围内已加载且可读取的文本；不包含表单、编辑区、隐藏或折叠内容、iframe、Shadow DOM、图片、Canvas 和 PDF。'] };
}
