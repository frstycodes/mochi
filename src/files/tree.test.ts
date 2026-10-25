import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  buildTree,
  compactTree,
  filterFiles,
  toRanges,
  visibleRows,
} from './tree.ts';

const FILES = [
  'README.md',
  'src/files/FileTree.tsx',
  'src/files/fuzzy.ts',
  'src/pane/FilesTab.tsx',
  'src/ui.tsx',
];

test('filterFiles keeps matches with their folders, highlights per row, best match first', () => {
  const { files, highlights, best } = filterFiles(FILES, 'ftab');
  assert.deepEqual(files, ['src/pane/FilesTab.tsx']);
  assert.equal(best, 'src/pane/FilesTab.tsx');
  assert.deepEqual(highlights.get('src/pane/FilesTab.tsx'), [0, 5, 6, 7]);
  const rows = visibleRows(buildTree(files), 'all').map(
    (r) => `${'  '.repeat(r.depth)}${r.node.name}`,
  );
  assert.deepEqual(rows, ['src', '  pane', '    FilesTab.tsx']);
});

test('filterFiles highlights folder names when the match runs through them', () => {
  const { highlights } = filterFiles(FILES, 'srcui');
  assert.deepEqual(highlights.get('src'), [0, 1, 2]);
  assert.deepEqual(highlights.get('src/ui.tsx'), [0, 1]);
});

test('visibleRows only opens expanded folders', () => {
  const tree = buildTree(FILES);
  assert.deepEqual(
    visibleRows(tree, new Set(['src'])).map((r) => r.node.path),
    ['src', 'src/files', 'src/pane', 'src/ui.tsx', 'README.md'],
  );
});

test('toRanges merges consecutive indices', () => {
  assert.deepEqual(toRanges([0, 5, 6, 7, 9]), [
    [0, 1],
    [5, 8],
    [9, 10],
  ]);
});

test('compactTree merges single-folder chains but keeps folders with siblings', () => {
  const tree = compactTree(
    buildTree([
      'src/host/types/agent.ts',
      'src/goals/report.ts',
      'electron/agents/claude/hooks.ts',
    ]),
  );
  const rows = visibleRows(tree, 'all').map((r) => `${r.depth}:${r.node.name}`);
  assert.deepEqual(rows, [
    '0:electron/agents/claude',
    '1:hooks.ts',
    '0:src',
    '1:goals',
    '2:report.ts',
    '1:host/types',
    '2:agent.ts',
  ]);
  assert.equal(tree[0].path, 'electron/agents/claude');
});
