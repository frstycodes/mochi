import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { ActivityEntry } from '../model.ts';
import { recentFiles } from './recentFiles.ts';

const tool = (text: string, at: number) => ({ at, who: 'claude', kind: 'tool', text }) as ActivityEntry;

test('recent files: work log reads and edits plus opened files, newest first, each once, relative to the root', () => {
  const activity = [tool('Read src/a.ts', 1), tool('Run pnpm test', 2), tool('Edit /repo/src/b.ts +3 −1', 3), tool('Edit src/a.ts +1 −0', 5), { at: 6, who: 'you', kind: 'message', text: 'Read src/c.ts' } as ActivityEntry];
  const files = recentFiles(activity, [{ path: 'README.md', at: 4 }, { path: 'src/b.ts:12', at: 0 }], '/repo');
  assert.deepEqual(files.map((f) => f.path), ['src/a.ts', 'README.md', 'src/b.ts']);
  assert.equal(recentFiles(activity, [], '/repo', 1).length, 1);
});
