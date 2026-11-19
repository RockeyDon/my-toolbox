export const OUTPUT_LIMIT = 5 * 1024 * 1024;
const colors = ['#28334a', '#ac3633', '#28734c', '#85620e', '#345fba', '#8b439b', '#167181', '#586780'];
export interface Span { text: string; color?: string; bold?: boolean }
export interface OutputLine { spans: Span[]; size: number }
export interface Output {
  lines: OutputLine[];
  bytes: number;
  truncated: boolean;
  pending: string;
  color?: string;
  bold?: boolean;
  cursor: number;
}
const encoder = new TextEncoder();
export function emptyOutput(): Output { return { lines: [{ spans: [], size: 0 }], bytes: 0, truncated: false, pending: '', cursor: 0 }; }
function sliceSpans(spans: Span[], from: number, to = Infinity): Span[] {
  const result: Span[] = [];
  let offset = 0;
  for (const span of spans) {
    const start = Math.max(0, from - offset);
    const end = Math.min(span.text.length, to - offset);
    if (end > start) result.push({ ...span, text: span.text.slice(start, end) });
    offset += span.text.length;
  }
  return result;
}
function merge(spans: Span[]): Span[] {
  const result: Span[] = [];
  for (const span of spans) {
    const previous = result.at(-1);
    if (previous && previous.color === span.color && previous.bold === span.bold) previous.text += span.text;
    else result.push({ ...span });
  }
  return result;
}
function sizeOf(spans: Span[]) { return spans.reduce((size, span) => size + encoder.encode(span.text).length, 0); }

export function appendOutput(previous: Output, text: string, stream = 'stdout', limit = OUTPUT_LIMIT): Output {
  const next: Output = { ...previous, lines: [...previous.lines] };
  let line: OutputLine = { spans: [...(next.lines.at(-1)?.spans ?? [])], size: next.lines.at(-1)?.size ?? 0 };
  next.lines[next.lines.length - 1] = line;
  const input = previous.pending + text;
  next.pending = '';
  let offset = 0;
  while (offset < input.length) {
    const character = input[offset];
    if (character === '\x1b') {
      const remainder = input.slice(offset);
      const escape = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[^[\]])/.exec(remainder)?.[0];
      if (!escape) {
        if (remainder.length <= 4096) next.pending = remainder;
        break;
      }
      if (escape.endsWith('m') && escape.startsWith('\x1b[')) {
        const codes = escape.slice(2, -1).split(';').map(Number);
        for (let index = 0; index < codes.length; index++) {
          const code = codes[index] ?? 0;
          if (code === 0) { next.color = undefined; next.bold = false; }
          else if (code === 1) next.bold = true;
          else if (code === 22) next.bold = false;
          else if (code === 39) next.color = undefined;
          else if (code >= 30 && code <= 37) next.color = colors[code - 30];
          else if (code >= 90 && code <= 97) next.color = colors[code - 90];
          else if ([38, 48].includes(code)) index += codes[index + 1] === 2 ? 4 : 2;
        }
      } else if (escape.endsWith('K')) {
        next.bytes -= line.size;
        line.spans = escape === '\x1b[2K' ? [] : sliceSpans(line.spans, 0, next.cursor);
        line.size = sizeOf(line.spans);
        next.bytes += line.size;
      }
      offset += escape.length;
    } else if (character === '\n') {
      line = { spans: [], size: 0 };
      next.lines.push(line);
      next.bytes++;
      next.cursor = 0;
      offset++;
    } else if (character === '\r') {
      next.cursor = 0;
      offset++;
    } else if (character === '\b') {
      next.cursor = Math.max(0, next.cursor - 1);
      offset++;
    } else {
      const end = input.slice(offset).search(/[\x1b\n\r\b]/);
      const value = input.slice(offset, end < 0 ? input.length : offset + end);
      const span = { text: value, color: next.color ?? (stream === 'stderr' ? '#ac3633' : undefined), bold: next.bold };
      next.bytes -= line.size;
      line.spans = merge([...sliceSpans(line.spans, 0, next.cursor), span, ...sliceSpans(line.spans, next.cursor + value.length)]);
      line.size = sizeOf(line.spans);
      next.bytes += line.size;
      next.cursor += value.length;
      offset += value.length;
    }
  }
  while (next.bytes > limit && next.lines.length > 1) {
    const removed = next.lines.shift();
    next.bytes -= (removed?.size ?? 0) + 1;
    next.truncated = true;
  }
  if (next.bytes > limit) {
    const content = line.spans.map((span) => span.text).join('');
    let cut = Math.max(1, content.length - Math.floor(limit / 4));
    if (/[\uDC00-\uDFFF]/.test(content[cut] ?? '')) cut++;
    line.spans = sliceSpans(line.spans, cut);
    line.size = sizeOf(line.spans);
    next.bytes = line.size;
    next.cursor = Math.max(0, next.cursor - cut);
    next.truncated = true;
  }
  return next;
}

export function outputText(output: Output) { return output.lines.map((line) => line.spans.map((span) => span.text).join('')).join('\n'); }
