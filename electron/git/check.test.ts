import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { runCheck } from './check.ts';

test('runCheck reports the exit code and the output tail, failing or not', async () => {
  const failed = await runCheck(tmpdir(), 'echo checking; echo boom >&2; exit 3');
  assert.equal(failed.exitCode, 3);
  assert.match(failed.output, /checking\nboom$/);
  assert.equal((await runCheck(tmpdir(), 'true')).exitCode, 0);
});
