import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import { ChevronDown, ChevronUp, Flag } from 'reicon-react';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInputProvider, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { Kbd } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ComposerInbox } from './browser/composer';
import type { ActivityEntry, Author, Provider, QueueItem, Thread } from './model';
import { clock } from './progress';
import { QueueDecision } from './QueueView';
import { useHarness } from './store';
import { ProviderMark } from './ui';
import { BranchLabel, ComposerCard, ComposerInput, ComposerMeta, PermissionsMenu, RunOnMenu } from './Composer';
import { ThreadMinimap } from './ThreadMinimap';
import { WorkLog } from './WorkLog';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from './viz/FenceVisual';
import { ImageDropTarget } from './viz/ImageVisual';
import { VizThreadProvider } from './viz/WidgetVisual';
import { DriftCard, useDriftGuard } from './goals/DriftGuard';

type ChatRow =
  | { kind: 'message'; key: string; entry: ActivityEntry; showAuthor: boolean }
  | { kind: 'event'; key: string; entry: ActivityEntry }
  | { kind: 'work'; key: string; who: Author; entries: ActivityEntry[] };

export function ChatView({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const rows = useChatRows(thread.activity);
  const decisions = state.queue.filter((q) => q.threadId === thread.id);
  const isRunning = thread.steps.some((s) => s.status === 'running');
  const tray = useTrayState(decisions.length);

  const composer = useComposerHeightVar();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Conversation data-photo-scope className="min-h-0 flex-1">
        <VizThreadProvider value={thread.id}>
          <ConversationContent className="mx-auto w-full max-w-[720px] gap-5 px-4 pt-6 pb-[calc(var(--composer-h)+1.5rem)] md:px-6">
            {rows.map((row, i) => (
              <div key={row.key} data-chat-row={i} className="scroll-mt-6">
                <ChatRowView row={row} isLive={i === rows.length - 1 && isRunning} />
              </div>
            ))}
          </ConversationContent>
        </VizThreadProvider>
        <ConversationScrollButton className="bottom-[calc(var(--composer-h)+0.75rem)]" />
        <ThreadMinimap labels={rows.map(rowLabel)} className="absolute top-6 right-1 bottom-[calc(var(--composer-h)+1rem)] z-10 hidden md:flex" />
        <ScrollIntent onScrollUp={tray.collapse} onReachBottom={tray.expand} />
      </Conversation>
      <div ref={composer} className="absolute inset-x-0 bottom-0 z-10">
        <PromptInputProvider key={thread.id}>
          <ImageDropTarget>
            <Composer thread={thread} decisions={decisions} isTrayOpen={tray.isOpen} onToggleTray={tray.toggle} />
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

function useChatRows(activity: ActivityEntry[]): ChatRow[] {
  const rows: ChatRow[] = [];
  activity.forEach((entry, i) => {
    const key = `${entry.at}-${i}`;
    const last = rows[rows.length - 1];
    const isWork = entry.kind === 'tool' || entry.kind === 'reasoning';
    if (isWork && last?.kind === 'work' && last.who === entry.who) {
      last.entries.push(entry);
      return;
    }
    if (isWork) return rows.push({ kind: 'work', key, who: entry.who, entries: [entry] });
    if (entry.kind === 'event') return rows.push({ kind: 'event', key, entry });
    const previous = [...rows].reverse().find((r) => r.kind !== 'event');
    const previousWho = previous?.kind === 'work' ? previous.who : previous?.entry.who;
    rows.push({ kind: 'message', key, entry, showAuthor: previousWho !== entry.who });
  });
  return rows;
}

// isLive: the newest row of a running thread, the one still being written.
function ChatRowView({ row, isLive }: { row: ChatRow; isLive: boolean }) {
  if (row.kind === 'work') return <WorkLog entries={row.entries} isLive={isLive} />;
  if (row.kind === 'event')
    return (
      <p className="flex items-center gap-2 type-caption text-subtle-foreground">
        <Flag className="size-3.5 shrink-0" />
        {row.entry.text}
        <span className="tabular">· {clock(row.entry.at)}</span>
      </p>
    );

  const { entry } = row;
  const isYou = entry.who === 'you';
  const isAgent = entry.who === 'claude' || entry.who === 'codex';
  return (
    <Message from={isYou ? 'user' : 'assistant'} title={`${authorName(entry.who)} · ${clock(entry.at)}`}>
      <MessageContent className={cn('type-prose', isAgent && 'w-full')}>
        {isAgent && row.showAuthor && (
          <span className="flex items-center gap-1.5 type-caption text-subtle-foreground">
            <ProviderMark provider={entry.who as Provider} size={14} />
            {authorName(entry.who)}
            <span className="tabular">{clock(entry.at)}</span>
          </span>
        )}
        {/* GAP: the tick simulation never streams text; once the agent runtime does, isAnimating should follow the stream, not the row position. */}
        <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} isAnimating={isAgent && isLive}>
          {entry.text}
        </MessageResponse>
      </MessageContent>
    </Message>
  );
}

function rowLabel(row: ChatRow) {
  if (row.kind === 'work') return `${authorName(row.who)} work log (${row.entries.length})`;
  if (row.kind === 'event') return row.entry.text;
  return `${authorName(row.entry.who)}: ${row.entry.text}`;
}

function authorName(who: Author) {
  return { you: 'You', claude: 'Claude', codex: 'Codex', harness: 'Harness' }[who];
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

function Composer({ thread, decisions, isTrayOpen, onToggleTray }: { thread: Thread; decisions: QueueItem[]; isTrayOpen: boolean; onToggleTray: () => void }) {
  const [isQueue, setIsQueue] = useState(false);
  const provider = thread.providers[0];
  const drift = useDriftGuard(thread);
  useSeedAttachment(thread.id === 'adm');

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-3 md:px-6">
      <DriftCard guard={drift} thread={thread} />
      <ComposerCard className="in-data-image-over:border-ring">
        {decisions.length > 0 && <QuestionTray decisions={decisions} isOpen={isTrayOpen} onToggle={onToggleTray} />}
        <ComposerInput
          provider={provider}
          submitLabel={isQueue ? 'Queue message' : 'Send'}
          onSend={({ text, files }) => {
            const trimmed = text.trim();
            if (!trimmed && files.length === 0) return;
            const withFiles = files.length ? `${trimmed}${trimmed ? ' ' : ''}(${files.length} attached)` : trimmed;
            return drift.submit(withFiles, isQueue ? 'Queued: ' : '');
          }}
          placeholder={decisions.length ? 'Answer above, or steer with a message' : `Steer ${authorName(provider)} while it works`}
          onKeyDown={(e) => e.key === 'Meta' && setIsQueue(true)}
          onKeyUp={(e) => e.key === 'Meta' && setIsQueue(false)}
          onBlur={() => setIsQueue(false)}
        />
      </ComposerCard>
      <ComposerMeta>
        <RunOnMenu />
        <PermissionsMenu />
        {!!thread.repo && <BranchLabel branch={thread.repo.branch} />}
        <span className="ml-auto hidden shrink-0 items-center gap-1 md:flex">
          {isQueue ? (
            'Queues after this turn'
          ) : (
            <>
              <Kbd>Cmd</Kbd> to queue
            </>
          )}
        </span>
      </ComposerMeta>
    </div>
  );
}

function QuestionTray({ decisions, isOpen, onToggle }: { decisions: QueueItem[]; isOpen: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();
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
