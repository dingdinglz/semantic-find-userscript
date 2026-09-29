import { extractSnapshot } from '../../src/userscript/extract/passages';
import { passageRanges } from '../../src/userscript/extract/anchors';
Object.assign(globalThis, { __sfBenchmark: async () => {
  document.body.replaceChildren(); const article = document.createElement('article');
  const text = '可重复测量的正文包含条件与例外，也包含英文 evidence 和 emoji 😀。'.padEnd(50, '文');
  for (let i = 0; i < 2000; i++) { const p = document.createElement('p'); p.textContent = text; article.append(p); }
  document.body.append(article); const durations: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now(), snapshot = await extractSnapshot('article', undefined, 0, i);
    durations.push(performance.now() - start);
    if (snapshot.passages.length !== 2000 || snapshot.passages.flatMap(passageRanges).map(r => r.toString()).join('') !== text.repeat(2000)) throw new Error('Benchmark lost original text');
  }
  return { characters: text.length * 2000, textNodes: 2000, runs: durations, p95: [...durations].sort((a, b) => a - b)[9], browser: navigator.userAgent };
} });
