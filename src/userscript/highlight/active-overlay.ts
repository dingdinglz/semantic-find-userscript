import { OWN_ATTR } from '../extract/walker';
export class ActiveOverlay {
  private host?: HTMLDivElement;
  private ranges: Range[] = [];
  private frame = 0;
  private resize?: ResizeObserver;
  private schedule = () => { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); };
  show(ranges: Range[]): void {
    this.clear(); this.ranges = ranges;
    this.host = document.createElement('div'); this.host.setAttribute(OWN_ATTR, 'overlay'); this.host.setAttribute('aria-hidden', 'true');
    this.host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483645!important;';
    this.host.attachShadow({ mode: 'open' }); document.documentElement.append(this.host);
    window.addEventListener('scroll', this.schedule, true); window.addEventListener('resize', this.schedule);
    document.fonts?.addEventListener('loadingdone', this.schedule);
    document.addEventListener('load', this.schedule, true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resize = new ResizeObserver(this.schedule); this.resize.observe(document.body);
      for (const range of ranges) if (range.startContainer.parentElement) this.resize.observe(range.startContainer.parentElement);
    }
    this.schedule();
  }
  private draw(): void {
    if (!this.host) return;
    this.host.shadowRoot!.replaceChildren();
    for (const range of this.ranges) {
      if (!range.startContainer.isConnected) continue;
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;pointer-events:none;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(255,180,65,.35);outline:1px solid #b26b08;`;
        this.host.shadowRoot!.append(box);
      }
    }
  }
  clear(): void {
    cancelAnimationFrame(this.frame); this.frame = 0;
    window.removeEventListener('scroll', this.schedule, true); window.removeEventListener('resize', this.schedule);
    document.fonts?.removeEventListener('loadingdone', this.schedule);
    document.removeEventListener('load', this.schedule, true); this.resize?.disconnect(); this.resize = undefined;
    this.host?.remove(); this.host = undefined; this.ranges = [];
  }
}
