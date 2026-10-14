import type { SearchLine, SearchOptions } from '../host/types/fs.ts';

const PREVIEW_CHARS = 240;
const PREVIEW_LEAD = 48;

/** The query as a global regex; throws on an invalid pattern when `isRegex`. */
export function compileQuery(pattern: string, { isCaseSensitive, isRegex, isWholeWord }: SearchOptions) {
  const source = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(isWholeWord ? `\\b(?:${source})\\b` : source, isCaseSensitive ? 'g' : 'gi');
}

/** Every line of `text` that matches, with its match ranges inside a preview cut to fit one row. */
export function matchLines(text: string, regex: RegExp, limit: number) {
  const out: SearchLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    const ranges = matchRanges(lines[i], regex);
    if (ranges.length) out.push(preview(lines[i], i + 1, ranges));
  }
  return out;
}

function matchRanges(line: string, regex: RegExp) {
  const ranges: [number, number][] = [];
  regex.lastIndex = 0;
  for (let m = regex.exec(line); m; m = regex.exec(line)) {
    // A zero-length match (`^`, `\b`, `a*`) would loop forever on the same index.
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function preview(line: string, lineNumber: number, ranges: [number, number][]): SearchLine {
  const indent = line.length - line.trimStart().length;
  const start = Math.max(indent, Math.min(ranges[0][0] - PREVIEW_LEAD, line.length - PREVIEW_CHARS));
  const text = line.slice(start, start + PREVIEW_CHARS).trimEnd();
  return {
    line: lineNumber,
    text,
    isCut: start > indent,
    column: ranges[0],
    ranges: ranges.flatMap(([from, to]) => (to <= start || from >= start + text.length ? [] : [[Math.max(0, from - start), Math.min(text.length, to - start)] as [number, number]])),
  };
}
