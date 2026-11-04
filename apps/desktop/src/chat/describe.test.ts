import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { shortCommand } from '../agentPhase.ts';
import { describeCall } from './describe.ts';

test('a long command shortens to its program and last argument, like Claude', () => {
  const cases: [string, string][] = [
    ['pnpm test', 'pnpm test'],
    ["/bin/zsh -lc 'git status --short'", 'git status --short'],
    [
      'cat apps/desktop/node_modules/torph/dist/react/index.d.ts',
      'cat … index.d.ts',
    ],
    ["sed -n '1,80p' apps/desktop/src/WorkLog.tsx", 'sed … WorkLog.tsx'],
    ['rg -n "describeTool|VERBS" electron src/chat/', 'rg … chat'],
    ['node -e "\\\n  console.log(1)"', 'node -e "\\'],
  ];
  for (const [command, expected] of cases)
    assert.equal(shortCommand(command), expected, command);
});

test("a call prefers the agent's own description, else reads from its verb", () => {
  assert.equal(
    describeCall({
      text: 'Run gh run watch 1',
      description: "Waited for PR 42's CI run to finish",
    }),
    "Waited for PR 42's CI run to finish",
  );
  assert.equal(describeCall({ text: 'Read src/usage.tsx' }), 'Read usage.tsx');
  assert.equal(
    describeCall({ text: 'Edit src/Composer.tsx  +3 −1' }),
    'Edited Composer.tsx',
  );
  assert.equal(
    describeCall({ text: 'Search redis token bucket' }),
    'Searched the web for “redis token bucket”',
  );
  assert.equal(describeCall({ text: 'Run pnpm test' }), 'Ran pnpm test');
  assert.equal(
    describeCall({ text: 'Mcp claude.ai Linear: get_issue' }),
    'Called get issue on claude.ai Linear',
  );
  assert.equal(
    describeCall({ text: 'Mcp mochi: rename_thread' }),
    'Renamed a thread',
  );
  assert.equal(
    describeCall({ text: 'Mcp mochi: some_future_tool' }),
    'Called some future tool on Mochi',
  );
  assert.equal(describeCall({ text: 'Skill ui' }), 'Used the Ui skill');
});
