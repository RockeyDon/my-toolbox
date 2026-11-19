import { describe, expect, it } from 'vitest';
import { bestEffortLayout, formatJson, serializeJson } from './json';
import { initialJsonState, jsonReducer } from './json-state';

describe('JSON5 to standard JSON', () => {
  it.each(['null', 'false', 'true', '42', '-1.5', '"hello"', '[]', '{}'])('supports root %s', (input) => {
    const result = formatJson(input, false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual(JSON.parse(input));
  });

  it('normalizes comments, single quotes, trailing commas, hex and unquoted keys', () => {
    const result = formatJson("// example\n{ name: '中文', count: 0x10, items: [true,], }", false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ name: '中文', count: 16, items: [true] });
    expect(result.text).toContain('\n  "name":');
  });

  it('puts nested containers and adjacent objects on separate lines', () => {
    const value = [{ items: [{ a: 1 }, { b: [true, null] }] }, { empty: [] }];
    const result = formatJson(JSON.stringify(value), false);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(JSON.stringify(value, null, 2));
    expect(result.text).not.toMatch(/\[\{|\},\{/);
  });

  it.each(['NaN', 'Infinity', '-Infinity', '{a: [NaN]}', '1e999'])('rejects nonfinite %s', (input) => {
    const result = formatJson(input, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('标准 JSON 不支持');
  });

  it('retains special keys as ordinary data', () => {
    const result = formatJson('{"__proto__":{"polluted":true}}', false);
    expect(result.ok).toBe(true);
    expect(Object.keys(JSON.parse(result.text))).toEqual(['__proto__']);
    expect(Object.hasOwn({}, 'polluted')).toBe(false);
  });

  it('encodes keys, CJK and emoji while keeping required escapes', () => {
    const value = { 中文: '汉字😀\n"\\', ascii: 'a' };
    const ascii = serializeJson(value, 'pretty', true);
    expect(ascii).toContain('\\u4e2d\\u6587');
    expect(ascii).toContain('\\ud83d\\ude00');
    expect([...ascii].every((char) => char.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(JSON.parse(ascii)).toEqual(value);
    expect(serializeJson(JSON.parse(ascii), 'pretty', false)).toContain('汉字😀');
    expect(serializeJson(value, 'compact', false)).toBe(JSON.stringify(value));
  });

  it('reports coordinates in the formatted malformed document', () => {
    const result = formatJson('{a:1,b:@}', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.text).toContain('\n');
      expect(result.text[result.error.offset]).toBe('@');
      expect(result.error.line).toBe(3);
    }
  });

  it('does not change string and comment contents when laying out invalid JSON', () => {
    const input = String.raw`{text:'brackets {}[], escaped \' quote',/* {},[] */bad:@,// keep {}[]
end:2}`;
    const result = bestEffortLayout(input);
    expect(result).toContain(String.raw`'brackets {}[], escaped \' quote'`);
    expect(result).toContain('/* {},[] */');
    expect(result).toContain('// keep {}[]\n');
    expect(result).toContain('bad: @');
  });

  it('never turns invalid tokens into valid JSON by removing whitespace', () => {
    const result = formatJson('{a: tr ue}', false);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('tr ue');
  });

  it('handles empty and incomplete input', () => {
    for (const input of ['', '{', '[1,', '{a:"unfinished']) expect(formatJson(input, false).ok).toBe(false);
  });

  it('preserves trailing whitespace in incomplete strings and comments', () => {
    expect(bestEffortLayout('{a:"unfinished  ')).toContain('"unfinished  ');
    expect(bestEffortLayout('{/* unfinished  ')).toContain('/* unfinished  ');
  });
});

describe('Python data literals to standard JSON', () => {
  it.each(['True', 'False', 'None'])('supports root %s', (input) => {
    const result = formatJson(input, false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toBe(input === 'None' ? null : input === 'True');
  });

  it('converts nested dictionaries, lists and trailing commas', () => {
    const result = formatJson("[{'name': '中文', 'active': True, 'items': [None, {'disabled': False},],}, {'count': -1.5e2}]", false);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(JSON.stringify([{ name: '中文', active: true, items: [null, { disabled: false }] }, { count: -150 }], null, 2));
    expect(result.text).not.toMatch(/\[\{|\},\{/);
  });

  it('keeps Python keywords and structural punctuation inside strings unchanged', () => {
    const result = formatJson(String.raw`{'True': 'None False [{ },{', 'value': True, 'quote': 'it\'s fine'}`, false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ True: 'None False [{ },{', value: true, quote: "it's fine" });
  });

  it('decodes Python Unicode, hex, octal and control escapes', () => {
    const result = formatJson(String.raw`{'text': '\U0001f600\u4e2d\x41\101\a\n\t\\'}`, true);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ text: '😀中AA\x07\n\t\\' });
    expect(result.text).toContain('\\ud83d\\ude00');
  });

  it('supports Python comments, raw strings and multiline strings', () => {
    const result = formatJson("# example\n{'path': r'C:\\new\\test', 'text': '''first\n[{ True },{\nlast''', 'value': None}", false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ path: String.raw`C:\new\test`, text: 'first\n[{ True },{\nlast', value: null });
  });

  it('retains special dictionary keys without changing prototypes', () => {
    const result = formatJson("{'__proto__': {'polluted': True}, 'constructor': None}", false);
    expect(result.ok).toBe(true);
    expect(Object.keys(JSON.parse(result.text))).toEqual(['__proto__', 'constructor']);
    expect(Object.hasOwn({}, 'polluted')).toBe(false);
  });

  it('preserves existing JSON5 escape semantics for shared syntax', () => {
    const result = formatJson(String.raw`{text: 'a\/b\q', value: 0x10}`, false);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toEqual({ text: 'a/bq', value: 16 });
  });

  it.each([
    "{'value': True, 'bad': @}", "{'value': None", "[True False]", "{'value': True} extra",
    "{'value': set()}", "[x for x in range(3)]", "{'value': __import__('os')}", "{1: True}",
    String.raw`{'value': '\U00110000'}`, String.raw`{'value': True, 'bad': '\xZZ'}`, "{'value': True, 'number': 1e999}",
  ])('rejects malformed or non-JSON Python data: %s', (input) => {
    expect(formatJson(input, false).ok).toBe(false);
  });

  it('reports Python errors at the displayed position after laying out the source', () => {
    const result = formatJson("[{'enabled': True, 'bad': @}]", false);
    expect(result.ok).toBe(false);
    expect(result.text).not.toMatch(/\[\{|\},\{/);
    if (!result.ok) {
      expect(result.text[result.error.offset]).toBe('@');
      expect(result.error.line).toBe(4);
    }
  });

  it('preserves Python comments and multiline strings during failure layout', () => {
    const input = "{'value': True, # keep [{ },{\n 'text': '''keep [{ },{\n'quote' and  spaces  ''', 'bad': @}";
    const result = formatJson(input, false);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('# keep [{ },{\n');
    expect(result.text).toContain("'''keep [{ },{\n'quote' and  spaces  '''");
    if (!result.ok) expect(result.text[result.error.offset]).toBe('@');
  });
});

describe('JSON editor state', () => {
  it('keeps transformations disabled initially and after failure', () => {
    expect(jsonReducer(initialJsonState, { type: 'compact' })).toBe(initialJsonState);
    const failed = jsonReducer({ ...initialJsonState, text: '{a:@}' }, { type: 'format' });
    expect(failed.parsed).toBeNull();
    expect(failed.highlighted).toBe(true);
    expect(jsonReducer(failed, { type: 'unicode' })).toBe(failed);
  });

  it('treats null and false roots as successfully parsed', () => {
    for (const text of ['null', 'false']) {
      const state = jsonReducer({ ...initialJsonState, text }, { type: 'format' });
      expect(state.parsed).not.toBeNull();
      expect(jsonReducer(state, { type: 'compact' }).text).toBe(text);
    }
  });

  it('invalidates parsed data on manual editing while retaining highlighting', () => {
    const formatted = jsonReducer({ ...initialJsonState, text: '{a: 1}' }, { type: 'format' });
    const edited = jsonReducer(formatted, { type: 'edit', text: '{a: 2}' });
    expect(edited.parsed).toBeNull();
    expect(edited.highlighted).toBe(true);
    expect(jsonReducer(edited, { type: 'format' }).parsed?.value).toEqual({ a: 2 });
  });

  it('restores multiline layout for Unicode operations after explicit compression', () => {
    const formatted = jsonReducer({ ...initialJsonState, text: '[{中文:"😀"},{items:[{enabled:true}]}]' }, { type: 'format' });
    const compact = jsonReducer(formatted, { type: 'compact' });
    expect(compact.text).not.toContain('\n');
    const unicode = jsonReducer(compact, { type: 'unicode' });
    expect(unicode.layout).toBe('pretty');
    expect(unicode.text).toContain('\n');
    expect(unicode.text).not.toMatch(/\[\{|\},\{/);
    expect(JSON.parse(unicode.text)).toEqual(formatted.parsed?.value);
    expect(jsonReducer(unicode, { type: 'unicode' }).text).toBe(unicode.text);
    expect(jsonReducer(unicode, { type: 'chinese' }).text).toBe(formatted.text);
    expect(jsonReducer(compact, { type: 'chinese' }).text).toBe(formatted.text);
    expect(jsonReducer(compact, { type: 'format' }).text).toBe(formatted.text);
  });
});
