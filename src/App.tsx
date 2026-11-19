import { CharacterTools } from './features/characters/CharacterTools';

export function App() {
  return <div className="app-layout">
    <aside className="sidebar">
      <nav aria-label="工具菜单"><button className="nav-item selected" aria-current="page"><span className="nav-icon" aria-hidden="true">{'{ }'}</span>字符工具</button></nav>
    </aside>
    <CharacterTools />
  </div>;
}
