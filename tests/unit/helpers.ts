import { vi } from 'vitest';
import type { CredentialRecord, LocalPassage, PageSnapshot } from '../../src/shared/types';
export function mockGM(record?: CredentialRecord) {
  const values = new Map<string, unknown>(); if (record) values.set('semanticFind.credentials', record);
  const listeners = new Map<number, { key: string; fn: (key: string, old: unknown, value: unknown, remote: boolean) => void }>();
  let id = 0;
  const set = (key: string, value: unknown, remote = false) => { const old = values.get(key); if (value === undefined) values.delete(key); else values.set(key, value); listeners.forEach(l => { if (l.key === key) l.fn(key, old, value, remote); }); };
  vi.stubGlobal('GM_info', { scriptHandler: 'Tampermonkey', version: '5.4.6226' });
  vi.stubGlobal('GM_getValue', (key: string, fallback?: unknown) => values.get(key) ?? fallback);
  vi.stubGlobal('GM_setValue', vi.fn((key, value) => set(key, value)));
  vi.stubGlobal('GM_deleteValue', vi.fn(key => set(key, undefined)));
  vi.stubGlobal('GM_addValueChangeListener', (key: string, fn: (key: string, old: unknown, value: unknown, remote: boolean) => void) => { listeners.set(++id, { key, fn }); return id; });
  vi.stubGlobal('GM_removeValueChangeListener', (id: number) => listeners.delete(id));
  vi.stubGlobal('GM_addStyle', (css: string) => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return style; });
  return { values, set, listeners };
}
export const credential: CredentialRecord = { schemaVersion: 1, id: 'test-record-v1', apiKey: 'test-placeholder-not-a-real-key' };
export function passage(index: number, text = 'Original passage.'): LocalPassage {
  const container = document.createElement('p'); container.textContent = text; document.body.append(container); const node = container.firstChild as Text;
  return { id: `b${String(index).padStart(5, '0')}`, text, normalizedText: text, textHash: text, headingPath: [], before: '', after: '', order: index - 1, container,
    slices: [{ node, nodeStart: 0, nodeEnd: text.length, rawStart: 0, rawEnd: text.length }] };
}
export function snapshot(count = 3): PageSnapshot { return { id: 'snapshot-1', digest: 'digest', pageEpoch: 0, revision: 1, root: document.body, scope: 'article', limitations: [], passages: Array.from({ length: count }, (_, i) => passage(i + 1)) }; }
export function response(ids: string[], value = 0.9) { return { model: 'jev-1.13.0', answers: Object.fromEntries(ids.map(id => [`match_${id}`, { type: 'noul', noul: value }])), usage: { input_tokens: 120, output_tokens: 20 } }; }
