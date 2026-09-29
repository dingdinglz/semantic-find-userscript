import type { Scope } from '../../shared/types';
import { FindError, checkAbort } from '../../shared/errors';
import { collectText, OWN_ATTR } from './walker';
export function captureSelection(): Range | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return undefined;
  const range = selection.getRangeAt(0).cloneRange();
  const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
  if (parent?.closest(`[${OWN_ATTR}]`) || range.commonAncestorContainer.getRootNode() !== document) return undefined;
  return range.toString().trim() ? range : undefined;
}
export async function resolveScope(scope: Scope, selection?: Range, signal?: AbortSignal): Promise<Element> {
  if (document.contentType === 'application/pdf' || document.querySelector('embed[type="application/pdf"]')) throw new FindError('scope');
  if (scope === 'selection') {
    if (!selection || selection.collapsed || !selection.commonAncestorContainer.isConnected) throw new FindError('scope');
    const node = selection.commonAncestorContainer;
    return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement!;
  }
  if (scope === 'loaded-page') return document.body;
  const candidates = [...document.querySelectorAll('article,main,[role="main"]')];
  let best: Element | undefined; let bestScore = 0;
  for (const candidate of candidates) {
    checkAbort(signal);
    const texts = await collectText(candidate, undefined, signal, 'article');
    let length = 0, linked = 0;
    for (const { node } of texts) { length += node.length; if (node.parentElement?.closest('a')) linked += node.length; }
    const paragraphs = candidate.querySelectorAll('p,li,blockquote,pre,tr').length;
    const ratio = linked / Math.max(1, length);
    const score = length * (1 - ratio) ** 2 + Math.min(paragraphs, 200) * 30;
    if (length >= 20 && ratio < 0.5 && score > bestScore) { best = candidate; bestScore = score; }
  }
  if (!best) throw new FindError('scope');
  return best;
}
