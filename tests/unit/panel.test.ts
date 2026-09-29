import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panel } from '../../src/userscript/ui/panel';
import { Credentials } from '../../src/userscript/settings/credentials';
import { TypeSafeClient } from '../../src/userscript/typesafe/client';
import { mockGM } from './helpers';

const keyEvents = ['keydown', 'keypress', 'keyup'] as const;
describe('panel keyboard isolation', () => {
  let panel: Panel, credentials: Credentials, listeners: AbortController;
  const pageKey = vi.fn(), search = vi.fn();
  beforeEach(() => {
    mockGM(); credentials = new Credentials(); listeners = new AbortController();
    pageKey.mockClear(); search.mockClear();
    for (const type of keyEvents) {
      document.addEventListener(type, pageKey, { signal: listeners.signal });
      window.addEventListener(type, pageKey, { signal: listeners.signal });
    }
    panel = new Panel({ close() {}, settings() {}, search, stop() {}, select() {}, navigate() {}, queryChanged() {}, preferencesChanged() {} });
  });
  afterEach(() => { panel.dispose(); credentials.dispose(); listeners.abort(); vi.unstubAllGlobals(); });

  it.each(keyEvents)('keeps %s for s/i inside the panel without blocking local handlers or defaults', type => {
    const inputKey = vi.fn(), panelKey = vi.fn();
    panel.query.addEventListener(type, inputKey);
    panel.shadow.querySelector('section')!.addEventListener(type, panelKey);
    for (const key of ['s', 'i']) {
      const event = new KeyboardEvent(type, { key, bubbles: true, composed: true, cancelable: true });
      expect(panel.query.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(inputKey).toHaveBeenCalledTimes(2); expect(panelKey).toHaveBeenCalledTimes(2);
    expect(pageKey).not.toHaveBeenCalled();
  });

  it('also isolates settings inputs, selects, textareas and keyboard-operated controls', () => {
    panel.showSettings(credentials, new TypeSafeClient(), () => {});
    const controls = panel.shadow.querySelectorAll('input,select,textarea,button,summary,a');
    expect(panel.shadow.querySelector('#sf-api-key')).not.toBeNull();
    expect(panel.shadow.querySelector('#sf-shortcut')).not.toBeNull();
    for (const control of controls) for (const type of keyEvents) {
      const localKey = vi.fn(); control.addEventListener(type, localKey, { once: true });
      const event = new KeyboardEvent(type, { key: 'i', bubbles: true, composed: true, cancelable: true });
      expect(control.dispatchEvent(event)).toBe(true); expect(localKey).toHaveBeenCalledOnce();
    }
    expect(pageKey).not.toHaveBeenCalled();
  });

  it('does not cancel editing, Tab, native find, repeated keys or IME confirmation', () => {
    const keys: KeyboardEventInit[] = [
      { key: 'Tab' }, { key: 'Backspace' }, { key: 'ArrowLeft' },
      { key: 'f', ctrlKey: true }, { key: 'f', metaKey: true },
      { key: 's', repeat: true }, { key: 'i', isComposing: true }, { key: 'Enter', isComposing: true },
    ];
    for (const init of keys) for (const type of keyEvents) {
      const event = new KeyboardEvent(type, { ...init, bubbles: true, composed: true, cancelable: true });
      expect(panel.query.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(search).not.toHaveBeenCalled(); expect(pageKey).not.toHaveBeenCalled();
  });

  it('preserves the document-capture path used by Escape and the open shortcut', () => {
    const captureKey = vi.fn();
    document.addEventListener('keydown', captureKey, { capture: true, signal: listeners.signal });
    for (const init of [{ key: 'Escape' }, { key: 'F', ctrlKey: true, shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, composed: true, cancelable: true });
      panel.query.dispatchEvent(event); expect(captureKey).toHaveBeenLastCalledWith(event);
    }
    expect(pageKey).not.toHaveBeenCalled();
  });

  it('leaves page shortcuts outside the panel alone while it is open', () => {
    for (const type of keyEvents) {
      const event = new KeyboardEvent(type, { key: 's', bubbles: true, composed: true, cancelable: true });
      expect(document.body.dispatchEvent(event)).toBe(true);
    }
    expect(pageKey).toHaveBeenCalledTimes(6);
  });
});
