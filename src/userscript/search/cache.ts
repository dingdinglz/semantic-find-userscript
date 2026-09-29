import type { Judgment, PageSnapshot } from '../../shared/types';
import { MODEL, PROMPT_VERSION } from '../typesafe/prompts';
import { SPLIT_VERSION } from '../extract/passages';
export class SearchCache {
  private entries = new Map<string, Map<string, Judgment>>();
  key(snapshot: PageSnapshot, query: string, credentialId: string): string {
    return JSON.stringify([snapshot.id, snapshot.digest, snapshot.passages.map(p => [p.id, p.textHash, p.headingPath, p.before, p.after]), query.trim(), MODEL, PROMPT_VERSION, SPLIT_VERSION, credentialId]);
  }
  get(key: string): Map<string, Judgment> { return new Map(this.entries.get(key)); }
  set(key: string, value: Map<string, Judgment>): void {
    this.entries.delete(key); this.entries.set(key, new Map(value));
    while (this.entries.size > 10 || this.size() > 5 * 1024 * 1024) this.entries.delete(this.entries.keys().next().value!);
  }
  private size(): number { return [...this.entries].reduce((n, [key, value]) => n + key.length * 2 + value.size * 160, 0); }
  clear(): void { this.entries.clear(); }
}
