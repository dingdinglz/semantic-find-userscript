import { beforeEach, describe, expect, it } from 'vitest';
import { buildRequest } from '../../src/userscript/typesafe/prompts';
import { parseEvaluation, parseModels } from '../../src/userscript/typesafe/schema';
import { batches, fits, fitSnapshot, requestBudget } from '../../src/userscript/search/batcher';
import { passage, response, snapshot } from './helpers';
import { passageRanges } from '../../src/userscript/extract/anchors';
beforeEach(() => { document.body.replaceChildren(); });
describe('TypeSafe protocol and budgets', () => {
  it('sends only official top-level fields and allowlisted original evidence', () => {
    const p = passage(1, '<script>untrusted text</script>');
    const request = buildRequest('where?', [p]);
    expect(Object.keys(request).sort()).toEqual(['model', 'questions', 'state']);
    expect(Object.keys(request.state.document[p.id]).sort()).toEqual(['headingPath', 'kind', 'region', 'text']);
    expect(request.state.candidates).toEqual([p.id]);
    expect(request.questions.match_b00001.instructions.task).toContain('document.b00001');
    expect(request.questions.match_b00001.instructions.boundary).toContain('untrusted');
    expect(JSON.stringify(request)).not.toMatch(/container|slices|apiKey|snapshotId|credentialId/);
  });
  it('shares the full scope across candidate batches, including distant context and navigation', () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => passage(i + 1, `Full original context ${i}.`));
    paragraphs[0].kind = 'link'; paragraphs[0].region = 'sidebar'; paragraphs[0].text = 'Python';
    const plan = batches('Python 的用法', paragraphs);
    expect(plan.length).toBeGreaterThan(1);
    for (const batch of plan) {
      expect(batch.context).toEqual(paragraphs);
      const request = buildRequest('Python 的用法', batch.passages, batch.context);
      expect(Object.keys(request.state.document)).toHaveLength(50);
      expect(request.state.document.b00001).toMatchObject({ text: 'Python', kind: 'link', region: 'sidebar' });
      expect(request.state.document.b00050.text).toBe('Full original context 49.');
      expect(Object.keys(request.questions)).toHaveLength(batch.passages.length);
      expect(Object.values(request.questions)[0].instructions.navigation).toContain('Python usage');
    }
  });
  it('rejects candidates absent from or inconsistent with the shared document', () => {
    const p = passage(1);
    expect(() => buildRequest('q', [p], [])).toThrow();
    expect(() => buildRequest('q', [p], [{ ...p, text: 'Different source' }])).toThrow();
    expect(() => buildRequest('q', [p], [p, p])).toThrow();
  });
  it.each([NaN, Infinity, -0.1, 1.1, '0.9', null, undefined])('rejects invalid probabilities %s', value => {
    const payload = response(['b00001']); (payload.answers.match_b00001 as { noul: unknown }).noul = value;
    expect(() => parseEvaluation(payload, ['b00001'])).toThrow();
  });
  it('rejects missing, extra, wrong-type answers and invalid usage', () => {
    expect(() => parseEvaluation(response([]), ['b00001'])).toThrow();
    expect(() => parseEvaluation(response(['b00001', 'b00002']), ['b00001'])).toThrow();
    const payload = response(['b00001']); payload.answers.match_b00001.type = 'choice'; expect(() => parseEvaluation(payload, ['b00001'])).toThrow();
    const badUsage = response(['b00001']); badUsage.usage.input_tokens = -1; expect(() => parseEvaluation(badUsage, ['b00001'])).toThrow();
  });
  it('reads noul and actual model without inventing a confidence field', () => {
    expect(parseEvaluation(response(['b00001'], 0.94), ['b00001']).judgments).toEqual([{ id: 'b00001', value: 0.94, model: 'jev-1.13.0' }]);
    expect(() => parseModels({ models: [{ name: 'jev-latest', description: 'Alias', release_date: '2026-01-01' }] })).not.toThrow();
    expect(() => parseModels({ models: [{}] })).toThrow();
  });
  it('scans every candidate, respects serialized question budgets, and never confuses CJK with chars/4', () => {
    const paragraphs = Array.from({ length: 100 }, (_, i) => passage(i + 1, '中文条件与例外。'.repeat(90)));
    const result = batches('中文问题', paragraphs);
    expect(result.flatMap(b => b.passages)).toEqual(paragraphs);
    expect(result.every(b => b.passages.length <= 16 && fits('中文问题', b.passages, b.context))).toBe(true);
    expect(result.some(b => b.context.length > b.passages.length)).toBe(true);
    expect(new Set(result.flatMap(b => b.context.map(p => p.id))).size).toBe(paragraphs.length);
    expect(requestBudget('中文问题', [paragraphs[0]]).longest).toBeGreaterThan(paragraphs[0].text.length * 3);
  });
  it('subdivides oversized single passages before planning without losing ranges', () => {
    const snap = snapshot(1); snap.passages = [passage(1, '😀 long condition. '.repeat(4000))];
    const fitted = fitSnapshot(snap, 'where?'); expect(fitted.id).not.toBe(snap.id); expect(fitted.passages.length).toBeGreaterThan(1);
    expect(fitted.passages.flatMap(passageRanges).map(r => r.toString()).join('')).toBe(snap.passages[0].text);
    expect(batches('where?', fitted.passages).flatMap(b => b.passages)).toEqual(fitted.passages);
  });
});
