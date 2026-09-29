import { readFile, writeFile } from 'node:fs/promises';
import { metrics, validateCases } from '../tests/evaluation/metrics.ts';
import type { EvaluationCase, Prediction } from '../tests/evaluation/metrics.ts';
const args = process.argv.slice(2), flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const cases: EvaluationCase[] = JSON.parse(await readFile(flag('--cases') ?? 'tests/evaluation/cases.json', 'utf8'));
validateCases(cases);
const path = flag('--predictions');
if (!path) {
  console.log(JSON.stringify({ status: 'not-evaluated', cases: cases.length, noAnswerCases: cases.filter(c => !c.expected.length).length,
    note: '种子标注草稿，需人工复核并扩充至方案的 120 组。未调用模型，不能报告模型精确率或召回率。',
    usage: 'npm run evaluate -- --predictions predictions.local.json [--cases reviewed-cases.json] [--out report.local.json]' }, null, 2));
} else {
  const predictions: Prediction[] = JSON.parse(await readFile(path, 'utf8'));
  const select = (subset: EvaluationCase[]) => metrics(subset, predictions.filter(p => subset.some(c => c.id === p.caseId)));
  const report = { models: [...new Set(predictions.map(p => p.model))], promptVersions: [...new Set(predictions.map(p => p.promptVersion))],
    overall: metrics(cases, predictions),
    language: Object.fromEntries(['zh', 'en', 'cross'].map(language => [language, select(cases.filter(c => c.language === language))])),
    split: Object.fromEntries(['tune', 'test'].map(split => [split, select(cases.filter(c => c.split === split))])),
    pageType: Object.fromEntries([...new Set(cases.map(c => c.pageType))].map(type => [type, select(cases.filter(c => c.pageType === type))])) };
  const json = JSON.stringify(report, null, 2); console.log(json); if (flag('--out')) await writeFile(flag('--out')!, json + '\n');
}
