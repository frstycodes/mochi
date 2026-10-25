import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import { fileArtifacts, visualArtifacts } from './artifacts.ts';

const chart = '{"type":"bar","title":"Calls","x":"day","data":[{"day":"Mon","calls":3}]}';
const fence = (lang: string, body: string, meta = '') => `\`\`\`${lang}${meta ? ` ${meta}` : ''}\n${body}\n\`\`\``;
const msg = (at: number, text: string, who: ActivityEntry['who'] = 'claude'): ActivityEntry => ({ at, who, kind: 'message', text });

test('collects rendered visuals from agent replies, newest first, titled from meta then spec', () => {
  const activity = [
    msg(1, ['Two visuals:', fence('svg', '<svg></svg>', 'title="Logo"'), 'and', fence('chart', chart)].join('\n')),
    msg(2, fence('html', '<p>hi</p>')),
  ];
  assert.deepEqual(
    visualArtifacts(activity).map((a) => [a.language, a.title, a.at]),
    [
      ['html', 'HTML widget', 2],
      ['chart', 'Calls', 1],
      ['svg', 'Logo', 1],
    ],
  );
});

test('skips code fences, your messages, tool output, broken and unfinished fences', () => {
  const activity: ActivityEntry[] = [
    msg(1, fence('ts', 'const a = 1')),
    msg(2, fence('svg', '<svg></svg>'), 'you'),
    { at: 3, who: 'claude', kind: 'tool', text: fence('svg', '<svg></svg>') },
    msg(4, fence('chart', '{ "type": "bar" ')),
    msg(5, '```svg\n<svg'),
  ];
  assert.deepEqual(visualArtifacts(activity), []);
});

const tool = (at: number, text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ at, who: 'claude', kind: 'tool', text, ...extra });

test('files: created outside the repo or generated, newest first, each once; repo edits and reads stay out', () => {
  const activity = [
    tool(1, 'Write /tmp/out/report.md'),
    tool(2, 'Write src/app.ts'),
    tool(3, 'Edit /Users/me/notes.md'),
    tool(4, 'Read /tmp/out/data.csv'),
    tool(5, 'Edit files', { patch: 'diff --git a//tmp/out/chart.html b//tmp/out/chart.html\n--- /dev/null\n+++ b//tmp/out/chart.html\n@@ -0,0 +1,1 @@\n+<p/>' }),
    tool(6, 'Edit src/new.ts', { patch: 'diff --git a/src/new.ts b/src/new.ts\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,1 @@\n+x' }),
    tool(7, 'Generate image', { generated: { status: 'done', src: '/Users/me/.mochi/images/cat.png' } }),
    tool(8, 'Write /tmp/out/report.md'),
  ];
  assert.deepEqual(
    fileArtifacts(activity, null).map((f) => [f.path, f.at]),
    [
      ['/tmp/out/report.md', 8],
      ['/Users/me/.mochi/images/cat.png', 7],
      ['/tmp/out/chart.html', 5],
    ],
  );
});

test('files: a folderless chat counts what it creates in its own folder', () => {
  assert.deepEqual(
    fileArtifacts([tool(1, 'Write plan.md')], '/Users/me/.harness/chats/new-1/').map((f) => f.path),
    ['/Users/me/.harness/chats/new-1/plan.md'],
  );
});
