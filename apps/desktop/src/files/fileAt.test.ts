import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { fileAt } from './fileAt.ts';

test('fileAt: inside the thread folder reads relative to it; an absolute path elsewhere, or with no folder, reads from its own folder', () => {
  const files = { threadId: 't', root: '/Users/me/app' };
  assert.deepEqual(fileAt(files, '/Users/me/app/src/a.png'), {
    ...files,
    path: 'src/a.png',
  });
  assert.deepEqual(fileAt(files, 'src/a.png'), { ...files, path: 'src/a.png' });
  assert.deepEqual(fileAt(files, '/private/tmp/scratch/shot.png'), {
    threadId: 't',
    root: '/private/tmp/scratch',
    path: 'shot.png',
  });
  assert.deepEqual(fileAt(files, '/Users/me/app-other/a.png'), {
    threadId: 't',
    root: '/Users/me/app-other',
    path: 'a.png',
  });
  assert.deepEqual(fileAt(files, '/a.png'), {
    threadId: 't',
    root: '/',
    path: 'a.png',
  });
  assert.deepEqual(
    fileAt({ threadId: 't', root: '' }, '/tmp/shot.png'),
    { threadId: 't', root: '/tmp', path: 'shot.png' },
    'a folderless chat (no root)',
  );
});
