import type { DiffFile } from '../host/types/git.ts';

export interface DirGroup {
  dir: string;
  files: DiffFile[];
}

/** Files sorted by path and grouped under their directory, like a compressed file tree. */
export function groupByDir(files: DiffFile[]): DirGroup[] {
  const groups = new Map<string, DiffFile[]>();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const dir = file.path.slice(0, file.path.lastIndexOf('/') + 1);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  return [...groups].map(([dir, files]) => ({ dir, files }));
}

export function fileKey(file: Pick<DiffFile, 'path' | 'staged'>) {
  return `${file.staged ? 'staged' : 'worktree'}:${file.path}`;
}

/** Whether a hunk (`@@ -a,b +c,d @@`) covers `line` on that side; a missing count means one line. */
export function hunkCovers(header: string, side: 'additions' | 'deletions', line: number) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!m) return false;
  const [start, count = '1'] = side === 'deletions' ? [m[1], m[2]] : [m[3], m[4]];
  return line >= Number(start) && line < Number(start) + Number(count);
}

/** A line comment from the Changes tab as the thread reads it. */
export function reviewNote(path: string, side: 'additions' | 'deletions', line: number, text: string) {
  const where = side === 'deletions' ? `${path}, removed line ${line}` : `${path}:${line}`;
  return `Review note on \`${where}\`\n\n${text}`;
}
