import {
  memo,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from 'react';
import { useIsSimplifying } from './simplify/useSimplify';
import { SimplifySwap } from './simplify/SimplifyMotion';
import { host } from './host';
import { getDraft, threadDraftKey } from './chat/drafts';
import { composerHold } from './chat/composerHold';
import { useSmoothText } from './chat/reveal';
import { ThreadContextRing } from './ContextRing';
import { threadUsage } from './usage/model';
import { motion } from 'motion/react';
import type { EditorView } from '@codemirror/view';
import { Hourglass, Sparkles } from '@/icons';
import { FoldChevron } from './Fold';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInputProvider,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ComposerInbox } from './browser/composer';
import {
  authorName,
  isMochiCard,
  isStreamedOnly,
  type Provider,
  type QueuedMessage,
  type QueueItem,
  type Thread,
} from './model';
import { CardEntry, EventLine } from './chat/MochiWidget';
import { useWithoutStreamedText } from './chat/useWithoutStreamedText';
import { PlanRow } from './chat/PlanRow';
import { clock } from './progress';
import { QueueDecision } from './QueueView';
import {
  shallowEqual,
  useDispatch,
  useGetState,
  useHarnessSelector,
} from './store';
import { ProviderMark } from './ui';
import { WorkspaceNotes, useThreadWorkspace } from './git/WorkspacePicker';
import {
  ComposerCard,
  ComposerInput,
  ComposerMeta,
  ComposerTrayBody,
  PermissionsMenu,
  useComposerHandoff,
  useSharedLayout,
} from './Composer';
import { useSplit } from './layout/SplitContext';
import { ChatMochi, WorkLog } from './WorkLog';
import { SetupRow } from './chat/SetupRow';
import { useLibraryNames } from './library/names';
import {
  agentPhase,
  currentAction,
  isWorking,
  pendingWork,
  type CurrentAction,
} from './agentPhase';
import {
  chatRows,
  finalReplies,
  liveWorkIndex,
  type ChatRow,
} from './chat/rows';
import { SecondOpinionRow } from './secondOpinion/SecondOpinionRow';
import {
  VIZ_COMPONENTS,
  VIZ_PLUGINS,
  VIZ_REHYPE_PLUGINS,
} from './viz/FenceVisual';
import { ImageDropTarget } from './viz/ImageVisual';
import { VizThreadProvider } from './viz/WidgetVisual';
import { EarlierTurnCard, ReportCard } from './goals/ReportCard';
import { NextMoveRecord, ThreadPlan, nextMoveOf } from './goals/NextMove';
import { PlanRecordRow } from './goals/PlanRecordRow';
import { SubThreadResultRow, ThreadLinkRow } from './goals/SubThreads';
import { ProposalEntry } from './chat/ThreadProposals';
import { moveRecord, showsVerdictCard, suggestedReply } from './goals/report';
import { TurnChangesCard } from './chat/TurnChangesCard';
import { AutofixEventRow, ReceivedMessageRow } from './chat/ThreadMessage';
import { SubReports } from './chat/SubReports';
import {
  isTurnRunning,
  type TurnAnchor,
  useTurnAnchor,
} from './chat/turnAnchor';
import { Shortcut } from './Shortcut';
import { isMod, MOD_KEY } from './keys';
import { MessageActions } from './chat/MessageActions';
import { MessageContextMenu } from './chat/MessageContextMenu';
import { useThreadPins } from './chat/pins';
import { SelectionPin, usePinHighlights } from './chat/SelectionPin';
import { useRemoteMachine } from './remote/origin';
import { LimitEntry, LimitHint } from './chat/LimitCard';
import { CompactionRow } from './chat/CompactionRow';
import { HandoffRow } from './chat/HandoffRow';
import { compactFocus, compactGate } from './chat/compact';
import {
  parseSlash,
  resolveToken,
  typedSkills,
  type SlashItem,
} from './chat/slash';
import { rehypeSlashTokens } from './chat/rehypeRefs';
import {
  SlashMenu,
  useSlashItems,
  useSlashMenu,
  useThreadPlugins,
  useThreadServers,
  useThreadSkills,
} from './chat/SlashMenu';
import { queuedMessage, sendMessage, shouldQueue } from './chat/outbox';
import {
  attachmentProblem,
  imageFiles,
  sentImages,
  withAttachedFiles,
} from './chat/images';
import { ImageGenCard } from './chat/ImageGenCard';
import { DevServerCard } from './chat/DevServerCard';
import { McpAppCard } from './chat/McpAppCard';
import { MessageImages } from './chat/MessageImages';
import { toast } from '@/toast/store';
import { QueueTray } from './chat/QueueTray';
import { PendingSteers } from './chat/SteerBubble';
import { newestYoursKey } from './chat/sendFlight';
import { launchSend, useSendLanding } from './chat/useSendFlight';
import { usePrefs, type Prefs } from './settings/prefs';
import {
  MentionChips,
  MentionMenu,
  useMentionMenu,
  useThreadMentionDrop,
  useThreadMentionFiles,
} from './chat/MentionMenu';
import type { Mention } from './chat/mentions';
import { projectRef } from './projects';
import { askInSideChat } from './sidechat/AskInSideChat';
import { controlsOf } from './runtime/controls';
import type { ModelOption } from './runtime/models';
import { SubagentGroup } from './agents/SubagentRow';
import { foldTurns } from './chat/turnFold';
import { WorkedRow } from './chat/WorkedRow';
import {
  rememberedScroll,
  Transcript,
  TranscriptScrollButton,
  useTranscript,
} from './chat/Transcript';

export type MessageBar = ComponentType<{
  thread: Thread;
  index: number;
  align: 'start' | 'end';
}>;

/**
 * `isReadOnly`: a replay's transcript, without the composer and the per-message actions that would change the thread.
 * `messageBar` puts actions of its own back under the messages that would have them (another computer's thread).
 */
export function ChatView({
  thread,
  isReadOnly,
  messageBar,
}: {
  thread: Thread;
  isReadOnly?: boolean;
  messageBar?: MessageBar;
}) {
  const isRunning = isTurnRunning(thread);
  const anchor = useTurnAnchor(thread);
  const [toggledTurns, setToggledTurns] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleTurn = (key: string) =>
    setToggledTurns((turns) => {
      const next = new Set(turns);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const rows = foldTurns(
    chatRows(
      thread.activity,
      thread.reviews,
      shownTurnChanges(anchor),
      anchor?.isLatest ? undefined : anchor,
    ),
    thread.activity,
    isRunning,
    toggledTurns,
  );
  // A second opinion runs beside the agent: the agent's own newest row stays the live one.
  const liveIndex = rows.findLastIndex(
    (r) =>
      r.kind !== 'review' && r.kind !== 'changes' && r.kind !== 'earlier-turn',
  );
  const liveWork = liveWorkIndex(rows);
  // Its label names skills and servers as the library does.
  useLibraryNames();
  const action = currentAction(thread);
  // Mochi's own widgets and the agent's questions sit in the transcript where they were asked; the tray keeps the agent's approvals.
  // Ready for review is a state of the thread, not a question: it stays out of the tray so the composer remains a prompt.
  const decisions = useHarnessSelector(
    (s) =>
      s.queue.filter(
        (q) =>
          q.threadId === thread.id &&
          !isMochiCard(q) &&
          q.kind !== 'review' &&
          q.kind !== 'question',
      ),
    shallowEqual,
  );
  const tray = useTrayState(decisions.length);
  const [isComposerCompact, setComposerCompact] = useState(false);
  const withActions = finalReplies(rows, isRunning);

  const {
    ref: composerRef,
    hold: holdComposer,
    release: releaseComposer,
  } = useComposerHeightVar();
  const messages = useRef<HTMLDivElement>(null);
  const pins = useThreadPins(thread.id);
  usePinHighlights(messages, pins);
  const handoff = useComposerHandoff(useSplit().leafId);
  const slashItems = useSlashItems(
    thread.providers[0],
    thread.spaceId,
    projectRef(thread.repo),
    thread.agent,
  );
  const [remembered] = useState(() => rememberedScroll.get(thread.id));
  // The composer's own: a message taken back returns there with its mentions and images.
  const restoreDraft = useRef<((message: QueuedMessage) => void) | null>(null);
  // Nothing in the composer depends on the reply being written, and its subtree is the chat's largest after the transcript.
  const composerThread = useWithoutStreamedText(thread);

  return (
    // The provider holds the message box's text for the whole chat: the next-move card fills it with the agent's draft.
    <PromptInputProvider key={thread.id}>
      <div
        data-chat={thread.id}
        className="relative flex min-h-0 flex-1 flex-col"
        style={
          isReadOnly
            ? ({ '--composer-h': '0px' } as React.CSSProperties)
            : undefined
        }
      >
        {!isReadOnly && <ComposerBase />}
        <div
          ref={messages}
          data-photo-scope
          className="relative mt-(--chat-top,0px) min-h-0 flex-1"
        >
          <VizThreadProvider value={thread.id}>
            <Transcript
              threadId={thread.id}
              rows={rows}
              remembered={remembered}
              className={cn(
                handoff.isHandoff && 'animate-in duration-300 fade-in',
              )}
              header={
                <div
                  className={cn('px-4 pt-6 md:px-6', !!thread.setup && 'pb-5')}
                >
                  {!!thread.setup && (
                    <SetupRow thread={thread} setup={thread.setup} />
                  )}
                </div>
              }
              footer={
                <div className="flex flex-col gap-5 px-4 pb-[calc(max(var(--composer-h),var(--composer-hold,0px))+1.5rem)] md:px-6">
                  {!isReadOnly && (
                    <PendingSteers
                      thread={thread}
                      onTakeBack={(message) => restoreDraft.current?.(message)}
                    />
                  )}
                  <ReportCard
                    thread={thread}
                    anchor={anchor}
                    isReadOnly={isReadOnly}
                  />
                  <ThreadPlan thread={thread} isWorking={isRunning} />
                  <ChatMochi
                    phase={agentPhase(thread)}
                    label={pendingWork(thread)?.label}
                  />
                </div>
              }
              renderRow={(row, i) => (
                <ChatRowView
                  thread={thread}
                  row={row}
                  slashItems={slashItems}
                  isReadOnly={isReadOnly}
                  messageBar={messageBar}
                  hasActions={withActions.has(i)}
                  onToggleTurn={toggleTurn}
                  isLive={
                    row.kind === 'work'
                      ? i === liveWork && !!action
                      : i === liveIndex && isRunning
                  }
                  action={action}
                />
              )}
            >
              <TranscriptScrollButton className="bottom-[calc(var(--composer-h)+0.75rem)]" />
              {!isReadOnly && (
                <SelectionPin threadId={thread.id} scope={messages} />
              )}
              {!isReadOnly && (
                <ScrollIntent
                  onScrollUp={() => {
                    holdComposer();
                    tray.collapse();
                    // Scrolling back to check something while writing keeps the composer open.
                    if (!composerRef.current?.contains(document.activeElement))
                      setComposerCompact(true);
                  }}
                  onReachBottom={() => {
                    tray.expand();
                    setComposerCompact(false);
                    if (!decisions.length) releaseComposer();
                  }}
                />
              )}
            </Transcript>
          </VizThreadProvider>
        </div>
        {!isReadOnly && (
          <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-10">
            <ImageDropTarget>
              <Composer
                thread={composerThread}
                slashItems={slashItems}
                decisions={decisions}
                isTrayOpen={tray.isOpen}
                onToggleTray={tray.toggle}
                isCompact={isComposerCompact}
                onExpand={() => setComposerCompact(false)}
                handoff={handoff}
                restoreRef={restoreDraft}
              />
            </ImageDropTarget>
            <ComposerInbox threadId={thread.id} />
          </div>
        )}
      </div>
    </PromptInputProvider>
  );
}

/**
 * The page's own colour under the transcript where the composer card sits, shown only over Mica, the one see-through page (index.css): there the
 * composer's backdrop blur let text on see-through pixels through sharp, and on this base it blurs like the rest.
 */
function ComposerBase() {
  return (
    <div
      aria-hidden
      className="composer-base pointer-events-none absolute inset-x-0 bottom-(--composer-card-bottom) mx-auto w-full max-w-(--chat-width) px-4 md:px-6"
    >
      <div className="h-(--composer-card-h) rounded-2xl bg-background" />
    </div>
  );
}

/**
 * Writes --composer-h on the parent directly: the composer animates its height every frame, and a state update would re-render the whole chat.
 * Also the card's own height and its distance from the bottom (--composer-card-h, --composer-card-bottom), for ComposerBase.
 * `hold` and `release` pin --composer-hold; see composerHold.
 */
function useComposerHeightVar() {
  const ref = useRef<HTMLDivElement>(null);
  const holder = useRef<ReturnType<typeof composerHold>>(null);
  const hold = () => {
    const el = ref.current;
    if (el) holder.current?.hold(el.offsetHeight);
  };
  const release = () => holder.current?.release();
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const held = composerHold((px) =>
      px === undefined
        ? parent.style.removeProperty('--composer-hold')
        : parent.style.setProperty('--composer-hold', `${px}px`),
    );
    holder.current = held;
    const ro = new ResizeObserver(([e]) => {
      const height = e.borderBoxSize[0].blockSize;
      parent.style.setProperty('--composer-h', `${height}px`);
      const card = el.querySelector('[data-composer]');
      if (card) {
        const { top, bottom } = card.getBoundingClientRect();
        parent.style.setProperty('--composer-card-h', `${bottom - top}px`);
        parent.style.setProperty(
          '--composer-card-bottom',
          `${el.getBoundingClientRect().bottom - bottom}px`,
        );
      }
      held.resized(height);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      held.dispose();
    };
  }, []);
  return { ref, hold, release };
}

interface ChatRowProps {
  thread: Thread;
  row: ChatRow;
  slashItems: SlashItem[];
  isLive: boolean;
  isReadOnly?: boolean;
  messageBar?: MessageBar;
  hasActions: boolean;
  action?: CurrentAction;
  /** Stable enough: it only calls a state setter, so `isSameRowProps` leaves it out. */
  onToggleTurn: (key: string) => void;
}

// isLive: the newest row of a running thread, the one still being written. Memoized: a scroll re-renders the virtualized list, and only rows that just mounted should render.
const ChatRowView = memo(function ChatRowView({
  thread,
  row,
  slashItems,
  isLive,
  isReadOnly,
  messageBar,
  hasActions,
  action,
  onToggleTurn,
}: ChatRowProps) {
  const landingRef = useSendLanding(
    thread.id,
    newestYoursKey(thread.activity, row),
  );
  if (row.kind === 'work')
    return (
      <WorkLog
        entries={row.entries}
        skills={slashItems}
        action={isLive ? action : undefined}
      />
    );
  if (row.kind === 'worked')
    return <WorkedRow row={row} onToggle={onToggleTurn} />;
  if (row.kind === 'review')
    return <SecondOpinionRow thread={thread} review={row.review} />;
  if (row.kind === 'changes')
    return (
      <TurnChangesCard
        thread={thread}
        turn={row.turn}
        isReadOnly={isReadOnly}
      />
    );
  if (row.kind === 'earlier-turn')
    return <EarlierTurnCard anchor={row.anchor} record={row.record} />;
  if (row.kind === 'subagent')
    return <SubagentGroup thread={thread} entries={row.entries} />;
  if (row.kind === 'image')
    return (
      <ImageGenCard image={row.entry.generated!} startedMs={row.entry.ms} />
    );
  if (row.kind === 'widget')
    return <McpAppCard threadId={thread.id} widget={row.entry.widget!} />;
  if (row.kind === 'thread-message')
    return row.entry.autofix ? (
      <AutofixEventRow
        entry={row.entry}
        event={row.entry.autofix}
        index={row.index}
      />
    ) : (
      <ReceivedMessageRow
        entry={row.entry}
        from={row.entry.from!}
        index={row.index}
      />
    );
  if (row.kind === 'plan') return <PlanRow entries={row.entries} />;
  if (row.kind === 'reports') return <SubReports entries={row.entries} />;
  if (row.kind === 'event' && row.entry.isLimit)
    return <LimitEntry thread={thread} entry={row.entry} />;
  if (row.kind === 'event' && row.entry.nextMove)
    return <NextMoveRecord record={row.entry.nextMove} />;
  if (row.kind === 'event' && row.entry.planRecord)
    return <PlanRecordRow thread={thread} record={row.entry.planRecord} />;
  if (row.kind === 'event' && row.entry.threadLink)
    return <ThreadLinkRow thread={thread} link={row.entry.threadLink} />;
  if (row.kind === 'event' && row.entry.subThread)
    return (
      <SubThreadResultRow entry={row.entry} result={row.entry.subThread} />
    );
  if (row.kind === 'event' && row.entry.devServer)
    return <DevServerCard thread={thread} server={row.entry.devServer} />;
  if (row.kind === 'event' && row.entry.proposals)
    return <ProposalEntry thread={thread} entry={row.entry} />;
  if (row.kind === 'event' && row.entry.handoff)
    return (
      <HandoffRow
        handoff={row.entry.handoff}
        at={row.entry.at}
        spaceId={thread.spaceId}
      />
    );
  if (row.kind === 'event' && row.entry.compaction)
    return (
      <CompactionRow
        compaction={row.entry.compaction}
        at={row.entry.at}
        provider={thread.session?.provider ?? thread.providers[0]}
      />
    );
  if (row.kind === 'event')
    return row.entry.card ? (
      <CardEntry entry={row.entry} card={row.entry.card} />
    ) : (
      <EventLine
        text={row.entry.text}
        detail={row.entry.detail}
        at={row.entry.at}
        glyph={row.entry.glyph}
        site={row.entry.site}
      />
    );

  const { entry } = row;
  const Bar = isReadOnly ? messageBar : MessageActions;
  const isYou = entry.who === 'you';
  const isAgent = entry.who === 'claude' || entry.who === 'codex';
  const isImageOnly = isYou && !!entry.images?.length && !entry.text.trim();
  const message = (
    <div
      data-activity-index={row.index}
      data-file-scope
      className="group/row flex flex-col gap-1"
    >
      {entry.wasQueued && (
        <span className="flex items-center gap-1 self-end type-caption text-subtle-foreground">
          <Hourglass aria-hidden className="size-3" />
          Queued
        </span>
      )}
      {isYou && !!entry.images?.length && (
        <MessageImages
          photos={entry.images.map((src, i) => ({
            src,
            name: `Image ${i + 1}`,
          }))}
          className="justify-end"
        />
      )}
      {!isImageOnly && (
        <Message
          from={isYou ? 'user' : 'assistant'}
          title={`${authorName(entry.who)} · ${clock(entry.at)}`}
        >
          <MessageContent
            ref={landingRef}
            className={cn('type-prose', isAgent && 'w-full')}
          >
            {isAgent && row.showAuthor && (
              <span className="flex items-center gap-1.5 type-caption text-subtle-foreground">
                <ProviderMark provider={entry.who as Provider} size={14} />
                {authorName(entry.who)}
                <span className="tabular">{clock(entry.at)}</span>
              </span>
            )}
            {isYou ? (
              <YourMessage text={entry.text} slashItems={slashItems} />
            ) : isAgent ? (
              <AgentReply thread={thread} index={row.index} isLive={isLive} />
            ) : (
              <MessageResponse
                plugins={VIZ_PLUGINS}
                components={VIZ_COMPONENTS}
                rehypePlugins={VIZ_REHYPE_PLUGINS}
                isAnimating={false}
              >
                {entry.text}
              </MessageResponse>
            )}
          </MessageContent>
        </Message>
      )}
      {!!Bar && (isYou || hasActions) && (
        <Bar
          thread={thread}
          index={row.index}
          align={isYou ? 'end' : 'start'}
        />
      )}
    </div>
  );
  if (isReadOnly) return message;
  return (
    <MessageContextMenu thread={thread} index={row.index}>
      {message}
    </MessageContextMenu>
  );
}, isSameRowProps);

/**
 * Rows re-render for their own entries, not for each token streamed into another: `chatRows` rebuilds every row object, and a
 * streamed thread differs only in its transcript (`isStreamedOnly`). `action` matters only to the live row.
 */
function isSameRowProps(a: ChatRowProps, b: ChatRowProps) {
  const isSameRow =
    a.row.kind === b.row.kind &&
    Object.keys(b.row).every((k) =>
      shallowEqual(a.row[k as keyof ChatRow], b.row[k as keyof ChatRow]),
    );
  const isSameThread =
    a.thread === b.thread || isStreamedOnly(a.thread, b.thread);
  return (
    isSameRow &&
    isSameThread &&
    a.isLive === b.isLive &&
    a.hasActions === b.hasActions &&
    a.slashItems === b.slashItems &&
    a.isReadOnly === b.isReadOnly &&
    a.messageBar === b.messageBar &&
    (!b.isLive || a.action === b.action)
  );
}

/** Your message as markdown with its links, the known `/name` tokens coloured as they were in the composer. */
function YourMessage({
  text,
  slashItems,
}: {
  text: string;
  slashItems: SlashItem[];
}) {
  const rehypePlugins = [
    ...VIZ_REHYPE_PLUGINS,
    [rehypeSlashTokens, slashItems.map((i) => i.name)],
  ] as typeof VIZ_REHYPE_PLUGINS;
  return (
    <MessageResponse
      plugins={VIZ_PLUGINS}
      components={VIZ_COMPONENTS}
      rehypePlugins={rehypePlugins}
      isAnimating={false}
    >
      {text}
    </MessageResponse>
  );
}

/** An agent's reply, or its simplified version: it shimmers while that is made, then crossfades to it. The live reply reveals smoothly (`useSmoothText`). */
function AgentReply({
  thread,
  index,
  isLive,
}: {
  thread: Thread;
  index: number;
  isLive: boolean;
}) {
  const entry = thread.activity[index];
  const isSimplifying = useIsSimplifying(thread.id, index);
  const simplified = entry.simplified?.isShown ? entry.simplified.text : null;
  const text = useSmoothText(entry.text, isLive && simplified === null);
  return (
    <SimplifySwap
      view={simplified === null ? 'original' : 'simplified'}
      isSimplifying={isSimplifying}
    >
      {simplified !== null && (
        <span className="flex items-center gap-1 type-caption text-subtle-foreground">
          <Sparkles aria-hidden className="size-3" />
          Simplified for you
        </span>
      )}
      <MessageResponse
        plugins={VIZ_PLUGINS}
        components={VIZ_COMPONENTS}
        rehypePlugins={VIZ_REHYPE_PLUGINS}
        isAnimating={isLive}
      >
        {simplified ?? text}
      </MessageResponse>
    </SimplifySwap>
  );
}

/** The anchor turn's file changes, as their own card after the turn and never inside its report. Older turns' edits stay in the work log. */
function shownTurnChanges(anchor: TurnAnchor | undefined) {
  return anchor?.changes ? [anchor.changes] : [];
}

/** Reading back through the chat folds the question tray away; returning to the latest message brings it back. */
function useTrayState(count: number) {
  const [isOpen, setOpen] = useState(true);
  const [seenCount, setSeenCount] = useState(count);
  if (count !== seenCount) {
    setSeenCount(count);
    if (count > 0) setOpen(true);
  }
  return {
    isOpen,
    toggle: () => setOpen((o) => !o),
    collapse: () => setOpen(false),
    expand: () => setOpen(true),
  };
}

const SCROLL_INTENT_PX = 24;

/**
 * Listens to the reader's input, not scroll: the list scrolls programmatically (following the stream, holding rows still), and those scroll
 * events aren't the reader's intent. The list lets go of the end on its own when the reader scrolls up.
 */
function ScrollIntent({
  onScrollUp,
  onReachBottom,
}: {
  onScrollUp: () => void;
  onReachBottom: () => void;
}) {
  const { scroller, isAtEnd } = useTranscript();
  const scrolledUp = useEffectEvent(onScrollUp);
  const reachedBottom = useEffectEvent(onReachBottom);

  useEffect(() => {
    const el = scroller;
    if (!el) return;
    let up = 0;
    let touchY = 0;
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    const intent = (dy: number) => {
      if (dy > 0 && atBottom()) return reachedBottom();
      up = dy < 0 ? up - dy : 0;
      if (up < SCROLL_INTENT_PX) return;
      up = 0;
      scrolledUp();
    };
    const onWheel = (e: WheelEvent) => intent(e.deltaY);
    const onTouchStart = (e: TouchEvent) => (touchY = e.touches[0].clientY);
    const onTouchMove = (e: TouchEvent) => {
      intent(touchY - e.touches[0].clientY);
      touchY = e.touches[0].clientY;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [scroller]);

  useEffect(() => {
    if (isAtEnd) reachedBottom();
  }, [isAtEnd]);

  return null;
}

// Memoized: the chat re-renders for every streamed token, and nothing the composer is given changes with it.
const Composer = memo(function Composer({
  thread,
  slashItems,
  decisions,
  isTrayOpen,
  onToggleTray,
  isCompact,
  onExpand,
  handoff,
  restoreRef,
}: {
  thread: Thread;
  slashItems: SlashItem[];
  decisions: QueueItem[];
  isTrayOpen: boolean;
  onToggleTray: () => void;
  isCompact: boolean;
  onExpand: () => void;
  handoff: ReturnType<typeof useComposerHandoff>;
  restoreRef: RefObject<((message: QueuedMessage) => void) | null>;
}) {
  const dispatch = useDispatch();
  const isRemote = !!useRemoteMachine();
  const { whileWorking, promptSuggestions } = usePrefs();
  const [isHeld, setIsHeld] = useState(false);
  const isQueueing = shouldQueue(thread, whileWorking, isHeld);
  const queued = thread.queued ?? [];
  const { textInput, attachments } = usePromptInputController();
  const editor = useRef<EditorView>(null);
  const controls = controlsOf(thread);
  const workspace = useThreadWorkspace(thread);
  const provider = thread.providers[0];
  // A model of another provider switches the thread to it from your next message (`provider-switch`); so does another model
  // of the same provider once the session ran out of usage, to start fresh from a handoff instead of the full context.
  const setControls = (next: typeof controls, model?: ModelOption) => {
    const isSwitch =
      !!model &&
      (model.harness !== provider ||
        (!!thread.live?.limit && model.id !== controls.model));
    if (model && isSwitch)
      return dispatch({
        type: 'provider-switch',
        threadId: thread.id,
        to: model.harness,
        model: next.model,
      });
    dispatch({ type: 'controls', threadId: thread.id, controls: next });
  };
  const root = projectRef(thread.repo);
  const mention = useMentionMenu(
    thread.id,
    useThreadSkills(provider, thread.spaceId, root, thread.agent),
    useThreadServers(provider, thread.spaceId, root, thread.agent),
    useThreadPlugins(provider, thread.spaceId, root, thread.agent),
    useThreadMentionFiles(thread),
  );
  const threadDrop = useThreadMentionDrop(mention);
  const getState = useGetState();
  const submit = (message: QueuedMessage, extra?: { queuedId?: string }) => {
    // The newest thread: the composer may hold one a few streamed tokens old (`useWithoutStreamedText`).
    const state = getState();
    sendMessage(
      dispatch,
      state,
      state.threads.find((t) => t.id === thread.id) ?? thread,
      message,
      extra,
    );
    mention.clear();
  };
  const compact = compactGate(thread, decisions.length > 0);
  const offReason = compact.kind === 'off' ? compact.reason : undefined;
  const items = slashItems.map((i) =>
    i.source === 'mochi' && i.name === 'compact' && offReason
      ? { ...i, disabledReason: offReason }
      : i,
  );
  const slash = useSlashMenu(items);
  // Slash tracks the caret always; the open menu owns the listbox attributes.
  const menuProps = {
    ...slash.editorProps,
    ...(mention.isOpen && mention.editorProps),
  };
  const draftKey = threadDraftKey(thread.id);
  useSeedAttachment(thread.id === 'adm' && !getDraft(draftKey));
  const draftExtra =
    mention.mentions.length > 0 ? { mentions: mention.mentions } : undefined;
  const restoreMentions = useEffectEvent(() =>
    mention.restore(
      getDraft<{ mentions: Mention[] }>(draftKey)?.extra?.mentions ?? [],
    ),
  );
  useEffect(() => restoreMentions(), []);

  // `/compact` never goes to the agent as text: it runs now, waits in the queue as typed, or says why it can't.
  const runCompact = (focus: string, hasFiles: boolean) => {
    const problem =
      hasFiles || mention.mentions.length > 0
        ? '/compact takes only a focus, no attachments or references'
        : offReason;
    if (problem) {
      toast.error(problem);
      return false;
    }
    if (compact.kind === 'queue')
      dispatch({
        type: 'queued-add',
        threadId: thread.id,
        message: queuedMessage(focus ? `/compact ${focus}` : '/compact', {
          mentions: [],
          isCommand: true,
          typedSkills: [],
        }),
      });
    else dispatch({ type: 'compact', threadId: thread.id, focus });
  };

  const recordUnanswered = useRecordUnanswered(thread);

  const restore = (message: QueuedMessage) => {
    // Whatever you were already typing stays; the message's text follows it.
    textInput.setInput(
      textInput.value.trim()
        ? `${textInput.value}\n${message.draft}`
        : message.draft,
    );
    mention.restore(message.mentions);
    if (message.images?.length) attachments.add(imageFiles(message.images));
    editor.current?.focus();
  };
  useEffect(() => {
    restoreRef.current = restore;
  });
  const edit = (message: QueuedMessage) => {
    dispatch({ type: 'queued-remove', threadId: thread.id, id: message.id });
    restore(message);
  };

  return (
    <div className="mx-auto w-full max-w-(--chat-width) px-4 pb-3 md:px-6">
      <motion.div {...handoff.layout}>
        <div className="relative">
          {/* Over the card, out of flow: showing it while it works never moves the composer. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-full *:pointer-events-auto">
            <ThreadComposerMeta
              thread={thread}
              isFolded={isCompact}
              isHeld={isHeld}
              whileWorking={whileWorking}
            />
          </div>
          <SlashMenu menu={slash} />
          <MentionMenu menu={mention} />
          <ComposerCard
            data-composer
            isCompact={isCompact}
            onFocusCapture={onExpand}
            // While compact, the first click only unfolds it, so it can't also flip a tray or press send.
            onClickCapture={(e) => {
              if (!isCompact) return;
              e.stopPropagation();
              onExpand();
              editor.current?.focus();
            }}
            {...threadDrop}
            className="in-data-image-over:border-ring data-mention-over:border-ring"
          >
            {decisions.length > 0 && (
              <QuestionTray
                decisions={decisions}
                isOpen={isTrayOpen}
                onToggle={onToggleTray}
              />
            )}
            <QueueTray
              thread={thread}
              onEdit={edit}
              onSendNow={(message) => submit(message, { queuedId: message.id })}
            />
            <MentionChips menu={mention} />
            <ComposerInput
              ref={editor}
              draftKey={draftKey}
              draftExtra={draftExtra}
              controls={controls}
              provider={provider}
              isLocked={thread.isSettingsChat}
              isModelOnly={thread.isSettingsChat}
              onControlsChange={setControls}
              slashItems={items}
              inlineMentions={mention.inlineMentions}
              onStop={
                thread.live?.isWorking
                  ? () => dispatch({ type: 'interrupt', threadId: thread.id })
                  : undefined
              }
              submitLabel={isQueueing ? 'Queue message' : 'Send'}
              hasMentions={mention.mentions.length > 0}
              permissions={
                !thread.isSettingsChat && (
                  <PermissionsMenu
                    threadId={thread.id}
                    provider={provider}
                    value={controls.access}
                    onChange={(access) => setControls({ ...controls, access })}
                  />
                )
              }
              meter={
                <ThreadContextRing
                  thread={thread}
                  provider={provider}
                  usage={threadUsage(thread)}
                />
              }
              onSend={async ({ text, files }) => {
                const trimmed = text.trim();
                if (
                  !trimmed &&
                  files.length === 0 &&
                  mention.mentions.length === 0
                )
                  return;
                const command = parseSlash(trimmed);
                const problem =
                  command?.command.name === 'side' && files.length > 0
                    ? 'Side chat questions can’t carry attachments'
                    : attachmentProblem(
                        files,
                        isRemote ? 'another computer' : undefined,
                      );
                if (problem) {
                  toast.error(problem);
                  return false;
                }
                if (command?.command.name === 'side')
                  return askInSideChat(dispatch, thread.id, command.arg);
                const focus = compactFocus(trimmed);
                if (focus !== null) return runCompact(focus, files.length > 0);
                let sent: string;
                try {
                  sent = await withAttachedFiles(
                    trimmed,
                    files,
                    (name, base64) => host.data.saveAttachment(name, base64),
                  );
                } catch (error) {
                  toast.error('Couldn’t attach the files', {
                    description: (error as Error).message,
                  });
                  return false;
                }
                if (!isQueueing) recordUnanswered();
                // Another computer's thread keeps no original here: the image goes inline and lives there.
                const images = await sentImages(files, (type, base64) =>
                  isRemote
                    ? Promise.reject(new Error('kept on that computer'))
                    : host.data.saveImage(type, base64),
                );
                const message = queuedMessage(sent, {
                  ...(images.length > 0 && { images }),
                  mentions: mention.mentions,
                  isCommand: !!resolveToken(trimmed, slashItems),
                  typedSkills: typedSkills(trimmed, slashItems),
                });
                if (!isQueueing) {
                  launchSend(thread.id, editor.current);
                  return submit(message);
                }
                dispatch({ type: 'queued-add', threadId: thread.id, message });
                mention.clear();
              }}
              placeholder={placeholder(
                thread,
                decisions.length > 0,
                isQueueing,
              )}
              suggestion={
                promptSuggestions
                  ? suggestionOf(thread, decisions.length > 0)
                  : undefined
              }
              autoFocus={handoff.isHandoff}
              {...menuProps}
              onKeyDown={(e, view) => {
                mention.editorProps.onKeyDown(e);
                if (!e.defaultPrevented) slash.editorProps.onKeyDown(e, view);
                if (e.key === MOD_KEY) setIsHeld(true);
                const newest = queued.at(-1);
                if (
                  e.key !== 'ArrowUp' ||
                  e.defaultPrevented ||
                  e.altKey ||
                  e.shiftKey ||
                  isMod(e) ||
                  view.state.doc.length ||
                  mention.mentions.length ||
                  !newest
                )
                  return;
                e.preventDefault();
                edit(newest);
              }}
              onKeyUp={(e) => e.key === MOD_KEY && setIsHeld(false)}
              onBlur={() => setIsHeld(false)}
            />
          </ComposerCard>
        </div>
        {!!workspace && <WorkspaceNotes workspace={workspace} />}
      </motion.div>
    </div>
  );
});

function placeholder(thread: Thread, isAsking: boolean, isQueueing: boolean) {
  const name = authorName(thread.providers[0]);
  if (isAsking) return 'Answer above, or steer with a message';
  if (isQueueing) return `Queue a message for when ${name} finishes`;
  return isWorking(thread) ? `Steer ${name} while it works` : `Message ${name}`;
}

/** Only for an idle thread with nothing to answer: while it works or asks, the placeholder says what a message would do. */
const suggestionOf = (thread: Thread, isAsking: boolean) =>
  isWorking(thread) || isAsking ? undefined : suggestedReply(thread);

/** What holding mod does to this send: the setting's other choice. */
/** Over the card: the limit or hold-to hint. Folds away with the composer while you read back. */
function ThreadComposerMeta({
  thread,
  isFolded,
  isHeld,
  whileWorking,
}: {
  thread: Thread;
  isFolded: boolean;
  isHeld: boolean;
  whileWorking: Prefs['whileWorking'];
}) {
  const hint = thread.live?.limit ? (
    <LimitHint limit={thread.live.limit} />
  ) : (
    isWorking(thread) && (
      <WhileWorkingHint whileWorking={whileWorking} isHeld={isHeld} />
    )
  );
  if (!hint) return null;
  // Folds by its row height, so the card settles down instead of jumping, and blurs out as it goes.
  return (
    <div
      inert={isFolded}
      className={cn(
        'grid origin-top grid-rows-[1fr] transition-[grid-template-rows,opacity,filter,scale] duration-150 ease-(--ease-out) motion-reduce:transition-[opacity]',
        isFolded &&
          'grid-rows-[0fr] scale-[0.97] overflow-hidden opacity-0 blur-xs motion-reduce:scale-100 motion-reduce:blur-none',
      )}
    >
      {/* ComposerMeta's top padding would keep the folded row open, so a bare box takes the min-height. */}
      <div className="min-h-0">
        <ComposerMeta className="min-h-0 pt-0 pb-1.5">{hint}</ComposerMeta>
      </div>
    </div>
  );
}

function WhileWorkingHint({
  whileWorking,
  isHeld,
}: {
  whileWorking: Prefs['whileWorking'];
  isHeld: boolean;
}) {
  const other = whileWorking === 'queue' ? 'steer' : 'queue';
  return (
    <span className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
      {isHeld ? (
        { steer: 'Steers now', queue: 'Queues after this turn' }[other]
      ) : (
        <>
          Hold <Shortcut keys={['mod']} /> to {other}
        </>
      )}
    </span>
  );
}

function QuestionTray({
  decisions,
  isOpen,
  onToggle,
}: {
  decisions: QueueItem[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const sharedLayout = useSharedLayout(isOpen);
  const first = decisions[0];
  return (
    <section aria-label="Waiting on you" className="relative">
      <motion.button
        {...sharedLayout}
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex h-9 w-full cursor-default items-center gap-2 px-4 text-left type-meta hover:bg-foreground/5"
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-warning"
        />
        <span className="shrink-0 font-medium">
          {decisions.length === 1
            ? 'Waiting on you'
            : `${decisions.length} waiting on you`}
        </span>
        <span
          className={cn(
            'min-w-0 truncate text-muted-foreground transition-opacity duration-150',
            isOpen && 'opacity-0',
          )}
        >
          {first.title}
        </span>
        <span className="ml-auto text-subtle-foreground">
          <FoldChevron isOpen={isOpen} />
        </span>
      </motion.button>
      <ComposerTrayBody isOpen={isOpen}>
        <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[min(52vh,28rem)]">
          {/* Sticky actions: a long question scrolls, but Next / Send stays in reach. Needs the card's overflow-visible below. */}
          <div className="flex flex-col gap-2 px-1 pb-1 [&_[data-slot=questionnaire-actions]]:sticky [&_[data-slot=questionnaire-actions]]:bottom-0 [&_[data-slot=questionnaire-actions]]:z-10 [&_[data-slot=questionnaire-actions]]:bg-card [&_[data-slot=questionnaire-actions]]:py-2">
            {decisions.map((item) => (
              <QueueDecision
                key={item.id}
                item={item}
                className="overflow-visible border-0 bg-transparent shadow-none ring-0 *:data-[slot=card-footer]:border-t-0 *:data-[slot=card-footer]:bg-transparent *:data-[slot=card-footer]:pt-0"
              />
            ))}
          </div>
        </ScrollArea>
      </ComposerTrayBody>
    </section>
  );
}

// GAP: demo-only. Seeds a screenshot so the attachment preview is visible without dropping a file.
function useSeedAttachment(isEnabled: boolean) {
  const { attachments } = usePromptInputController();
  const seeded = useRef(false);
  useEffect(() => {
    if (!isEnabled || seeded.current) return;
    seeded.current = true;
    attachments.add([
      new File([SCREENSHOT_SVG], 'usage-page.svg', { type: 'image/svg+xml' }),
      new File(['key_id,day,calls\n'], 'usage-sample.csv', {
        type: 'text/csv',
      }),
    ]);
  }, [isEnabled, attachments]);
}

const SCREENSHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f7f8fa"/><rect x="10" y="10" width="60" height="8" rx="2" fill="#1d1f24"/><rect x="118" y="9" width="32" height="10" rx="3" fill="#1d1f24"/>${[
  30, 36, 34, 44, 41, 52, 50, 58, 62, 70,
]
  .map(
    (h, i) =>
      `<rect x="${12 + i * 14}" y="${96 - h}" width="10" height="${h}" rx="1.5" fill="#4a86d8" opacity="${0.55 + i * 0.045}"/>`,
  )
  .join('')}<rect x="10" y="102" width="140" height="1" fill="#e3e5ea"/></svg>`;

/** Writing instead of answering keeps the card in the chat too, as its question with no answer. */
function useRecordUnanswered(thread: Thread) {
  const dispatch = useDispatch();
  const next = nextMoveOf(thread);
  return () => {
    if (!next?.question || !showsVerdictCard(thread)) return;
    dispatch({
      type: 'next-move-record',
      threadId: thread.id,
      record: moveRecord(thread, next.question),
    });
  };
}
