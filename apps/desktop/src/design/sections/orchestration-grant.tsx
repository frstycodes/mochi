import { useState } from 'react';
import { GrantCard } from '../../chat/GrantCard';
import type { GrantStatus } from '../../chat/grants';
import type { OrchestrationGrant } from '../../model';
import { Block } from '../layout';
import { ComposerStub, MockFrame } from './next-move';

/** The agent's ask to start nested threads from turns you didn't start, and the grant's live budget: the chat's real card on demo data. */
export function OrchestrationGrantBlock() {
  return (
    <Block
      title="Orchestration grant"
      use="A multi-phase plan asks once, in your turn, for a budget: threads, models (each one you can switch off) and hours. Allowed, sub-thread reports and Auto-fix turns start nested threads on it without a card, each one listed here with its state; Revoke ends it, and spent or expired it reads as a record while create_thread goes back to cards."
      wide
    >
      <div className="flex flex-col gap-12">
        <MockFrame label="Ask · pending, then allowed (try Allow, Revoke)">
          <p className="type-prose">
            Phase 1 is three schema PRs. Once they land I'll start the three
            migrations, and then the backfill.
          </p>
          <LiveGrant />
          <ComposerStub placeholder="Message Claude" />
        </MockFrame>
        <MockFrame label="Every state, side by side">
          <div className="flex flex-col gap-3">
            {STATES.map(([status, grant]) => (
              <GrantCard
                key={status}
                grant={grant}
                status={status}
                minutesLeft={130}
                agent="Claude"
                onAllow={() => undefined}
                onDeny={() => undefined}
                onRevoke={() => undefined}
              />
            ))}
          </div>
        </MockFrame>
      </div>
    </Block>
  );
}

const ASK: OrchestrationGrant = {
  id: 'demo-g1',
  maxThreads: 5,
  models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'gpt-5.5-codex'],
  minutes: 240,
  reason:
    'Phase 2: one migration thread per schema PR once its reports come back, then a backfill thread.',
  state: 'pending',
  started: [],
};

const STARTED = [
  { threadId: 'e2e', title: 'Migrate orders to the new schema' },
  { title: 'Migrate invoices to the new schema' },
];

const STATES: [GrantStatus, OrchestrationGrant][] = [
  ['active', { ...ASK, state: 'active', started: STARTED }],
  ['spent', { ...ASK, state: 'active', maxThreads: 2, started: STARTED }],
  ['revoked', { ...ASK, state: 'revoked', started: STARTED.slice(0, 1) }],
  ['expired', { ...ASK, state: 'active' }],
  ['denied', { ...ASK, state: 'denied' }],
];

function LiveGrant() {
  const [grant, setGrant] = useState(ASK);
  return (
    <GrantCard
      grant={grant}
      status={grant.state === 'active' ? 'active' : grant.state}
      minutesLeft={grant.minutes}
      agent="Claude"
      onAllow={(models) =>
        setGrant((g) => ({
          ...g,
          state: 'active',
          models,
          started: STARTED.slice(0, 1),
        }))
      }
      onDeny={() => setGrant((g) => ({ ...g, state: 'denied' }))}
      onRevoke={() => setGrant((g) => ({ ...g, state: 'revoked' }))}
    />
  );
}
