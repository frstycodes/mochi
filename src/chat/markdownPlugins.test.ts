import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { markdownPlugins } from './markdownPlugins.ts';

test('loads markdown plugins only for the content that needs them, including streamed fences', () => {
  assert.deepEqual(markdownPlugins('A plain **markdown** reply with `inline code`.'), { code: false, math: false, mermaid: false, cjk: false });
  assert.deepEqual(markdownPlugins('Before\n```ts\nconst x = 1'), { code: true, math: false, mermaid: false, cjk: false });
  assert.deepEqual(markdownPlugins('  ~~~mermaid\ngraph TD'), { code: true, math: false, mermaid: true, cjk: false });
  assert.equal(markdownPlugins('```mermaidish').mermaid, false);
  assert.equal(markdownPlugins('> ``` mermaid\ngraph TD').mermaid, true);
  assert.equal(markdownPlugins('An unfinished $x').math, true);
  assert.equal(markdownPlugins('日本語 한국어 中文').cjk, true);
});
