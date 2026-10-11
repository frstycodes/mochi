import type { ChangeKind, DiffFile, DiffHunk, GitFileStatus, Worktree } from '../host/types/git.ts';

/** Splits `git diff` output into files and self-contained hunk patches. */
export function parseDiff(text: string, staged: boolean): DiffFile[] {
  return text
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '))
    .map((chunk) => parseFile(chunk, staged));
}

function parseFile(chunk: string, staged: boolean): DiffFile {
  const lines = (chunk.endsWith('\n') ? chunk.slice(0, -1) : chunk).split('\n');
  const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
  const headerLines = firstHunk < 0 ? lines : lines.slice(0, firstHunk);
  const header = `${headerLines.join('\n')}\n`;
  const hunks = firstHunk < 0 ? [] : splitHunks(lines.slice(firstHunk), header);
  const { path, oldPath } = filePaths(headerLines);
  return {
    path,
    oldPath,
    kind: changeKind(headerLines),
    staged,
    binary: headerLines.some((l) => l.startsWith('Binary files') || l === 'GIT binary patch'),
    added: hunks.reduce((n, h) => n + h.added, 0),
    removed: hunks.reduce((n, h) => n + h.removed, 0),
    patch: chunk.endsWith('\n') ? chunk : `${chunk}\n`,
    hunks,
  };
}

// Hunk bodies only hold lines starting with ' ', '+', '-' or '\', so any '@@' line opens the next hunk.
function splitHunks(lines: string[], header: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let start = 0;
  for (let i = 1; i <= lines.length; i++) {
    if (i < lines.length && !lines[i].startsWith('@@')) continue;
    const body = lines.slice(start, i);
    hunks.push({
      header: body[0],
      patch: `${header}${body.join('\n')}\n`,
      added: body.filter((l) => l[0] === '+').length,
      removed: body.filter((l) => l[0] === '-').length,
    });
    start = i;
  }
  return hunks;
}

function changeKind(header: string[]): ChangeKind {
  if (header.some((l) => l.startsWith('new file mode'))) return 'added';
  if (header.some((l) => l.startsWith('deleted file mode'))) return 'deleted';
  if (header.some((l) => l.startsWith('rename from'))) return 'renamed';
  return 'modified';
}

function filePaths(header: string[]) {
  const field = (prefix: string) => {
    const line = header.find((l) => l.startsWith(prefix));
    return line === undefined ? undefined : unquote(line.slice(prefix.length));
  };
  const renamedFrom = field('rename from ');
  const after = field('+++ b/') ?? field('rename to ');
  const before = field('--- a/') ?? renamedFrom;
  const path = after ?? before ?? gitLinePath(header[0]);
  return { path, oldPath: renamedFrom };
}

// `diff --git a/X b/X` is ambiguous with spaces; binary and mode-only diffs have no ---/+++ lines, and both halves match there.
function gitLinePath(line: string) {
  const rest = line.slice('diff --git '.length);
  if (rest.startsWith('"')) return unquote(rest.slice(0, rest.indexOf('" "') + 1)).slice(2);
  return rest.slice(2, (rest.length - 1) / 2);
}

// git appends a tab after ---/+++ paths containing spaces, and C-quotes paths with quotes or control characters.
function unquote(raw: string) {
  const value = raw.replace(/\t$/, '');
  if (!value.startsWith('"')) return value;
  return JSON.parse(value) as string;
}

/** `git status --porcelain=v1 -z`. Renames carry their old path as the next NUL field. */
export function parseStatus(text: string): GitFileStatus[] {
  const fields = text.split('\0');
  const files: GitFileStatus[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    files.push({ path: entry.slice(3), status: statusOf(xy) });
    if (xy.includes('R') || xy.includes('C')) i++;
  }
  return files;
}

function statusOf(xy: string): GitFileStatus['status'] {
  if (xy === '??') return 'untracked';
  if (xy.includes('A')) return 'added';
  if (xy.includes('D')) return 'deleted';
  return 'modified';
}

/** `git worktree list --porcelain`: blank-line separated records. */
export function parseWorktrees(text: string): Worktree[] {
  return text
    .split(/\n\n+/)
    .map((block) => block.split('\n').filter(Boolean))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => {
      const value = (key: string) => lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      return {
        path: value('worktree')!,
        head: value('HEAD') ?? '',
        branch: value('branch')?.replace(/^refs\/heads\//, '') ?? null,
      };
    });
}
