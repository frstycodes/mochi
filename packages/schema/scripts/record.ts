// Records the agent events the Claude and Codex mappers produce from their own recorded provider streams, for the schema
// round-trip tests. Run from the repo root: `node --import ./scripts/test-env.ts packages/schema/scripts/record.ts`.
// Outside the package's tsconfig on purpose: it reaches into `electron/`, which the package must not depend on.
import { readFileSync, writeFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../../../src/host/types/agent.ts';
import { createMapper } from '../../core/src/agents/claude/map.ts';
import { FIXTURE } from '../../core/src/agents/claude/fixture.ts';
import {
  mapNotification,
  mapRequest,
  requestKey,
  threadState,
} from '../../core/src/agents/codex/map.ts';
import { RpcClient } from '../../core/src/agents/codex/rpc.ts';

const lines = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function claude(messages: unknown[]) {
  const { map } = createMapper('t1', '/repo');
  return messages.flatMap((m) => map(m as SDKMessage));
}

function codex(name: string) {
  const input = new PassThrough();
  const s = threadState('h1', '/tmp/scratch');
  const events: AgentEvent[] = [];
  const rpc = new RpcClient(input, new PassThrough(), {
    onNotification: (method, params) =>
      events.push(...mapNotification(method, params, s)),
    onRequest: (id, method, params) => {
      const event = mapRequest(method, params, requestKey('default', id), s);
      if (event) events.push(event);
    },
    onInvalid: () => {},
  });
  input.write(
    readFileSync(
      new URL(
        `../../core/src/agents/codex/fixtures/${name}.jsonl`,
        import.meta.url,
      ),
      'utf8',
    ),
  );
  rpc.close('done');
  return events;
}

const recorded = {
  'claude/turn': claude(FIXTURE),
  'claude/subagent': claude(
    lines('../../core/src/agents/claude/fixtures/subagent.jsonl'),
  ),
  'claude/background': claude(
    lines('../../core/src/agents/claude/fixtures/background.jsonl'),
  ),
  ...Object.fromEntries(
    [
      'plan',
      'command',
      'failed',
      'subagent',
      'background',
      'background-stop',
    ].map((name) => [`codex/${name}`, codex(name)]),
  ),
};
// JSON drops `undefined` keys, as IPC and the event log do.
writeFileSync(
  new URL('../fixtures/agent-events.json', import.meta.url),
  `${JSON.stringify(recorded, null, 1)}\n`,
);
console.log(
  Object.entries(recorded)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join('\n'),
);
