import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import type {
  DiffFile,
  GhAccount,
  GitFileStatus,
  Worktree,
} from '../host/types/git.ts';

/** Splits `git diff` output into files and self-contained hunk patches. */
export function parseDiff(text: string, staged: boolean): DiffFile[] {
  return rawFilePatches(text).flatMap((patch) =>
    parsePatchFiles(patch).flatMap(({ files }) =>
      files.map((file) => diffFile(file, patch, staged)),
    ),
  );
}

// The library exposes parsed content, but staging/discard must retain the original patch bytes.
export function rawFilePatches(text: string) {
  return text
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '));
}

function diffFile(
  file: FileDiffMetadata,
  chunk: string,
  staged: boolean,
): DiffFile {
  const patch = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
  const offsets: number[] = [];
  let from = 0;
  for (const hunk of file.hunks) {
    const start = patch.indexOf(`\n${hunk.hunkSpecs!}`, from) + 1;
    offsets.push(start);
    from = start + 1;
  }
  const header = patch.slice(0, offsets[0] ?? patch.length);
  const hunks = file.hunks.map((hunk, index) => ({
    header: hunk.hunkSpecs!.replace(/\r?\n$/, ''),
    patch:
      header + patch.slice(offsets[index], offsets[index + 1] ?? patch.length),
    added: hunk.additionLines,
    removed: hunk.deletionLines,
  }));
  const isRenamed =
    file.type === 'rename-pure' ||
    file.type === 'rename-changed' ||
    /^rename from /m.test(header);
  return {
    path: file.name,
    oldPath: isRenamed ? file.prevName : undefined,
    kind:
      file.type === 'new'
        ? 'added'
        : file.type === 'deleted'
          ? 'deleted'
          : isRenamed
            ? 'renamed'
            : 'modified',
    staged,
    binary: /^(Binary files |GIT binary patch)/m.test(header),
    added: hunks.reduce((count, hunk) => count + hunk.added, 0),
    removed: hunks.reduce((count, hunk) => count + hunk.removed, 0),
    patch,
    hunks,
  };
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
      const value = (key: string) =>
        lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      return {
        path: value('worktree')!,
        head: value('HEAD') ?? '',
        branch: value('branch')?.replace(/^refs\/heads\//, '') ?? null,
      };
    });
}

/**
 * `gh auth status` (gh 2.78 has no --json for it; the text goes to stderr) → logins on every host. Reads only the login and
 * active lines, so the token lines it also prints never leave this function.
 */
export function parseGhAuthStatus(text: string): GhAccount[] {
  const accounts: GhAccount[] = [];
  let current: GhAccount | null = null;
  for (const line of text.split('\n')) {
    const login = line.match(
      /^\s*(✓ Logged in|X Failed to log in) to (\S+) account (\S+)/,
    );
    if (login) {
      current = {
        host: login[2],
        login: login[3],
        isActive: false,
        isValid: login[1].startsWith('✓'),
      };
      accounts.push(current);
    } else if (current && /^\s*- Active account: true/.test(line))
      current.isActive = true;
  }
  return accounts;
}
