import { listenKeydown, isCommand } from '../keymap';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, History } from '@/icons';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import type {
  ActivityEntry,
  Assumption,
  NextOption,
  Thread,
  TurnReport,
} from '../model';
import type { TurnAnchor } from '../chat/turnAnchor';
import { useDispatch } from '../store';
import { Expand } from '../WorkLog';
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
  nextMoveOf,
} from './NextMove';
import { showsVerdictCard } from './report';

/**
 * The end of a turn, in the chat: Mochi's verdict, the agent's summary, then the agent's question with its own answers as buttons.
 * Answering it, or writing instead, keeps it in the chat as a record (`next-move-record`); ⌘↵ takes the first answer while the message box is empty. Read-only (a replay, another computer's thread) shows the
 * question without answers: they would act on this computer's store. Only on the latest turn: while a newer one runs, or after one stopped without widgets of its own, `EarlierTurnCard` keeps them on `anchor`.
 */
export function ReportCard({
  thread,
  anchor,
  isReadOnly,
}: {
  thread: Thread;
  anchor: TurnAnchor | undefined;
  isReadOnly?: boolean;
}) {
  const next = nextMoveOf(thread);
  const answers = useMoveAnswers(thread);
  const { textInput } = usePromptInputController();
  const isShown = !!next && !!anchor?.isLatest && showsVerdictCard(thread);
  // The agent wrote it before reading your message, so its answers may already be moot.
  const isSuperseded = !!next?.report?.isSuperseded;
  const choices =
    isShown && !isReadOnly && !isSuperseded ? choicesFor(next, answers) : [];
  const card = useMoveShortcut(
    choices.length > 0 && !textInput.value.trim(),
    () => choices[0].run(),
  );
  if (!isShown) return null;
  const { verdict, question, report } = next;
  return (
    // An idle turn with no summary, changes or question leaves every section below empty; the children decide that, so CSS hides the shell.
    <NextMoveCard
      ref={card}
      data-next-move={thread.id}
      className={cn(
        'has-[>[data-slot=card-content]:only-child:empty]:hidden',
        isSuperseded && 'opacity-60',
      )}
    >
      {verdict.kind !== 'idle' && <NextMoveHeader verdict={verdict} />}
      <NextMoveContent>
        {isSuperseded && <SupersededNote />}
        <SubThreadLineage thread={thread} />
        {!!report?.summary && (
          <NextMoveSummary>{report.summary}</NextMoveSummary>
        )}
        {!isReadOnly && <TurnSection thread={thread} report={report} />}
        <SubThreadList thread={thread} />
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

/** The card's buttons: the agent's own answers. */
function choicesFor(
  next: NonNullable<ReturnType<typeof nextMoveOf>>,
  answers: ReturnType<typeof useMoveAnswers>,
) {
  const { ask, report } = next;
  if (!ask) return [];
  return ask.options.map((o) => ({
    label: o.label,
    run: () => answers.option(o, ask.question, report),
  }));
}

/** What each answer does. The record goes first so it sits above the message an answer sends. */
function useMoveAnswers(thread: Thread) {
  const dispatch = useDispatch();
  const { textInput } = usePromptInputController();
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
  const option = (
    o: NextOption,
    question: string,
    report: TurnReport | undefined,
  ) => {
    record(question, report, o.label);
    if (o.isDraft) return textInput.setInput(o.reply);
    dispatch({ type: 'send', threadId: thread.id, text: o.reply });
  };
  return { option };
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
