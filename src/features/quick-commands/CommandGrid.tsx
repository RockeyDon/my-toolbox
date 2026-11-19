import { useEffect, useRef, useState } from 'react';
import type { QuickCommand } from './types';

interface Props {
  commands: QuickCommand[];
  disabled: boolean;
  onExecute: (command: QuickCommand) => void;
  onEdit: (command?: QuickCommand) => void;
  onDelete: (command: QuickCommand) => void;
  onReorder: (ids: string[]) => Promise<void>;
}
export function CommandGrid({ commands, disabled, onExecute, onEdit, onDelete, onReorder }: Props) {
  const [drag, setDrag] = useState<{ source: string; target: string } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const cancel = () => { clearTimeout(timer.current); dragRef.current = null; setDrag(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const move = (source: string, target: string) => {
    const ids = commands.map((command) => command.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1); ids.splice(to, 0, source);
    void onReorder(ids);
  };
  return <div className="command-grid" aria-label="快捷命令列表" onKeyDown={(event) => {
    if (event.key === 'Escape') { cancel(); suppressClick.current = true; }
  }}>
    {commands.map((command, index) => <div key={command.id} data-command-id={command.id}
      className={`command-card ${drag?.source === command.id ? 'dragging' : ''} ${drag?.target === command.id ? 'drop-target' : ''}`}>
      <button className="command-trigger" title={`${command.name}\n${command.command}\n按住拖动排序，或按 Alt + 方向键调整`} disabled={disabled}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          origin.current = { x: event.clientX, y: event.clientY }; suppressClick.current = false;
          const button = event.currentTarget;
          timer.current = setTimeout(() => {
            dragRef.current = { source: command.id, target: command.id }; setDrag(dragRef.current);
            suppressClick.current = true; button.setPointerCapture(event.pointerId);
          }, 180);
        }} onPointerMove={(event) => {
          if (!dragRef.current) {
            if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 5) clearTimeout(timer.current);
            return;
          }
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-command-id]')?.dataset.commandId;
          if (target) { dragRef.current = { ...dragRef.current, target }; setDrag(dragRef.current); }
        }} onPointerUp={(event) => {
          const current = dragRef.current;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          cancel(); if (current) move(current.source, current.target);
        }} onPointerCancel={cancel} onKeyDown={(event) => {
          if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            const target = commands[index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1)];
            if (target) move(command.id, target.id);
          }
        }} onClick={() => { if (!suppressClick.current) onExecute(command); suppressClick.current = false; }}>{command.name}</button>
      <div className="command-actions">
        <button aria-label={`编辑命令 ${command.name}`} title="编辑" disabled={disabled} onClick={() => onEdit(command)}>✎</button>
        <button aria-label={`删除命令 ${command.name}`} title="删除" disabled={disabled} onClick={() => onDelete(command)}>×</button>
      </div>
    </div>)}
    <button className="command-add" disabled={disabled} onClick={() => onEdit()}>＋ 添加命令</button>
  </div>;
}
