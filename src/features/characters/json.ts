import JSON5 from 'json5';
import { parsePythonLiteral, PythonLiteralError } from './python-literal';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonLayout = 'pretty' | 'compact';
export type TextError = { message: string; line: number; column: number; offset: number };
export type FormatResult = { ok: true; value: JsonValue; text: string } | { ok: false; text: string; error: TextError };

function requireFiniteNumbers(value: JsonValue): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('标准 JSON 不支持 NaN 或 Infinity，请改为有限数字。');
  if (value && typeof value === 'object') Object.values(value).forEach(requireFiniteNumbers);
}

function parseJsonInput(text: string): JsonValue {
  let python: ReturnType<typeof parsePythonLiteral> | undefined;
  try { python = parsePythonLiteral(text); }
  catch (error) {
    if (error instanceof PythonLiteralError && error.pythonSyntax) throw error;
  }
  // Prefer Python for its explicit syntax, retaining JSON5 semantics for shared syntax.
  if (python?.pythonSyntax) return python.value;
  return JSON5.parse<JsonValue>(text);
}

export function serializeJson(value: JsonValue, layout: JsonLayout, ascii: boolean): string {
  const text = JSON.stringify(value, null, layout === 'pretty' ? 2 : undefined);
  return ascii ? text.replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : text;
}

export function errorDetails(error: unknown, text: string): TextError {
  const source = error as { lineNumber?: number; columnNumber?: number; message?: string };
  const line = Math.min(Math.max(source.lineNumber ?? 1, 1), text.split('\n').length);
  const lines = text.split('\n');
  const column = Math.min(Math.max(source.columnNumber ?? 1, 1), (lines[line - 1]?.length ?? 0) + 1);
  const offset = lines.slice(0, line - 1).reduce((sum, part) => sum + part.length + 1, 0) + column - 1;
  const detail = source.message?.replace(/^JSON5: /, '') ?? '无法解析内容';
  return { message: `第 ${line} 行，第 ${column} 列：${detail}`, line, column, offset };
}

// Only whitespace outside strings and comments is changed; invalid source tokens remain intact.
export function bestEffortLayout(text: string): string {
  let result = '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  let comment: 'line' | 'block' | undefined;
  const newline = () => {
    result = result.replace(/[ \t]*$/, '');
    if (!result.endsWith('\n')) result += '\n';
    result += '  '.repeat(Math.min(depth, 80));
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (comment) {
      result += char;
      if (comment === 'line' && (char === '\n' || char === '\r')) { comment = undefined; newline(); }
      else if (comment === 'block' && char === '*' && next === '/') { result += '/'; i++; comment = undefined; }
      continue;
    }
    if (quote) {
      if (!escaped && text.startsWith(quote, i)) {
        result += quote;
        i += quote.length - 1;
        quote = '';
      } else {
        result += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = text.slice(i, i + 3) === char.repeat(3) ? char.repeat(3) : char;
      result += quote;
      i += quote.length - 1;
    }
    else if (char === '#') { comment = 'line'; result += char; }
    else if (char === '/' && (next === '/' || next === '*')) { comment = next === '/' ? 'line' : 'block'; result += char + next; i++; }
    else if (char === '{' || char === '[') { result += char; depth++; newline(); }
    else if (char === '}' || char === ']') { depth = Math.max(0, depth - 1); newline(); result += char; }
    else if (char === ',') { result += char; newline(); }
    else if (char === ':') result += ': ';
    else if (/\s/.test(char)) { if (result && !/\s$/.test(result)) result += ' '; }
    else result += char;
  }
  return quote || comment ? result.trimStart() : result.trim();
}

export function formatJson(text: string, ascii: boolean): FormatResult {
  try {
    const value = parseJsonInput(text);
    requireFiniteNumbers(value);
    return { ok: true, value, text: serializeJson(value, 'pretty', ascii) };
  } catch (error) {
    const formatted = bestEffortLayout(text);
    // Reparse to report coordinates in the exact text that will appear in the editor.
    try { requireFiniteNumbers(parseJsonInput(formatted)); }
    catch (formattedError) { return { ok: false, text: formatted, error: errorDetails(formattedError, formatted) }; }
    return { ok: false, text, error: errorDetails(error, text) };
  }
}
