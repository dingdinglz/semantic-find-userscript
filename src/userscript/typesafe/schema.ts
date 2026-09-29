import type { Judgment, Usage } from '../../shared/types';
import { FindError } from '../../shared/errors';
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function parseEvaluation(value: unknown, targetIds: string[]): { judgments: Judgment[]; usage: Usage; model: string } {
  const fail = () => { throw new FindError('protocol'); };
  if (!object(value) || typeof value.model !== 'string' || !value.model || !object(value.answers) || !object(value.usage)) return fail();
  if (Object.keys(value.answers).length !== targetIds.length || Object.keys(value.answers).some(id => !targetIds.includes(id.replace(/^match_/u, '')) || !id.startsWith('match_'))) return fail();
  const model = value.model, answers = value.answers;
  const judgments = targetIds.map(id => {
    const a = answers[`match_${id}`];
    if (!object(a) || a.type !== 'noul' || typeof a.noul !== 'number' || !Number.isFinite(a.noul) || a.noul < 0 || a.noul > 1) return fail();
    return { id, value: a.noul, model };
  });
  const { input_tokens, output_tokens } = value.usage;
  if (typeof input_tokens !== 'number' || !Number.isSafeInteger(input_tokens) || input_tokens < 0 || typeof output_tokens !== 'number' || !Number.isSafeInteger(output_tokens) || output_tokens < 0) return fail();
  return { judgments, usage: { input_tokens, output_tokens }, model };
}
export function parseModels(value: unknown): void {
  if (!object(value) || !Array.isArray(value.models) || !value.models.length || value.models.some(m => !object(m) || typeof m.name !== 'string' || !m.name || typeof m.description !== 'string' || typeof m.release_date !== 'string')) throw new FindError('protocol');
}
