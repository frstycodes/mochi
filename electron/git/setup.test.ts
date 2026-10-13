import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SetupChoice, WorktreeSetup } from '../../src/host/types/agent.ts';
import { includePatterns, installCommand, matchesInclude, prepareWorktree } from './setup.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

test('the install follows the lockfile at the top of the worktree', () => {
  const manager = (...files: string[]) => installCommand(new Set(files))?.argv.join(' ');
  assert.equal(manager('package.json', 'pnpm-lock.yaml'), 'pnpm install --frozen-lockfile --prefer-offline');
  assert.equal(manager('package-lock.json'), 'npm ci');
  assert.equal(manager('yarn.lock'), 'yarn install --frozen-lockfile');
  assert.equal(manager('yarn.lock', '.yarnrc.yml'), 'yarn install --immutable');
  assert.equal(manager('bun.lock'), 'bun install --frozen-lockfile');
  assert.equal(manager('bun.lockb'), 'bun install --frozen-lockfile');
  assert.equal(manager('uv.lock', 'pyproject.toml'), 'uv sync --frozen');
  assert.equal(manager('poetry.lock'), 'poetry install');
  assert.equal(manager('Gemfile.lock'), 'bundle install');
  assert.equal(manager('go.mod', 'go.sum'), 'go mod download');
  assert.equal(manager('Cargo.lock'), 'cargo fetch --locked');
  assert.equal(manager('package.json'), undefined, 'no lockfile, nothing to install from');
  assert.equal(manager('pnpm-lock.yaml', 'package-lock.json'), 'pnpm install --frozen-lockfile --prefer-offline', 'pnpm wins over a stray npm lockfile');
});

test('include patterns read like .gitignore', () => {
  const patterns = includePatterns('.env*, # comment\n!.env.example\nconfig/local.json\n.secrets/');
  assert.deepEqual(patterns, ['.env*', '!.env.example', 'config/local.json', '.secrets/']);
  assert.equal(matchesInclude('.env', patterns), true);
  assert.equal(matchesInclude('apps/web/.env.local', patterns), true, 'a name without a slash matches at any depth');
  assert.equal(matchesInclude('.env.example', patterns), false, '! takes a match back');
  assert.equal(matchesInclude('config/local.json', patterns), true);
  assert.equal(matchesInclude('apps/config/local.json', patterns), false, 'a pattern with a slash is anchored');
  assert.equal(matchesInclude('.secrets/', patterns), true);
  assert.equal(matchesInclude('.secrets', patterns), false, 'a trailing slash only takes folders');
  assert.equal(matchesInclude('node_modules/', patterns), false);
});

function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mochi-setup-')));
  const project = join(root, 'project');
  mkdirSync(project);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: { ...process.env, ...IDENTITY }, stdio: 'pipe' }).toString();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(project, '.gitignore'), '.env*\nnode_modules/\nlocal.json\n');
  writeFileSync(join(project, '.worktreeinclude'), 'local.json\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  writeFileSync(join(project, '.env'), 'SECRET=1\n');
  writeFileSync(join(project, '.env.example'), 'SECRET=\n');
  writeFileSync(join(project, 'local.json'), '{}\n');
  mkdirSync(join(project, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(project, 'node_modules', 'dep', '.env'), 'NOT=copied\n');
  const dir = join(root, 'worktree');
  git('worktree', 'add', '-q', '-b', 'mochi/t', dir);
  return { project, dir };
}

function recorder() {
  const updates: WorktreeSetup[] = [];
  return { updates, emit: (s: WorktreeSetup) => updates.push(s), last: () => updates.at(-1)! };
}

test('setup copies ignored local files, then runs the setup command with the worktree paths', async () => {
  const { project, dir } = scratch();
  const { emit, last } = recorder();
  const status = await prepareWorktree({ root: project, dir, include: '.env*, !.env.example', command: 'echo "$MOCHI_ROOT_PATH" > from-root.txt', emit, choose: () => Promise.resolve('skip'), signal: new AbortController().signal });
  assert.equal(status, 'ready');
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'SECRET=1\n');
  assert.equal(readFileSync(join(dir, 'local.json'), 'utf8'), '{}\n', ".worktreeinclude's patterns add to the setting");
  assert.equal(existsSync(join(dir, '.env.example')), false);
  assert.equal(existsSync(join(dir, 'node_modules')), false, 'never walks into an ignored folder');
  assert.equal(readFileSync(join(dir, 'from-root.txt'), 'utf8').trim(), project);
  assert.deepEqual(last().steps.map((s) => [s.id, s.status]), [['copy', 'done'], ['script', 'done']]);
  assert.equal(last().status, 'ready');
  assert.ok(last().endedAt);
});

test('a failed step waits: Retry runs it again, Skip setup ends the setup skipped', async () => {
  const { project, dir } = scratch();
  const { emit, last } = recorder();
  const choices: SetupChoice[] = ['retry', 'skip'];
  let asked = 0;
  const status = await prepareWorktree({
    root: project,
    dir,
    include: '',
    command: 'echo boom >&2; exit 3',
    emit,
    choose: () => {
      asked++;
      assert.equal(last().status, 'failed', 'the row shows the failure while it waits');
      return Promise.resolve(choices.shift()!);
    },
    signal: new AbortController().signal,
  });
  assert.equal(status, 'skipped');
  assert.equal(asked, 2, 'retried once, then skipped');
  const step = last().steps.find((s) => s.id === 'script')!;
  assert.equal(step.status, 'failed');
  assert.equal(step.exitCode, 3);
  assert.match(step.output ?? '', /boom/);
});

test('an abort stops the running command and ends the setup cancelled', async () => {
  const { project, dir } = scratch();
  const { emit, last } = recorder();
  const abort = new AbortController();
  const started = Date.now();
  setTimeout(() => abort.abort(), 300);
  const status = await prepareWorktree({ root: project, dir, include: '', command: 'sleep 30', emit, choose: () => Promise.resolve('skip'), signal: abort.signal });
  assert.equal(status, 'cancelled');
  assert.ok(Date.now() - started < 5000, 'the sleep was killed, not waited out');
  assert.equal(last().status, 'cancelled');
});

test('nothing to prepare emits nothing', async () => {
  const { project, dir } = scratch();
  const { updates, emit } = recorder();
  assert.equal(await prepareWorktree({ root: project, dir, include: '', emit, choose: () => Promise.resolve('skip'), signal: new AbortController().signal }).then(() => updates.length > 0), true, '.worktreeinclude alone still copies local.json');
  writeFileSync(join(project, '.worktreeinclude'), '');
  const quiet = recorder();
  assert.equal(await prepareWorktree({ root: project, dir, include: '', emit: quiet.emit, choose: () => Promise.resolve('skip'), signal: new AbortController().signal }), 'ready');
  assert.equal(quiet.updates.length, 0);
});
