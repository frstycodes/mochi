import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  Chat,
  CheckCircle,
  ChevronDown,
  Hourglass,
  MessagePlus,
  MinusCircle,
  Settings,
  X,
} from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FoldChevron } from '@/Fold';
import type { ActivityEntry, Thread, ThreadProposal } from '../model';
import { useHarness, useHarnessSelector, useSpace } from '../store';
import { SubThreadState } from '../goals/SubThreads';
import { threadStatus } from '../goals/VerdictChip';
import { Expand } from '../WorkLog';
import { Shortcut } from '../Shortcut';
import { IS_MAC, type Key } from '../keys';
import { setPrefs } from '../settings/prefs';
import { PermissionsMenu } from '../Composer';
import { EffortPicker, ModelPicker, useModels } from '../ModelControls';
import { optionFor } from '../runtime/models';
import { DEFAULT_CONTROLS } from '../runtime/controls';
import { PlaceChip } from '../PlacePicker';
import { useProjectsWithCopies } from '../projectCopies';
import { useComputers } from '../remote/computers';
import { useWorkspace, WorkspaceControls } from '../git/WorkspacePicker';
import { openSettings } from '../routes/nav';
import { ThreadName } from './ThreadMessage';
import {
  isExpired,
  isWithdrawn,
  OFFER_REPLY,
  suggestedCount,
  suggestionHereReply,
} from './proposals';

/** A proposal as a card shows it: expiry is read off the clock, never stored. */
export type ShownProposal = ThreadProposal & { isExpired?: boolean };

type Create = ThreadProposal['create'];

/** One turn's thread cards where the agent made them: each offer on its own, the turn's suggestions in one card. */
export function ProposalEntry({
  thread,
  entry,
}: {
  thread: Thread;
  entry: ActivityEntry;
}) {
  const { state, dispatch } = useHarness();
  const shown = (entry.proposals ?? []).map((p) => ({
    ...p,
    isExpired: isExpired(p, entry, state.now),
  }));
  const start = (p: ThreadProposal, create?: Create) =>
    dispatch({
      type: 'proposal-start',
      threadId: thread.id,
      proposalId: p.id,
      ...(create && { create }),
    });
  // The agent ended its turn (or Do it here asks it to start), so your answer in place is its next message.
  const here = (p: ThreadProposal, text: string) => {
    dispatch({
      type: 'proposal-answer',
      threadId: thread.id,
      proposalId: p.id,
      state: 'here',
    });
    dispatch({ type: 'send', threadId: thread.id, text });
  };
  const dismiss = (p: ThreadProposal) =>
    dispatch({
      type: 'proposal-answer',
      threadId: thread.id,
      proposalId: p.id,
      state: 'dismissed',
    });
  const offers = shown.filter((p) => p.initiation === 'offer');
  const suggestions = shown.filter((p) => p.initiation !== 'offer');
  return (
    <div className="flex flex-col gap-3">
      {offers.map((p) =>
        isOpen(p) ? (
          <OfferCard
            key={p.id}
            offer={p}
            onNew={(create) => start(p, create)}
            onHere={() => here(p, OFFER_REPLY)}
          />
        ) : (
          <ProposalRecords key={p.id} proposals={[p]} />
        ),
      )}
      {suggestions.length > 0 && (
        <SuggestionCard
          suggestions={suggestions}
          onStart={start}
          onHere={(p) => here(p, suggestionHereReply(p))}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}

const isOpen = (p: ShownProposal) => p.state === 'pending' && !p.isExpired;

/** A task you named that may not belong here: the agent stopped its turn on New thread or Do it here. */
export function OfferCard({
  offer,
  onNew,
  onHere,
}: {
  offer: ShownProposal;
  onNew: (create: Create) => void;
  onHere: () => void;
}) {
  const [create, setCreate] = useState(offer.create);
  const answer = (pick: 'new' | 'here') =>
    pick === 'new' ? onNew(create) : onHere();
  return (
    <FramedCard
      aria-label="Start this in its own thread?"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (IS_MAC ? e.metaKey : e.ctrlKey))
          answer('new');
        if (e.key === 'Escape') answer('here');
      }}
      header={
        <>
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-warning"
          />
          Start this in its own thread?
        </>
      }
    >
      <FramedItem>
        <ProposalTitle>{offer.title}</ProposalTitle>
        <ProposalOptions
          proposalId={offer.id}
          create={create}
          onChange={setCreate}
        >
          <DontAskAgain
            onPick={(pick) => {
              setPrefs({ unrelatedTask: pick });
              answer(pick);
            }}
          />
        </ProposalOptions>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className="type-meta"
            onClick={() => answer('new')}
            aria-keyshortcuts={IS_MAC ? 'Meta+Enter' : 'Control+Enter'}
          >
            New thread
            <KeyHint keys={['mod', 'Enter']} isPrimary />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="type-meta"
            onClick={() => answer('here')}
            aria-keyshortcuts="Escape"
          >
            Do it here
            <KeyHint keys={['Esc']} />
          </Button>
        </div>
      </FramedItem>
    </FramedCard>
  );
}

/** Work the agent noticed: one card per turn, the open ones in a column, the answered ones as muted rows under them. */
export function SuggestionCard({
  suggestions,
  onStart,
  onHere,
  onDismiss,
}: {
  suggestions: ShownProposal[];
  onStart: (p: ShownProposal, create: Create) => void;
  onHere: (p: ShownProposal) => void;
  onDismiss: (p: ShownProposal) => void;
}) {
  const [edits, setEdits] = useState<Record<string, Create>>({});
  const createOf = (p: ShownProposal) => edits[p.id] ?? p.create;
  const open = suggestions.filter(isOpen);
  const settled = suggestions.filter((p) => !isOpen(p));
  return (
    <FramedCard
      aria-label="Suggested threads"
      header={
        <>
          <span className="flex-1">{suggestedCount(suggestions)}</span>
          {open.length > 1 && (
            <Button
              size="xs"
              variant="ghost"
              className="type-meta"
              onClick={() => open.forEach((p) => onStart(p, createOf(p)))}
            >
              {`Start all ${open.length}`}
            </Button>
          )}
        </>
      }
    >
      {open.map((p) => (
        <FramedItem key={p.id}>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ProposalTitle>{p.title}</ProposalTitle>
              <p
                className="line-clamp-2 type-meta text-muted-foreground [overflow-wrap:anywhere]"
                title={p.brief}
              >
                {p.brief}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Dismiss ${p.title}`}
                    onClick={() => onDismiss(p)}
                  />
                }
              >
                <X />
              </TooltipTrigger>
              <TooltipContent>Dismiss suggestion</TooltipContent>
            </Tooltip>
          </div>
          <ProposalOptions
            proposalId={p.id}
            create={createOf(p)}
            onChange={(c) => setEdits((all) => ({ ...all, [p.id]: c }))}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              className="type-meta"
              onClick={() => onStart(p, createOf(p))}
            >
              Start
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="type-meta"
              onClick={() => onHere(p)}
            >
              Do it here
            </Button>
          </div>
        </FramedItem>
      ))}
      {settled.length > 0 && (
        <FramedItem className="gap-0 py-1.5">
          <ProposalRecords proposals={settled} />
        </FramedItem>
      )}
    </FramedCard>
  );
}

/** A card that frames a list: the header on the lighter frame, each item on the page tone flush to the sides and bottom, the frame showing between them. */
function FramedCard({
  header,
  children,
  className,
  ...props
}: ComponentProps<'section'> & { header: ReactNode }) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-muted',
        className,
      )}
      {...props}
    >
      <div className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 type-meta text-muted-foreground">
        {header}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

function FramedItem({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-3 bg-background p-3', className)}
      {...props}
    />
  );
}

function ProposalTitle({ children }: { children: ReactNode }) {
  return (
    <p className="type-body font-medium text-pretty [overflow-wrap:anywhere]">
      {children}
    </p>
  );
}

/** Where and how the new thread runs, folded; the composer's own pickers change it before you start it. */
function ProposalOptions({
  proposalId,
  create,
  onChange,
  children,
}: {
  proposalId: string;
  create: Create;
  onChange: (create: Create) => void;
  children?: ReactNode;
}) {
  const [isOptionsOpen, setOptionsOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 type-meta text-muted-foreground">
        <button
          type="button"
          aria-expanded={isOptionsOpen}
          onClick={() => setOptionsOpen((o) => !o)}
          className="-ml-1 flex cursor-pointer items-center gap-0.5 rounded-md px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Options
          <FoldChevron isOpen={isOptionsOpen} />
        </button>
        {children}
      </div>
      <Expand isOpen={isOptionsOpen}>
        {isOptionsOpen && (
          <ProposalSettings
            proposalId={proposalId}
            create={create}
            onChange={onChange}
          />
        )}
      </Expand>
    </div>
  );
}

// GAP: this computer's projects only; a proposal resolved on another computer (`create.parent` across machines) keeps its place.
function ProposalSettings({
  proposalId,
  create,
  onChange,
}: {
  proposalId: string;
  create: Create;
  onChange: (create: Create) => void;
}) {
  const space = useSpace();
  const projects = useProjectsWithCopies(space.id) ?? [];
  const [here] = useComputers();
  const controls = create.controls ?? DEFAULT_CONTROLS[create.provider];
  const setControls = (patch: Partial<typeof controls>) =>
    onChange({ ...create, controls: { ...controls, ...patch } });
  const workspace = useWorkspace(
    create.project ?? '',
    create.workspace ?? { mode: 'worktree' },
    (draft) => onChange({ ...create, workspace: draft }),
  );
  const model = optionFor(
    useModels(space.id)[create.provider],
    controls.model,
    create.provider,
  );
  const place = { machineId: null, ref: create.project };
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-1 pt-2 type-meta">
      <SettingRow label="Where">
        <PlaceChip
          projects={projects}
          computers={[here]}
          place={place}
          onChoose={(p) =>
            onChange({ ...create, project: p.ref, workspace: undefined })
          }
        />
      </SettingRow>
      {!!create.project && (
        <SettingRow label="Branch">
          <WorkspaceControls workspace={workspace} />
        </SettingRow>
      )}
      <SettingRow label="Model">
        <ModelPicker
          value={controls.model}
          provider={create.provider}
          onChange={(m) =>
            onChange({
              ...create,
              provider: m.harness,
              controls: { ...controls, model: m.id },
            })
          }
        />
      </SettingRow>
      {model.efforts.length > 0 && (
        <SettingRow label="Effort">
          <EffortPicker
            model={model}
            value={controls.effort}
            onChange={(effort) => setControls({ effort })}
          />
        </SettingRow>
      )}
      <SettingRow label="Permissions">
        <PermissionsMenu
          threadId={proposalId}
          provider={create.provider}
          value={controls.access}
          onChange={(access) => setControls({ access })}
        />
      </SettingRow>
    </dl>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 justify-end">{children}</dd>
    </>
  );
}

/** Answers this offer and every later one the same way (Settings › General). */
function DontAskAgain({ onPick }: { onPick: (pick: 'new' | 'here') => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex cursor-pointer items-center gap-0.5 rounded-md px-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        }
      >
        Don’t ask again
        <ChevronDown aria-hidden className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onClick={() => onPick('new')}>
          <MessagePlus />
          Always start a new thread
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPick('here')}>
          <Chat />
          Always do it here
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <OpenSettingsItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OpenSettingsItem() {
  return (
    <DropdownMenuItem onClick={() => openSettings('general', 'unrelatedTask')}>
      <Settings />
      Settings…
    </DropdownMenuItem>
  );
}

function KeyHint({ keys, isPrimary }: { keys: Key[]; isPrimary?: boolean }) {
  return (
    <span aria-hidden className="contents">
      <Shortcut
        keys={keys}
        className={cn(
          'ml-0.5 opacity-70',
          isPrimary && '[&_[data-slot=kbd]]:text-primary-foreground',
        )}
      />
    </span>
  );
}

/** Answered proposals, one line each: what it was, what became of it. */
export function ProposalRecords({ proposals }: { proposals: ShownProposal[] }) {
  return (
    <ul className="flex flex-col">
      {proposals.map((p) => (
        <ProposalRecord key={p.id} proposal={p} />
      ))}
    </ul>
  );
}

function ProposalRecord({ proposal }: { proposal: ShownProposal }) {
  const { Icon, note, detail } = recordOf(proposal);
  const isStarted = proposal.state === 'started' && !!proposal.threadId;
  return (
    <li className="flex min-h-7 min-w-0 items-center gap-2 type-body text-muted-foreground">
      <Icon aria-hidden className="size-4 shrink-0" />
      {isStarted ? (
        <ThreadName
          peer={{ threadId: proposal.threadId, title: proposal.title }}
          className="max-w-none min-w-0 shrink"
        />
      ) : (
        <span className="min-w-0 truncate" title={proposal.title}>
          {proposal.title}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="ml-auto shrink-0 type-meta text-subtle-foreground"
            />
          }
        >
          {isStarted ? <StartedNote threadId={proposal.threadId!} /> : note}
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </li>
  );
}

/** What the started thread is doing now, like its sidebar row. */
function StartedNote({ threadId }: { threadId: string }) {
  const sub = useHarnessSelector((s) =>
    s.threads.find((t) => t.id === threadId),
  );
  if (!sub) return 'Started';
  return (
    <SubThreadState
      sub={sub}
      status={threadStatus(sub)}
      className="type-meta"
    />
  );
}

function recordOf(p: ShownProposal) {
  if (p.isExpired)
    return {
      Icon: Hourglass,
      note: 'Expired',
      detail: 'Nobody started it within 7 days',
    };
  if (p.state === 'started')
    return {
      Icon: Chat,
      note: 'Started',
      detail: 'Running in its own thread, nested under this one',
    };
  if (p.state === 'here')
    return {
      Icon: CheckCircle,
      note: 'Done here',
      detail: 'You asked the agent to do it in this thread',
    };
  if (isWithdrawn(p))
    return {
      Icon: MinusCircle,
      note: 'No longer suggested',
      detail: `The agent withdrew it: ${p.reason}`,
    };
  return { Icon: MinusCircle, note: 'Dismissed', detail: 'You dismissed it' };
}
