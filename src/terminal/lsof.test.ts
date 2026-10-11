import assert from 'node:assert/strict';
import { test } from 'node:test';
import { launchConfigs, listeningUnder, packageScripts, parseCwds, parseEtime, parseListening, parsePs, pickPort } from './lsof.ts';

test('lsof listeners, cwds and ps rows combine into ports under the thread root', () => {
  const listening = parseListening('p100\ncnode\nf21\nn*:5173\nf22\nn[::1]:5173\np200\nf9\nn127.0.0.1:3000\np300\nf4\nn*:8080\n');
  assert.deepEqual(listening, [
    { pid: 100, port: 5173 },
    { pid: 200, port: 3000 },
    { pid: 300, port: 8080 },
  ]);
  const cwds = parseCwds('p100\nfcwd\nn/repo/wt\np200\nfcwd\nn/repo/wt/apps/web\np300\nfcwd\nn/repo/wt-other\n');
  const procs = parsePs('  100 01:02:03 node vite --port 5173\n  200 2-00:00:05 node server.js\n');
  const ports = listeningUnder('/repo/wt', listening, cwds, procs, 1_000_000_000);
  assert.deepEqual(ports.map((p) => [p.port, p.pid, p.command]), [
    [3000, 200, 'node server.js'],
    [5173, 100, 'node vite --port 5173'],
  ]);
  assert.equal(ports[1].startedAt, 1_000_000_000 - 3723_000);
});

test('etime covers mm:ss, hh:mm:ss and dd-hh:mm:ss', () => {
  assert.equal(parseEtime('00:07'), 7);
  assert.equal(parseEtime('01:02:03'), 3723);
  assert.equal(parseEtime('2-00:00:05'), 172805);
});

test('port allocation skips reserved and busy ports', async () => {
  const busy = new Set([5301]);
  assert.equal(await pickPort(5300, new Set([5300]), async (p) => !busy.has(p)), 5302);
  await assert.rejects(pickPort(5300, new Set(), async () => false, 5303));
});

test('run targets come from dev-ish package scripts and launch.json configs', () => {
  assert.deepEqual(packageScripts({ scripts: { dev: 'vite', build: 'tsc', 'dev:api': 'node api', test: 'x' } }, 'pnpm').map((t) => t.command), ['pnpm run dev', 'pnpm run dev:api']);
  const [target] = launchConfigs({ configurations: [{ name: 'app', runtimeExecutable: 'pnpm', runtimeArgs: ['dev', '--port', '5191', "it's"], port: 5191 }, { name: 'bad' }] });
  assert.deepEqual(target, { name: 'app', command: `pnpm dev --port 5191 'it'\\''s'`, source: 'launch.json', port: 5191 });
});
