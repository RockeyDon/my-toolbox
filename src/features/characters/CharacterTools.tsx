import { useReducer, useState } from 'react';
import { CodeEditor } from '../../components/CodeEditor';
import { initialJsonState, jsonReducer } from './json-state';
import { displayText, escapeText } from './long-text';

type Tab = 'json' | 'text';

export function CharacterTools() {
  const [tab, setTab] = useState<Tab>('json');
  const [jsonState, dispatch] = useReducer(jsonReducer, initialJsonState);
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const activeText = tab === 'json' ? jsonState.text : text;
  const error = tab === 'json' ? jsonState.error?.message : textError;
  const valid = jsonState.parsed !== null;

  const convertText = (action: 'escape' | 'display') => {
    try { setText(action === 'escape' ? escapeText(text) : displayText(text)); setTextError(null); }
    catch (error) { setTextError((error as Error).message); }
  };

  return <main className="workspace">
    <div className="tabs" role="tablist" aria-label="字符工具">
      {([{ id: 'json', name: 'JSON格式化', icon: '{ }' }, { id: 'text', name: '长文本转换', icon: 'Aa' }] as const).map((item) =>
        <button key={item.id} id={`tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`}
          tabIndex={tab === item.id ? 0 : -1} className={`tab ${tab === item.id ? 'active' : ''}`} onClick={() => setTab(item.id)}
          onKeyDown={(event) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 'json' : event.key === 'End' ? 'text' : tab === 'json' ? 'text' : 'json';
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }
          }}><span className="tab-icon" aria-hidden="true">{item.icon}</span>{item.name}</button>)}
    </div>
    <section className="tool-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === 'json'
        ? <CodeEditor key="json" label="JSON 编辑器" value={jsonState.text} highlighted={jsonState.highlighted} error={jsonState.error}
          contextEnabled={valid && jsonState.layout === 'pretty'}
          placeholder="输入 JSON、JSON5 或 Python 字典 / 列表" onChange={(value) => dispatch({ type: 'edit', text: value })} />
        : <CodeEditor key="text" label="文本编辑器" value={text} placeholder="输入文本或转义内容（不含外围双引号）"
          onChange={(value) => { setText(value); setTextError(null); }} />}
      <div className="editor-status"><span>{activeText.split('\n').length} 行<span className="status-dot">·</span>{Array.from(activeText).length} 字符</span>
        {tab === 'json' && valid && <span className="parsed-status" role="status">已解析</span>}</div>
      <div className="actions">
        <div className="action-buttons">{tab === 'json' ? <>
          <button className="button primary" onClick={() => dispatch({ type: 'format' })}>格式化</button>
          <button className="button" disabled={!valid} onClick={() => dispatch({ type: 'compact' })}>压缩</button>
          <span className="button-divider" />
          <button className="button" disabled={!valid} onClick={() => dispatch({ type: 'unicode' })}>转Unicode</button>
          <button className="button" disabled={!valid} onClick={() => dispatch({ type: 'chinese' })}>转中文</button>
        </> : <>
          <button className="button primary" onClick={() => convertText('escape')}>转义</button>
          <button className="button" onClick={() => convertText('display')}>展示</button>
        </>}</div>
      </div>
    </section>
    {error && <div className="error-message" role="alert">{error}</div>}
  </main>;
}
