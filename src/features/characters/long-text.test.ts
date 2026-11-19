import { describe, expect, it } from 'vitest';
import { displayText, escapeText } from './long-text';

describe('long text conversion', () => {
  it.each(['', '中文😀', 'line one\nline two', '"quotes" and \\path', '\t\b\f\r\n\u0000', String.raw`literal \n and \u4e2d`])('round trips %j', (text) => {
    const escaped = escapeText(text);
    expect(JSON.parse(`"${escaped}"`)).toBe(text);
    expect(displayText(escaped)).toBe(text);
  });

  it('decodes full JSON escapes', () => {
    expect(displayText(String.raw`\u4e2d\u6587\n\t\"\\\/`)).toBe('中文\n\t"\\/');
  });

  it.each([String.raw`\q`, 'trailing\\', 'actual\nnewline', 'unescaped " quote', '"whole string"'])('rejects invalid input %j', (text) => {
    expect(() => displayText(text)).toThrow('无法展示');
  });
});
