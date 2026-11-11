import { Chat, X } from '@/icons';
import {
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  PaneList,
  PaneListItem,
  PaneListItemTrail,
  RowActions,
  RowButton,
} from '../pane/PaneList';
import { timeAgo } from '../progress';
import { TooltipIconButton } from '../ui';
import type { LoggedAnswer, LoggedDecision, LoggedProposal } from './logbook';

export const LOGBOOK_KINDS = ['answers', 'decisions', 'proposals'] as const;
export type LogbookKind = (typeof LOGBOOK_KINDS)[number];

export interface Logbook {
  answers: LoggedAnswer[];
  decisions: LoggedDecision[];
  proposals: LoggedProposal[];
}

export const LOGBOOK_LABELS = {
  answers: 'Answers',
  decisions: 'Decisions',
  proposals: 'Later',
} satisfies Record<LogbookKind, string>;

/** One kind's rows, newest first; a click opens the thread at the reply the row came from. */
export function LogbookRows({
  kind,
  log,
  now,
  onOpen,
  onRemove,
}: {
  kind: LogbookKind;
  log: Logbook;
  now: number;
  onOpen: (index: number) => void;
  onRemove: (answer: LoggedAnswer) => void;
}) {
  return (
    <PaneList>
      {kind === 'answers' &&
        log.answers
          .toReversed()
          .map((a) => (
            <AnswerItem
              key={a.key}
              answer={a}
              age={timeAgo(now - a.at)}
              onOpen={() => onOpen(a.index)}
              onRemove={() => onRemove(a)}
            />
          ))}
      {kind === 'decisions' &&
        log.decisions
          .toReversed()
          .map((d) => (
            <DecisionItem
              key={d.key}
              decision={d}
              age={timeAgo(now - d.at)}
              onOpen={() => onOpen(d.index)}
            />
          ))}
      {kind === 'proposals' &&
        log.proposals
          .toReversed()
          .map((p) => (
            <ProposalItem
              key={p.key}
              proposal={p}
              age={timeAgo(now - p.at)}
              onOpen={() => onOpen(p.index)}
            />
          ))}
    </PaneList>
  );
}

function AnswerItem({
  answer,
  age,
  onOpen,
  onRemove,
}: {
  answer: LoggedAnswer;
  age: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <PaneListItem className="relative items-start">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0">
          <RowButton label={answer.question} onClick={onOpen} />
        </ItemTitle>
        <ItemDescription>{answer.summary}</ItemDescription>
      </ItemContent>
      <PaneListItemTrail
        meta={age}
        actions={
          <RowActions>
            <TooltipIconButton
              label="Remove from Logbook"
              hint="The reply stays in the thread"
              onClick={onRemove}
            >
              <X />
            </TooltipIconButton>
          </RowActions>
        }
      />
    </PaneListItem>
  );
}

function DecisionItem({
  decision,
  age,
  onOpen,
}: {
  decision: LoggedDecision;
  age: string;
  onOpen: () => void;
}) {
  return (
    <PaneListItem className="relative items-start">
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="line-clamp-none w-full min-w-0 font-normal">
          <RowButton
            label={decision.text}
            onClick={onOpen}
            className="line-clamp-3 whitespace-normal"
          />
        </ItemTitle>
        {decision.isCorrected && (
          <ItemDescription>Assumption you corrected</ItemDescription>
        )}
      </ItemContent>
      <RowMeta>{age}</RowMeta>
    </PaneListItem>
  );
}

const PROPOSAL_STATES = {
  pending: 'Suggested',
  expired: 'Expired',
  dismissed: 'Dismissed',
} satisfies Record<LoggedProposal['state'], string>;

function ProposalItem({
  proposal,
  age,
  onOpen,
}: {
  proposal: LoggedProposal;
  age: string;
  onOpen: () => void;
}) {
  return (
    <PaneListItem className="relative items-start">
      <ItemMedia>
        <Chat aria-hidden className="size-4 text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="w-full min-w-0">
          <RowButton label={proposal.title} onClick={onOpen} />
        </ItemTitle>
        <ItemDescription>{proposal.reason ?? proposal.brief}</ItemDescription>
      </ItemContent>
      <RowMeta>
        {PROPOSAL_STATES[proposal.state]} · {age}
      </RowMeta>
    </PaneListItem>
  );
}

function RowMeta({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 type-caption text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}
