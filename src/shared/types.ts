export type Scope = 'article' | 'selection' | 'loaded-page';
export type TextSlice = { node: Text; nodeStart: number; nodeEnd: number; rawStart: number; rawEnd: number };
export type LocalPassage = {
  id: string; order: number; text: string; normalizedText: string;
  headingPath: string[]; before: string; after: string;
  slices: TextSlice[]; textHash: string; container: Element;
};
export type PageSnapshot = {
  id: string; pageEpoch: number; revision: number; scope: Scope;
  passages: LocalPassage[]; limitations: string[]; root: Element; digest: string;
};
export type CredentialRecord = { schemaVersion: 1; id: string; apiKey: string };
export type Usage = { input_tokens: number; output_tokens: number };
export type Judgment = { id: string; value: number; model: string };
export type SearchRun = {
  runId: string; pageEpoch: number; snapshotId: string; revision: number; credentialId: string;
  query: string; total: number; completed: number; failed: number;
  status: 'running' | 'complete' | 'partial' | 'cancelled' | 'stale';
  judgments: Map<string, Judgment>; requests: number; retries: number; usage: Usage; error?: string;
};
export type Preferences = {
  schemaVersion: 1; shortcut: string; takeoverFind: boolean; scrollMargin: number;
  sites: Record<string, 'ask' | 'allow' | 'disabled'>;
};
export type GMResponse = { status: number; responseText: string; responseHeaders: string; finalUrl?: string };
export type GMRequestDetails = {
  method: 'GET' | 'POST'; url: string; headers: Record<string, string>; data?: string;
  anonymous: true; redirect: 'error'; fetch: true;
  onload: (response: GMResponse) => void; onerror: () => void; ontimeout: () => void; onabort: () => void;
};
export type GMRequest = (details: GMRequestDetails) => { abort(): void };
