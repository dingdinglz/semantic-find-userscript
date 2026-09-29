export const uid = () => crypto.randomUUID();
// Non-cryptographic content checksum; identity/version checks also gate every reuse.
export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
export const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
export function safeEnd(text: string, end: number): number {
  return end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1]) ? end - 1 : end;
}
export function context(text: string, tail = false, max = 200): string {
  if (text.length <= max) return text;
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)];
  const fitting = tail ? parts.filter(p => text.length - p.index <= max).map(p => p.segment).join('')
    : parts.filter(p => p.index + p.segment.length <= max).map(p => p.segment).join('');
  if (fitting) return fitting;
  if (!tail) return text.slice(0, safeEnd(text, max));
  const start = text.length - max;
  return text.slice(start + (/[\uDC00-\uDFFF]/u.test(text[start]) ? 1 : 0));
}
export const nextTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', text); node.type = 'button';
  node.addEventListener('click', event => { if (event.isTrusted) action(); });
  return node;
}
