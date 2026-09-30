import type { LocalPassage } from '../../shared/types';
import { passageRanges, validAnchor } from '../extract/anchors';
import { uid } from '../../shared/utils';
import { OWN_ATTR } from '../extract/walker';
import { ActiveOverlay } from './active-overlay';
type HighlightValue = { priority: number };
type HighlightWindow = { Highlight?: new (...ranges: Range[]) => HighlightValue; CSS?: { highlights?: Map<string, HighlightValue>; supports?: (query: string) => boolean } };
export class Highlighter {
  private names = [`sf-${uid()}-matches`, `sf-${uid()}-current`];
  private overlay = new ActiveOverlay();
  private style?: HTMLStyleElement;
  private api = globalThis as unknown as HighlightWindow;
  mode: 'css' | 'overlay' | 'none' = 'overlay';
  constructor() {
    if (this.api.CSS?.highlights && this.api.Highlight && this.api.CSS.supports?.('selector(::highlight(sf-test))')) {
      try {
        this.style = GM_addStyle(`::highlight(${this.names[0]}){background-color:#fff0a6;color:#202020}::highlight(${this.names[1]}){background-color:#ffbd66;color:#202020}`);
        this.style.setAttribute(OWN_ATTR, 'style'); this.mode = 'css';
      } catch { this.mode = 'overlay'; }
    }
  }
  matches(passages: LocalPassage[]): void {
    if (this.mode !== 'css') return;
    try { this.api.CSS!.highlights!.set(this.names[0], new this.api.Highlight!(...passages.filter(validAnchor).flatMap(passageRanges))); }
    catch { this.clear(); this.mode = 'overlay'; }
  }
  active(passage: LocalPassage): void {
    const ranges = passageRanges(passage);
    if (this.mode === 'css') {
      try { const highlight = new this.api.Highlight!(...ranges); highlight.priority = 1; this.api.CSS!.highlights!.set(this.names[1], highlight); return; }
      catch { this.clear(); this.mode = 'overlay'; }
    }
    try { this.overlay.show(ranges); } catch { this.mode = 'none'; this.overlay.clear(); }
  }
  clearActive(): void { this.api.CSS?.highlights?.delete(this.names[1]); this.overlay.clear(); }
  clear(): void { this.api.CSS?.highlights?.delete(this.names[0]); this.clearActive(); }
  dispose(): void { this.clear(); this.style?.remove(); }
}
