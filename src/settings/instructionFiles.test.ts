import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { composeInstructions, instructionsFileOf } from './instructionFiles.ts';

test('composeInstructions puts the shared file before the harness’s own, and adds nothing when both are empty', () => {
  assert.equal(composeInstructions('  \n', ''), '');
  assert.equal(composeInstructions('Lead with the result.\n', ''), "The user's instructions for this Mochi profile:\n\nLead with the result.");
  assert.equal(composeInstructions('Shared', '\nClaude only\n'), "The user's instructions for this Mochi profile:\n\nShared\n\nClaude only");
  assert.equal(instructionsFileOf('codex'), 'codex.md');
});
