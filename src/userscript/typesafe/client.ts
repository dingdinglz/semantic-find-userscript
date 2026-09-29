import type { LocalPassage, Usage, Judgment } from '../../shared/types';
import { checkAbort, FindError, sleep } from '../../shared/errors';
import { request, parseHTTP } from '../transport/gm-request';
import { readCredential, cleanKey } from '../settings/credentials';
import { bisect, fits } from '../search/batcher';
import { buildRequest } from './prompts';
import { parseEvaluation, parseModels } from './schema';
export type EvaluationContext = {
  credentialId: string; signal: AbortSignal; deadline: number; valid: () => boolean;
  attempt: (retry: boolean) => void; used: (usage: Usage) => void;
};
export class TypeSafeClient {
  constructor(private transport: typeof request = request) {}
  async testConnection(key: string, signal: AbortSignal): Promise<void> {
    const response = await this.transport('/v1/models', cleanKey(key), signal, 10000);
    checkAbort(signal); parseModels(parseHTTP(response));
  }
  async evaluateBatch(query: string, passages: LocalPassage[], ctx: EvaluationContext): Promise<Judgment[]> {
    if (!fits(query, passages)) throw new FindError('length');
    const body = JSON.stringify(buildRequest(query, passages));
    for (let attempt = 0; ; attempt++) {
      checkAbort(ctx.signal);
      if (!ctx.valid()) throw new FindError('stale');
      if (Date.now() >= ctx.deadline) throw new FindError('budget');
      // Re-read on EVERY attempt, including after Retry-After. No cached credential survives a retry.
      const record = readCredential();
      if (!record || record.id !== ctx.credentialId) throw new FindError('auth');
      ctx.attempt(attempt > 0);
      try {
        const response = await this.transport('/v1/systemone', record.apiKey, ctx.signal, Math.min(12000, ctx.deadline - Date.now()), body);
        checkAbort(ctx.signal);
        if (!ctx.valid() || readCredential()?.id !== ctx.credentialId) throw new FindError('stale');
        const result = parseEvaluation(parseHTTP(response), passages.map(p => p.id)); ctx.used(result.usage); return result.judgments;
      } catch (error) {
        if (!(error instanceof FindError)) throw new FindError('protocol');
        // Length-only subdivision is owned here as well, never by both UI and controller.
        if (error.code === 'length' && passages.length > 1) {
          const middle = Math.ceil(passages.length / 2);
          return [...await this.evaluateBatch(query, passages.slice(0, middle), ctx), ...await this.evaluateBatch(query, passages.slice(middle), ctx)];
        }
        if (error.code === 'length' && passages.length === 1 && passages[0].text.length >= 80) {
          // Still only original, already-previewed text. Each half is independent evidence for the same local passage.
          const parts = bisect(passages[0]);
          const left = await this.evaluateBatch(query, [parts[0]], ctx);
          const right = await this.evaluateBatch(query, [parts[1]], ctx);
          if (left[0].model !== right[0].model) throw new FindError('protocol');
          return [{ ...left[0], value: Math.max(left[0].value, right[0].value) }];
        }
        if (!['network', 'timeout', 'rate', 'server'].includes(error.code) || attempt >= 2) throw error;
        const wait = Math.max(error.retryAfter, 500 * 2 ** attempt + Math.random() * 250);
        if (Date.now() + wait >= ctx.deadline) throw new FindError('budget');
        await sleep(wait, ctx.signal);
      }
    }
  }
}
