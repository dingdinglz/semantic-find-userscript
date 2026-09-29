import type { Preferences, Scope } from '../../shared/types';
export const SCOPE_LABELS: Record<Scope, string> = { 'loaded-page': '已加载页面文本（含导航与侧边栏）', article: '仅当前正文', selection: '仅选中内容' };
export const SETTINGS_KEY = 'semanticFind.settings';
export const DEFAULTS: Preferences = { schemaVersion: 1, shortcut: 'Mod+Shift+F', takeoverFind: false, scrollMargin: 80, scope: 'loaded-page', sites: {} };
export function validShortcut(shortcut: string): boolean { return /^(Mod|Ctrl|Meta|Alt)(\+(Shift|Alt))?\+[A-Z0-9]$/u.test(shortcut); }
export function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(k => !['schemaVersion', 'shortcut', 'takeoverFind', 'scrollMargin', 'scope', 'sites'].includes(k))) throw new Error('Unknown settings field');
  if (obj.schemaVersion !== 1 || typeof obj.shortcut !== 'string' || !validShortcut(obj.shortcut) || typeof obj.takeoverFind !== 'boolean' ||
      typeof obj.scrollMargin !== 'number' || !Number.isFinite(obj.scrollMargin) || obj.scrollMargin < 0 || obj.scrollMargin > 400 || !obj.sites || typeof obj.sites !== 'object' || Array.isArray(obj.sites)) throw new Error('Invalid settings');
  // Migrate v1 settings without a saved scope; old "ask" sites now use explicit-submit search.
  const scope = obj.scope ?? DEFAULTS.scope;
  if (!Object.hasOwn(SCOPE_LABELS, scope as string)) throw new Error('Invalid scope');
  const sites: Preferences['sites'] = {};
  for (const [origin, mode] of Object.entries(obj.sites)) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || !['ask', 'allow', 'disabled'].includes(mode as string)) throw new Error('Invalid site');
    sites[origin] = mode === 'disabled' ? 'disabled' : 'allow';
  }
  return { schemaVersion: 1, shortcut: obj.shortcut, takeoverFind: obj.takeoverFind, scrollMargin: obj.scrollMargin, scope: scope as Scope, sites };
}
export function preferences(): Preferences {
  try { return parsePreferences(GM_getValue(SETTINGS_KEY)); } catch { return { ...DEFAULTS, sites: {} }; }
}
export function savePreferences(value: Preferences): void { GM_setValue(SETTINGS_KEY, parsePreferences(value)); }
export function exportPreferences(): string { return JSON.stringify(preferences(), null, 2); }
export function importPreferences(json: string): void { savePreferences(parsePreferences(JSON.parse(json))); }
export function siteMode(mode: 'allow' | 'disabled'): void {
  const prefs = preferences(); prefs.sites[location.origin] = mode; savePreferences(prefs);
}
