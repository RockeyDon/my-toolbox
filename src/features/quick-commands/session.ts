import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { Change, Configuration, RuntimeEvent, TabState } from './types';
import { appendOutput, emptyOutput, type Output } from './output';

export interface OutputTab {
  id: string;
  name: string;
  state: TabState;
  output: Output;
  currentRun: string | null;
  scrollTop: number;
  following: boolean;
}
interface Session { tabs: OutputTab[]; activeId: string | null }
let session: Session = { tabs: [], activeId: null };
let nextNumber = 1;
const listeners = new Set<() => void>();
const pending = new Map<string, RuntimeEvent[]>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function publish() { for (const listener of listeners) listener(); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getSession() { return session; }

export function applyEvent(tab: OutputTab, event: RuntimeEvent): OutputTab {
  if (event.type === 'state') return { ...tab, state: event.state };
  if (event.type === 'started') {
    const header = `\n── ${event.item.name} · ${new Date(event.startedAt).toLocaleTimeString()} ──\n$ ${event.item.command}\n`;
    return { ...tab, currentRun: event.runId, output: appendOutput({ ...tab.output, pending: '', color: undefined, bold: false }, header) };
  }
  if (tab.currentRun !== event.runId) return tab;
  if (event.type === 'finished') {
    return { ...tab, currentRun: null, output: appendOutput({ ...tab.output, pending: '', color: undefined, bold: false }, `\n${event.result}\n`) };
  }
  return { ...tab, output: appendOutput(tab.output, event.text, event.stream) };
}

export function flushEvents() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  if (!pending.size) return;
  session = { ...session, tabs: session.tabs.map((tab) => {
    const events = pending.get(tab.id) ?? [];
    return events.reduce(applyEvent, tab);
  }) };
  pending.clear();
  publish();
}
function receive(event: RuntimeEvent) {
  if (!session.tabs.some((tab) => tab.id === event.tabId)) return;
  const events = pending.get(event.tabId) ?? [];
  events.push(event);
  pending.set(event.tabId, events);
  if (!flushTimer) flushTimer = setTimeout(flushEvents, 40);
}

export async function createTab() {
  const channel = new Channel<RuntimeEvent>();
  const early: RuntimeEvent[] = [];
  let ready = false;
  channel.onmessage = (event) => { if (ready) receive(event); else early.push(event); };
  const id = await invoke<string>('qc_create_tab', { channel });
  const state: TabState = { queue: [], current: null, runId: null, interruptSent: false, closing: false, lastResult: null };
  const tab: OutputTab = { id, name: `终端 ${nextNumber++}`, state, output: emptyOutput(), currentRun: null, scrollTop: 0, following: true };
  session = { tabs: [...session.tabs, tab], activeId: id };
  ready = true;
  early.forEach(receive);
  publish();
  return id;
}
export function activateTab(id: string) { session = { ...session, activeId: id }; publish(); }
export async function closeTab(id: string) {
  const tab = session.tabs.find((item) => item.id === id);
  if (!tab) return;
  await invoke('qc_close_tab', { tabId: id });
  pending.delete(id);
  const index = session.tabs.findIndex((tab) => tab.id === id);
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  session = { tabs, activeId: session.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : session.activeId };
  publish();
}
export function clearOutput(id: string) {
  flushEvents();
  session = { ...session, tabs: session.tabs.map((tab) => tab.id === id ? { ...tab, output: emptyOutput() } : tab) };
  publish();
}
export function rememberScroll(id: string, scrollTop: number, following: boolean) {
  session = { ...session, tabs: session.tabs.map((tab) => tab.id === id ? { ...tab, scrollTop, following } : tab) };
}
export async function loadConfiguration() {
  if (!isTauri()) throw new Error('快捷命令需要在桌面应用中使用；浏览器无法执行本机命令。');
  return invoke<Configuration>('qc_load');
}
export const updateConfiguration = (change: Change) => invoke<Configuration>('qc_update', { change });
export const scanShells = () => invoke<Configuration>('qc_scan');
export const pickShell = () => invoke<string | null>('qc_pick_shell');
export const submitCommand = (tabId: string, commandId: string) => invoke('qc_submit', { tabId, commandId });
export const deleteQueueItem = (tabId: string, itemId: string) => invoke('qc_delete_queue', { tabId, itemId });
export const interruptTask = (tabId: string, runId: string) => invoke('qc_interrupt', { tabId, runId });
