import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodeHighlighterPlugin } from '@streamdown/code';
import type { TokensResult } from 'shiki';
import { withDiffFences } from './diffCodePlugin.ts';

const themes: Parameters<CodeHighlighterPlugin['highlight']>[0]['themes'] = ['github-light', 'github-dark'];

function fakePlugin(seen: { code: string; language: string }[]) {
  return {
    name: 'shiki',
    type: 'code-highlighter',
    getSupportedLanguages: () => ['ts'],
    getThemes: () => themes,
    supportsLanguage: (language: string) => language === 'ts',
    highlight({ code, language }) {
      seen.push({ code, language });
      return { tokens: code.split('\n').map((line) => (line ? [{ content: line, offset: 0, color: '#123' }] : [])) } as unknown as TokensResult;
    },
  } as CodeHighlighterPlugin;
}

const contents = (result: TokensResult | null) => result!.tokens.map((line) => line.map((t) => `${t.htmlAttrs?.['data-diff'] ?? ''}:${t.content}`));

test('a diff fence drops its headers and is highlighted in the language of its path, markers split off and tagged', () => {
  const seen: { code: string; language: string }[] = [];
  const diff = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-const a = 1;', '+const a = 2;', ' keep', '...', 'bare', ''].join('\n');
  const result = withDiffFences(fakePlugin(seen)).highlight({ code: diff, language: 'diff' as never, themes });
  assert.deepEqual(seen, [{ code: ['const a = 1;', 'const a = 2;', 'keep', 'bare', ''].join('\n'), language: 'ts' }]);
  assert.deepEqual(contents(result), [
    ['del:-', ':const a = 1;'],
    ['add:+', ':const a = 2;'],
    ['ctx: ', ':keep'],
    [':bare'],
    [],
  ]);
});

test('a diff without a known path falls back to plain text, other languages pass through', () => {
  const seen: { code: string; language: string }[] = [];
  const plugin = withDiffFences(fakePlugin(seen));
  plugin.highlight({ code: '+x', language: 'diff' as never, themes });
  plugin.highlight({ code: '+x', language: 'ts' as never, themes });
  assert.deepEqual(seen, [{ code: 'x', language: 'text' }, { code: '+x', language: 'ts' }]);
});
