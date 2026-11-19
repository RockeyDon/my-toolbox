import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { json } from '@codemirror/lang-json';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import type { TextError } from '../features/characters/json';
import { jsonContext } from './json-context';

type Props = { value: string; onChange: (text: string) => void; highlighted?: boolean; contextEnabled?: boolean; error?: TextError | null; label: string; placeholder: string };

const colors = HighlightStyle.define([
  { tag: tags.propertyName, color: '#414c72' },
  { tag: tags.string, color: '#258064' },
  { tag: tags.number, color: '#ba6526' },
  { tag: tags.bool, color: '#7853b8' },
  { tag: tags.null, color: '#a15276' },
  { tag: tags.punctuation, color: '#6d7891' },
]);

export function CodeEditor({ value, onChange, highlighted = false, contextEnabled = false, error, label, placeholder }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  const externalUpdate = useRef(false);
  const language = useRef(new Compartment());
  const context = useRef(new Compartment());

  useEffect(() => { callback.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({
        extensions: [
          basicSetup,
          lintGutter(),
          EditorView.lineWrapping,
          language.current.of([]),
          context.current.of([]),
          syntaxHighlighting(colors),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !externalUpdate.current) callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, [label]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    externalUpdate.current = true;
    try {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    } finally { externalUpdate.current = false; }
  }, [value]);

  useEffect(() => { view.current?.dispatch({ effects: language.current.reconfigure(highlighted ? json() : []) }); }, [highlighted]);

  useEffect(() => { view.current?.dispatch({ effects: context.current.reconfigure(contextEnabled ? jsonContext(colors) : []) }); }, [contextEnabled]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const from = Math.min(error?.offset ?? 0, editor.state.doc.length);
    editor.dispatch(setDiagnostics(editor.state, error ? [{ from, to: Math.min(from + 1, editor.state.doc.length), severity: 'error', message: error.message }] : []));
    if (error) editor.dispatch({ selection: EditorSelection.cursor(from), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  }, [error]);

  return <div className={`editor-shell${error ? ' has-error' : ''}`}>
    {!value && <div className="editor-placeholder" aria-hidden="true">{placeholder}</div>}
    <div className="editor-mount" ref={container} />
  </div>;
}
