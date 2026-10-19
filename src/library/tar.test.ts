import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { readTar } from './tar.ts';

test('readTar reads regular files, long pax paths, and skips what accept rejects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-tar-'));
  const long = `${'deep/'.repeat(25)}SKILL.md`;
  mkdirSync(join(root, 'repo', long, '..'), { recursive: true });
  writeFileSync(join(root, 'repo', 'a.md'), 'A');
  writeFileSync(join(root, 'repo', 'big.bin'), 'x'.repeat(2000));
  writeFileSync(join(root, 'repo', long), 'long one');
  // Gzipped separately: bsdtar pads its own -z output, which a gzip stream reader rejects as trailing junk.
  const archive = gzipSync(execFileSync('tar', ['-c', '--format', 'pax', '-C', root, 'repo']));
  const stream = new Blob([archive]).stream().pipeThrough(new DecompressionStream('gzip'));
  const files = new Map<string, string>();
  for await (const entry of readTar(stream, (_path, size) => size < 1000)) files.set(entry.path, new TextDecoder().decode(entry.body));
  assert.equal(files.get('repo/a.md'), 'A');
  assert.equal(files.get(`repo/${long}`), 'long one');
  assert.ok(!files.has('repo/big.bin'));
});

test('readTar hands over the commit git archive writes in the global header', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mochi-tar-git-'));
  writeFileSync(join(root, 'SKILL.md'), 'x');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString().trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'init', '--no-verify');
  const archive = gzipSync(execFileSync('git', ['-C', root, 'archive', '--format=tar', '--prefix=repo-HEAD/', 'HEAD']));
  let commit = '';
  const stream = new Blob([archive]).stream().pipeThrough(new DecompressionStream('gzip'));
  for await (const entry of readTar(stream, () => true, (c) => (commit = c))) assert.equal(entry.path, 'repo-HEAD/SKILL.md');
  assert.equal(commit, git('rev-parse', 'HEAD'));
});
