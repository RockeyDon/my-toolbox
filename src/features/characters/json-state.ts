import { formatJson, serializeJson, type JsonLayout, type JsonValue, type TextError } from './json';

export type JsonState = {
  text: string;
  parsed: { value: JsonValue } | null;
  highlighted: boolean;
  layout: JsonLayout;
  ascii: boolean;
  error: TextError | null;
};
export type JsonAction = { type: 'edit'; text: string } | { type: 'format' | 'compact' | 'unicode' | 'chinese' };

export const initialJsonState: JsonState = { text: '', parsed: null, highlighted: false, layout: 'pretty', ascii: false, error: null };

export function jsonReducer(state: JsonState, action: JsonAction): JsonState {
  if (action.type === 'edit') return { ...state, text: action.text, parsed: null, error: null };
  if (action.type === 'format') {
    const result = formatJson(state.text, state.ascii);
    return result.ok
      ? { ...state, text: result.text, parsed: { value: result.value }, highlighted: true, layout: 'pretty', error: null }
      : { ...state, text: result.text, parsed: null, highlighted: true, error: result.error };
  }
  if (!state.parsed) return state;
  const layout = action.type === 'compact' ? 'compact' : 'pretty';
  const ascii = action.type === 'unicode' ? true : action.type === 'chinese' ? false : state.ascii;
  return { ...state, layout, ascii, text: serializeJson(state.parsed.value, layout, ascii), error: null };
}
