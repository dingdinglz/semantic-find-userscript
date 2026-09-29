import { describe, expect, it } from 'vitest';
import { matchesShortcut, editablePath } from '../../src/userscript/ui/keyboard';
import { DEFAULTS } from '../../src/userscript/settings/preferences';
describe('shortcuts preserve native find and IME', () => {
  it('keeps native find unless explicitly opted in', () => {
    const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true });
    expect(matchesShortcut(e, DEFAULTS, false)).toBe(false);
    expect(matchesShortcut(e, { ...DEFAULTS, takeoverFind: true }, false)).toBe(true);
  });
  it('matches exact OS modifiers, custom shortcut and ignores composition/repeat', () => {
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'F', metaKey: true, shiftKey: true }), DEFAULTS, true)).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true }), DEFAULTS, false)).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'F', metaKey: true, shiftKey: true, isComposing: true }), DEFAULTS, true)).toBe(false);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 'F', metaKey: true, shiftKey: true, repeat: true }), DEFAULTS, true)).toBe(false);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }), { ...DEFAULTS, shortcut: 'Alt+Shift+S' }, false)).toBe(true);
  });
  it('checks the composed path for outside editable fields', () => {
    const input = document.createElement('input');
    expect(editablePath({ composedPath: () => [input] } as unknown as KeyboardEvent)).toBe(true);
  });
});
