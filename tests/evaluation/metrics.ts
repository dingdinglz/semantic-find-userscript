export type EvaluationCase = {
  id: string; articleId: string; split: 'tune' | 'test'; language: 'zh' | 'en' | 'cross'; pageType: string;
  query: string; passages: Record<string, string>; expected: string[]; ambiguous?: boolean;
};
export type Prediction = { caseId: string; model: string; promptVersion: string; status: 'complete' | 'partial' | 'cancelled'; values: Record<string, number> };
export function validateCases(cases: EvaluationCase[]): void {
  const seen = new Set<string>(), splits = new Map<string, string>();
  for (const c of cases) {
    if (!c.id || seen.has(c.id) || !c.query || !Object.keys(c.passages).length || c.expected.some(id => !(id in c.passages)) || !['zh', 'en', 'cross'].includes(c.language) || !['tune', 'test'].includes(c.split)) throw new Error('Invalid evaluation case');
    if (splits.has(c.articleId) && splits.get(c.articleId) !== c.split) throw new Error('Article leaks across tuning and locked-test splits');
    seen.add(c.id); splits.set(c.articleId, c.split);
  }
}
export function metrics(cases: EvaluationCase[], predictions: Prediction[]) {
  validateCases(cases); const byId = new Map<string, Prediction>();
  for (const prediction of predictions) {
    const c = cases.find(c => c.id === prediction.caseId);
    if (!c || byId.has(prediction.caseId) || !prediction.model || !prediction.promptVersion || !['complete', 'partial', 'cancelled'].includes(prediction.status) ||
      Object.entries(prediction.values).some(([id, value]) => !(id in c.passages) || !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Invalid prediction');
    if (prediction.status === 'complete' && Object.keys(prediction.values).length !== Object.keys(c.passages).length) throw new Error('Incomplete coverage cannot be called complete');
    byId.set(prediction.caseId, prediction);
  }
  let tp = 0, fp = 0, expected = 0, checked = 0, total = 0, unsure = 0, noAnswer = 0, falsePositiveQueries = 0, falseAbsence = 0, failures = 0, included = 0;
  for (const c of cases) {
    if (c.ambiguous) continue;
    included++; const prediction = byId.get(c.id), values = prediction?.values ?? {};
    const matched = Object.keys(values).filter(id => values[id] >= 0.8);
    tp += matched.filter(id => c.expected.includes(id)).length; fp += matched.filter(id => !c.expected.includes(id)).length;
    expected += c.expected.length; total += Object.keys(c.passages).length; checked += Object.keys(values).length;
    const uncertain = Object.values(values).filter(p => p > 0.2 && p < 0.8).length; unsure += uncertain;
    if (!c.expected.length) { noAnswer++; if (matched.length) falsePositiveQueries++; }
    if (c.expected.length && prediction?.status === 'complete' && !matched.length && !uncertain) falseAbsence++;
    if (prediction?.status !== 'complete') failures++;
  }
  const ratio = (a: number, b: number) => b ? a / b : null;
  return { cases: included, ambiguousExcluded: cases.length - included, truePositivePassages: tp, falsePositivePassages: fp, expectedPassages: expected,
    precision: ratio(tp, tp + fp), recall: ratio(tp, expected), noAnswerQueries: noAnswer, noAnswerFalsePositives: falsePositiveQueries,
    noAnswerFalsePositiveRate: ratio(falsePositiveQueries, noAnswer), falseAbsenceQueries: falseAbsence, falseAbsenceRate: ratio(falseAbsence, included - noAnswer),
    uncertainPassages: unsure, uncertainRate: ratio(unsure, checked), failedOrIncompleteQueries: failures, failedOrIncompleteRate: ratio(failures, included),
    checkedPassages: checked, totalPassages: total, coverage: ratio(checked, total) };
}
