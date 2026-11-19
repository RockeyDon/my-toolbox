import { describe, expect, it, vi } from 'vitest';
import { applyEvent, type OutputTab } from './session';
import { emptyOutput, outputText } from './output';
import type { QueueItem } from './types';

vi.mock('@tauri-apps/api/core', () => ({ Channel: class {}, invoke: vi.fn(), isTauri: () => false }));
const item: QueueItem = { id: 'queue-1', name: '示例', command: 'echo example', shell: { id: 'sh', name: 'sh', path: '/bin/sh', kind: 'posix' } };
function tab(): OutputTab {
  return { id: 'tab-1', name: '终端 1', output: emptyOutput(), currentRun: null, following: true, scrollTop: 0,
    state: { queue: [], current: null, runId: null, interruptSent: false, closing: false, lastResult: null } };
}
describe('command session events', () => {
  it('keeps consecutive run output and ignores stale output from an earlier run', () => {
    let current = applyEvent(tab(), { type: 'started', tabId: 'tab-1', runId: 'run-1', item, startedAt: 0 });
    current = applyEvent(current, { type: 'output', tabId: 'tab-1', runId: 'run-1', text: 'FIRST', stream: 'stdout' });
    current = applyEvent(current, { type: 'finished', tabId: 'tab-1', runId: 'run-1', result: '退出码 0' });
    current = applyEvent(current, { type: 'started', tabId: 'tab-1', runId: 'run-2', item, startedAt: 1000 });
    current = applyEvent(current, { type: 'output', tabId: 'tab-1', runId: 'run-1', text: 'STALE', stream: 'stdout' });
    current = applyEvent(current, { type: 'output', tabId: 'tab-1', runId: 'run-2', text: 'SECOND', stream: 'stdout' });
    expect(outputText(current.output)).toContain('FIRST');
    expect(outputText(current.output)).toContain('SECOND');
    expect(outputText(current.output)).not.toContain('STALE');
  });
});
