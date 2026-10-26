import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { setDataDir } from './paths.ts';
import {
  accountInstructionsUsed,
  profileFolder,
  setAccountInstructionsUsed,
} from './profileFolder.ts';

test('a profile loads the account’s instructions file until it is turned off, and only where the harness can skip it', async () => {
  setDataDir(mkdtempSync(join(tmpdir(), 'mochi-profile-')));
  assert.equal(await accountInstructionsUsed('p', 'claude'), true);

  await setAccountInstructionsUsed('p', 'claude', false);
  assert.equal(await accountInstructionsUsed('p', 'claude'), false);
  assert.equal(await accountInstructionsUsed('other', 'claude'), true);
  assert.deepEqual((await profileFolder('p')).usesAccountFile, {
    claude: false,
    codex: true,
  });

  await setAccountInstructionsUsed('p', 'claude', true);
  assert.equal(await accountInstructionsUsed('p', 'claude'), true);

  await assert.rejects(
    setAccountInstructionsUsed('p', 'codex', false),
    /always loads/,
  );
  assert.equal(await accountInstructionsUsed('p', 'codex'), true);
});
