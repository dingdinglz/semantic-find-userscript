import type { Preferences } from '../../shared/types';
export function editablePath(event: KeyboardEvent): boolean {
  return event.composedPath().some(node => node instanceof Element && (!!node.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')));
}
export function matchesShortcut(event: KeyboardEvent, prefs: Preferences, mac = /Mac|iPhone|iPad/iu.test(navigator.platform)): boolean {
  if (event.isComposing || event.repeat) return false;
  const matches = (shortcut: string) => {
    const parts = shortcut.toLowerCase().replace('mod', mac ? 'meta' : 'ctrl').split('+');
    return event.key.toLowerCase() === parts.at(-1) && event.ctrlKey === parts.includes('ctrl') && event.metaKey === parts.includes('meta') && event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt');
  };
  return matches(prefs.shortcut) || (prefs.takeoverFind && matches('Mod+F'));
}
