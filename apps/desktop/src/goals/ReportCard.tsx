import { listenKeydown, isCommand } from '../keymap';
import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  XCircle,
  GitBranch,
  History,
  MessageText,
  CheckCircle,
  Warning,
  Terminal,
} from '@/icons';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import {
  GitMergeIcon,
  GitPullRequestIcon,
  REF_CHIP_CLASS,
  REF_TONE_CLASS,
} from '@/icons/github';
import { cn } from '@/lib/utils';
import {
  type ActivityEntry,
  type Assumption,
  authorName,
  isMet,
  type NextOption,
  type Thread,
  type TurnReport,
} from '../model';
import { ProgressRing, SectionLabel } from '../ui';
import { RefChip } from '../chat/ChatLink';
import type { RefTone } from '@mochi/domain/chat/refs';
import type { TurnAnchor } from '../chat/turnAnchor';
import { OPEN_PR_PROMPT } from '../git/prs';
import type { ThreadPr } from '../git/useThreadPrs';
import { useHarness, useDispatch } from '../store';
import { CallList, Expand } from '../WorkLog';
import { continuePrompt, withUnseenGaps, type Move } from './moves';
import { AssumptionList } from './Assumptions';
import { changeDraft } from './ledger';
import { TurnSpine } from './Spine';
import { turnSection } from './spineNodes';
import { usePrefs } from '../settings/prefs';
import { SubThreadLineage } from './SubThreads';
import { SubThreadList } from './SubThreadList';
import {
  NextMoveActions,
  NextMoveAnswer,
  NextMoveAsk,
  NextMoveCard,
  NextMoveContent,
  NextMoveHeader,
  NextMoveQuestion,
  NextMoveSummary,
  useNextMove,
} from './NextMove';
import { showsVerdictCard, turnReport } from './report';
import {
  bareStates,
  idleVerdict,
  type Gap,
  type Tile,
  type TileTone,
  type Verdict,
} from './verdict';

/**
 * The end of a turn, in the chat: Mochi's verdict, the agent's summary, Mochi's evidence and gaps, then the agent's question with
 * its own answers as buttons, or Mochi's move when it wrote none. Answering it, or writing instead, keeps it in the chat as a
 * record (`next-move-record`); ⌘↵ takes the first answer while the message box is empty. Read-only (a replay, another computer's thread) shows the
 * question without answers: they would act on this computer's store. `onJump` scrolls to the agent's quoted words. Only on the
 * latest turn: while a newer one runs, or after one stopped without widgets of its own, `EarlierTurnCard` keeps them on `anchor`.
 */
export function ReportCard({
  thread,
  anchor,
  isReadOnly,
  onJump,
}: {
  thread: Thread;
  anchor: TurnAnchor | undefined;
  isReadOnly?: boolean;
  onJump?: (quote: string) => void;
}) {
  const next = useNextMove(thread);
  const answers = useMoveAnswers(thread);
  const { textInput } = usePromptInputController();
  const isShown = !!next && !!anchor?.isLatest && showsVerdictCard(thread);
  // The agent wrote it before reading your message, so its answers may already be moot.
  const isSuperseded = !!next?.report?.isSuperseded;
  const choices =
    isShown && !isReadOnly && !isSuperseded
      ? choicesFor(thread, next, answers)
      : [];
  const card = useMoveShortcut(
    choices.length > 0 && !textInput.value.trim(),
    () => choices[0].run(),
  );
  if (!isShown) return null;
  const { verdict, prs, tiles, question, report } = next;
  return (
    // A goal-less idle turn with no summary, changes or question leaves every section below empty; the children decide that, so CSS hides the shell.
    <NextMoveCard
      ref={card}
      data-next-move={thread.id}
      className={cn(
        'has-[>[data-slot=card-content]:only-child:empty]:hidden',
        isSuperseded && 'opacity-60',
      )}
    >
      {verdict.kind !== 'idle' && (
        <NextMoveHeader thread={thread} verdict={verdict} />
      )}
      <NextMoveContent>
        {isSuperseded && <SupersededNote />}
        <SubThreadLineage thread={thread} />
        {!!report?.summary && (
          <NextMoveSummary>{report.summary}</NextMoveSummary>
        )}
        {!isReadOnly && <TurnSection thread={thread} report={report} />}
        <Evidence thread={thread} tiles={tiles} prs={prs} />
        <SubThreadList thread={thread} />
        {verdict.gaps.length > 0 && (
          <GapList thread={thread} gaps={verdict.gaps} onJump={onJump} />
        )}
        {verdict.kind === 'waiting' && (
          <p className="type-meta text-muted-foreground">
            Mochi asks when one finishes or needs you.
          </p>
        )}
        {!!question && (
          <NextMoveAsk question={question}>
            {choices.length > 0 && (
              <NextMoveActions
                labels={choices.map((c) => c.label)}
                onPick={(i) => choices[i].run()}
              />
            )}
          </NextMoveAsk>
        )}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/**
 * What the turn decided and assumed: on its plan as a spine when it had one, with older open assumptions under Still open;
 * else as rows. Change drafts a message about the assumption; sending it marks it changed (`changedBySend`).
 */
function TurnSection({
  thread,
  report,
}: {
  thread: Thread;
  report: TurnReport | undefined;
}) {
  const dispatch = useDispatch();
  const { textInput } = usePromptInputController();
  const { turnSpine } = usePrefs();
  const section = turnSection(thread, report, turnSpine);
  if (!section) return null;
  const onSet = (a: Assumption, state: Assumption['state']) =>
    dispatch({ type: 'assumption-set', threadId: thread.id, id: a.id, state });
  const onChange = (a: Assumption) => textInput.setInput(changeDraft(a));
  return (
    <>
      {section.kind === 'spine' && (
        <TurnSpine
          assumptions={thread.assumptions ?? []}
          nodes={section.nodes}
          onSet={onSet}
          onChange={onChange}
        />
      )}
      <AssumptionList
        current={section.kind === 'rows' ? section.current : []}
        earlier={section.earlier}
        onSet={onSet}
        onChange={onChange}
      />
      {section.kind === 'rows' && <FoldedDecisions items={section.decisions} />}
    </>
  );
}

/**
 * The widgets of the last turn that produced them, kept under it while a newer turn runs: its summary, the sub-threads (live)
 * and the question you answered; its file changes are a card of their own just above. No verdict and no answers: those describe the thread now, and the newer turn ends with its own.
 */
export function EarlierTurnCard({
  thread,
  anchor,
  record,
}: {
  thread: Thread;
  anchor: TurnAnchor;
  record?: ActivityEntry['nextMove'];
}) {
  const summary = record?.summary ?? anchor.report?.summary;
  return (
    <NextMoveCard
      data-earlier-turn={anchor.start}
      className="has-[>[data-slot=card-content]:only-child:empty]:hidden"
    >
      <NextMoveContent>
        {!!summary && <NextMoveSummary>{summary}</NextMoveSummary>}
        <SubThreadList thread={thread} />
        {!!record && <NextMoveQuestion>{record.question}</NextMoveQuestion>}
        {!!record?.answer && <NextMoveAnswer>{record.answer}</NextMoveAnswer>}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/** Heads a report the agent wrote before it read a message you sent into its turn. */
export function SupersededNote() {
  return (
    <span className="flex items-center gap-1.5 type-caption text-subtle-foreground">
      <History aria-hidden className="size-3.5" />
      Written before your message
    </span>
  );
}

/** The card's buttons: the agent's own answers with Close gaps for what it couldn't have seen, else Mochi's move and one other answer. */
function choicesFor(
  thread: Thread,
  next: NonNullable<ReturnType<typeof useNextMove>>,
  answers: ReturnType<typeof useMoveAnswers>,
) {
  const { ask, move, question, verdict, report, prs, context } = next;
  if (ask) {
    const options = ask.options.map((o) => ({
      label: o.label,
      run: () => answers.option(o, ask.question, report),
    }));
    return withUnseenGaps(options, thread, verdict, report, (m) => ({
      label: m.label,
      run: () => answers.move(m, verdict, ask.question, report, []),
    }));
  }
  if (!move || !question) return [];
  const other = otherAnswer(thread, verdict, prs);
  return [
    {
      label: move.label,
      run: () =>
        answers.move(move, verdict, question, report, context.subPrs ?? []),
    },
    { label: other.label, run: () => answers.other(other, question, report) },
  ];
}

interface OtherAnswer {
  label: string;
  isOpenAnyway?: boolean;
}

/** What each answer does. The record goes first so it sits above the message a move sends. */
function useMoveAnswers(thread: Thread) {
  const { state, dispatch } = useHarness();
  const { textInput } = usePromptInputController();
  const agent = authorName(thread.session?.provider ?? thread.providers[0]);
  const send = (text: string, reason: string, threadId = thread.id) =>
    dispatch({ type: 'send', threadId, text, reason });
  const record = (
    question: string,
    report: TurnReport | undefined,
    answer: string,
  ) =>
    dispatch({
      type: 'next-move-record',
      threadId: thread.id,
      record: {
        ...(report?.summary && { summary: report.summary }),
        question,
        answer,
      },
    });
  const move = (
    m: Move,
    verdict: Verdict,
    question: string,
    report: TurnReport | undefined,
    subPrs: number[],
  ) => {
    record(question, report, m.label);
    const hasPlan = thread.steps.some(
      (s) => s.status !== 'done' && s.status !== 'dropped',
    );
    // A move on a sub-thread (from its parent's card) acts there: its gaps go to its own agent, its result comes back here.
    const target =
      (m.threadId && state.threads.find((t) => t.id === m.threadId)) || thread;
    const gaps =
      target === thread
        ? verdict.gaps
        : (idleVerdict(target, bareStates(target))?.gaps ?? []);
    ({
      confirm: () =>
        dispatch({
          type: 'idle-update',
          threadId: thread.id,
          patch: { isConfirmed: true },
        }),
      'close-gaps': () =>
        send(
          closeGapsPrompt(gaps.filter((g) => !g.isAccepted)),
          'Close gaps from the next move',
          target.id,
        ),
      'hand-back': () =>
        dispatch({
          type: 'subthread-handback',
          threadId: target.id,
          evidence: handBackEvidence(target),
        }),
      'merge-subs': () =>
        send(
          `Merge these sub-thread pull requests into this branch with gh pr merge, then pull them in: ${subPrs.map((n) => `#${n}`).join(', ')}.`,
          'Merge sub-thread PRs from the next move',
        ),
      continue: () =>
        send(
          continuePrompt(report, hasPlan),
          `Continue with ${agent} from the next move`,
        ),
      commit: () =>
        send(
          'Commit these changes on this branch with a Conventional Commits message.',
          'Commit from the next move',
        ),
      'open-pr': () =>
        send(OPEN_PR_PROMPT, 'Open pull request from the next move'),
      settle: () => dispatch({ type: 'settle', threadId: thread.id }),
    })[m.kind]();
  };
  const option = (
    o: NextOption,
    question: string,
    report: TurnReport | undefined,
  ) => {
    record(question, report, o.label);
    if (o.isDraft) return textInput.setInput(o.reply);
    send(o.reply, `${o.label} from the next move`);
  };
  const other = (
    answer: OtherAnswer,
    question: string,
    report: TurnReport | undefined,
  ) => {
    record(question, report, answer.label);
    if (!answer.isOpenAnyway) return;
    send(
      `${OPEN_PR_PROMPT} I chose Open anyway: list the open gaps in its description.`,
      'Open anyway from the next move',
    );
  };
  return { option, move, other };
}

/** What a sub-thread hands back: its own summary of the work, and the PR it opened into the parent's branch. */
function handBackEvidence(sub: Thread) {
  const prs = sub.prs
    .filter((p) => p.state === 'open' || p.state === 'draft')
    .map((p) => `PR #${p.number}`);
  return [turnReport(sub)?.summary ?? `${sub.title} is finished`, ...prs].join(
    ' · ',
  );
}

/** Open anyway past critical gaps with no PR yet; else Not yet. */
function otherAnswer(
  thread: Thread,
  verdict: Verdict,
  prs: ThreadPr[],
): OtherAnswer {
  const hasPr = prs.some(
    (p) =>
      p.state.status === 'open' ||
      p.state.status === 'draft' ||
      p.state.status === 'merged',
  );
  const isBlocked =
    verdict.gaps.some((g) => !g.isAccepted && g.severity === 'critical') &&
    !!thread.repo &&
    !hasPr;
  if (isBlocked) return { label: 'Open anyway', isOpenAnyway: true };
  return { label: 'Not yet' };
}

/** ⌘↵ (Ctrl+Enter elsewhere) takes the move while the card shows and the message box is empty. */
function useMoveShortcut(isOn: boolean, take: () => void) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOn) return;
    // Capture, so it runs before the message box's own Enter (which would submit the empty box).
    const onKey = (e: KeyboardEvent) => {
      if (
        !isCommand(e, 'report-take-move') ||
        !isFromChat(card.current, e.target)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      take();
    };
    return listenKeydown(onKey, true);
  });
  return card;
}

/** From this card's own chat (a split shows several), and from its message box or no field at all: ⌘↵ in a review comment sends that. */
function isFromChat(card: HTMLElement | null, target: EventTarget | null) {
  const chat = card?.closest('[data-chat]');
  if (!chat || !(target instanceof Element) || !chat.contains(target))
    return false;
  return (
    !target.closest('input, textarea, [contenteditable="true"]') ||
    !!target.closest('[data-composer]')
  );
}

/** What Mochi read, one fact each: an icon in its status colour and plain text; a fact asking for you becomes a toned badge, and a PR is its own chip. */
export function Evidence({
  thread,
  tiles,
  prs,
}: {
  thread: Thread;
  tiles: Tile[];
  prs: ThreadPr[];
}) {
  const chips = prs.filter((p) => !!p.githubRef);
  if (!tiles.length) return null;
  return (
    <ul
      aria-label="Evidence"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 type-meta text-subtle-foreground"
    >
      {tiles.map((t) =>
        t.id === 'pr' && chips.length > 0 ? (
          <li key={t.id} className="flex items-center gap-1.5">
            {chips.map((p) => (
              <RefChip key={p.pr.number} githubRef={p.githubRef!} />
            ))}
          </li>
        ) : (
          <li
            key={t.id}
            className={cn(
              'flex h-5 items-center gap-1.5 whitespace-nowrap',
              !!t.tone &&
                t.tone !== 'none' &&
                cn('rounded-sm px-1.5', REF_CHIP_CLASS[t.tone]),
            )}
          >
            <FactIcon thread={thread} tile={t} />
            <span className={cn(t.tone && t.tone !== 'none' && 'opacity-75')}>
              {t.name}
            </span>
            <span
              className={
                t.tone === 'none'
                  ? 'text-muted-foreground'
                  : t.tone
                    ? 'font-medium'
                    : 'text-foreground'
              }
            >
              {t.value}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

function FactIcon({ thread, tile }: { thread: Thread; tile: Tile }) {
  const criteria = thread.criteria ?? [];
  if (tile.id === 'criteria' && criteria.length > 0)
    return (
      <ProgressRing
        met={criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length}
        total={criteria.length}
        slot={thread.line}
        size={14}
      />
    );
  const className = cn(
    'size-3.5 shrink-0',
    REF_TONE_CLASS[factTone(tile.bars)],
  );
  if (tile.id === 'pr')
    return tile.bars.includes('merged') ? (
      <GitMergeIcon aria-hidden className={className} />
    ) : (
      <GitPullRequestIcon aria-hidden className={className} />
    );
  const Icon = FACT_ICONS[tile.id];
  return <Icon aria-hidden className={className} />;
}

const FACT_ICONS = {
  criteria: CheckCircle,
  checks: Terminal,
  git: GitBranch,
  agent: MessageText,
} satisfies Record<Exclude<Tile['id'], 'pr'>, unknown>;

function factTone(bars: TileTone[]): RefTone {
  if (bars.includes('destructive')) return 'destructive';
  if (bars.includes('warning')) return 'warning';
  if (bars.every((b) => b === 'none')) return 'muted';
  if (bars.includes('info')) return 'info';
  return bars.includes('merged') ? 'merged' : 'success';
}

const SHOWN_GAPS = 5;

/** Critical first (the verdict lists them so); past five, the rest wait behind Show more. Rows match the work log's call list. */
export function GapList({
  thread,
  gaps,
  onJump,
}: {
  thread: Thread;
  gaps: Gap[];
  onJump?: (quote: string) => void;
}) {
  const [isAll, setIsAll] = useState(false);
  const shown = isAll ? gaps : gaps.slice(0, SHOWN_GAPS);
  const hidden = gaps.length - shown.length;
  return (
    <div className="flex flex-col items-start gap-1">
      <CallList aria-label="Gaps" className="w-full">
        {shown.map((g) => (
          <GapRow key={g.id} thread={thread} gap={g} onJump={onJump} />
        ))}
      </CallList>
      {hidden > 0 && (
        <Button size="sm" variant="ghost" onClick={() => setIsAll(true)}>
          {`Show ${hidden} more`}
        </Button>
      )}
    </div>
  );
}

/** One gap: its status icon says how bad, the row opens to the failing output or the agent's own words. */
function GapRow({
  thread,
  gap,
  onJump,
}: {
  thread: Thread;
  gap: Gap;
  onJump?: (quote: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const criterion = gap.criterionId
    ? thread.criteria?.find((c) => c.id === gap.criterionId)
    : undefined;
  const output = criterion?.check?.output?.trim();
  const hasDetail = !!output || !!gap.quote;
  const severity = gap.isAccepted
    ? 'Accepted'
    : gap.severity === 'critical'
      ? 'Critical'
      : 'Unverified';
  return (
    <li className="flex flex-col">
      <div
        className={cn(
          'relative isolate flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta',
          hasDetail && 'hover:bg-accent/60',
          gap.isAccepted && 'text-muted-foreground',
        )}
      >
        {hasDetail && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${severity}: ${gap.text}`}
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-0 cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2"
          />
        )}
        <GapIcon gap={gap} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            !gap.isAccepted && 'text-foreground',
            gap.isAccepted && 'line-through',
          )}
        >
          <span className="sr-only">{`${severity}: `}</span>
          {gap.text}
        </span>
        {!!criterion?.command && (
          <code className="max-w-[40%] shrink-0 truncate font-mono type-caption text-muted-foreground">
            {criterion.command}
          </code>
        )}
        {gap.severity === 'unverified' && (
          <AcceptGap thread={thread} gap={gap} />
        )}
        {hasDetail ? (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150',
              isOpen && 'rotate-90',
            )}
          />
        ) : (
          <span aria-hidden className="size-3.5 shrink-0" />
        )}
      </div>
      {hasDetail && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">
            {output ? (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono type-caption whitespace-pre-wrap text-muted-foreground">
                {output}
              </pre>
            ) : (
              <GapQuote quote={gap.quote!} onJump={onJump} />
            )}
          </div>
        </Expand>
      )}
    </li>
  );
}

function GapIcon({ gap }: { gap: Gap }) {
  if (gap.isAccepted)
    return (
      <CheckCircle
        aria-hidden
        className="size-3.5 shrink-0 text-subtle-foreground"
      />
    );
  if (gap.severity === 'critical')
    return (
      <XCircle aria-hidden className="size-3.5 shrink-0 text-destructive" />
    );
  return <Warning aria-hidden className="size-3.5 shrink-0 text-warning" />;
}

function GapQuote({
  quote,
  onJump,
}: {
  quote: string;
  onJump?: (quote: string) => void;
}) {
  return (
    <p className="type-meta text-pretty text-muted-foreground">
      {`“${quote}”`}
      {!!onJump && (
        <>
          {' '}
          <button
            type="button"
            className="cursor-pointer text-foreground underline-offset-2 hover:underline focus-visible:underline"
            onClick={() => onJump(quote)}
          >
            Jump to message
          </button>
        </>
      )}
    </p>
  );
}

function AcceptGap({ thread, gap }: { thread: Thread; gap: Gap }) {
  const dispatch = useDispatch();
  const accepted = thread.idle?.accepted ?? [];
  const toggle = () =>
    dispatch({
      type: 'idle-update',
      threadId: thread.id,
      patch: {
        accepted: gap.isAccepted
          ? accepted.filter((id) => id !== gap.id)
          : [...accepted, gap.id],
      },
    });
  return (
    <Button
      size="xs"
      variant="ghost"
      className="relative z-10"
      onClick={toggle}
    >
      {gap.isAccepted ? 'Undo' : 'Accept'}
    </Button>
  );
}

function closeGapsPrompt(gaps: Gap[]) {
  return `Mochi found these gaps when you went idle. Close each one, or say why it can't be:\n${gaps.map((g) => `- ${g.severity === 'critical' ? 'Critical' : 'Unverified'}: ${g.text}${g.quote ? ` (you wrote: "${g.quote}")` : ''}`).join('\n')}`;
}

/** The one line in a report that asks for anything. */
export function ReportQuestion({ report }: { report: TurnReport }) {
  if (!report.question) return null;
  return (
    <p className="flex gap-2 type-body text-pretty">
      <span
        aria-hidden
        className="mt-2 size-1.5 shrink-0 rounded-full bg-warning"
      />
      <span>
        <span className="font-medium text-warning">Needs you: </span>
        {report.question}
      </span>
    </p>
  );
}

/** The no-plan card's decisions, folded to their count like the spine's steps: rarely worth reading, there when you want them. */
export function FoldedDecisions({ items }: { items: string[] }) {
  const [isOpen, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <section aria-label="Decided" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen((was) => !was)}
        className="flex w-fit cursor-default items-center gap-1 rounded-sm type-caption text-subtle-foreground transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {`${items.length} ${items.length === 1 ? 'decision' : 'decisions'}`}
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 transition-transform duration-150',
            isOpen && 'rotate-90',
          )}
        />
      </button>
      <Expand isOpen={isOpen}>
        <ul className="flex list-disc flex-col gap-0.5 pl-4 type-meta text-muted-foreground marker:text-subtle-foreground">
          {items.map((item) => (
            <li key={item} className="text-pretty">
              {item}
            </li>
          ))}
        </ul>
      </Expand>
    </section>
  );
}

export function ReportList({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <SectionLabel>{label}</SectionLabel>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 type-meta text-muted-foreground marker:text-subtle-foreground">
        {items.map((item) => (
          <li key={item} className="text-pretty">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
