import { checkAbort } from '../../shared/errors';
import { nextTask } from '../../shared/utils';
export const OWN_ATTR = 'data-semantic-find-owned';
const EXCLUDED = `script,style,noscript,template,input,textarea,select,option,button,form,[contenteditable]:not([contenteditable="false"]),nav,aside,footer,[role="navigation"],[role="complementary"],[role="button"],[${OWN_ATTR}],.advertisement,.ads,.ad-slot,.share-buttons`;
export function excluded(element: Element): boolean { return !!element.closest(EXCLUDED); }
export function readable(element: Element, cache = new WeakMap<Element, boolean>()): boolean {
  const known = cache.get(element); if (known !== undefined) return known;
  let yes = !element.matches(EXCLUDED) && !element.hasAttribute('hidden');
  if (yes) {
    const style = getComputedStyle(element);
    yes = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden';
  }
  const parent = element.parentElement;
  if (yes && parent?.tagName === 'DETAILS' && !parent.hasAttribute('open') && element.tagName !== 'SUMMARY') yes = false;
  if (yes && parent) yes = readable(parent, cache);
  cache.set(element, yes); return yes;
}
export type CollectedText = { node: Text; start: number; end: number };
export async function collectText(root: Element, selection?: Range, signal?: AbortSignal): Promise<CollectedText[]> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const visibility = new WeakMap<Element, boolean>();
  const collected: CollectedText[] = []; let count = 0; let node: Node | null;
  while ((node = walker.nextNode())) {
    checkAbort(signal);
    if (++count % 150 === 0) await nextTask();
    const text = node as Text; const parent = text.parentElement;
    if (!parent || !readable(parent, visibility)) continue;
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
    if (end > start) collected.push({ node: text, start, end });
  }
  checkAbort(signal); return collected;
}
