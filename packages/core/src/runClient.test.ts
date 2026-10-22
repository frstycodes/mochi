import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCommand, RunError, spawnCommand } from './runClient.ts';

test('runCommand returns output, rejects a bad exit and a timeout as RunError', async () => {
  assert.equal((await runCommand('sh', ['-c', 'echo hi'])).stdout, 'hi\n');
  assert.equal((await runCommand('sh', ['-c', 'echo in; cat'], { input: 'piped' })).stdout, 'in\npiped');
  await assert.rejects(runCommand('sh', ['-c', 'echo nope >&2; exit 3']), (e) => e instanceof RunError && e.code === 3 && e.stderr.includes('nope'));
  await assert.rejects(runCommand('sleep', ['5'], { timeout: 50 }), (e) => e instanceof RunError && e.timedOut === true);
  await assert.rejects(runCommand('no-such-binary-xyz'), (e) => e instanceof RunError && e.code === -1);
});

test('spawnCommand streams stdout, takes stdin and reports exit', async () => {
  const child = spawnCommand('cat');
  const seen: string[] = [];
  child.stdout.setEncoding('utf8').on('data', (text: string) => seen.push(text));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.stdin.write('ping\n');
  child.stdin.end();
  assert.equal(await exited, 0);
  assert.equal(seen.join(''), 'ping\n');
});

test('spawnCommand kill ends a long process with a non-zero code', async () => {
  const child = spawnCommand('sleep', ['30']);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  setTimeout(() => child.kill(), 200);
  // null where a signal killed it; Windows' taskkill gives an exit code.
  assert.notEqual(await exited, 0);
});
