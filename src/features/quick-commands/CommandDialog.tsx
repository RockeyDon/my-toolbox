import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { QuickCommand, Shell } from './types';
import { pickShell } from './session';

export function Modal({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="qc-dialog" aria-label={title} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2>{title}</h2>{children}
  </dialog>;
}

export function CommandDialog({ command, onSave, onCancel }: {
  command?: QuickCommand; onSave: (command: QuickCommand) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(command?.name ?? '');
  const [text, setText] = useState(command?.command ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <Modal title={command ? '编辑命令' : '添加命令'} onCancel={() => { if (!saving) onCancel(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!name.trim() || !text.trim()) { setError('名称和命令不可为空'); return; }
      setSaving(true); setError('');
      try { await onSave({ id: command?.id ?? crypto.randomUUID(), name: name.trim(), command: text }); }
      catch (error) { setError(String(error)); setSaving(false); }
    }}>
      <label>名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
      <label>命令<textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} disabled={saving} spellCheck={false} /></label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="qc-dialog-actions"><button className="button" type="button" disabled={saving} onClick={onCancel}>取消</button>
        <button className="button primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div>
    </form>
  </Modal>;
}

export function ShellDialog({ shell, onSave, onCancel }: { shell?: Shell; onSave: (shell: Shell) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(shell?.name ?? '');
  const [path, setPath] = useState(shell?.path ?? '');
  const [kind, setKind] = useState<'posix' | 'fish'>(shell?.kind ?? 'posix');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const choose = async () => {
    try {
      const selected = await pickShell();
      if (selected) { setPath(selected); setKind(selected.split('/').at(-1) === 'fish' ? 'fish' : 'posix'); }
    } catch (error) { setError(String(error)); }
  };
  return <Modal title={shell ? '编辑 Shell' : '手动添加 Shell'} onCancel={() => { if (!saving) onCancel(); }}>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError(''); setSaving(true);
      try { await onSave({ id: shell?.id ?? crypto.randomUUID(), name, path, kind }); }
      catch (error) { setError(String(error)); setSaving(false); }
    }}>
      <label>显示名称（可选）<input autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={saving} /></label>
      <label>可执行文件<div className="qc-path"><input required value={path} onChange={(event) => setPath(event.target.value)} disabled={saving} />
        <button type="button" className="button" disabled={saving} onClick={() => void choose()}>选择文件…</button></div></label>
      <label>Shell 兼容类型<select value={kind} onChange={(event) => setKind(event.target.value as 'posix' | 'fish')} disabled={saving}>
        <option value="posix">POSIX（sh / zsh / bash / dash / ksh）</option><option value="fish">fish</option></select></label>
      <p className="qc-help">包装程序必须兼容所选类型的登录与命令参数；普通可执行文件不能作为 Shell。</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="qc-dialog-actions"><button className="button" type="button" disabled={saving} onClick={onCancel}>取消</button>
        <button className="button primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button></div>
    </form>
  </Modal>;
}
