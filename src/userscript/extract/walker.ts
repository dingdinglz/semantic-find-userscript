import type { Scope } from '../../shared/types';
import { checkAbort } from '../../shared/errors';
import { nextTask } from '../../shared/utils';
export const OWN_ATTR = 'data-semantic-find-owned';
const EXCLUDED = `script,style,noscript,template,input,textarea,select,option,form,[contenteditable]:not([contenteditable="false"]),[${OWN_ATTR}],.advertisement,.ads,.ad-slot,.share-buttons`;
const ARTICLE_EXCLUDED = 'nav,aside,footer,button,[role="navigation"],[role="complementary"],[role="button"],[role="menu"]';
const exclusions = (scope: Scope) => scope === 'article' ? `${EXCLUDED},${ARTICLE_EXCLUDED}` : EXCLUDED;
export function excluded(element: Element, scope: Scope = 'loaded-page'): boolean { return !!element.closest(exclusions(scope)); }
export function readable(element: Element, cache = new WeakMap<Element, boolean>(), scope: Scope = 'loaded-page'): boolean {
  const known = cache.get(element); if (known !== undefined) return known;
  let yes = !element.matches(exclusions(scope)) && !element.hasAttribute('hidden');
  if (yes) {
    const style = getComputedStyle(element);
    yes = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden';
  }
  const parent = element.parentElement;
  if (yes && parent?.tagName === 'DETAILS' && !parent.hasAttribute('open') && element.tagName !== 'SUMMARY') yes = false;
  if (yes && parent) yes = readable(parent, cache, scope);
  cache.set(element, yes); return yes;
}
export type CollectedText = { node: Text; parent: Element; text: string; start: number; end: number };
export async function collectText(root: Element, selection?: Range, signal?: AbortSignal, scope: Scope = 'loaded-page'): Promise<CollectedText[]> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Freeze the traversal boundary before yielding so a live feed cannot extend it forever.
  const nodes: Text[] = []; let node: Node | null;
  checkAbort(signal);
  while ((node = walker.nextNode())) nodes.push(node as Text);
  const visibility = new WeakMap<Element, boolean>();
  const collected: CollectedText[] = []; let count = 0;
  for (const text of nodes) {
    if (++count % 150 === 0) await nextTask();
    checkAbort(signal);
    const parent = text.parentElement;
    if (!parent || !root.contains(text) || !readable(parent, visibility, scope)) continue;
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) continue;
    let start = 0, end = text.length;
    if (selection) {
      if (!selection.intersectsNode(text)) continue;
      if (selection.startContainer === text) start = selection.startOffset;
      if (selection.endContainer === text) end = selection.endOffset;
      // intersectsNode also handles element-offset boundaries, including zero-length intersections.
      const r = document.createRange(); r.selectNodeContents(text);
      if (selection.compareBoundaryPoints(Range.END_TO_START, r) >= 0 || selection.compareBoundaryPoints(Range.START_TO_END, r) <= 0) continue;
    }
    if (end > start) collected.push({ node: text, parent, text: text.data.slice(start, end), start, end });
  }
  checkAbort(signal); return collected;
}
