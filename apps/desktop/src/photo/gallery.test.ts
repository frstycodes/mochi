import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import { isVideo, threadMedia } from './gallery.ts';

const at = 0;
const activity: ActivityEntry[] = [
  {
    at,
    who: 'you',
    kind: 'message',
    text: 'look',
    images: ['/tmp/a.png', 'data:image/png;base64,AAAA'],
  },
  { at, who: 'claude', kind: 'tool', text: 'Read shots/b.png' },
  { at, who: 'claude', kind: 'tool', text: 'Read src/index.ts' },
  {
    at,
    who: 'claude',
    kind: 'tool',
    text: 'Screenshot',
    images: ['/cache/c.png'],
  },
  {
    at,
    who: 'claude',
    kind: 'tool',
    text: 'Generate image',
    generated: { status: 'done', src: '/gen/d.png', prompt: 'A dune' },
  },
  {
    at,
    who: 'claude',
    kind: 'tool',
    text: 'Generate image',
    generated: { status: 'running' },
  },
  {
    at,
    who: 'claude',
    kind: 'message',
    text: [
      'Here: ![Chart](./chart.svg) and ![](https://x.dev/e.webm "clip")',
      '```md',
      '![not shown](code.png)',
      '```',
      'Again ![dup](/tmp/a.png)',
    ].join('\n'),
  },
  { at, who: 'harness', kind: 'message', text: '![skip](/tmp/z.png)' },
];

test('every image and video in the thread, in reading order, once each', () => {
  const media = threadMedia(activity, '/repo');
  assert.deepEqual(
    media.map((m) => [m.src, m.name, m.kind]),
    [
      ['/tmp/a.png', 'Image 1', undefined],
      ['data:image/png;base64,AAAA', 'Image 2', undefined],
      ['/repo/shots/b.png', 'b.png', undefined],
      ['/cache/c.png', 'Image 1', undefined],
      ['/gen/d.png', 'A dune', undefined],
      ['/repo/chart.svg', 'Chart', undefined],
      ['https://x.dev/e.webm', 'Image', 'video'],
    ],
  );
});

test('a thread without media has an empty gallery', () => {
  assert.deepEqual(threadMedia([activity[2]], '/repo'), []);
});

test('videos are told by extension or data URL type', () => {
  assert.ok(isVideo('/a/clip.MOV'));
  assert.ok(isVideo('https://x.dev/a.mp4?t=3'));
  assert.ok(isVideo('data:video/webm;base64,AAAA'));
  assert.ok(!isVideo('/a/clip.png'));
});
