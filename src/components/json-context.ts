import type { EditorState, Extension } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, showPanel, type Panel, type ViewUpdate } from '@codemirror/view';
import { highlightTree, type Highlighter } from '@lezer/highlight';

export type ContextRow = { from: number; to: number; number: number; text: string };

export function jsonContextRows(state: EditorState, position: number, limit: number): ContextRow[] {
  if (limit <= 0) return [];
  const line = state.doc.lineAt(position);
  const anchor = Math.min(line.to, line.from + line.text.search(/\S|$/));
  const rows: ContextRow[] = [];
  const cursor = syntaxTree(state).cursorAt(anchor, 1);
  do {
    if (cursor.name !== 'Object' && cursor.name !== 'Array') continue;
    const start = state.doc.lineAt(cursor.from);
    if (start.number >= line.number || cursor.to <= anchor) continue;
    if (!rows.some((row) => row.number === start.number)) rows.push({ from: start.from, to: start.to, number: start.number, text: start.text });
    if (rows.length >= limit) break;
  } while (cursor.parent());
  return rows.reverse();
}

class JsonContextPanel implements Panel {
  readonly dom = document.createElement('nav');
  readonly top = true;
  private destroyed = false;
  private signature = '';

  constructor(private view: EditorView, private highlighter: Highlighter) {
    this.dom.className = 'json-context';
    this.dom.setAttribute('aria-label', 'JSON 父级上下文');
    this.dom.hidden = true;
  }

  mount() {
    this.view.scrollDOM.addEventListener('scroll', this.measure, { passive: true });
    this.measure();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged || update.startState !== update.state) this.measure();
  }

  destroy() {
    this.destroyed = true;
    this.view.scrollDOM.removeEventListener('scroll', this.measure);
  }

  private measure = () => {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const scroller = view.scrollDOM.getBoundingClientRect();
        const block = view.lineBlockAtHeight(Math.max(0, scroller.top - view.documentTop));
        const limit = Math.min(5, Math.floor((view.dom.clientHeight / 4 - 1) / view.defaultLineHeight));
        const gutter = view.dom.querySelector('.cm-gutters')?.getBoundingClientRect().width ?? 0;
        const numbers = view.dom.querySelector('.cm-lineNumbers')?.getBoundingClientRect().width ?? gutter;
        return { rows: jsonContextRows(view.state, block.from, limit), gutter, numbers, left: view.scrollDOM.scrollLeft, lineHeight: view.defaultLineHeight };
      },
      write: ({ rows, gutter, numbers, left, lineHeight }) => {
        if (this.destroyed) return;
        this.dom.style.setProperty('--context-gutter', `${gutter}px`);
        this.dom.style.setProperty('--context-number-padding', `${gutter - numbers + 10}px`);
        this.dom.style.setProperty('--context-scroll', `${-left}px`);
        this.dom.style.setProperty('--context-line-height', `${lineHeight}px`);
        const signature = JSON.stringify(rows);
        if (signature === this.signature) return;
        this.signature = signature;
        this.dom.hidden = rows.length === 0;
        this.dom.replaceChildren(...rows.map((row) => this.renderRow(row)));
      },
    });
  };

  private renderRow(row: ContextRow): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'json-context-row';
    button.setAttribute('aria-label', `跳转到第 ${row.number} 行：${row.text.trim()}`);
    button.dataset.line = String(row.number);
    const number = document.createElement('span');
    number.className = 'json-context-number';
    number.textContent = String(row.number);
    number.setAttribute('aria-hidden', 'true');
    const code = document.createElement('span');
    code.className = 'json-context-code';
    const text = document.createElement('span');
    text.className = 'json-context-text';
    let offset = row.from;
    highlightTree(syntaxTree(this.view.state), this.highlighter, (from, to, classes) => {
      if (offset < from) text.append(this.view.state.sliceDoc(offset, from));
      const token = document.createElement('span');
      token.className = classes;
      token.textContent = this.view.state.sliceDoc(from, to);
      text.append(token);
      offset = to;
    }, row.from, row.to);
    if (offset < row.to) text.append(this.view.state.sliceDoc(offset, row.to));
    code.append(text);
    button.append(number, code);
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const next = event.shiftKey ? button.previousElementSibling : button.nextElementSibling;
      if (next instanceof HTMLButtonElement) { event.preventDefault(); next.focus(); }
    });
    button.addEventListener('click', () => {
      this.view.dispatch({ selection: EditorSelection.cursor(row.from), effects: EditorView.scrollIntoView(row.from, { y: 'start', yMargin: 0 }) });
      this.view.focus();
    });
    return button;
  }
}

export function jsonContext(highlighter: Highlighter): Extension {
  return showPanel.of((view) => new JsonContextPanel(view, highlighter));
}
