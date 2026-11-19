import type { Configuration, Shell } from './types';

export function ShellSelector({ configuration, busy, scanning, onSelect, onScan, onEdit, onRemove }: {
  configuration: Configuration; busy: boolean; scanning: boolean;
  onSelect: (id: string) => void; onScan: () => void; onEdit: (shell?: Shell) => void; onRemove: (shell: Shell) => void;
}) {
  const { config, defaultShell, defaultError, unavailableIds } = configuration;
  const all = [...config.shells.discovered, ...config.shells.manual];
  const selected = all.find((shell) => shell.id === config.shells.selectedId);
  const defaultSelected = config.shells.selectedId === 'system-default';
  const unavailable = defaultSelected ? !!defaultError : unavailableIds.includes(config.shells.selectedId);
  const label = defaultSelected ? `系统默认 · ${defaultShell?.name ?? '不可用'}` : `${selected?.name ?? '不可用'}${unavailable ? ' · 不可用' : ''}`;
  const close = (element: HTMLElement) => element.closest('details')?.removeAttribute('open');
  return <details className="shell-selector" role="group" aria-label="选择执行 Shell"><summary className="button" title={unavailable ? defaultError ?? selected?.path : label}>
    {label}<span aria-hidden="true">▾</span></summary>
    <div className="qc-popover shell-options">
      <button disabled={busy} onClick={(event) => { close(event.currentTarget); onSelect('system-default'); }}>
        {defaultSelected ? '✓ ' : ''}系统默认 · {defaultShell?.name ?? '不可用'}</button>
      {all.map((shell) => <div className="shell-option" key={shell.id}>
        <button title={shell.path} disabled={busy} onClick={(event) => { close(event.currentTarget); onSelect(shell.id); }}>
          {selected?.id === shell.id ? '✓ ' : ''}{shell.name}{unavailableIds.includes(shell.id) ? ' · 不可用' : ''}<small>{shell.path}</small></button>
        {config.shells.manual.some((item) => item.id === shell.id) && <>
          <button className="shell-edit" aria-label={`编辑 Shell ${shell.name}`} disabled={busy} onClick={(event) => {
            close(event.currentTarget); onEdit(shell);
          }}>编辑</button>
          <button className="shell-edit" aria-label={`移除 Shell ${shell.name}`} disabled={busy} onClick={(event) => {
            close(event.currentTarget); onRemove(shell);
          }}>移除</button>
        </>}
      </div>)}
      <hr /><button disabled={busy || scanning} onClick={(event) => { close(event.currentTarget); onScan(); }}>{scanning ? '扫描中…' : '重新扫描'}</button>
      <button disabled={busy} onClick={(event) => { close(event.currentTarget); onEdit(); }}>＋ 手动添加…</button>
    </div>
  </details>;
}
