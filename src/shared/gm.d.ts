import type { GMRequest } from './types';
declare global {
  const GM_xmlhttpRequest: GMRequest;
  const GM_info: { scriptHandler: string; version?: string };
  function GM_getValue<T = unknown>(key: string, fallback?: T): T;
  function GM_setValue(key: string, value: unknown): void;
  function GM_deleteValue(key: string): void;
  function GM_registerMenuCommand(label: string, callback: () => void): number;
  function GM_addValueChangeListener(key: string, callback: (key: string, oldValue: unknown, newValue: unknown, remote: boolean) => void): number;
  function GM_removeValueChangeListener(id: number): void;
  function GM_addStyle(css: string): HTMLStyleElement;
}
export {};
