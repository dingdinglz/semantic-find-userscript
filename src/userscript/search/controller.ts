import type { PageSnapshot, SearchRun } from '../../shared/types';
import { FindError, safeMessage } from '../../shared/errors';
import { uid } from '../../shared/utils';
import { readCredential } from '../settings/credentials';
import { batches } from './batcher';
import { SearchCache } from './cache';
import { TypeSafeClient } from '../typesafe/client';
export class SearchController {
  run?: SearchRun;
  private abort?: AbortController;
  readonly cache = new SearchCache();
  constructor(private client: TypeSafeClient, private update: (run: SearchRun) => void, private budgetMs = 45000) {}
  cancel(status: 'cancelled' | 'stale' = 'cancelled'): void {
    this.abort?.abort(); this.abort = undefined;
    if (this.run) { this.run.status = status; if (status === 'stale') this.run.judgments.clear(); this.update(this.run); }
  }
  clear(): void { this.cancel(); this.run = undefined; this.cache.clear(); }
  async start(snapshot: PageSnapshot, rawQuery: string, credentialId: string, authorized: () => boolean): Promise<void> {
    const query = rawQuery.trim();
    if (!query || !authorized()) return;
    if (this.run?.status === 'running' && this.run.snapshotId === snapshot.id && this.run.query === query && this.run.credentialId === credentialId) return;
    this.cancel();
    if (readCredential()?.id !== credentialId) throw new FindError('auth');
    const key = this.cache.key(snapshot, query, credentialId), judgments = this.cache.get(key);
    // Plan against the complete snapshot, then skip cached questions, never cached context.
    const plan = batches(query, snapshot.passages);
    const queue = plan.map(batch => ({ ...batch, passages: batch.passages.filter(p => !judgments.has(p.id)) })).filter(batch => batch.passages.length);
    const previous = this.run?.snapshotId === snapshot.id && this.run.query === query && this.run.credentialId === credentialId ? this.run : undefined;
    const run: SearchRun = { runId: uid(), pageEpoch: snapshot.pageEpoch, snapshotId: snapshot.id, revision: snapshot.revision, credentialId, query,
      total: snapshot.passages.length, completed: judgments.size, failed: 0, status: 'running', judgments, windowed: plan.some(batch => batch.context.length < snapshot.passages.length),
      requests: previous?.requests ?? 0, retries: previous?.retries ?? 0, usage: previous ? { ...previous.usage } : { input_tokens: 0, output_tokens: 0 } };
    this.run = run; const abort = new AbortController(); this.abort = abort; const deadline = Date.now() + this.budgetMs;
    const valid = () => this.run === run && run.runId === this.run.runId && !abort.signal.aborted && run.status === 'running' &&
      run.pageEpoch === snapshot.pageEpoch && run.snapshotId === snapshot.id && run.revision === snapshot.revision && readCredential()?.id === credentialId && authorized();
    const timer = setTimeout(() => { if (valid()) { run.status = 'partial'; run.error = safeMessage(new FindError('budget')); abort.abort(); this.update(run); } }, this.budgetMs);
    this.update(run);
    const worker = async () => {
      while (queue.length && valid()) {
        const batch = queue.shift()!;
        try {
          const results = await this.client.evaluateBatch(query, batch.passages, { credentialId, signal: abort.signal, deadline, valid,
            attempt: retry => { if (valid()) { run.requests++; if (retry) run.retries++; } },
            used: usage => { if (valid()) { run.usage.input_tokens += usage.input_tokens; run.usage.output_tokens += usage.output_tokens; } } }, batch.context);
          if (!valid()) return;
          results.forEach(j => run.judgments.set(j.id, j)); run.completed = run.judgments.size;
          this.cache.set(key, run.judgments); this.update(run);
        } catch (error) {
          if (!valid()) return;
          run.failed += batch.passages.length; run.error = safeMessage(error);
          if (error instanceof FindError && ['compatibility', 'auth', 'stale', 'budget', 'protocol', 'length'].includes(error.code)) {
            run.status = error.code === 'stale' ? 'stale' : 'partial'; abort.abort();
          }
          this.update(run);
        }
      }
    };
    try { await Promise.all([worker(), worker()]); }
    finally { clearTimeout(timer); }
    if (this.run !== run) return;
    if (run.status === 'running') run.status = run.completed === run.total && run.failed === 0 ? 'complete' : 'partial';
    this.update(run);
  }
}
