import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeCall, describeCommand } from './describe.ts';

test('Codex commands read as plain sentences, the raw command as the fallback', () => {
  const cases: [string, string][] = [
    ["/bin/zsh -lc 'git status --short'", 'Checked git status'],
    ['git -C apps/web log --oneline -5', 'Read the git log'],
    ['git diff src/chat/rows.ts', 'Looked at the diff of rows.ts'],
    ['pnpm -s typecheck; echo "exit $?"', 'Type-checked the project'],
    ['pnpm --filter api test usage', 'Ran the tests in api'],
    ['npm run build 2>&1', 'Built the project'],
    ['pnpm exec tsc -p electron --noEmit', 'Type-checked the project'],
    ['pnpm add ioredis', 'Added ioredis'],
    ['cd apps/web && REDIS_URL=redis://x pnpm test', 'Ran the tests'],
    ['ls -la src/chat', 'Listed files in chat'],
    ['cat src/usage.tsx | head -40', 'Read usage.tsx'],
    ["sed -n '1,80p' src/WorkLog.tsx", 'Read part of WorkLog.tsx'],
    ['rg -n "describeTool|VERBS" electron src', 'Searched for “describeTool|VERBS” in electron, src'],
    ['find . -name "*.test.ts"', 'Looked for files'],
    ['gh pr checks 42 --watch', "Checked PR 42's CI"],
    ['gh run watch 1234', 'Waited for the CI run to finish'],
    ['curl -s https://api.github.com/repos/x/y', 'Requested api.github.com'],
    ['sleep 30', 'Waited 30s'],
    ['node -e "\\\n  console.log(1)"', 'Ran a JavaScript snippet'],
    ["python3 -c 'print(1)'", 'Ran a Python snippet'],
    ['k6 run scripts/load/ratelimit.k6.js --vus 200', 'k6 run scripts/load/ratelimit.k6.js --vus 200'],
  ];
  for (const [command, expected] of cases) assert.equal(describeCommand(command), expected, command);
});

test("a call prefers the agent's own description, else reads from its verb", () => {
  assert.equal(describeCall({ text: 'Run gh run watch 1', description: "Waited for PR 42's CI run to finish" }), "Waited for PR 42's CI run to finish");
  assert.equal(describeCall({ text: 'Read src/usage.tsx' }), 'Read usage.tsx');
  assert.equal(describeCall({ text: 'Edit src/Composer.tsx  +3 −1' }), 'Edited Composer.tsx');
  assert.equal(describeCall({ text: 'Search redis token bucket' }), 'Searched the web for “redis token bucket”');
  assert.equal(describeCall({ text: 'Run pnpm test' }), 'Ran the tests');
  assert.equal(describeCall({ text: 'Mcp claude.ai Linear: get_issue' }), 'Called get_issue on claude.ai Linear');
  assert.equal(describeCall({ text: 'Skill ui' }), 'Used the ui skill');
});
