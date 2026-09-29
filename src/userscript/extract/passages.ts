import type { LocalPassage, PageSnapshot, Scope, TextSlice } from '../../shared/types';
import { context, hash, normalize, safeEnd, uid } from '../../shared/utils';
import { collectText } from './walker';
import { resolveScope } from './scope';
export const SPLIT_VERSION = 'utf16-blocks-1';
type Block = { container: Element; text: string; slices: TextSlice[]; headingPath: string[] };
function owner(node: Text, root: Element): Element {
  let el = node.parentElement!; let block: Element | undefined;
  while (true) {
    if (el.matches('pre,tr,li,blockquote,h1,h2,h3,h4,h5,h6')) return el;
    if (!block && el.matches('p,div,section,dt,dd,figcaption,summary,address')) block = el;
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
  const entries = await collectText(root, scope === 'selection' ? selection : undefined, signal);
  const blocks: Block[] = []; let previous: Text | undefined;
  for (const { node, start, end } of entries) {
    const container = owner(node, root);
    let block = blocks.at(-1);
    if (!block || block.container !== container) {
      block = { container, text: '', slices: [], headingPath: [] }; blocks.push(block); previous = undefined;
    }
    // Separators have no TextSlice: never highlight excluded DOM between visible slices.
    if (previous && (previous.parentElement?.closest('td,th,p') !== node.parentElement?.closest('td,th,p') || previous.nextSibling?.nodeName === 'BR')) block.text += '\n';
    const rawStart = block.text.length; block.text += node.data.slice(start, end);
    block.slices.push({ node, nodeStart: start, nodeEnd: end, rawStart, rawEnd: block.text.length }); previous = node;
  }
  const headings: string[] = []; const targets: Block[] = [];
  for (let block of blocks) {
    block = trimBlock(block); if (!block.text.trim()) continue;
    if (/^H[1-6]$/u.test(block.container.tagName)) {
      const level = Number(block.container.tagName[1]); headings.length = level;
      headings[level - 1] = context(block.text); continue;
    }
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
    normalizedText: normalize(b.text), textHash: hash(b.text), before: context(pieces[order - 1]?.text ?? '', true), after: context(pieces[order + 1]?.text ?? '') }));
  return { id: uid(), pageEpoch, revision, root, scope, passages,
    digest: hash(JSON.stringify(passages.map(({ text, headingPath, before, after }) => ({ text, headingPath, before, after })))),
    limitations: ['只检索所选范围内已加载且可读取的正文；不包含隐藏或折叠正文、iframe、Shadow DOM、图片、Canvas 和 PDF。', '标题及前后文仅辅助判断，不生成回答；跨远距离章节推理不在保证范围内。'] };
}
