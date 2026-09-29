import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractSnapshot } from '../../src/userscript/extract/passages';
import { passageRanges, validAnchor, exactReanchor } from '../../src/userscript/extract/anchors';
import { collectText } from '../../src/userscript/extract/walker';
const html = readFileSync('tests/fixtures/article.html', 'utf8');
beforeEach(() => { document.documentElement.innerHTML = html; });
describe('original DOM extraction and UTF-16 anchoring', () => {
  it('keeps original slices and excludes unsupported/private text, including collapsed details', async () => {
    const snapshot = await extractSnapshot('article', undefined, 0, 1);
    const text = snapshot.passages.map(p => p.text).join('\n');
    expect(text).not.toContain('SECRET_'); expect(text).toContain('aria-hidden'); expect(text).toContain('屏幕下方');
    for (const p of snapshot.passages) { expect(validAnchor(p)).toBe(true); expect(passageRanges(p).map(r => r.toString()).join('')).toBe(p.slices.map(s => p.text.slice(s.rawStart, s.rawEnd)).join('')); }
    const inline = snapshot.passages.find(p => p.text.startsWith('英文缩写'))!;
    expect(inline.text).toContain('连续   空白及换行\n');
    const hidden = snapshot.passages.find(p => p.text.startsWith('这是可见'))!;
    expect(passageRanges(hidden).map(r => r.toString()).join('')).toBe('这是可见的前文和后文。');
  });
  it('does not duplicate li > p, blockquote > p or text intervals', async () => {
    const { passages } = await extractSnapshot('article', undefined, 0, 1);
    const seen = new Map<Text, Set<number>>();
    for (const p of passages) for (const s of p.slices) {
      const offsets = seen.get(s.node) ?? new Set();
      for (let i = s.nodeStart; i < s.nodeEnd; i++) { expect(offsets.has(i)).toBe(false); offsets.add(i); } seen.set(s.node, offsets);
    }
    expect(passages.filter(p => p.text.includes('先打开'))).toHaveLength(1);
    expect(passages.find(p => p.container.id === 'table-target')?.headingPath.join(' ')).toContain('保留期限');
  });
  it('preserves duplicate phrases as separate anchors', async () => {
    const { passages } = await extractSnapshot('article', undefined, 0, 1);
    const repeats = passages.filter(p => p.text.startsWith('这句话重复'));
    expect(repeats).toHaveLength(2); expect(repeats[0].id).not.toBe(repeats[1].id);
    expect(passageRanges(repeats[0])[0].startContainer.parentElement?.id).toBe('repeat-a');
    expect(passageRanges(repeats[1])[0].startContainer.parentElement?.id).toBe('repeat-b');
  });
  it('clips selection strictly at UTF-16 boundaries, without outside heading or neighbors', async () => {
    const node = document.querySelector('#uncertain')!.lastChild as Text;
    const range = document.createRange(); const start = node.data.indexOf('😀'); range.setStart(node, start); range.setEnd(node, start + 2);
    const snapshot = await extractSnapshot('selection', range, 0, 1);
    expect(snapshot.passages.map(p => p.text)).toEqual(['😀']);
    expect(snapshot.passages[0].headingPath).toEqual([]); expect(snapshot.passages[0].before).toBe(''); expect(snapshot.passages[0].after).toBe('');
    expect(passageRanges(snapshot.passages[0])[0].toString()).toBe('😀');
  });
  it('supports selections with element-offset boundaries and across links', async () => {
    const parent = document.querySelector('#hidden-mix')!;
    const range = document.createRange(); range.setStart(parent, 0); range.setEnd(parent, 1);
    expect((await collectText(parent, range)).map(e => e.node.data.slice(e.start, e.end)).join('')).toBe('这是可见的前文');
    range.selectNodeContents(document.querySelector('#inline')!);
    expect((await extractSnapshot('selection', range, 0, 1)).passages[0].text).toContain('链接');
  });
  it('splits long nodes into non-overlapping UTF-16 slices without dropping tail', async () => {
    const text = ('An entire sentence 😀. 中文条件及例外都要保留。 ').repeat(200);
    document.body.innerHTML = '<article><p></p></article>'; document.querySelector('p')!.textContent = text;
    const { passages } = await extractSnapshot('article', undefined, 0, 1);
    expect(passages.length).toBeGreaterThan(3); expect(passages.map(p => p.text).join('')).toBe(text.trim());
    expect(passages.flatMap(passageRanges).map(r => r.toString()).join('')).toBe(text.trim());
    expect(passages.every(p => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(p.text))).toBe(true);
  });
  it('does not silently fall back to the entire page', async () => {
    document.body.innerHTML = '<div>A plain page without a reliable article root.</div>';
    await expect(extractSnapshot('article', undefined, 0, 1)).rejects.toMatchObject({ code: 'scope' });
    expect((await extractSnapshot('loaded-page', undefined, 0, 1)).passages).toHaveLength(1);
  });
  it('rejects changed or replaced nodes and ambiguous exact reanchors', async () => {
    const { passages } = await extractSnapshot('article', undefined, 0, 1), p = passages[0];
    p.slices[0].node.data = 'Changed'; expect(validAnchor(p)).toBe(false); expect(() => passageRanges(p)).toThrow();
    expect(exactReanchor(p, [p, p])).toBeUndefined(); p.container.remove(); expect(exactReanchor(p, [p])).toBeUndefined();
  });
});
