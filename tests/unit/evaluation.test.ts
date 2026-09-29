import { describe, expect, it } from 'vitest';
import { metrics, validateCases } from '../evaluation/metrics';
import type { EvaluationCase, Prediction } from '../evaluation/metrics';
const cases: EvaluationCase[] = [{ id: 'a', articleId: 'one', language: 'zh', split: 'tune', pageType: 'article', query: 'q', passages: { b1: 'a', b2: 'b' }, expected: ['b1'] },
  { id: 'b', articleId: 'two', language: 'en', split: 'test', pageType: 'terms', query: 'q', passages: { b1: 'a' }, expected: [] }];
const prediction = (caseId: string, values: Record<string, number>, status: Prediction['status'] = 'complete'): Prediction => ({ caseId, values, status, model: 'test', promptVersion: 'test' });
describe('honest offline metrics', () => {
  it('counts false positives, recall, unanswered errors and coverage with raw counts', () => {
    const result = metrics(cases, [prediction('a', { b1: 0.9, b2: 0.1 }), prediction('b', { b1: 0.9 })]);
    expect(result.precision).toBe(0.5); expect(result.recall).toBe(1); expect(result.noAnswerFalsePositives).toBe(1); expect(result.coverage).toBe(1);
  });
  it('never treats a missing/failed prediction or uncertainty as complete absence', () => {
    const result = metrics(cases, [prediction('a', { b2: 0.1 }, 'partial')]); expect(result.falseAbsenceQueries).toBe(0); expect(result.failedOrIncompleteQueries).toBe(2); expect(result.coverage).toBeCloseTo(1 / 3);
    expect(metrics(cases, [prediction('a', { b1: 0.5, b2: 0.1 })]).falseAbsenceQueries).toBe(0);
    expect(metrics(cases, [prediction('a', { b1: 0.1, b2: 0.1 })]).falseAbsenceQueries).toBe(1);
  });
  it('rejects article leakage and incomplete complete-runs', () => {
    expect(() => validateCases([cases[0], { ...cases[1], articleId: 'one' }])).toThrow();
    expect(() => metrics(cases, [prediction('a', { b1: 0.1 })])).toThrow();
  });
});
