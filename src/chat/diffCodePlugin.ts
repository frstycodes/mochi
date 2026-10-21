import type { CodeHighlighterPlugin } from '@streamdown/code';
import type { ThemedToken, TokensResult } from 'shiki';

type DiffKind = 'add' | 'del' | 'ctx';
export type DiffLine = { kind: DiffKind; marker: string; code: string };

/**
 * `plugin` with ```diff fences highlighted line by line: file headers, `@@` hunk lines and `...` elisions are dropped, the +/- marker
 * becomes its own token tagged `data-diff` (index.css tints the line from it), and the code after it is highlighted in
 * the language of the first `+++`/`---` path, or as plain text when there is none.
 */
export function withDiffFences(plugin: CodeHighlighterPlugin): CodeHighlighterPlugin {
  return {
    ...plugin,
    supportsLanguage: (language) => isDiff(language) || plugin.supportsLanguage(language),
    highlight(options, callback) {
      if (!isDiff(options.language)) return plugin.highlight(options, callback);
      const lines = options.code.split('\n').filter((line) => !isHeader(line)).map(diffLine);
      const code = lines.map((line) => line.code).join('\n');
      const language = (pathLanguage(options.code, plugin) ?? 'text') as typeof options.language;
      const mark = (result: TokensResult) => markDiff(result, lines);
      const result = plugin.highlight({ ...options, code, language }, callback && ((r) => callback(mark(r))));
      return result && mark(result);
    },
  };
}

export function markDiff(result: TokensResult, lines: DiffLine[]): TokensResult {
  const tokens = lines.map(({ kind, marker }, i): ThemedToken[] => [
    ...(marker ? [{ content: marker, offset: 0, htmlAttrs: { 'data-diff': kind } }] : []),
    ...(result.tokens[i] ?? []),
  ]);
  return { ...result, tokens };
}

export function diffLine(line: string): DiffLine {
  const marker = /^[-+ ]/.test(line) ? line[0] : '';
  const kind = marker === '+' ? 'add' : marker === '-' ? 'del' : 'ctx';
  return { kind, marker, code: line.slice(marker.length) };
}

function pathLanguage(diff: string, plugin: CodeHighlighterPlugin) {
  const extension = diff.match(/^(?:\+\+\+|---) (?!\/dev\/null).*\.(\w+)\s*$/m)?.[1]?.toLowerCase();
  return extension && plugin.supportsLanguage(extension as Parameters<typeof plugin.supportsLanguage>[0]) ? extension : undefined;
}

function isHeader(line: string) {
  return /^(@@|\+\+\+ |--- |diff |index |\.\.\.|\\ )/.test(line);
}

function isDiff(language: string) {
  return /^(diff|patch)$/i.test(language.trim());
}
