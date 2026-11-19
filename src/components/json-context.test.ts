import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree, foldEffect, codeFolding } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { jsonContextRows } from './json-context';

function document(value: unknown) {
  const state = EditorState.create({ doc: JSON.stringify(value, null, 2), extensions: [json(), codeFolding()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function rowsAt(state: EditorState, text: string, limit = 5) {
  return jsonContextRows(state, state.doc.toString().indexOf(text), limit);
}

describe('JSON parent context', () => {
  it('finds the ordered containers of nested properties and anonymous array elements', () => {
    const state = document({ results: [{ conclusions: [{ tag: 'example' }] }] });
    const rows = rowsAt(state, '"tag"');
    expect(rows.map((row) => row.text.trim())).toEqual(['{', '"results": [', '{', '"conclusions": [', '{']);
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 5]);
    for (const row of rows) expect(state.doc.sliceString(row.from, row.to)).toBe(row.text);
  });

  it('includes only ancestors above the current line, not siblings or visible opening lines', () => {
    const state = document({ first: { value: 1 }, second: { value: 2 } });
    expect(rowsAt(state, '"second"').map((row) => row.text.trim())).toEqual(['{']);
    expect(rowsAt(state, '"value": 2').map((row) => row.text.trim())).toEqual(['{', '"second": {']);
    expect(jsonContextRows(state, 0, 5)).toEqual([]);
  });

  it('keeps the closest ancestors when height or depth limits apply', () => {
    const state = document({ a: { b: { c: { d: { e: { leaf: 1 } } } } } });
    expect(rowsAt(state, '"leaf"', 2).map((row) => row.text.trim())).toEqual(['"d": {', '"e": {']);
    expect(rowsAt(state, '"leaf"', 5)).toHaveLength(5);
    expect(rowsAt(state, '"leaf"', 0)).toEqual([]);
  });

  it('ignores brackets and escaped quotes inside strings', () => {
    const state = document({ 'key[{': [{ text: '"quoted" }], {', next: true }] });
    expect(rowsAt(state, '"next"').map((row) => row.text.trim())).toEqual(['{', '"key[{": [', '{']);
  });

  it('handles closing delimiters and excludes containers that have ended', () => {
    const state = document({ a: { b: 1 }, c: 2 });
    const closing = state.doc.toString().indexOf('  },');
    expect(jsonContextRows(state, closing, 5).map((row) => row.text.trim())).toEqual(['{', '"a": {']);
    expect(rowsAt(state, '"c"').map((row) => row.text.trim())).toEqual(['{']);
  });

  it('does not expose a folded container as a parent of its own visible opening line', () => {
    const state = document({ items: [{ a: 1 }, { b: 2 }] });
    const opening = state.doc.toString().indexOf('[');
    const closing = state.doc.toString().indexOf(']');
    const folded = state.update({ effects: foldEffect.of({ from: opening + 1, to: closing }) }).state;
    expect(rowsAt(folded, '"items"').map((row) => row.text.trim())).toEqual(['{']);
  });

  it.each([null, false, 42, 'example', [], {}])('has no offscreen parents for root %j', (value) => {
    const state = document(value);
    expect(jsonContextRows(state, 0, 5)).toEqual([]);
  });
});
