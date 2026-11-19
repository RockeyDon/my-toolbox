import type { JsonValue } from './json';

export class PythonLiteralError extends SyntaxError {
  readonly lineNumber: number;
  readonly columnNumber: number;

  constructor(message: string, text: string, offset: number, readonly pythonSyntax: boolean) {
    super(message);
    const lines = text.slice(0, offset).split('\n');
    this.lineNumber = lines.length;
    this.columnNumber = lines.at(-1)!.length + 1;
  }
}

// Parse data literals only. Python code, calls and expressions are never evaluated.
export function parsePythonLiteral(text: string): { value: JsonValue; pythonSyntax: boolean } {
  let offset = 0;
  let pythonSyntax = false;
  const fail = (message: string): never => { throw new PythonLiteralError(message, text, offset, pythonSyntax); };
  const skip = () => {
    while (offset < text.length) {
      if (/\s/.test(text[offset]!)) offset++;
      else if (text[offset] === '#') {
        pythonSyntax = true;
        while (offset < text.length && text[offset] !== '\n') offset++;
      } else break;
    }
  };
  const consume = (token: string) => {
    skip();
    if (text[offset] !== token) fail(`应为 ${token}`);
    offset++;
  };
  const string = (): string => {
    let raw = false;
    if (/^[ru]$/i.test(text[offset] ?? '') && /['"]/.test(text[offset + 1] ?? '')) {
      raw = text[offset]!.toLowerCase() === 'r';
      pythonSyntax = true;
      offset++;
    }
    const quote = text[offset];
    if (quote !== "'" && quote !== '"') fail('字典键必须是字符串');
    const triple = text.slice(offset, offset + 3) === quote!.repeat(3);
    if (triple) pythonSyntax = true;
    const delimiter = quote!.repeat(triple ? 3 : 1);
    offset += delimiter.length;
    let result = '';
    while (offset < text.length) {
      if (text.startsWith(delimiter, offset)) { offset += delimiter.length; return result; }
      const char = text[offset++]!;
      if (!triple && (char === '\n' || char === '\r')) fail('字符串中存在未转义的换行');
      if (char !== '\\') { result += char; continue; }
      if (offset === text.length) fail('字符串末尾的转义不完整');
      const escaped = text[offset++]!;
      if (raw) { result += char + escaped; continue; }
      if (escaped === '\n') continue;
      if (escaped === '\r') { if (text[offset] === '\n') offset++; continue; }
      const escapes: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
      if (Object.hasOwn(escapes, escaped)) {
        if (escaped === 'a') pythonSyntax = true;
        result += escapes[escaped];
      } else if (escaped === 'x' || escaped === 'u' || escaped === 'U') {
        if (escaped === 'U') pythonSyntax = true;
        const length = escaped === 'x' ? 2 : escaped === 'u' ? 4 : 8;
        const digits = text.slice(offset, offset + length);
        if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) fail(`无效的 \\${escaped} 转义`);
        const code = Number.parseInt(digits, 16);
        if (code > 0x10ffff) fail('Unicode 码点超出范围');
        result += String.fromCodePoint(code);
        offset += length;
      } else if (/[0-7]/.test(escaped)) {
        const digits = escaped + (text.slice(offset).match(/^[0-7]{0,2}/)?.[0] ?? '');
        if (digits !== '0') pythonSyntax = true;
        result += String.fromCharCode(Number.parseInt(digits, 8));
        offset += digits.length - 1;
      } else result += `\\${escaped}`;
    }
    return fail('字符串未结束');
  };
  const value = (): JsonValue => {
    skip();
    const char = text[offset];
    if (char === "'" || char === '"' || /^[ru]['"]/i.test(text.slice(offset, offset + 2))) return string();
    if (char === '[' || char === '{') {
      const object = char === '{';
      const end = object ? '}' : ']';
      const items: JsonValue[] = [];
      const entries: Record<string, JsonValue> = {};
      offset++;
      skip();
      while (text[offset] !== end) {
        if (offset >= text.length) fail(`缺少 ${end}`);
        if (object) {
          const key = string();
          consume(':');
          Object.defineProperty(entries, key, { value: value(), enumerable: true, configurable: true, writable: true });
        } else items.push(value());
        skip();
        if (text[offset] === end) break;
        consume(',');
        skip();
      }
      offset++;
      return object ? entries : items;
    }
    const literal = text.slice(offset).match(/^(True|False|None)\b/)?.[0];
    if (literal) {
      pythonSyntax = true;
      offset += literal.length;
      return literal === 'None' ? null : literal === 'True';
    }
    const number = text.slice(offset).match(/^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i)?.[0];
    if (number) { offset += number.length; return Number(number); }
    return fail('需要字典、列表、字符串、数字、True、False 或 None');
  };
  const parsed = value();
  skip();
  if (offset !== text.length) fail('数据后存在多余内容');
  return { value: parsed, pythonSyntax };
}
