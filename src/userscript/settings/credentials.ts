import type { CredentialRecord } from '../../shared/types';
import { FindError } from '../../shared/errors';
import { uid } from '../../shared/utils';
export const CREDENTIAL_KEY = 'semanticFind.credentials';
export const VERIFIED_KEY = 'semanticFind.verification';
export function cleanKey(value: string): string {
  // Check before trimming so a pasted newline/control character is not silently accepted.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value) || !value.trim()) throw new FindError('auth');
  return value.trim();
}
export function readCredential(): CredentialRecord | undefined {
  const value = GM_getValue<unknown>(CREDENTIAL_KEY);
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Partial<CredentialRecord>;
  if (r.schemaVersion !== 1 || typeof r.id !== 'string' || !r.id || typeof r.apiKey !== 'string') return undefined;
  try { if (cleanKey(r.apiKey) !== r.apiKey) return undefined; } catch { return undefined; }
  return r as CredentialRecord;
}
export function credentialLabel(): string {
  const record = readCredential();
  if (!record) return '未配置';
  const verified = GM_getValue<string>(VERIFIED_KEY) === record.id;
  return `已配置${record.apiKey.length > 8 ? `，末尾 ${record.apiKey.slice(-4)}` : ''} · ${verified ? '连接已验证' : '尚未验证'}`;
}
export class Credentials {
  private listeners = new Set<() => void>();
  private lastId = readCredential()?.id;
  private listenerId = GM_addValueChangeListener(CREDENTIAL_KEY, () => this.changed());
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void {
    const id = readCredential()?.id; if (id === this.lastId) return;
    this.lastId = id; this.listeners.forEach(fn => fn());
  }
  save(draft: string, verified = false): CredentialRecord {
    const record: CredentialRecord = { schemaVersion: 1, id: uid(), apiKey: cleanKey(draft) };
    GM_deleteValue(VERIFIED_KEY);
    GM_setValue(CREDENTIAL_KEY, record);
    if (verified) GM_setValue(VERIFIED_KEY, record.id);
    this.changed(); return record;
  }
  clear(): void { GM_deleteValue(VERIFIED_KEY); GM_deleteValue(CREDENTIAL_KEY); this.changed(); }
  verify(id: string): void { if (readCredential()?.id === id) GM_setValue(VERIFIED_KEY, id); }
  dispose(): void { GM_removeValueChangeListener(this.listenerId); this.listeners.clear(); }
}
