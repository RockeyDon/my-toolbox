import { describe, expect, it } from 'vitest';
import { appendOutput, emptyOutput, outputText } from './output';

describe('bounded light-theme command output', () => {
  it('appends history without replacing earlier runs', () => {
    const first = appendOutput(emptyOutput(), '$ first\n中文\n');
    const second = appendOutput(first, '$ second\nnext\n');
    expect(outputText(first)).toBe('$ first\n中文\n');
    expect(outputText(second)).toBe('$ first\n中文\n$ second\nnext\n');
  });
  it('decodes split ANSI sequences, ignores backgrounds and never creates HTML', () => {
    const first = appendOutput(emptyOutput(), '\x1b[3');
    const result = appendOutput(first, '1mred\x1b[0m<script>no</script>\x1b[40mplain');
    expect(outputText(result)).toBe('red<script>no</script>plain');
    expect(result.lines[0]?.spans[0]?.color).toBe('#ac3633');
    expect(result.pending).toBe('');
  });
  it('updates progress in place and supports erase-to-end and CRLF', () => {
    let output = appendOutput(emptyOutput(), 'progress 10%\rprogress 90%');
    expect(outputText(output)).toBe('progress 90%');
    output = appendOutput(output, '\rdone\x1b[K\r\nnext');
    expect(outputText(output)).toBe('done\nnext');
  });
  it('bounds multiline and single-line Unicode output without invalid surrogate pairs', () => {
    const multiline = appendOutput(emptyOutput(), 'first\nsecond\nthird', 'stdout', 12);
    expect(multiline.bytes).toBeLessThanOrEqual(12);
    expect(multiline.truncated).toBe(true);
    const single = appendOutput(emptyOutput(), '😀中文'.repeat(50), 'stdout', 32);
    expect(single.bytes).toBeLessThanOrEqual(32);
    expect(single.truncated).toBe(true);
    expect(outputText(single)).not.toMatch(/^[\uDC00-\uDFFF]/);
  });
  it('colors stderr on a light background and removes OSC terminal controls', () => {
    const output = appendOutput(emptyOutput(), '\x1b]0;window title\x07error', 'stderr');
    expect(outputText(output)).toBe('error');
    expect(output.lines[0]?.spans[0]?.color).toBe('#ac3633');
  });
  it('consumes truecolor ANSI parameters without treating them as bold or basic colors', () => {
    const output = appendOutput(emptyOutput(), '\x1b[38;2;1;31;1mtest');
    expect(outputText(output)).toBe('test');
    expect(output.color).toBeUndefined();
    expect(output.bold).toBeUndefined();
  });
});
