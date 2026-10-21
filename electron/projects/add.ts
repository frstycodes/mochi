import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isCloneUrl, normalizeOrigin, repoName } from '../../src/git/origin.ts';
import type { GithubAccountRef } from '../../src/git/github.ts';
import type { CloneSource, GithubRepo } from '../../src/host/types/projects.ts';
import { runGhOn, runGitAs } from '../git/gh.ts';
import { runGit, runStreaming, topLevel } from '../git/run.ts';

const OWNER_REPO = /^[\w.-]+\/(?!\.\.?(?:\.git)?$)[\w.-]+$/;
const NAME = /^[\w.-]+$/;

/**
 * Clones `source` into `parentDir/<repo>`. A URL clones with your own git credentials; `owner/repo` clones from GitHub as
 * the profile's account (its token through a credential helper, never in the URL or the repo's config), or through
 * `gh repo clone` as gh's active login when the profile has none. Returns the folder and the repo's name.
 */
export async function cloneProject(source: CloneSource, parentDir: string, account: GithubAccountRef | undefined, onLine: (line: string) => void) {
  if ('url' in source) {
    if (!isCloneUrl(source.url)) throw new Error(`${source.url} isn’t a git URL Mochi can clone: use https://…, ssh://… or git@host:owner/repo`);
    const name = repoName(normalizeOrigin(source.url)!);
    const dest = await freeFolder(parentDir, name);
    await runStreaming('git', dest.parent, ['clone', '--progress', '--', source.url, dest.path], onLine);
    return { path: dest.path, name };
  }
  if (!OWNER_REPO.test(source.github)) throw new Error(`${source.github} isn’t owner/repo`);
  const name = source.github.slice(source.github.indexOf('/') + 1).replace(/\.git$/, '');
  const dest = await freeFolder(parentDir, name);
  if (account) {
    const url = `https://${account.host}/${source.github}.git`;
    await runGitAs(account, dest.parent, ['clone', '--progress', '--', url, dest.path], (args, env) => runStreaming('git', dest.parent, args, onLine, env));
  } else await runStreaming('gh', dest.parent, ['repo', 'clone', source.github, dest.path, '--', '--progress'], onLine);
  return { path: dest.path, name };
}

/** `git init` in `parentDir/<name>`. Publishing is separate (`publishProject`), so a failed publish still leaves the project. */
export async function initProject(parentDir: string, name: string) {
  if (!NAME.test(name) || name === '.' || name === '..') throw new Error('A project name takes letters, digits, “.”, “-” and “_”');
  const dest = await freeFolder(parentDir, name);
  await mkdir(dest.path);
  await runGit(dest.path, ['init']);
  return dest.path;
}

/**
 * The folder for a new project: `path` as it is, or made from `from`'s files, moved or copied there (`path` must not exist yet).
 * `gitInit` runs `git init` unless the folder is already inside a repository.
 */
export async function adoptFolder(path: string, from: string | undefined, transfer: 'move' | 'copy', gitInit: boolean) {
  const dest = resolve(path.replace(/^~(?=[\\/]|$)/, homedir()));
  if (from !== undefined) {
    if (!isAbsolute(from) || !(await stat(from).then((s) => s.isDirectory(), () => false))) throw new Error(`${from} isn't a folder`);
    if (await stat(dest).then(() => true, () => false)) throw new Error(`${dest} already exists; pick a new folder for the project`);
    await mkdir(dirname(dest), { recursive: true });
    if (transfer === 'copy') await cp(from, dest, { recursive: true, errorOnExist: true, force: false });
    else await moveFolder(from, dest);
  }
  if (gitInit && !(await topLevel(dest).then(() => true, () => false))) await runGit(dest, ['init']);
  return dest;
}

// A rename can't cross volumes (EXDEV): the files are copied, then the original removed.
async function moveFolder(from: string, dest: string) {
  try {
    await rename(from, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, dest, { recursive: true, errorOnExist: true, force: false });
    await rm(from, { recursive: true });
  }
}

/** A GitHub repository for the folder through gh, set as its origin; nothing is pushed until there's a commit. */
export async function publishProject(path: string, name: string, visibility: 'private' | 'public', account: GithubAccountRef | undefined) {
  await runGhOn(account, ['repo', 'create', name, `--${visibility}`, '--source', path, '--remote', 'origin'], path);
}

/** The account's own repositories, most recently updated first. */
export async function githubRepos(account: GithubAccountRef | undefined): Promise<GithubRepo[]> {
  const out = await runGhOn(account, ['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,description,isPrivate,updatedAt']);
  const rows = JSON.parse(out) as { nameWithOwner: string; description: string | null; isPrivate: boolean; updatedAt: string }[];
  return rows
    .map((r) => ({ name: r.nameWithOwner, description: r.description ?? '', isPrivate: r.isPrivate, updatedAt: r.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** `parentDir/<name>` when nothing is there yet; the parent is created if needed. */
async function freeFolder(parentDir: string, name: string) {
  const parent = resolve(parentDir.replace(/^~(?=[\\/]|$)/, homedir()));
  const path = join(parent, name);
  if (await stat(path).then(() => true, () => false)) throw new Error(`${path} already exists; add it with Open folder instead`);
  await mkdir(parent, { recursive: true });
  return { parent, path };
}
