import { listenKeydown, isCommand } from '../keymap';
import { useEffect, useRef, type Ref } from 'react';
import { History, X } from '@/icons';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ActivityEntry, NextAction, Thread, TurnReport } from '../model';
import type { Verdict } from './verdict';
import type { TurnAnchor } from '../chat/turnAnchor';
import { useDispatch } from '../store';
import { IS_MAC } from '../keys';
import { Shortcut } from '../Shortcut';
import { AssumedSection } from './Assumptions';
import {
  NextMoveAnswer,
  NextMoveCard,
  NextMoveContent,
  NextMoveHeader,
  NextMoveQuestion,
  NextMoveSummary,
  nextMoveOf,
} from './NextMove';
import { boxAssumptions, moveRecord, showsVerdictCard } from './report';

/**
 * The end of a turn, in the chat: Mochi's verdict when it needs you, the agent's recap, this turn's open assumptions, then the
 * agent's one question with its answers as buttons. Answering it, or writing instead, keeps it in the chat as a muted record
 * (`next-move-record`); ⌘↵ takes the pick while the message box is empty. Read-only (a replay, another computer's thread) shows
 * the question without answers: they would act on this computer's store. Only on the latest turn: while a newer one runs, or
 * after one stopped without widgets of its own, `EarlierTurnCard` keeps them on `anchor`.
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
  const dispatch = useDispatch();
  const next = nextMoveOf(thread);
  const pick = usePick(thread);
  const { textInput } = usePromptInputController();
  const isShown = !!next && !!anchor?.isLatest && showsVerdictCard(thread);
  // The agent wrote it before reading your message, so its answers may already be moot.
  const isSuperseded = !!next?.report?.isSuperseded;
  const actions =
    isShown && !isReadOnly && !isSuperseded ? (next.ask?.actions ?? []) : [];
  const card = useMoveShortcut(
    actions.length > 0 && !textInput.value.trim(),
    () => pick(actions[0]),
  );
  if (!isShown) return null;
  return (
    <WrapUpBox
      ref={card}
      thread={thread}
      verdict={next.verdict}
      report={next.report}
      question={next.question}
      actions={actions}
      isReadOnly={isReadOnly}
      onPick={pick}
      onDismiss={() =>
        dispatch({ type: 'next-move-dismiss', threadId: thread.id })
      }
    />
  );
}

/**
 * The box itself, read top to bottom: the verdict when it needs you, the recap, the turn's open assumptions under Assumed, then
 * the one question with its answers from the pick. Transparent with a hairline, a dismiss in the corner. Null when nothing
 * asks for you (no verdict, assumption or question), however much the recap says.
 */
export function WrapUpBox({
  ref,
  thread,
  verdict,
  report,
  question,
  actions,
  isReadOnly,
  onPick,
  onDismiss,
}: {
  ref?: Ref<HTMLDivElement>;
  thread: Thread;
  verdict: Verdict;
  report: TurnReport | undefined;
  question: string | null;
  actions: NextAction[];
  isReadOnly?: boolean;
  onPick: (action: NextAction) => void;
  onDismiss: () => void;
}) {
  const isSuperseded = !!report?.isSuperseded;
  const assumptions = report ? boxAssumptions(thread, report.turn) : [];
  const hasVerdict = verdict.kind !== 'idle';
  // A recap alone repeats the reply above it: the box is for what comes next.
  if (!hasVerdict && !assumptions.length && !question) return null;
  return (
    <NextMoveCard
      ref={ref}
      data-next-move={thread.id}
      className={cn('relative', isSuperseded && 'opacity-60')}
    >
      {hasVerdict && <NextMoveHeader verdict={verdict} />}
      <NextMoveContent className="gap-4">
        {!isReadOnly && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss"
            onClick={onDismiss}
            className={cn(
              'absolute right-2 text-muted-foreground',
              hasVerdict ? 'top-1.5' : 'top-2',
            )}
          >
            <X />
          </Button>
        )}
        {isSuperseded && <SupersededNote />}
        {!!report?.recap && (
          <NextMoveSummary className={cn(!hasVerdict && 'pr-8')}>
            {report.recap}
          </NextMoveSummary>
        )}
        <AssumedSection
          thread={thread}
          assumptions={assumptions}
          isReadOnly={isReadOnly || isSuperseded}
        />
        {!!question && (
          <div className="flex flex-col gap-2.5">
            <NextMoveQuestion>{question}</NextMoveQuestion>
            {actions.length > 0 && (
              <NextMoveActions
                labels={actions.map((a) => a.label)}
                onPick={(i) => onPick(actions[i])}
              />
            )}
          </div>
        )}
      </NextMoveContent>
    </NextMoveCard>
  );
}

/** The answers, left-aligned from the pick: primary with its shortcut, the others secondary. */
export function NextMoveActions({
  labels,
  onPick,
}: {
  labels: string[];
  onPick: (index: number) => void;
}) {
  const [primary, ...others] = labels;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        className={ANSWER_TEXT}
        aria-keyshortcuts={IS_MAC ? 'Meta+Enter' : 'Control+Enter'}
        onClick={() => onPick(0)}
      >
        {primary}
        <span aria-hidden className="contents">
          <Shortcut
            keys={['mod', 'Enter']}
            className="ml-0.5 opacity-70 [&_[data-slot=kbd]]:bg-primary-foreground/15 [&_[data-slot=kbd]]:text-primary-foreground"
          />
        </span>
      </Button>
      {others.map((label, i) => (
        <Button
          key={label}
          size="sm"
          variant="secondary"
          className={ANSWER_TEXT}
          onClick={() => onPick(i + 1)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** `sm` buttons at the meta size: `sm`'s 12px reads smaller than the answers it holds. */
const ANSWER_TEXT = 'text-[0.8125rem]';

/**
 * The widgets of the last turn that produced them, kept under it while a newer turn runs: its recap and the question you answered; its file changes are a card of their own just above. No verdict and no answers: those describe the thread now, and the newer turn ends with its own.
 */
export function EarlierTurnCard({
  anchor,
  record,
}: {
  anchor: TurnAnchor;
  record?: ActivityEntry['nextMove'];
}) {
  const summary = record?.summary ?? anchor.report?.recap;
  return (
    <NextMoveCard
      data-earlier-turn={anchor.start}
      className="has-[>[data-slot=card-content]:only-child:empty]:hidden"
    >
      <NextMoveContent>
        {!!summary && <NextMoveSummary>{summary}</NextMoveSummary>}
        {!!record && (
          <NextMoveQuestion className="text-muted-foreground">
            {record.question}
          </NextMoveQuestion>
        )}
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

/** What a button does: the record goes first so it sits above the message it sends; a draft goes to the message box instead. */
function usePick(thread: Thread) {
  const dispatch = useDispatch();
  const { textInput } = usePromptInputController();
  return (action: NextAction) => {
    const question = thread.report?.ask;
    if (question)
      dispatch({
        type: 'next-move-record',
        threadId: thread.id,
        record: moveRecord(thread, question, action.label),
      });
    if (action.isDraft) return textInput.setInput(action.label);
    dispatch({ type: 'send', threadId: thread.id, text: action.label });
  };
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
