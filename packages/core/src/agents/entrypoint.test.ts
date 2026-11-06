import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { withClaudeEntrypoint } from './config.ts';

test('labels requests as Mochi when no entrypoint is set', () => {
  assert.deepEqual(withClaudeEntrypoint({ A: '1' }), {
    A: '1',
    CLAUDE_CODE_ENTRYPOINT: 'mochi',
  });
});

test('replaces an inherited sdk-* entrypoint', () => {
  for (const inherited of ['sdk-cli', 'sdk-ts'])
    assert.equal(
      withClaudeEntrypoint({ CLAUDE_CODE_ENTRYPOINT: inherited })
        .CLAUDE_CODE_ENTRYPOINT,
      'mochi',
    );
});

test('keeps a custom entrypoint', () => {
  assert.equal(
    withClaudeEntrypoint({ CLAUDE_CODE_ENTRYPOINT: 'custom' })
      .CLAUDE_CODE_ENTRYPOINT,
    'custom',
  );
});
