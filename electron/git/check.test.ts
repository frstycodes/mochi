import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'vite-plus/test';
import { runCheck } from './check.ts';

// Checks are the user's own commands, so they're written for the platform's shell: cmd.exe on Windows.
const isWindows = process.platform === 'win32';

test('runCheck reports the exit code and the output tail, failing or not', async () => {
  const failed = await runCheck(
    tmpdir(),
    isWindows
      ? 'echo checking& echo boom 1>&2& exit /b 3'
      : 'echo checking; echo boom >&2; exit 3',
  );
  assert.equal(failed.exitCode, 3);
  assert.match(failed.output, /checking\r?\nboom$/);
  assert.equal(
    (await runCheck(tmpdir(), isWindows ? 'exit /b 0' : 'true')).exitCode,
    0,
  );
});
