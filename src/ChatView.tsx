import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSimplifyReveal } from './simplify/useSimplify';
import { getDraft, threadDraftKey } from './chat/drafts';
import { ContextRing } from './ContextRing';
import { threadUsage } from './usage/model';
import { motion, useReducedMotionConfig } from 'motion/react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ChevronDown, ChevronUp, Hourglass, Sparkles } from 'reicon-react';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInputProvider, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ComposerInbox } from './browser/composer';
import { authorName, isMochiCard, type Provider, type QueuedMessage, type QueueItem, type Thread } from './model';
import { CardEntry, EventLine } from './chat/MochiWidget';
import { clock } from './progress';
import { QueueDecision } from './QueueView';
import { useHarness } from './store';
import { ProviderMark } from './ui';
import { WorkspaceControls, WorkspaceNotes, useThreadWorkspace } from './git/WorkspacePicker';
import { BranchLabel, ComposerCard, ComposerInput, ComposerMeta, PermissionsMenu, useComposerHandoff } from './Composer';
import { useSplit } from './layout/SplitContext';
import { ThreadMinimap, type OutlineItem } from './ThreadMinimap';
import { ChatMochi, WorkLog } from './WorkLog';
import { SetupRow } from './chat/SetupRow';
import { agentPhase, currentAction, isWorking, pendingWork, type CurrentAction } from './agentPhase';
import { chatRows, finalReplies, liveWorkIndex, type ChatRow } from './chat/rows';
import { SecondOpinionRow } from './secondOpinion/SecondOpinionRow';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from './viz/FenceVisual';
import { ImageDropTarget } from './viz/ImageVisual';
import { VizThreadProvider } from './viz/WidgetVisual';
import { DriftCard, useDriftGuard } from './goals/DriftGuard';
import { GoalCard } from './goals/GoalCard';
import { ReportCard } from './goals/ReportCard';
import { currentReport } from './goals/report';
import { TurnChangesCard } from './chat/TurnChangesCard';
import { ReceivedMessageRow } from './chat/ThreadMessage';
import { turnChanges } from './chat/turnChanges';
import { hasGoal } from './drift';
import { Shortcut } from './Shortcut';
import { isMod, MOD_KEY } from './keys';
import { MessageActions } from './chat/MessageActions';
import { MessageContextMenu } from './chat/MessageContextMenu';
import { useThreadPins, type Pin } from './chat/pins';
import { SelectionPin, usePinHighlights } from './chat/SelectionPin';
import { LimitEntry, LimitHint } from './chat/LimitCard';
import { CompactionRow } from './chat/CompactionRow';
import { compactFocus, compactGate } from './chat/compact';
import { parseSlash, resolveToken, slashTokens, typedSkills, type SlashItem } from './chat/slash';
import { SlashMenu, useSlashItems, useSlashMenu, useThreadServers, useThreadSkills } from './chat/SlashMenu';
import { SlashTokenText } from './chat/SlashToken';
import { queuedMessage, shouldQueue } from './chat/outbox';
import { imageFiles, imageProblem, sentImages } from './chat/images';
import { toast } from 'sonner';
import { openPhotos } from './photo/photos';
import { QueueTray } from './chat/QueueTray';
import { usePrefs, type Prefs } from './settings/prefs';
import { MentionChips, MentionMenu, useMentionMenu } from './chat/MentionMenu';
import type { Mention } from './chat/mentions';
import { askInSideChat } from './sidechat/AskInSideChat';
import { controlsOf } from './runtime/controls';
import { SubagentRow } from './agents/SubagentRow';
import { rememberedScroll, Transcript, type TranscriptHandle } from './chat/Transcript';

/** `isReadOnly`: a replay's transcript, without the composer and the per-message actions that would change the thread. */
export function ChatView({ thread, isReadOnly }: { thread: Thread; isReadOnly?: boolean }) {
  const { state } = useHarness();
  // A live agent thread may have no planned steps; its turn is what's running.
  const isRunning = thread.live ? thread.live.isWorking : thread.steps.some((s) => s.status === 'running');
  const rows = chatRows(thread.activity, thread.reviews, shownTurnChanges(thread, isRunning));
  // A second opinion runs beside the agent: the agent's own newest row stays the live one.
  const liveIndex = rows.findLastIndex((r) => r.kind !== 'review' && r.kind !== 'changes');
  const liveWork = liveWorkIndex(rows);
  const action = currentAction(thread);
  // Mochi's own widgets sit in the transcript where the agent asked; the tray keeps the agent's questions and approvals.
  // Ready for review is a state of the thread, not a question: it stays out of the tray so the composer remains a prompt.
  const decisions = state.queue.filter((q) => q.threadId === thread.id && !isMochiCard(q) && q.kind !== 'review');
  const tray = useTrayState(decisions.length);
  const withActions = finalReplies(rows, isRunning);

  const composer = useComposerHeightVar();
  const resize = useOpeningResize();
  const messages = useRef<HTMLDivElement>(null);
  const pins = useThreadPins(thread.id);
  usePinHighlights(messages, pins);
  const handoff = useComposerHandoff(useSplit().leafId);
  const slashItems = useSlashItems(thread.providers[0], thread.spaceId, thread.agent);
  const transcript = useRef<TranscriptHandle | null>(null);
  const [remembered] = useState(() => rememberedScroll.get(thread.id));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" style={isReadOnly ? ({ '--composer-h': '0px' } as React.CSSProperties) : undefined}>
      {/* Instant while opening: a thread opens at its latest message, and a thread that unmounted reopens where it was left. */}
      <Conversation data-photo-scope initial={remembered && !remembered.isAtBottom ? false : 'instant'} resize={resize} className="min-h-0 flex-1">
        <VizThreadProvider value={thread.id}>
          <ConversationContent className={cn('mx-auto w-full max-w-[720px] gap-5 px-4 pt-6 pb-[calc(var(--composer-h)+1.5rem)] md:px-6', handoff.isHandoff && 'animate-in duration-300 fade-in')}>
            <div ref={messages} className="contents">
              {hasGoal(thread) && <GoalCard thread={thread} />}
              {!!thread.setup && <SetupRow thread={thread} setup={thread.setup} />}
              <Transcript ref={transcript} threadId={thread.id} rows={rows} remembered={remembered}>
                {(row, i) => <ChatRowView thread={thread} row={row} slashItems={slashItems} isReadOnly={isReadOnly} hasActions={withActions.has(i)} isLive={row.kind === 'work' ? i === liveWork && !!action : i === liveIndex && isRunning} action={action} />}
              </Transcript>
              <ReportCard thread={thread} />
              <ChatMochi phase={agentPhase(thread)} label={pendingWork(thread)?.label} />
            </div>
          </ConversationContent>
        </VizThreadProvider>
        <ConversationScrollButton className="bottom-[calc(var(--composer-h)+0.75rem)]" />
        {!isReadOnly && <SelectionPin threadId={thread.id} scope={messages} />}
        <ThreadMinimap items={outline(rows, pins)} onJump={(rowIndex) => transcript.current?.scrollToIndex(rowIndex, { align: 'start' })} className="absolute top-6 left-0 bottom-[calc(var(--composer-h)+1rem)] z-10 hidden md:flex" />
        {!isReadOnly && <ScrollIntent onScrollUp={tray.collapse} onReachBottom={tray.expand} />}
      </Conversation>
      {!isReadOnly && (
        <div ref={composer} className="absolute inset-x-0 bottom-0 z-10">
          <PromptInputProvider key={thread.id}>
            <ImageDropTarget>
              <Composer thread={thread} slashItems={slashItems} decisions={decisions} isTrayOpen={tray.isOpen} onToggleTray={tray.toggle} handoff={handoff} />
            </ImageDropTarget>
            <ComposerInbox threadId={thread.id} />
          </PromptInputProvider>
        </div>
      )}
    </div>
  );
}

// Writes --composer-h on the parent directly: the composer animates its height every frame, and a state update would re-render the whole chat.
function useComposerHeightVar() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const ro = new ResizeObserver(([e]) => parent.style.setProperty('--composer-h', `${e.borderBoxSize[0].blockSize}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

// isLive: the newest row of a running thread, the one still being written. Memoized: a scroll re-renders the virtualized list, and only rows that just mounted should render.
const ChatRowView = memo(function ChatRowView({ thread, row, slashItems, isLive, isReadOnly, hasActions, action }: { thread: Thread; row: ChatRow; slashItems: SlashItem[]; isLive: boolean; isReadOnly?: boolean; hasActions: boolean; action?: CurrentAction }) {
  if (row.kind === 'work') return <WorkLog entries={row.entries} skills={slashItems} action={isLive ? action : undefined} />;
  if (row.kind === 'review') return <SecondOpinionRow thread={thread} review={row.review} />;
  if (row.kind === 'changes') return <TurnChangesCard thread={thread} turn={row.turn} isReadOnly={isReadOnly} />;
  if (row.kind === 'subagent') {
    const subagent = thread.subagents?.find((s) => s.id === row.entry.subagentId);
    return subagent ? <SubagentRow thread={thread} subagent={subagent} /> : null;
  }
  if (row.kind === 'thread-message') return <ReceivedMessageRow entry={row.entry} from={row.entry.from!} index={row.index} />;
  if (row.kind === 'event' && row.entry.isLimit) return <LimitEntry thread={thread} entry={row.entry} />;
  if (row.kind === 'event' && row.entry.compaction) return <CompactionRow compaction={row.entry.compaction} at={row.entry.at} provider={thread.session?.provider ?? thread.providers[0]} />;
  if (row.kind === 'event') return row.entry.card ? <CardEntry entry={row.entry} card={row.entry.card} /> : <EventLine text={row.entry.text} detail={row.entry.detail} at={row.entry.at} />;

  const { entry } = row;
  const isYou = entry.who === 'you';
  const isAgent = entry.who === 'claude' || entry.who === 'codex';
  const message = (
    <div data-activity-index={row.index} data-file-scope className="group/row flex flex-col gap-1">
      {entry.wasQueued && (
        <span className="flex items-center gap-1 self-end type-caption text-subtle-foreground">
          <Hourglass aria-hidden className="size-3" />
          Queued
        </span>
      )}
      {isYou && !!entry.images?.length && <SentImages thumbs={entry.images} />}
      <Message from={isYou ? 'user' : 'assistant'} title={`${authorName(entry.who)} · ${clock(entry.at)}`}>
        <MessageContent className={cn('type-prose', isAgent && 'w-full')}>
          {isAgent && row.showAuthor && (
            <span className="flex items-center gap-1.5 type-caption text-subtle-foreground">
              <ProviderMark provider={entry.who as Provider} size={14} />
              {authorName(entry.who)}
              <span className="tabular">{clock(entry.at)}</span>
            </span>
          )}
          {isYou && slashTokens(entry.text, slashItems).length > 0 ? (
            <SlashTokenText text={entry.text} items={slashItems} />
          ) : isAgent ? (
            <AgentReply thread={thread} index={row.index} isLive={isLive} />
          ) : (
            <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} isAnimating={false}>
              {entry.text}
            </MessageResponse>
          )}
        </MessageContent>
      </Message>
      {!isReadOnly && (isYou || hasActions) && <MessageActions thread={thread} index={row.index} align={isYou ? 'end' : 'start'} />}
    </div>
  );
  if (isReadOnly) return message;
  return (
    <MessageContextMenu thread={thread} index={row.index}>
      {message}
    </MessageContextMenu>
  );
});

/** The images you sent with a message, as the small copies the transcript keeps; click opens them larger. */
function SentImages({ thumbs }: { thumbs: string[] }) {
  const photos = thumbs.map((src, i) => ({ src, name: `Image ${i + 1}` }));
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {photos.map((photo, i) => (
        <button
          key={i}
          type="button"
          aria-label={`View ${photo.name}`}
          onClick={() => openPhotos({ photos, index: i })}
          className="relative size-16 cursor-zoom-in overflow-hidden rounded-lg bg-muted after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
        >
          <img src={photo.src} alt="" className="size-full object-cover" />
        </button>
      ))}
    </div>
  );
}

/** An agent's reply, or its Simplify bullets: they come in with the word reveal, and the reply pulses while they're made. */
function AgentReply({ thread, index, isLive }: { thread: Thread; index: number; isLive: boolean }) {
  const entry = thread.activity[index];
  const { isSimplifying, isRevealing } = useSimplifyReveal(thread.id, index);
  const simplified = entry.simplified?.isShown ? entry.simplified.text : null;
  return (
    <>
      {simplified !== null && (
        <span className="flex items-center gap-1 type-caption text-subtle-foreground">
          <Sparkles aria-hidden className="size-3" />
          Simplified for you
        </span>
      )}
      <MessageResponse
        key={simplified === null ? 'original' : 'simplified'}
        plugins={VIZ_PLUGINS}
        components={VIZ_COMPONENTS}
        rehypePlugins={VIZ_REHYPE_PLUGINS}
        isAnimating={isLive || (simplified !== null && isRevealing)}
        className={cn('transition-[opacity,filter] duration-300 motion-reduce:transition-none', isSimplifying && 'opacity-50 blur-[1.5px]')}
      >
        {simplified ?? entry.text}
      </MessageResponse>
    </>
  );
}

/** Finished turns' file changes: the turn still running gets its card once it ends, and a turn with a report lists its files there instead. */
function shownTurnChanges(thread: Thread, isRunning: boolean) {
  const isOpenTurnHidden = isRunning || !!currentReport(thread);
  return turnChanges(thread.activity).filter((t) => t.end < thread.activity.length - 1 || !isOpenTurnHidden);
}

/** One rail item per prompt you sent; a prompt whose message (or a passage in it) is pinned carries those pins into the hover card. */
function outline(rows: ChatRow[], pins: Pin[]): OutlineItem[] {
  return rows.flatMap((row, rowIndex) => {
    if (row.kind !== 'message' || row.entry.who !== 'you') return [];
    const pinned = pins.filter((p) => p.index === row.index).map((p) => p.text || row.entry.text);
    return [{ rowIndex, text: row.entry.text, time: clock(row.entry.at), pins: pinned }];
  });
}

/** Reading back through the chat folds the question tray away; returning to the latest message brings it back. */
function useTrayState(count: number) {
  const [isOpen, setOpen] = useState(true);
  useEffect(() => {
    if (count > 0) setOpen(true);
  }, [count]);
  return { isOpen, toggle: () => setOpen((o) => !o), collapse: () => setOpen(false), expand: () => setOpen(true) };
}

const SCROLL_INTENT_PX = 24;

// Listens to wheel and touch, not scroll: stick-to-bottom scrolls programmatically, and those scroll events aren't the reader's intent.
function ScrollIntent({ onScrollUp, onReachBottom }: { onScrollUp: () => void; onReachBottom: () => void }) {
  const { scrollRef, isAtBottom } = useStickToBottomContext();
  const handlers = useRef({ onScrollUp, onReachBottom });
  handlers.current = { onScrollUp, onReachBottom };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let up = 0;
    let touchY = 0;
    const atBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    const intent = (dy: number) => {
      if (dy > 0 && atBottom()) return handlers.current.onReachBottom();
      up = dy < 0 ? up - dy : 0;
      if (up < SCROLL_INTENT_PX) return;
      up = 0;
      handlers.current.onScrollUp();
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
  }, [scrollRef]);

  useEffect(() => {
    if (isAtBottom) handlers.current.onReachBottom();
  }, [isAtBottom]);

  return null;
}

function Composer({
  thread,
  slashItems,
  decisions,
  isTrayOpen,
  onToggleTray,
  handoff,
}: {
  thread: Thread;
  slashItems: SlashItem[];
  decisions: QueueItem[];
  isTrayOpen: boolean;
  onToggleTray: () => void;
  handoff: ReturnType<typeof useComposerHandoff>;
}) {
  const { dispatch } = useHarness();
  const { whileWorking } = usePrefs();
  const [isHeld, setIsHeld] = useState(false);
  const isQueueing = shouldQueue(thread, whileWorking, isHeld);
  const queued = thread.queued ?? [];
  const { textInput, attachments } = usePromptInputController();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const controls = controlsOf(thread);
  const workspace = useThreadWorkspace(thread);
  const setControls = (next: typeof controls) => dispatch({ type: 'controls', threadId: thread.id, controls: next });
  const provider = thread.providers[0];
  const mention = useMentionMenu(thread, useThreadSkills(provider, thread.spaceId, thread.agent), useThreadServers(provider, thread.spaceId, thread.agent));
  const drift = useDriftGuard(thread, mention.clear);
  const compact = compactGate(thread, isQueueing, decisions.length > 0);
  const offReason = compact.kind === 'off' ? compact.reason : undefined;
  const items = useMemo(() => slashItems.map((i) => (i.source === 'mochi' && i.name === 'compact' && offReason ? { ...i, disabledReason: offReason } : i)), [slashItems, offReason]);
  const slash = useSlashMenu(items);
  // Slash tracks the caret always; the open menu owns the listbox attributes.
  const menuProps = { ...slash.textareaProps, ...(mention.isOpen && mention.textareaProps) };
  const draftKey = threadDraftKey(thread.id);
  useSeedAttachment(thread.id === 'adm' && !getDraft(draftKey));
  const draftExtra = useMemo(() => (mention.mentions.length > 0 ? { mentions: mention.mentions } : undefined), [mention.mentions]);
  useEffect(() => {
    mention.restore(getDraft<{ mentions: Mention[] }>(draftKey)?.extra?.mentions ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // `/compact` never goes to the agent as text: it runs now, waits in the queue as typed, or says why it can't.
  const runCompact = (focus: string, hasFiles: boolean) => {
    const problem = hasFiles || mention.mentions.length > 0 ? '/compact takes only a focus, no attachments or references' : offReason;
    if (problem) {
      toast.error(problem);
      return false;
    }
    if (compact.kind === 'queue') dispatch({ type: 'queued-add', threadId: thread.id, message: queuedMessage(focus ? `/compact ${focus}` : '/compact', { mentions: [], isCommand: true, typedSkills: [] }) });
    else dispatch({ type: 'compact', threadId: thread.id, focus });
  };

  const edit = (message: QueuedMessage) => {
    dispatch({ type: 'queued-remove', threadId: thread.id, id: message.id });
    // Whatever you were already typing stays; the queued text follows it.
    textInput.setInput(textInput.value.trim() ? `${textInput.value}\n${message.draft}` : message.draft);
    mention.restore(message.mentions);
    if (message.images?.length) attachments.add(imageFiles(message.images));
    textarea.current?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-3 md:px-6">
      <DriftCard guard={drift} thread={thread} />
      <motion.div {...handoff.layout}>
        <div className="relative">
          <SlashMenu menu={slash} />
          <MentionMenu menu={mention} />
          <ComposerCard className="in-data-image-over:border-ring">
            {decisions.length > 0 && <QuestionTray decisions={decisions} isOpen={isTrayOpen} onToggle={onToggleTray} />}
            <QueueTray thread={thread} onEdit={edit} onSendNow={(message) => drift.submit(message, { queuedId: message.id, interrupts: true })} />
            <MentionChips menu={mention} />
            <ComposerInput
              ref={textarea}
              draftKey={draftKey}
              draftExtra={draftExtra}
              controls={controls}
              provider={provider}
              isLocked={!!thread.live}
              onControlsChange={setControls}
              slashItems={items}
              onStop={thread.live?.isWorking ? () => dispatch({ type: 'interrupt', threadId: thread.id }) : undefined}
              submitLabel={isQueueing ? 'Queue message' : 'Send'}
              meter={<ContextRing provider={provider} spaceId={thread.spaceId} context={thread.context} usage={threadUsage(thread)} />}
              onSend={async ({ text, files }) => {
                const trimmed = text.trim();
                if (!trimmed && files.length === 0 && mention.mentions.length === 0) return;
                const command = parseSlash(trimmed);
                const problem = command?.command.name === 'side' && files.length > 0 ? 'Side chat questions can’t carry images' : imageProblem(files);
                if (problem) {
                  toast.error(problem);
                  return false;
                }
                if (command?.command.name === 'side') return askInSideChat(dispatch, thread.id, command.arg);
                const focus = compactFocus(trimmed);
                if (focus !== null) return runCompact(focus, files.length > 0);
                const images = await sentImages(files);
                const message = queuedMessage(trimmed, { ...(images.length > 0 && { images }), mentions: mention.mentions, isCommand: !!resolveToken(trimmed, slashItems), typedSkills: typedSkills(trimmed, slashItems) });
                if (!isQueueing) return drift.submit(message);
                dispatch({ type: 'queued-add', threadId: thread.id, message });
                mention.clear();
              }}
              placeholder={placeholder(thread, decisions.length > 0, isQueueing)}
              autoFocus={handoff.isHandoff}
              {...menuProps}
              onKeyDown={(e) => {
                mention.textareaProps.onKeyDown(e);
                if (!e.isPropagationStopped()) slash.textareaProps.onKeyDown(e);
                if (e.key === MOD_KEY) setIsHeld(true);
                const newest = queued.at(-1);
                if (e.key !== 'ArrowUp' || e.defaultPrevented || e.altKey || e.shiftKey || isMod(e) || e.currentTarget.value || mention.mentions.length || !newest) return;
                e.preventDefault();
                edit(newest);
              }}
              onKeyUp={(e) => e.key === MOD_KEY && setIsHeld(false)}
              onBlur={() => setIsHeld(false)}
            />
          </ComposerCard>
        </div>
        <ComposerMeta>
          <PermissionsMenu threadId={thread.id} provider={provider} value={controls.access} onChange={(access) => setControls({ ...controls, access })} />
          {workspace ? <WorkspaceControls workspace={workspace} /> : !!thread.repo && <BranchLabel repo={thread.repo} />}
          {thread.live?.limit ? <LimitHint limit={thread.live.limit} /> : isWorking(thread) && <WhileWorkingHint whileWorking={whileWorking} isHeld={isHeld} />}
        </ComposerMeta>
        {!!workspace && <WorkspaceNotes workspace={workspace} />}
      </motion.div>
    </div>
  );
}

function placeholder(thread: Thread, isAsking: boolean, isQueueing: boolean) {
  const name = authorName(thread.providers[0]);
  if (isAsking) return 'Answer above, or steer with a message';
  if (isQueueing) return `Queue a message for when ${name} finishes`;
  return isWorking(thread) ? `Steer ${name} while it works` : `Message ${name}`;
}

/** What holding mod does to this send: the setting's other choice. */
function WhileWorkingHint({ whileWorking, isHeld }: { whileWorking: Prefs['whileWorking']; isHeld: boolean }) {
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

function QuestionTray({ decisions, isOpen, onToggle }: { decisions: QueueItem[]; isOpen: boolean; onToggle: () => void }) {
  const reduce = useReducedMotionConfig();
  const first = decisions[0];
  return (
    <section aria-label="Waiting on you">
      <button type="button" aria-expanded={isOpen} onClick={onToggle} className="flex h-9 w-full cursor-default items-center gap-2 px-4 text-left type-meta hover:bg-foreground/5">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
        <span className="shrink-0 font-medium">{decisions.length === 1 ? 'Waiting on you' : `${decisions.length} waiting on you`}</span>
        <span className={cn('min-w-0 truncate text-muted-foreground transition-opacity duration-150', isOpen && 'opacity-0')}>{first.title}</span>
        <span className="ml-auto text-subtle-foreground">{isOpen ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</span>
      </button>
      {isOpen && (
        <motion.div initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[min(40vh,22rem)]">
            <div className="flex flex-col gap-2 px-1 pb-1">
              {decisions.map((item) => (
                <QueueDecision key={item.id} item={item} className="bg-transparent shadow-none ring-0 *:data-[slot=card-footer]:border-t-0 *:data-[slot=card-footer]:bg-transparent *:data-[slot=card-footer]:pt-0" />
              ))}
            </div>
          </ScrollArea>
        </motion.div>
      )}
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
    attachments.add([new File([SCREENSHOT_SVG], 'usage-page.svg', { type: 'image/svg+xml' }), new File(['key_id,day,calls\n'], 'usage-sample.csv', { type: 'text/csv' })]);
  }, [isEnabled, attachments]);
}

const SCREENSHOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f7f8fa"/><rect x="10" y="10" width="60" height="8" rx="2" fill="#1d1f24"/><rect x="118" y="9" width="32" height="10" rx="3" fill="#1d1f24"/>${[30, 36, 34, 44, 41, 52, 50, 58, 62, 70]
  .map((h, i) => `<rect x="${12 + i * 14}" y="${96 - h}" width="10" height="${h}" rx="1.5" fill="#4a86d8" opacity="${0.55 + i * 0.045}"/>`)
  .join('')}<rect x="10" y="102" width="140" height="1" fill="#e3e5ea"/></svg>`;

const OPENING_MS = 1000;

/** Content keeps growing for a moment after mount (markdown, images); following it smoothly reads as the chat scrolling by itself. */
function useOpeningResize() {
  const [isOpening, setOpening] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOpening(false), OPENING_MS);
    return () => window.clearTimeout(t);
  }, []);
  return isOpening ? 'instant' : 'smooth';
}
