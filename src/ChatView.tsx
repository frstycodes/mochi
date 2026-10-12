import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotionConfig } from 'motion/react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ChevronDown, ChevronUp } from 'reicon-react';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInputProvider, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ComposerInbox } from './browser/composer';
import { authorName, isMochiCard, type ActivityEntry, type Author, type Provider, type QueueItem, type Subagent, type Thread } from './model';
import { CardEntry, EventLine } from './chat/MochiWidget';
import { clock } from './progress';
import { QueueDecision } from './QueueView';
import { useHarness } from './store';
import { ProviderMark } from './ui';
import { WorkspaceControls, WorkspaceNotes, useThreadWorkspace } from './git/WorkspacePicker';
import { BranchLabel, ComposerCard, ComposerInput, ComposerMeta, PermissionsMenu, RunOnMenu, useComposerHandoff } from './Composer';
import { useSplit } from './layout/SplitContext';
import { ThreadMinimap } from './ThreadMinimap';
import { ChatMochi, WorkLog } from './WorkLog';
import { agentPhase, pendingWork } from './agentPhase';
import { SecondOpinionRow } from './secondOpinion/SecondOpinionRow';
import type { Review } from './secondOpinion/verdict';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from './viz/FenceVisual';
import { ImageDropTarget } from './viz/ImageVisual';
import { VizThreadProvider } from './viz/WidgetVisual';
import { DriftCard, useDriftGuard } from './goals/DriftGuard';
import { Shortcut } from './Shortcut';
import { MOD_KEY } from './keys';
import { MessageActions } from './chat/MessageActions';
import { MessageContextMenu } from './chat/MessageContextMenu';
import { useThreadPins, type Pin } from './chat/pins';
import { SelectionPin, usePinHighlights } from './chat/SelectionPin';
import { LimitBanner } from './chat/LimitBanner';
import { parseSlash } from './chat/slash';
import { SlashMenu, useSlashMenu } from './chat/SlashMenu';
import { withReferences } from './chat/mentions';
import { MentionChips, MentionMenu, useMentionMenu } from './chat/MentionMenu';
import { askInSideChat } from './sidechat/AskInSideChat';
import { controlsOf } from './runtime/controls';
import { QUEUED_PREFIX } from './runtime/live';
import { SubagentRow } from './agents/SubagentRow';

type ChatRow =
  | { kind: 'message'; key: string; entry: ActivityEntry; index: number; showAuthor: boolean }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] }
  | { kind: 'review'; key: string; review: Review }
  | { kind: 'subagent'; key: string; subagent: Subagent };

export function ChatView({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const rows = useChatRows(thread.activity, thread.reviews, thread.subagents);
  // A second opinion runs beside the agent: the agent's own newest row stays the live one.
  const liveIndex = rows.findLastIndex((r) => r.kind !== 'review');
  // Mochi's own widgets sit in the transcript where the agent asked; the tray keeps the agent's questions and approvals.
  const decisions = state.queue.filter((q) => q.threadId === thread.id && !isMochiCard(q));
  // A live agent thread may have no planned steps; its turn is what's running.
  const isRunning = thread.live ? thread.live.isWorking : thread.steps.some((s) => s.status === 'running');
  const tray = useTrayState(decisions.length);

  const composer = useComposerHeightVar();
  const resize = useOpeningResize();
  const messages = useRef<HTMLDivElement>(null);
  const pins = useThreadPins(thread.id);
  usePinHighlights(messages, pins);
  const handoff = useComposerHandoff(useSplit().leafId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Instant while opening: a thread opens at its latest message, and a Stage swipe lands on the live view already where the preview was. */}
      <Conversation data-photo-scope initial="instant" resize={resize} className="min-h-0 flex-1">
        <VizThreadProvider value={thread.id}>
          <ConversationContent className={cn('mx-auto w-full max-w-[720px] gap-5 px-4 pt-6 pb-[calc(var(--composer-h)+1.5rem)] md:px-6', handoff.isHandoff && 'animate-in duration-300 fade-in')}>
            <div ref={messages} className="contents">
              {rows.map((row, i) => (
                <div key={row.key} data-chat-row={i} className="scroll-mt-6">
                  <ChatRowView thread={thread} row={row} isLive={i === liveIndex && isRunning} />
                </div>
              ))}
              <ChatMochi phase={agentPhase(thread)} label={pendingWork(thread)?.label} />
            </div>
          </ConversationContent>
        </VizThreadProvider>
        <ConversationScrollButton className="bottom-[calc(var(--composer-h)+0.75rem)]" />
        <SelectionPin threadId={thread.id} scope={messages} />
        <ThreadMinimap items={outline(rows, pins)} className="absolute top-6 right-1 bottom-[calc(var(--composer-h)+1rem)] z-10 hidden md:flex" />
        <ScrollIntent onScrollUp={tray.collapse} onReachBottom={tray.expand} />
      </Conversation>
      <div ref={composer} className="absolute inset-x-0 bottom-0 z-10">
        <PromptInputProvider key={thread.id}>
          <ImageDropTarget>
            <Composer thread={thread} decisions={decisions} isTrayOpen={tray.isOpen} onToggleTray={tray.toggle} handoff={handoff} />
          </ImageDropTarget>
          <ComposerInbox threadId={thread.id} />
        </PromptInputProvider>
      </div>
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

function useChatRows(activity: ActivityEntry[], reviews: Review[] = [], subagents: Subagent[] = []): ChatRow[] {
  const rows: ChatRow[] = [];
  const pushReviews = (at: number) => reviews.filter((r) => (at < activity.length ? r.afterIndex === at : r.afterIndex >= at)).forEach((review) => rows.push({ kind: 'review', key: review.id, review }));
  activity.forEach((entry, i) => {
    pushReviews(i);
    const key = `${entry.at}-${i}`;
    const last = rows[rows.length - 1];
    const isWork = entry.kind === 'tool' || entry.kind === 'reasoning';
    if (isWork && last?.kind === 'work' && last.who === entry.who) {
      last.entries.push(entry);
      return;
    }
    if (isWork) return rows.push({ kind: 'work', key, who: entry.who, entries: [entry] });
    if (entry.kind === 'event') return rows.push({ kind: 'event', key, entry });
    if (entry.kind === 'subagent') {
      const subagent = subagents.find((s) => s.id === entry.subagentId);
      return subagent && rows.push({ kind: 'subagent', key, subagent });
    }
    const previous = rows.findLast((r) => r.kind === 'work' || r.kind === 'message');
    const previousWho = previous?.kind === 'work' ? previous.who : previous?.kind === 'message' ? previous.entry.who : undefined;
    rows.push({ kind: 'message', key, entry, index: i, showAuthor: previousWho !== entry.who });
  });
  pushReviews(activity.length);
  return rows;
}

// isLive: the newest row of a running thread, the one still being written.
function ChatRowView({ thread, row, isLive }: { thread: Thread; row: ChatRow; isLive: boolean }) {
  if (row.kind === 'work') return <WorkLog entries={row.entries} isLive={isLive} />;
  if (row.kind === 'review') return <SecondOpinionRow thread={thread} review={row.review} />;
  if (row.kind === 'subagent') return <SubagentRow thread={thread} subagent={row.subagent} />;
  if (row.kind === 'event') return row.entry.card ? <CardEntry entry={row.entry} card={row.entry.card} /> : <EventLine text={row.entry.text} detail={row.entry.detail} at={row.entry.at} />;

  const { entry } = row;
  const isYou = entry.who === 'you';
  const isAgent = entry.who === 'claude' || entry.who === 'codex';
  return (
    <MessageContextMenu thread={thread} index={row.index}>
      <div data-activity-index={row.index} data-file-scope className="group/row flex flex-col gap-1">
        <Message from={isYou ? 'user' : 'assistant'} title={`${authorName(entry.who)} · ${clock(entry.at)}`}>
          <MessageContent className={cn('type-prose', isAgent && 'w-full')}>
            {isAgent && row.showAuthor && (
              <span className="flex items-center gap-1.5 type-caption text-subtle-foreground">
                <ProviderMark provider={entry.who as Provider} size={14} />
                {authorName(entry.who)}
                <span className="tabular">{clock(entry.at)}</span>
              </span>
            )}
            <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} isAnimating={isAgent && isLive}>
              {entry.text}
            </MessageResponse>
          </MessageContent>
        </Message>
        <MessageActions thread={thread} index={row.index} align={isYou ? 'end' : 'start'} />
      </div>
    </MessageContextMenu>
  );
}

/** One rail item per row; a row whose message (or a passage in it) is pinned carries its pins, shown in the tooltip. */
function outline(rows: ChatRow[], pins: Pin[]) {
  return rows.map((row) => {
    const pinned = row.kind === 'message' ? pins.filter((p) => p.index === row.index) : [];
    return { label: rowLabel(row), pins: pinned.map((p) => p.text || (row.kind === 'message' ? row.entry.text : '')) };
  });
}

function rowLabel(row: ChatRow) {
  if (row.kind === 'work') return `${authorName(row.who)} work log (${row.entries.length})`;
  if (row.kind === 'review') return `${authorName(row.review.provider)} second opinion`;
  if (row.kind === 'subagent') return `Agent: ${row.subagent.name}`;
  if (row.kind === 'event') return row.entry.detail ? `${row.entry.text}: ${row.entry.detail}` : row.entry.text;
  return `${authorName(row.entry.who)}: ${row.entry.text}`;
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
  decisions,
  isTrayOpen,
  onToggleTray,
  handoff,
}: {
  thread: Thread;
  decisions: QueueItem[];
  isTrayOpen: boolean;
  onToggleTray: () => void;
  handoff: ReturnType<typeof useComposerHandoff>;
}) {
  const { state, dispatch } = useHarness();
  const [isQueue, setIsQueue] = useState(false);
  const controls = controlsOf(thread);
  const workspace = useThreadWorkspace(thread);
  const setControls = (next: typeof controls) => dispatch({ type: 'controls', threadId: thread.id, controls: next });
  const provider = thread.providers[0];
  const mention = useMentionMenu(thread);
  const drift = useDriftGuard(thread, mention.clear);
  const slash = useSlashMenu();
  const menuProps = mention.isOpen ? mention.textareaProps : slash.textareaProps;
  useSeedAttachment(thread.id === 'adm');

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-3 md:px-6">
      <DriftCard guard={drift} thread={thread} />
      <LimitBanner thread={thread} />
      <motion.div {...handoff.layout}>
        <div className="relative">
          <SlashMenu menu={slash} />
          <MentionMenu menu={mention} />
          <ComposerCard className="in-data-image-over:border-ring">
            {decisions.length > 0 && <QuestionTray decisions={decisions} isOpen={isTrayOpen} onToggle={onToggleTray} />}
            <MentionChips menu={mention} />
            <ComposerInput
              controls={controls}
              provider={provider}
              isLocked={!!thread.live}
              onControlsChange={setControls}
              onStop={thread.live?.isWorking ? () => dispatch({ type: 'interrupt', threadId: thread.id }) : undefined}
              submitLabel={isQueue ? 'Queue message' : 'Send'}
              onSend={({ text, files }) => {
                const trimmed = text.trim();
                if (!trimmed && files.length === 0 && mention.mentions.length === 0) return;
                const command = parseSlash(trimmed);
                if (command?.command.name === 'side') return askInSideChat(dispatch, thread.id, command.arg);
                const withFiles = files.length ? `${trimmed}${trimmed ? ' ' : ''}(${files.length} attached)` : trimmed;
                const { text: shown, ...references } = withReferences(withFiles, mention.mentions, state.threads);
                return drift.submit(shown, isQueue ? QUEUED_PREFIX : '', references);
              }}
              placeholder={decisions.length ? 'Answer above, or steer with a message' : `Steer ${authorName(provider)} while it works`}
              autoFocus={handoff.isHandoff}
              {...menuProps}
              onKeyDown={(e) => {
                mention.textareaProps.onKeyDown(e);
                if (!e.isPropagationStopped()) slash.textareaProps.onKeyDown(e);
                if (e.key === MOD_KEY) setIsQueue(true);
              }}
              onKeyUp={(e) => e.key === MOD_KEY && setIsQueue(false)}
              onBlur={() => setIsQueue(false)}
            />
          </ComposerCard>
        </div>
        <ComposerMeta>
          <RunOnMenu />
          <PermissionsMenu value={controls.access} onChange={(access) => setControls({ ...controls, access })} />
          {workspace ? <WorkspaceControls workspace={workspace} /> : !!thread.repo && <BranchLabel repo={thread.repo} />}
          <span className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
            {isQueue ? (
              'Queues after this turn'
            ) : (
              <>
                <Shortcut keys={['mod']} /> to queue
              </>
            )}
          </span>
        </ComposerMeta>
        {!!workspace && <WorkspaceNotes workspace={workspace} />}
      </motion.div>
    </div>
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
