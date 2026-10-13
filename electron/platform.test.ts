import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnable } from './platform.ts';

test('only Windows shims and bare names go through cmd.exe, quoted', () => {
  assert.deepEqual(spawnable('/usr/local/bin/codex', ['app-server'], false), { file: '/usr/local/bin/codex', args: ['app-server'] });
  assert.deepEqual(spawnable('C:\\Tools\\claude.EXE', ['--version'], true), { file: 'C:\\Tools\\claude.EXE', args: ['--version'] });
  assert.deepEqual(spawnable('C:\\Program Files\\nodejs\\codex.cmd', ['app-server'], true), { file: '"C:\\Program Files\\nodejs\\codex.cmd" app-server', args: [], shell: true });
  assert.deepEqual(spawnable('pnpm', ['install', '--frozen-lockfile'], true), { file: 'pnpm install --frozen-lockfile', args: [], shell: true });
  assert.equal(spawnable('x.cmd', ['say "hi"'], true).file, 'x.cmd "say ""hi"""');
});
