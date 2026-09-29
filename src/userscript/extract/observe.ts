import { excluded, OWN_ATTR, readable } from './walker';
function owned(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return !!el?.closest(`[${OWN_ATTR}]`);
}
export class ContentObserver {
  private observer?: MutationObserver;
  disconnect(): void { this.observer?.disconnect(); this.observer = undefined; }
  watch(root: Element, invalidate: (added: boolean) => void): void {
    this.disconnect();
    const states = new Map<Element, boolean>();
    const cache = new WeakMap<Element, boolean>();
    for (const el of [root, ...root.querySelectorAll('*')]) if (!owned(el)) states.set(el, readable(el, cache));
    const relevant = (record: MutationRecord): boolean => {
      if (owned(record.target)) return false;
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
      if (!target) return false;
      if (record.type === 'attributes') {
        // Layout-only mutations leave the text snapshot intact, but visibility or exclusion changes do not.
        const nextCache = new WeakMap<Element, boolean>();
        for (const [el, visible] of states) if (readable(el, nextCache) !== visible) return true;
        return false;
      }
      if (record.type === 'characterData') return root.contains(target) && !excluded(target) && readable(target);
      const changed = [...record.addedNodes, ...record.removedNodes].filter(n => !owned(n));
      if (!changed.length) return false;
      if (!root.isConnected || changed.some(n => n === root || n.contains(root))) return true;
      if (!root.contains(target) || excluded(target) || !readable(target)) return false;
      return changed.some(n => n.nodeType === Node.TEXT_NODE ? !!n.textContent?.trim() : n instanceof Element && !excluded(n) && !n.matches('script,style,link,meta'));
    };
    this.observer = new MutationObserver(records => {
      const changes = records.filter(relevant); if (!changes.length) return;
      // Invalidates immediately. No 500ms window in which old responses can still apply.
      this.disconnect(); invalidate(changes.some(r => r.addedNodes.length > 0));
    });
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'style', 'class', 'contenteditable', 'role'] });
    for (let parent = root.parentElement; parent; parent = parent.parentElement) this.observer.observe(parent, { childList: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  }
}
