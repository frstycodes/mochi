import { useState, type ReactNode } from 'react';
import {
  OfferCard,
  ProposalRecords,
  SuggestionCard,
  type ShownProposal,
} from '../../chat/ThreadProposals';
import { Button } from '@/components/ui/button';
import { Block } from '../layout';
import { ComposerStub, MockFrame, WorkLine } from './next-move';

/** Side work the agent offers (a task you named) or suggests (own_initiative): the chat's real cards on demo data. */
export function ThreadProposalsBlock() {
  return (
    <Block
      title="Thread proposals"
      use="The agent's side work, as Claude Code Desktop shows it. An offer is a task you named that may not belong here: its turn stops on New thread (⌘↵) or Do it here (Esc), with Options and Don't ask again. Suggestions are work it noticed: one card per turn, each with Start, Do it here and ×; answered ones stay in the card as muted rows. Options changes where and how the thread runs before it starts. Settings › General › Side threads can answer each kind for you."
      wide
    >
      <div className="flex flex-col gap-12">
        <MockFrame label="Suggestion · pending, then started, done here or dismissed">
          <p className="type-prose">
            The 429 handler now sends Retry-After and the test passes. While
            reading it I saw the token bucket isn't shared across workers, which
            is a separate fix.
          </p>
          <LiveSuggestions initial={[ONE]} />
          <ComposerStub placeholder="Message Claude" />
        </MockFrame>
        <MockFrame label="Several suggestions in one turn · at most 3, in one column">
          <WorkLine>Ran pnpm test</WorkLine>
          <p className="type-prose">
            Rate limits are in. Three things I'd do next, each on its own:
          </p>
          <LiveSuggestions initial={SEVERAL} />
        </MockFrame>
        <MockFrame label="Every answered state, as rows">
          <LiveSuggestions initial={STATES} />
        </MockFrame>
        <MockFrame label="Offer · a task you named, waiting on your answer">
          <YourMessage>also migrate the limiter to Redis</YourMessage>
          <LiveOffer />
          <ComposerStub placeholder="Message Claude" />
        </MockFrame>
      </div>
    </Block>
  );
}

/** A demo thread a started card links to. */
const DEMO_CHILD = 'e2e';

const CREATE = { provider: 'claude', project: null, isLive: false } as const;

const ONE: ShownProposal = {
  id: 'demo-p1',
  initiation: 'own_initiative',
  title: 'Share the token bucket across workers',
  brief:
    'src/limits/bucket.ts keeps one bucket per process, so 4 workers allow 4× the limit. Move the bucket into Redis (INCR + PEXPIRE) behind the same take() signature. Done when the 2k req/s load test in bench/limits.ts rejects past 500 req/s with 4 workers.',
  state: 'pending',
  create: CREATE,
};

const SEVERAL: ShownProposal[] = [
  ONE,
  {
    ...ONE,
    id: 'demo-p2',
    title:
      'Add RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset headers to every 2xx response',
    brief:
      'Clients can only back off after a 429 today. Add RateLimit-Limit / -Remaining / -Reset to every response from the limiter middleware. Done when the headers test in limits.test.ts passes.',
  },
  {
    ...ONE,
    id: 'demo-p3',
    title: 'Document the limits in the API reference',
    brief:
      'docs/api/limits.md: the per-key limits, the headers, and a retry example. Done when the docs build passes.',
  },
];

const STATES: ShownProposal[] = [
  { ...ONE, id: 'demo-s1', state: 'started', threadId: DEMO_CHILD },
  {
    ...ONE,
    id: 'demo-s2',
    state: 'here',
    title: 'Retry the flaky upload test',
  },
  {
    ...ONE,
    id: 'demo-s3',
    state: 'dismissed',
    title: 'Rename limits to quotas',
  },
  {
    ...ONE,
    id: 'demo-s4',
    state: 'dismissed',
    reason: 'fixed in this thread after all',
    title: 'Fix the off-by-one in the window rollover',
  },
  {
    ...ONE,
    id: 'demo-s5',
    isExpired: true,
    title: 'Bench the limiter at 10k req/s',
  },
];

function LiveSuggestions({ initial }: { initial: ShownProposal[] }) {
  const [items, setItems] = useState(initial);
  const set = (id: string, state: ShownProposal['state']) =>
    setItems((all) =>
      all.map((p) => (p.id === id ? { ...p, state, threadId: DEMO_CHILD } : p)),
    );
  return (
    <div className="flex flex-col gap-2">
      <SuggestionCard
        suggestions={items}
        onStart={(p) => set(p.id, 'started')}
        onHere={(p) => set(p.id, 'here')}
        onDismiss={(p) => set(p.id, 'dismissed')}
      />
      <ResetButton
        isShown={items !== initial}
        onReset={() => setItems(initial)}
      />
    </div>
  );
}

function LiveOffer() {
  const initial: ShownProposal = {
    ...ONE,
    id: 'demo-o1',
    initiation: 'offer',
    title: 'Migrate the limiter to Redis',
  };
  const [offer, setOffer] = useState(initial);
  const answer = (state: ShownProposal['state']) =>
    setOffer((o) => ({ ...o, state, threadId: DEMO_CHILD }));
  return (
    <div className="flex flex-col gap-2">
      {offer.state === 'pending' ? (
        <OfferCard
          offer={offer}
          onNew={() => answer('started')}
          onHere={() => answer('here')}
        />
      ) : (
        <ProposalRecords proposals={[offer]} />
      )}
      <ResetButton
        isShown={offer.state !== 'pending'}
        onReset={() => setOffer(initial)}
      />
    </div>
  );
}

function ResetButton({
  isShown,
  onReset,
}: {
  isShown: boolean;
  onReset: () => void;
}) {
  if (!isShown) return null;
  return (
    <Button size="xs" variant="ghost" className="self-start" onClick={onReset}>
      Reset
    </Button>
  );
}

function YourMessage({ children }: { children: ReactNode }) {
  return (
    <p className="ml-auto w-fit rounded-2xl bg-muted px-3 py-1.5 type-prose">
      {children}
    </p>
  );
}
