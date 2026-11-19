import { useState } from 'react';
import { CharacterTools } from './features/characters/CharacterTools';
import { QuickCommands } from './features/quick-commands/QuickCommands';

export function App() {
  const [module, setModule] = useState<'characters' | 'commands'>('characters');
  const [commandsVisited, setCommandsVisited] = useState(false);
  return <div className="app-layout">
    <aside className="sidebar">
      <nav aria-label="工具菜单">
        <button className={`nav-item ${module === 'characters' ? 'selected' : ''}`} aria-current={module === 'characters' ? 'page' : undefined}
          onClick={() => setModule('characters')}><span className="nav-icon" aria-hidden="true">{'{ }'}</span>字符工具</button>
        <button className={`nav-item ${module === 'commands' ? 'selected' : ''}`} aria-current={module === 'commands' ? 'page' : undefined}
          onClick={() => { setCommandsVisited(true); setModule('commands'); }}><span className="nav-icon" aria-hidden="true">&gt;_</span>快捷命令</button>
      </nav>
    </aside>
    <div className="module-view" hidden={module !== 'characters'}><CharacterTools /></div>
    {commandsVisited && <div className="module-view" hidden={module !== 'commands'}><QuickCommands /></div>}
  </div>;
}
