import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  composeInstructions,
  instructionsFileOf,
  isInstructionsFile,
} from './instructionFiles.ts';

test('composeInstructions puts the shared file before the harness’s own, and adds nothing when both are empty', () => {
  assert.equal(composeInstructions('  \n', ''), '');
  assert.equal(
    composeInstructions('Lead with the result.\n', ''),
    "The user's instructions for this Mochi profile:\n\nLead with the result.",
  );
  assert.equal(
    composeInstructions('Shared', '\nClaude only\n'),
    "The user's instructions for this Mochi profile:\n\nShared\n\nClaude only",
  );
  assert.equal(instructionsFileOf('codex'), 'codex.md');
});

test('isInstructionsFile accepts the profile’s own files and nothing that leaves its folder', () => {
  assert.ok(isInstructionsFile('mochi.md'));
  assert.ok(isInstructionsFile('claude.md'));
  assert.ok(!isInstructionsFile('../mochi.md'));
  assert.ok(!isInstructionsFile('notes.md'));
});
