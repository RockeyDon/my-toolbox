import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CommandGrid } from './CommandGrid';
import { CommandDialog, Modal, ShellDialog } from './CommandDialog';
import { ShellSelector } from './ShellSelector';
import { OutputTabs } from './OutputTabs';
import type { Change, Configuration, QuickCommand, Shell } from './types';
import {
  closeTab, createTab, deleteQueueItem, getSession, interruptTask, loadConfiguration, scanShells, submitCommand,
  subscribe, updateConfiguration, type OutputTab,
} from './session';
import './quick-commands.css';

type Dialog = { type: 'command'; command?: QuickCommand } | { type: 'shell'; shell?: Shell } | null;
interface Confirmation { title: string; message: string; action: () => Promise<void> }
let initialConfiguration: Promise<Configuration> | undefined;
export function QuickCommands() {
  const session = useSyncExternalStore(subscribe, getSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const operation = useRef(false);
  const submitting = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    initialConfiguration ??= loadConfiguration().then(async (loaded) => {
      try { return { configuration: await scanShells(), scanError: '' }; }
      catch (error) { return { configuration: loaded, scanError: `Shell 扫描失败：${String(error)}` }; }
    }).then((result) => {
      if (result.scanError && active) setError(result.scanError);
      return result.configuration;
    });
    const loadingConfiguration = initialConfiguration;
    loadingConfiguration.then((loaded) => { if (active) setConfiguration(loaded); })
      .catch((error: unknown) => {
        if (initialConfiguration === loadingConfiguration) initialConfiguration = undefined;
        if (active) setError(String(error));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    try { await action(); } catch (error) { setError(String(error)); }
  };
  const update = async (change: Change) => {
    while (operation.current) await new Promise((resolve) => setTimeout(resolve, 15));
    operation.current = true; setBusy(true);
    try { setConfiguration(await updateConfiguration(change)); setError(''); }
    finally { operation.current = false; setBusy(false); }
  };
  const execute = (command: QuickCommand) => {
    submitting.current = submitting.current.then(async () => {
      const tabId = getSession().activeId ?? await createTab();
      await submitCommand(tabId, command.id);
    }).catch((error: unknown) => setError(String(error)));
  };
  const scan = async () => {
    setScanning(true);
    try { setConfiguration(await scanShells()); setError(''); }
    catch (error) { setError(`Shell 扫描失败：${String(error)}`); }
    finally { setScanning(false); }
  };
  const removeShell = (shell: Shell) => setConfirmation({ title: '移除 Shell',
    message: `移除“${shell.name}”？${configuration?.config.shells.selectedId === shell.id ? '当前选择将切回系统默认。' : ''}已提交的任务不受影响。`,
    action: () => update({ type: 'removeShell', id: shell.id }),
  });
  const removeTab = (tab: OutputTab) => {
    if (tab.state.current || tab.state.queue.length) setConfirmation({ title: '关闭输出标签',
      message: '终止当前任务、丢弃待执行队列并关闭标签？', action: () => closeTab(tab.id),
    });
    else void run(() => closeTab(tab.id));
  };

  return <main className="workspace quick-commands">
    <div className="qc-toolbar">{configuration && <ShellSelector configuration={configuration} busy={busy} scanning={scanning}
      onSelect={(id) => void run(() => update({ type: 'selectShell', id }))} onScan={() => void scan()}
      onEdit={(shell) => setDialog({ type: 'shell', shell })} onRemove={removeShell} />}</div>
    {loading && <p className="qc-help" role="status">正在加载快捷命令…</p>}
    {configuration && <CommandGrid commands={configuration.config.commands} disabled={busy}
      onExecute={execute} onEdit={(command) => setDialog({ type: 'command', command })}
      onDelete={(command) => setConfirmation({ title: '删除命令', message: `删除“${command.name}”？已运行和排队的任务不受影响。`,
        action: () => update({ type: 'deleteCommand', id: command.id }),
      })} onReorder={async (ids) => { await run(() => update({ type: 'reorder', ids })); }} />}
    {error && <div className="qc-error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button>
      {!configuration && !loading && <button className="button" onClick={() => {
        setLoading(true);
        void run(async () => { try { setConfiguration(await loadConfiguration()); setError(''); } finally { setLoading(false); } });
      }}>重新加载</button>}</div>}
    <OutputTabs tabs={session.tabs} activeId={session.activeId} onCreate={() => void run(createTab)} onClose={removeTab}
      onDelete={(tabId, itemId) => void run(() => deleteQueueItem(tabId, itemId))}
      onInterrupt={(tabId, runId) => void run(() => interruptTask(tabId, runId))} onError={setError} />
    {dialog?.type === 'command' && <CommandDialog command={dialog.command} onCancel={() => setDialog(null)} onSave={async (command) => {
      await update({ type: 'saveCommand', command }); setDialog(null);
    }} />}
    {dialog?.type === 'shell' && <ShellDialog shell={dialog.shell} onCancel={() => setDialog(null)} onSave={async (shell) => {
      await update({ type: 'saveShell', shell }); setDialog(null);
    }} />}
    {confirmation && <Modal title={confirmation.title} onCancel={() => { if (!confirming) setConfirmation(null); }}>
      <p>{confirmation.message}</p><div className="qc-dialog-actions"><button className="button" disabled={confirming} onClick={() => setConfirmation(null)}>取消</button>
        <button className="button primary" disabled={confirming} onClick={() => {
          setConfirming(true); void run(async () => {
            try { await confirmation.action(); setConfirmation(null); } finally { setConfirming(false); }
          });
        }}>{confirming ? '处理中…' : '确认'}</button></div>
    </Modal>}
  </main>;
}
