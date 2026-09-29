import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Credentials, cleanKey, credentialLabel, readCredential } from '../../src/userscript/settings/credentials';
import { exportPreferences, importPreferences, preferences } from '../../src/userscript/settings/preferences';
import { credential, mockGM } from './helpers';
beforeEach(() => mockGM());
describe('credential storage boundaries', () => {
  it('uses random record IDs, saves full records atomically, and does not expose key in settings export', () => {
    const credentials = new Credentials(); const first = credentials.save('  test-only-value  '); const second = credentials.save('test-only-value');
    expect(first.id).not.toBe(second.id); expect(readCredential()).toEqual(second); expect(second.apiKey).toBe('test-only-value');
    expect(credentialLabel()).toContain('alue'); expect(exportPreferences()).not.toContain('test-only-value'); expect(exportPreferences()).not.toContain('apiKey');
    credentials.clear(); expect(readCredential()).toBeUndefined(); credentials.dispose();
  });
  it.each(['', '  ', 'key\n', '\tkey', 'test\u007f', 'key\rvalue'])('rejects empty or control-containing key %s', key => { expect(() => cleanKey(key)).toThrow(); });
  it('does not guess prefixes/lengths and never shows a whole short key as a suffix', () => {
    const credentials = new Credentials(); credentials.save('abc'); expect(credentialLabel()).not.toContain('abc'); expect(cleanKey('abc')).toBe('abc'); credentials.dispose();
  });
  it('broadcasts replacement and deletion once, locally and remotely', () => {
    const gm = mockGM(credential), credentials = new Credentials(), changed = vi.fn(); credentials.subscribe(changed);
    credentials.save('new-placeholder'); expect(changed).toHaveBeenCalledTimes(1);
    gm.set('semanticFind.credentials', { ...credential, id: 'remote-new' }, true); expect(changed).toHaveBeenCalledTimes(2);
    gm.set('semanticFind.credentials', undefined, true); expect(changed).toHaveBeenCalledTimes(3); credentials.dispose(); expect(gm.listeners.size).toBe(0);
  });
  it('never permits imported preferences to overwrite credentials', () => {
    const gm = mockGM(credential);
    expect(() => importPreferences(JSON.stringify({ ...preferences(), credentials: credential }))).toThrow();
    expect(() => importPreferences(JSON.stringify({ ...preferences(), apiKey: 'bad' }))).toThrow();
    importPreferences(JSON.stringify({ ...preferences(), shortcut: 'Alt+Shift+S' })); expect(gm.values.get('semanticFind.credentials')).toEqual(credential);
  });
});
