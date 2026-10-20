import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useIsSimplifying } from './simplify/useSimplify';
import { SimplifySwap } from './simplify/SimplifyMotion';
import { host } from './host';
import { getDraft, threadDraftKey } from './chat/drafts';
import { ContextRing } from './ContextRing';
import { threadUsage } from './usage/model';
import { motion, useReducedMotionConfig } from 'motion/react';
import type { EditorView } from '@codemirror/view';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ChevronDown, ChevronUp, Hourglass, Stars } from '@/icons';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInputProvider, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ComposerInbox } from './browser/composer';
import { authorName, isMochiCard, type Provider, type QueuedMessage, type QueueItem, type StepStatus, type Thread } from './model';
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
import { useLibraryNames } from './library/names';
import { agentPhase, currentAction, isWorking, pendingWork, type CurrentAction } from './agentPhase';
import { chatRows, finalReplies, liveWorkIndex, type ChatRow } from './chat/rows';
import { SecondOpinionRow } from './secondOpinion/SecondOpinionRow';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from './viz/FenceVisual';
import { ImageDropTarget } from './viz/ImageVisual';
import { VizThreadProvider } from './viz/WidgetVisual';
import { DriftCard, useDriftGuard } from './goals/DriftGuard';
import { GoalCard } from './goals/GoalCard';
import { ReportCard } from './goals/ReportCard';
import { NextMoveRecord, PlanList, useNextMove, type PlanItem } from './goals/NextMove';
import { SubThreadResultRow } from './goals/SubThreads';
import { showsVerdictCard } from './goals/report';
import { ProposalCard } from './goals/ProposalCard';
import { TurnChangesCard } from './chat/TurnChangesCard';
import { AutofixEventRow, ReceivedMessageRow } from './chat/ThreadMessage';
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
import { HandoffRow } from './chat/HandoffRow';
import { compactFocus, compactGate } from './chat/compact';
import { parseSlash, resolveToken, slashTokens, typedSkills, type SlashItem } from './chat/slash';
import { SlashMenu, useSlashItems, useSlashMenu, useThreadServers, useThreadSkills } from './chat/SlashMenu';
import { SlashTokenText } from './chat/SlashToken';
import { queuedMessage, shouldQueue } from './chat/outbox';
import { imageFiles, imageProblem, sentImages } from './chat/images';
import { ImageGenCard } from './chat/ImageGenCard';
import { McpAppCard } from './chat/McpAppCard';
import { MessageImages } from './chat/MessageImages';
import { toast } from '@/toast/store';
import { QueueTray } from './chat/QueueTray';
import { usePrefs, type Prefs } from './settings/prefs';
import { MentionChips, MentionMenu, useMentionMenu, useThreadMentionFiles } from './chat/MentionMenu';
import type { Mention } from './chat/mentions';
import { projectRef } from './projects';
import { askInSideChat } from './sidechat/AskInSideChat';
import { controlsOf } from './runtime/controls';
import { SubagentRow } from './agents/SubagentRow';
import { rememberedScroll, Transcript, type TranscriptHandle } from './chat/Transcript';

export type MessageBar = ComponentType<{ thread: Thread; index: number; align: 'start' | 'end' }>;

/**
 * `isReadOnly`: a replay's transcript, without the composer and the per-message actions that would change the thread.
 * `messageBar` puts actions of its own back under the messages that would have them (another computer's thread).
 */
export function ChatView({ thread, isReadOnly, messageBar }: { thread: Thread; isReadOnly?: boolean; messageBar?: MessageBar }) {
  const { state } = useHarness();
  // A live agent thread may have no planned steps; its turn is what's running.
  const isRunning = thread.live ? thread.live.isWorking : thread.steps.some((s) => s.status === 'running');
  const rows = chatRows(thread.activity, thread.reviews, shownTurnChanges(thread, isRunning));
  // A second opinion runs beside the agent: the agent's own newest row stays the live one.
  const liveIndex = rows.findLastIndex((r) => r.kind !== 'review' && r.kind !== 'changes');
  const liveWork = liveWorkIndex(rows);
  // Its label names skills and servers as the library does.
  useLibraryNames();
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
  const slashItems = useSlashItems(thread.providers[0], thread.spaceId, projectRef(thread.repo), thread.agent);
  const transcript = useRef<TranscriptHandle | null>(null);
  const [remembered] = useState(() => rememberedScroll.get(thread.id));

  return (
    // The provider holds the message box's text for the whole chat: the next-move card fills it with the agent's draft.
    <PromptInputProvider key={thread.id}>
      <div data-chat={thread.id} className="relative flex min-h-0 flex-1 flex-col" style={isReadOnly ? ({ '--composer-h': '0px' } as React.CSSProperties) : undefined}>
        {/* Instant while opening: a thread opens at its latest message, and a thread that unmounted reopens where it was left. */}
        <Conversation data-photo-scope initial={remembered && !remembered.isAtBottom ? false : 'instant'} resize={resize} className="min-h-0 flex-1">
          <VizThreadProvider value={thread.id}>
            <ConversationContent scrollClassName="[scroll-timeline:--chat_y]" className={cn('mx-auto w-full max-w-[720px] gap-5 px-4 pt-[calc(var(--chat-top,0px)+1.5rem)] pb-[calc(max(var(--composer-h),var(--composer-hold,0px))+1.5rem)] md:px-6', handoff.isHandoff && 'animate-in duration-300 fade-in')}>
              <div ref={messages} className="contents">
                {hasGoal(thread) && <GoalCard thread={thread} />}
                {!!thread.setup && <SetupRow thread={thread} setup={thread.setup} />}
                <Transcript ref={transcript} threadId={thread.id} rows={rows} remembered={remembered}>
                  {(row, i) => <ChatRowView thread={thread} row={row} slashItems={slashItems} isReadOnly={isReadOnly} messageBar={messageBar} hasActions={withActions.has(i)} isLive={row.kind === 'work' ? i === liveWork && !!action : i === liveIndex && isRunning} action={action} />}
                </Transcript>
                <ProposalCard thread={thread} />
                <ReportCard thread={thread} isReadOnly={isReadOnly} onJump={(quote) => jumpToQuote(transcript.current, rows, quote)} />
                <PlanList items={planItems(thread, state.now)} slot={thread.line} isWorking={isRunning} />
                <ChatMochi phase={agentPhase(thread)} label={pendingWork(thread)?.label} />
              </div>
            </ConversationContent>
          </VizThreadProvider>
          <ConversationScrollButton className="bottom-[calc(var(--composer-h)+0.75rem)]" />
          {!isReadOnly && <SelectionPin threadId={thread.id} scope={messages} />}
          <ThreadMinimap items={outline(rows, pins)} onJump={(rowIndex) => transcript.current?.scrollToIndex(rowIndex, { align: 'start' })} className="absolute top-[calc(var(--chat-top,0px)+1.5rem)] left-0 bottom-[calc(var(--composer-h)+1rem)] z-10 hidden md:flex" />
          {!isReadOnly && <ScrollIntent onScrollUp={() => (composer.hold(), tray.collapse())} onReachBottom={() => (tray.expand(), !decisions.length && composer.release())} />}
        </Conversation>
        {!isReadOnly && (
          <div ref={composer.ref} className="absolute inset-x-0 bottom-0 z-10">
            <ImageDropTarget>
              <Composer thread={thread} slashItems={slashItems} decisions={decisions} isTrayOpen={tray.isOpen} onToggleTray={tray.toggle} handoff={handoff} />
            </ImageDropTarget>
            <ComposerInbox threadId={thread.id} />
          </div>
        )}
      </div>
    </PromptInputProvider>
  );
}

/**
 * Writes --composer-h on the parent directly: the composer animates its height every frame, and a state update would re-render the whole chat.
 * `hold` pins --composer-hold at the current height, so folding the tray under a reader who just scrolled up doesn't shrink the chat's bottom
 * padding: the shrink would clamp the scroll back to the bottom, and `use-stick-to-bottom` re-locks on a shrink near the bottom.
 */
function useComposerHeightVar() {
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef(0);
  const release = () => {
    held.current = 0;
    ref.current?.parentElement?.style.removeProperty('--composer-hold');
  };
  const hold = () => {
    const el = ref.current;
    if (!el?.parentElement || held.current) return;
    held.current = el.offsetHeight;
    el.parentElement.style.setProperty('--composer-hold', `${held.current}px`);
  };
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const ro = new ResizeObserver(([e]) => {
      const height = e.borderBoxSize[0].blockSize;
      parent.style.setProperty('--composer-h', `${height}px`);
      if (height >= held.current) release();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, hold, release };
}

// isLive: the newest row of a running thread, the one still being written. Memoized: a scroll re-renders the virtualized list, and only rows that just mounted should render.
const ChatRowView = memo(function ChatRowView({ thread, row, slashItems, isLive, isReadOnly, messageBar, hasActions, action }: { thread: Thread; row: ChatRow; slashItems: SlashItem[]; isLive: boolean; isReadOnly?: boolean; messageBar?: MessageBar; hasActions: boolean; action?: CurrentAction }) {
  if (row.kind === 'work') return <WorkLog entries={row.entries} skills={slashItems} action={isLive ? action : undefined} />;
  if (row.kind === 'review') return <SecondOpinionRow thread={thread} review={row.review} />;
  if (row.kind === 'changes') return <TurnChangesCard thread={thread} turn={row.turn} isReadOnly={isReadOnly} />;
  if (row.kind === 'subagent') {
    const subagent = thread.subagents?.find((s) => s.id === row.entry.subagentId);
    return subagent ? <SubagentRow thread={thread} subagent={subagent} /> : null;
  }
  if (row.kind === 'image') return <ImageGenCard image={row.entry.generated!} startedMs={row.entry.ms} />;
  if (row.kind === 'widget') return <McpAppCard threadId={thread.id} widget={row.entry.widget!} />;
  if (row.kind === 'thread-message') return row.entry.autofix ? <AutofixEventRow entry={row.entry} event={row.entry.autofix} index={row.index} /> : <ReceivedMessageRow entry={row.entry} from={row.entry.from!} index={row.index} />;
  if (row.kind === 'event' && row.entry.isLimit) return <LimitEntry thread={thread} entry={row.entry} />;
  if (row.kind === 'event' && row.entry.nextMove) return <NextMoveRecord record={row.entry.nextMove} />;
  if (row.kind === 'event' && row.entry.subThread) return <SubThreadResultRow entry={row.entry} result={row.entry.subThread} />;
  if (row.kind === 'event' && row.entry.handoff) return <HandoffRow handoff={row.entry.handoff} at={row.entry.at} />;
  if (row.kind === 'event' && row.entry.compaction) return <CompactionRow compaction={row.entry.compaction} at={row.entry.at} provider={thread.session?.provider ?? thread.providers[0]} />;
  if (row.kind === 'event') return row.entry.card ? <CardEntry entry={row.entry} card={row.entry.card} /> : <EventLine text={row.entry.text} detail={row.entry.detail} at={row.entry.at} glyph={row.entry.glyph} site={row.entry.site} />;

  const { entry } = row;
  const Bar = isReadOnly ? messageBar : MessageActions;
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
      {isYou && !!entry.images?.length && <MessageImages photos={entry.images.map((src, i) => ({ src, name: `Image ${i + 1}` }))} className="justify-end" />}
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
      {!!Bar && (isYou || hasActions) && <Bar thread={thread} index={row.index} align={isYou ? 'end' : 'start'} />}
    </div>
  );
  if (isReadOnly) return message;
  return (
    <MessageContextMenu thread={thread} index={row.index}>
      {message}
    </MessageContextMenu>
  );
});

/** An agent's reply, or its simplified version: it shimmers while that is made, then crossfades to it. */
function AgentReply({ thread, index, isLive }: { thread: Thread; index: number; isLive: boolean }) {
  const entry = thread.activity[index];
  const isSimplifying = useIsSimplifying(thread.id, index);
  const simplified = entry.simplified?.isShown ? entry.simplified.text : null;
  return (
    <SimplifySwap view={simplified === null ? 'original' : 'simplified'} isSimplifying={isSimplifying}>
      {simplified !== null && (
        <span className="flex items-center gap-1 type-caption text-subtle-foreground">
          <Stars aria-hidden className="size-3" />
          Simplified for you
        </span>
      )}
      <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} isAnimating={isLive}>
        {simplified ?? entry.text}
      </MessageResponse>
    </SimplifySwap>
  );
}

/** Finished turns' file changes: the turn still running gets its card once it ends, and a turn with a report lists its files there instead. */
function shownTurnChanges(thread: Thread, isRunning: boolean) {
  const isOpenTurnHidden = isRunning || showsVerdictCard(thread);
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
  const editor = useRef<EditorView>(null);
  const controls = controlsOf(thread);
  const workspace = useThreadWorkspace(thread);
  const setControls = (next: typeof controls) => dispatch({ type: 'controls', threadId: thread.id, controls: next });
  const provider = thread.providers[0];
  const root = projectRef(thread.repo);
  const mention = useMentionMenu(thread.id, useThreadSkills(provider, thread.spaceId, root, thread.agent), useThreadServers(provider, thread.spaceId, root, thread.agent), useThreadMentionFiles(thread));
  const drift = useDriftGuard(thread, mention.clear);
  const compact = compactGate(thread, decisions.length > 0);
  const offReason = compact.kind === 'off' ? compact.reason : undefined;
  const items = useMemo(() => slashItems.map((i) => (i.source === 'mochi' && i.name === 'compact' && offReason ? { ...i, disabledReason: offReason } : i)), [slashItems, offReason]);
  const slash = useSlashMenu(items);
  // Slash tracks the caret always; the open menu owns the listbox attributes.
  const menuProps = { ...slash.editorProps, ...(mention.isOpen && mention.editorProps) };
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

  const recordUnanswered = useRecordUnanswered(thread);

  const edit = (message: QueuedMessage) => {
    dispatch({ type: 'queued-remove', threadId: thread.id, id: message.id });
    // Whatever you were already typing stays; the queued text follows it.
    textInput.setInput(textInput.value.trim() ? `${textInput.value}\n${message.draft}` : message.draft);
    mention.restore(message.mentions);
    if (message.images?.length) attachments.add(imageFiles(message.images));
    editor.current?.focus();
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-3 md:px-6">
      <DriftCard guard={drift} thread={thread} />
      <motion.div {...handoff.layout}>
        <div className="relative">
          <SlashMenu menu={slash} />
          <MentionMenu menu={mention} />
          <ComposerCard data-composer className="in-data-image-over:border-ring">
            {decisions.length > 0 && <QuestionTray decisions={decisions} isOpen={isTrayOpen} onToggle={onToggleTray} />}
            <QueueTray thread={thread} onEdit={edit} onSendNow={(message) => drift.submit(message, { queuedId: message.id })} />
            <MentionChips menu={mention} />
            <ComposerInput
              ref={editor}
              draftKey={draftKey}
              draftExtra={draftExtra}
              controls={controls}
              provider={provider}
              isLocked={!!thread.live}
              onControlsChange={setControls}
              slashItems={items}
              inlineMentions={mention.inlineMentions}
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
                if (!isQueueing) recordUnanswered();
                const images = await sentImages(files, (type, base64) => host.data.saveImage(type, base64));
                const message = queuedMessage(trimmed, { ...(images.length > 0 && { images }), mentions: mention.mentions, isCommand: !!resolveToken(trimmed, slashItems), typedSkills: typedSkills(trimmed, slashItems) });
                if (!isQueueing) return drift.submit(message);
                dispatch({ type: 'queued-add', threadId: thread.id, message });
                mention.clear();
              }}
              placeholder={placeholder(thread, decisions.length > 0, isQueueing)}
              autoFocus={handoff.isHandoff}
              {...menuProps}
              onKeyDown={(e, view) => {
                mention.editorProps.onKeyDown(e);
                if (!e.defaultPrevented) slash.editorProps.onKeyDown(e, view);
                if (e.key === MOD_KEY) setIsHeld(true);
                const newest = queued.at(-1);
                if (e.key !== 'ArrowUp' || e.defaultPrevented || e.altKey || e.shiftKey || isMod(e) || view.state.doc.length || mention.mentions.length || !newest) return;
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

/** Scrolls to the agent's last message holding `quote`: a verdict gap's source. */
function jumpToQuote(transcript: TranscriptHandle | null, rows: ChatRow[], quote: string) {
  const i = rows.findLastIndex((r) => r.kind === 'message' && r.entry.text.includes(quote));
  if (i >= 0) transcript?.scrollToIndex(i, { align: 'center' });
}

/** Writing instead of answering keeps the card in the chat too, as its question with no answer. */
function useRecordUnanswered(thread: Thread) {
  const { dispatch } = useHarness();
  const next = useNextMove(thread);
  return () => {
    if (!next?.question || !showsVerdictCard(thread)) return;
    dispatch({ type: 'next-move-record', threadId: thread.id, record: { ...(next.report?.summary && { summary: next.report.summary }), question: next.question } });
  };
}

/** The agent's plan as the chat's to-do list; dropped items leave it. */
function planItems(thread: Thread, now: number): PlanItem[] {
  return thread.steps.flatMap((s) => (s.status === 'dropped' ? [] : [{ title: s.title, status: PLAN_STATUS[s.status], ...(s.startedAt !== undefined && { minutes: (s.doneAt ?? now) - s.startedAt }) }]));
}

const PLAN_STATUS = { done: 'done', running: 'running', ready: 'pending', blocked: 'pending' } satisfies Record<Exclude<StepStatus, 'dropped'>, PlanItem['status']>;
