import type { DiffFile } from '../host/types/git.ts';
import {
  buildTree,
  compactTree,
  visibleRows,
  type TreeNode,
} from '../files/tree.ts';

export interface ChangeSection {
  /** "Staged" / "Changes" while staging is possible; null for one flat list. */
  title: string | null;
  tree: TreeNode[];
  /** In the tree's order, so the diffs read top to bottom like the tree. */
  files: DiffFile[];
}

export function changeSections(
  files: DiffFile[],
  canStage: boolean,
): ChangeSection[] {
  const groups = canStage
    ? [
        { title: 'Staged', files: files.filter((f) => f.staged) },
        { title: 'Changes', files: files.filter((f) => !f.staged) },
      ].filter((g) => g.files.length > 0)
    : [{ title: null, files }];
  return groups.map(({ title, files }) => {
    const tree = compactTree(buildTree(files.map((f) => f.path)));
    const byPath = new Map(files.map((f) => [f.path, f]));
    const ordered = visibleRows(tree, 'all').flatMap(
      ({ node }) => byPath.get(node.path) ?? [],
    );
    return { title, tree, files: ordered };
  });
}

export function fileKey(file: Pick<DiffFile, 'path' | 'staged'>) {
  return `${file.staged ? 'staged' : 'worktree'}:${file.path}`;
}

/** Whether a hunk (`@@ -a,b +c,d @@`) covers `line` on that side; a missing count means one line. */
export function hunkCovers(
  header: string,
  side: 'additions' | 'deletions',
  line: number,
) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!m) return false;
  const [start, count = '1'] =
    side === 'deletions' ? [m[1], m[2]] : [m[3], m[4]];
  return line >= Number(start) && line < Number(start) + Number(count);
}

/** A line comment from the Changes tab as the thread reads it. */
export function reviewNote(
  path: string,
  side: 'additions' | 'deletions',
  line: number,
  text: string,
) {
  const where =
    side === 'deletions' ? `${path}, removed line ${line}` : `${path}:${line}`;
  return `Review note on \`${where}\`\n\n${text}`;
}
