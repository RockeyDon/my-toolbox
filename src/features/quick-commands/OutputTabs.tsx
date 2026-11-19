import { useLayoutEffect, useRef } from 'react';
import { activateTab, clearOutput, rememberScroll, type OutputTab } from './session';
import { outputText } from './output';

export function OutputTabs({ tabs, activeId, onCreate, onClose, onDelete, onInterrupt, onError }: {
  tabs: OutputTab[]; activeId: string | null; onCreate: () => void; onClose: (tab: OutputTab) => void;
  onDelete: (tabId: string, itemId: string) => void; onInterrupt: (tabId: string, runId: string) => void; onError: (error: string) => void;
}) {
  const tab = tabs.find((item) => item.id === activeId);
  return <section className="qc-output-panel" aria-label="命令输出面板">
    <div className="qc-tab-bar"><div className="qc-tab-list" role="tablist" aria-label="输出标签">
      {tabs.map((item) => <div className={`qc-tab ${item.id === activeId ? 'active' : ''}`} key={item.id}>
        <button role="tab" id={`output-tab-${item.id}`} aria-selected={item.id === activeId} aria-controls={`output-panel-${item.id}`}
          onClick={() => activateTab(item.id)} title={item.name}>{item.state.current && <span className="qc-running-dot" aria-label="执行中">●</span>}{item.name}</button>
        <button className="qc-close" aria-label={`关闭${item.name}`} disabled={item.state.closing} onClick={() => onClose(item)}>×</button>
      </div>)}
    </div><button className="qc-new-tab" aria-label="新建输出标签" title="新建输出标签" onClick={onCreate}>＋</button></div>
    {tab ? <div className="qc-tab-content" role="tabpanel" id={`output-panel-${tab.id}`} aria-labelledby={`output-tab-${tab.id}`}>
      {tab.state.queue.length > 0 && <section className="qc-queue" aria-label="队列区">
        <div className="qc-queue-heading">队列（{tab.state.queue.length}）</div>
        <ol>{tab.state.queue.map((item) => <li key={item.id}><span title={`${item.command}\n${item.shell.path}`}>{item.name}</span>
          <button disabled={tab.state.closing} onClick={() => onDelete(tab.id, item.id)} aria-label={`删除队列命令 ${item.name}`}>删除</button></li>)}</ol>
      </section>}
      <div className="qc-output-tools"><button onClick={() => {
        navigator.clipboard.writeText(outputText(tab.output)).catch((error: unknown) => onError(`复制失败：${String(error)}`));
      }}>复制输出</button><button onClick={() => clearOutput(tab.id)}>清空输出</button></div>
      <OutputView key={tab.id} tab={tab} />
      <div className="qc-execution-status" role="status">
        <span>{tab.state.closing ? '正在清理任务…' : tab.state.current
          ? tab.state.interruptSent ? '中断已发送，等待退出' : `● 执行中 · ${tab.state.current.name}`
          : tab.state.lastResult ?? '空闲'}</span>
        {tab.state.current && tab.state.runId && <button className="button" disabled={tab.state.interruptSent || tab.state.closing}
          onClick={() => onInterrupt(tab.id, tab.state.runId!)}>停止</button>}
      </div>
    </div> : <div className="qc-output-empty">点击命令开始执行，或点击标签右侧 ＋ 新建输出标签</div>}
  </section>;
}

function OutputView({ tab }: { tab: OutputTab }) {
  const element = useRef<HTMLDivElement>(null);
  const initial = useRef(true);
  useLayoutEffect(() => {
    const view = element.current;
    if (!view) return;
    if (tab.following) view.scrollTop = view.scrollHeight;
    else if (initial.current) view.scrollTop = tab.scrollTop;
    initial.current = false;
  }, [tab.output, tab.following, tab.scrollTop]);
  return <div ref={element} className="qc-output" aria-label="命令输出" tabIndex={0} onScroll={(event) => {
    const view = event.currentTarget;
    rememberScroll(tab.id, view.scrollTop, view.scrollHeight - view.scrollTop - view.clientHeight < 24);
  }}>
    {tab.output.truncated && <div className="qc-truncated">输出超过 5 MiB，最早的内容已裁剪</div>}
    {tab.output.lines.map((line, index) => <div className="qc-output-line" key={index}>{line.spans.length
      ? line.spans.map((span, spanIndex) => <span key={spanIndex} style={{ color: span.color, fontWeight: span.bold ? 600 : undefined }}>{span.text}</span>)
      : '\n'}</div>)}
  </div>;
}
