export interface QuickCommand { id: string; name: string; command: string }
export interface Shell { id: string; name: string; path: string; kind: 'posix' | 'fish' }
export interface Config {
  version: number;
  commands: QuickCommand[];
  shells: { selectedId: string; discovered: Shell[]; manual: Shell[]; lastScannedAt: string | null };
}
export interface Configuration { config: Config; defaultShell: Shell | null; defaultError: string | null; unavailableIds: string[] }
export interface QueueItem extends QuickCommand { shell: Shell }
export interface TabState {
  queue: QueueItem[];
  current: QueueItem | null;
  runId: string | null;
  interruptSent: boolean;
  closing: boolean;
  lastResult: string | null;
}
export type RuntimeEvent =
  | { type: 'state'; tabId: string; state: TabState }
  | { type: 'output'; tabId: string; runId: string; text: string; stream: string }
  | { type: 'started'; tabId: string; runId: string; item: QueueItem; startedAt: number }
  | { type: 'finished'; tabId: string; runId: string; result: string };
export type Change =
  | { type: 'saveCommand'; command: QuickCommand }
  | { type: 'deleteCommand'; id: string }
  | { type: 'reorder'; ids: string[] }
  | { type: 'selectShell'; id: string }
  | { type: 'saveShell'; shell: Shell }
  | { type: 'removeShell'; id: string };
