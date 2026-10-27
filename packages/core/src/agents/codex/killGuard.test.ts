import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { KILL_REFUSED, KILL_WARNING, useAgentDriven } from '../processKill.ts';
import {
  CANT_ASK,
  KILL_GUARD_COMMAND,
  killHookAnswer,
  trustKillGuard,
} from './killGuard.ts';
import type { RpcClient } from './rpc.ts';

const KEY = '/<session-flags>/config.toml:pre_tool_use:0:0';

/** An app-server that lists the user's untrusted hook and the guard, and trusts what `config/value/write` names. */
function fakeServer(isGuardListed = true) {
  const trusted = new Map<string, string>();
  const writes: unknown[] = [];
  const hook = (key: string, command: string, source: string) => ({
    key,
    command,
    source,
    currentHash: `sha256:${key}`,
    trustStatus: trusted.get(key) === `sha256:${key}` ? 'trusted' : 'untrusted',
  });
  const rpc = {
    request: async (method: string, params: unknown) => {
      if (method === 'config/value/write') {
        writes.push(params);
        const { value } = params as {
          value: Record<string, { trusted_hash: string }>;
        };
        for (const [key, state] of Object.entries(value))
          trusted.set(key, state.trusted_hash);
        return {};
      }
      assert.equal(method, 'hooks/list');
      return {
        data: [
          {
            hooks: [
              hook('/Users/me/.codex/hooks.json:stop:0:0', 'mine', 'user'),
              ...(isGuardListed
                ? [hook(KEY, KILL_GUARD_COMMAND, 'sessionFlags')]
                : []),
            ],
          },
        ],
      };
    },
  } as unknown as RpcClient;
  return { rpc, writes };
}

test('trusts only the guard, once, and reports it trusted', async () => {
  const { rpc, writes } = fakeServer();
  assert.equal(await trustKillGuard(rpc), true);
  assert.deepEqual(writes, [
    {
      keyPath: 'hooks.state',
      mergeStrategy: 'upsert',
      value: { [KEY]: { trusted_hash: `sha256:${KEY}` } },
    },
  ]);
  assert.equal(await trustKillGuard(rpc), true);
  assert.equal(writes.length, 1);
});

test('a server that lists no guard writes nothing and reports untrusted', async () => {
  const { rpc, writes } = fakeServer(false);
  assert.equal(await trustKillGuard(rpc), false);
  assert.deepEqual(writes, []);
});

const hookInput = (command: string) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command },
  session_id: 'codex-thread',
});
const deny = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
});
// A pattern no process here matches, so the ask doesn't depend on what's running.
const NOBODY = 'zz-mochi-guard-nobody';

test("Codex can't ask: an ask is a deny that says so, a refusal keeps its reason, a PID kill runs", () => {
  useAgentDriven((threadId) => threadId === 'auto');
  assert.deepEqual(
    killHookAnswer('a', hookInput(`pkill -f ${NOBODY}`)),
    deny(`${KILL_WARNING} Blocked: ${CANT_ASK}`),
  );
  assert.deepEqual(
    killHookAnswer('auto--agent', hookInput(`pkill -f ${NOBODY}`)),
    deny(KILL_REFUSED),
  );
  // `.` matches every process, Core's own included: refused whoever started the turn.
  const reaching = killHookAnswer('a', hookInput('pkill -f x .'));
  assert.match(
    reaching?.hookSpecificOutput.permissionDecisionReason ?? '',
    /^Mochi: refused\./,
  );
  assert.equal(killHookAnswer('a', hookInput('kill 123')), null);
  assert.equal(
    killHookAnswer('a', { ...hookInput('pkill x'), hook_event_name: 'Stop' }),
    null,
  );
  useAgentDriven(() => false);
});
