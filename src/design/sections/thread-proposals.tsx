import { useState, type ReactNode } from 'react';
import { OfferCard, ProposalCard, type ShownProposal } from '../../chat/ThreadProposals';
import { Button } from '@/components/ui/button';
import { Block } from '../layout';
import { ComposerStub, MockFrame, WorkLine } from './next-move';

/** Side work the agent proposes (own_initiative) or offers (a task you named): the chat's real cards on demo data. */
export function ThreadProposalsBlock() {
  return (
    <Block
      title="Thread proposals"
      use="The agent's side work, Claude Code Desktop style. Work it noticed or recommends becomes a proposal: title, the brief folded, Dismiss and Start; nothing runs until you start it, and it expires after 7 days. A task you named where it isn't clear where it runs is an offer: the agent waits for New thread, Do it here or Dismiss. Started ones nest under this thread. Several in one turn page through the same card (‹ 2 of 3 ›), no box in a box."
      wide
    >
      <div className="flex flex-col gap-12">
        <MockFrame label="Proposal · pending, then started or dismissed">
          <p className="type-prose">The 429 handler now sends Retry-After and the test passes. While reading it I saw the token bucket isn't shared across workers, which is a separate fix.</p>
          <LiveProposals initial={[ONE]} />
          <ComposerStub placeholder="Message Claude" />
        </MockFrame>
        <MockFrame label="Every state, side by side">
          <div className="flex flex-col gap-3">
            {STATES.map((p) => (
              <ProposalCard key={p.id} proposals={[p]} onStart={() => undefined} onDismiss={() => undefined} />
            ))}
          </div>
        </MockFrame>
        <MockFrame label="Several proposals in one turn · at most 3, paged in one card">
          <WorkLine>Ran pnpm test</WorkLine>
          <p className="type-prose">Rate limits are in. Three things I'd do next, each on its own:</p>
          <LiveProposals initial={SEVERAL} />
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
  brief: 'src/limits/bucket.ts keeps one bucket per process, so 4 workers allow 4× the limit. Move the bucket into Redis (INCR + PEXPIRE) behind the same take() signature. Done when the 2k req/s load test in bench/limits.ts rejects past 500 req/s with 4 workers.',
  state: 'pending',
  create: CREATE,
};

const STATES: ShownProposal[] = [
  { ...ONE, id: 'demo-s1' },
  { ...ONE, id: 'demo-s2', state: 'started', threadId: DEMO_CHILD },
  { ...ONE, id: 'demo-s3', state: 'dismissed', reason: 'done in this thread' },
  { ...ONE, id: 'demo-s4', isExpired: true },
];

const SEVERAL: ShownProposal[] = [
  ONE,
  { ...ONE, id: 'demo-p2', title: 'Add RateLimit-* headers to 2xx responses', brief: 'Clients can only back off after a 429 today. Add RateLimit-Limit / -Remaining / -Reset to every response from the limiter middleware. Done when the headers test in limits.test.ts passes.' },
  { ...ONE, id: 'demo-p3', title: 'Document the limits in the API reference', brief: 'docs/api/limits.md: the per-key limits, the headers, and a retry example. Done when the docs build passes.' },
];

function LiveProposals({ initial }: { initial: ShownProposal[] }) {
  const [items, setItems] = useState(initial);
  const set = (id: string, state: ShownProposal['state']) => setItems((all) => all.map((p) => (p.id === id ? { ...p, state, threadId: DEMO_CHILD } : p)));
  return <ProposalCard proposals={items} onStart={(p) => set(p.id, 'started')} onDismiss={(p) => set(p.id, 'dismissed')} />;
}

function LiveOffer() {
  const [offer, setOffer] = useState<ShownProposal>({ ...ONE, id: 'demo-o1', initiation: 'offer', title: 'Migrate the limiter to Redis' });
  const answer = (state: ShownProposal['state']) => setOffer((o) => ({ ...o, state, threadId: DEMO_CHILD }));
  return (
    <div className="flex flex-col gap-2">
      <OfferCard proposal={offer} agent="Claude" onNew={() => answer('started')} onHere={() => answer('here')} onDismiss={() => answer('dismissed')} />
      {offer.state !== 'pending' && (
        <Button size="xs" variant="ghost" className="self-start" onClick={() => answer('pending')}>
          Reset
        </Button>
      )}
    </div>
  );
}

function YourMessage({ children }: { children: ReactNode }) {
  return <p className="ml-auto w-fit rounded-2xl bg-muted px-3 py-1.5 type-prose">{children}</p>;
}
