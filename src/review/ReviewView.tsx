import { useEffect, useRef, useState } from 'react';
import { CheckCircle, MessageEdit, Next, TaskSquare, X } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PrStateIcon } from '@/icons/github';
import { useConfirm } from '../git/useConfirm';
import type { Pane, PaneTab, Thread } from '../model';
import { BrowserTab } from '../pane/BrowserTab';
import { ChangesTab } from '../pane/ChangesTab';
import { useUndoable } from '../QueueView';
import { useHarness } from '../store';
import { summarize } from '../summary';
import { ProviderMarks, lineColor } from '../ui';
import { DiffStat } from '../WorkLog';
import { reviewThreads, stepIndex } from './order';
import { useReviewMode } from './useReviewMode';
import { isMod } from '../keys';

/** Walks every thread waiting on review, one at a time: goal and summary beside its diff and preview. */
export function ReviewView() {
  const { state } = useHarness();
  const { close } = useReviewMode();
  const threads = reviewThreads(state);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, threads.length - 1));
  const thread = threads[index];
  const step = (by: 1 | -1) => setSelected(stepIndex(index, threads.length, by));
  useReviewKeys(step, close);
  useCloseOnNavigate(close);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ReviewHeader position={thread ? `${index + 1} of ${threads.length}` : undefined} onClose={close} />
      {thread ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 md:grid md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <ReviewSummary key={thread.id} thread={thread} onSkip={() => step(1)} />
          <ReviewSurface key={`surface-${thread.id}`} thread={thread} />
        </div>
      ) : (
        <NothingToReview onClose={close} />
      )}
    </div>
  );
}

function ReviewHeader({ position, onClose }: { position?: string; onClose: () => void }) {
  const { state, isMobile } = useSidebar();
  return (
    <div className="app-drag flex h-11 shrink-0 items-center gap-2 px-3">
      {(isMobile || state === 'collapsed') && <SidebarTrigger className="-ml-1" />}
      <TaskSquare className="size-4 text-muted-foreground" />
      <span className="type-meta font-medium">Review</span>
      {!!position && <span className="tabular type-caption text-subtle-foreground">{position}</span>}
      <span className="flex-1" />
      <KbdGroup className="hidden type-caption text-subtle-foreground md:flex">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        move
        <Kbd className="ml-2">Esc</Kbd>
        close
      </KbdGroup>
      <Button variant="ghost" size="icon-sm" aria-label="Close review" onClick={onClose} className="text-muted-foreground">
        <X />
      </Button>
    </div>
  );
}

function ReviewSummary({ thread, onSkip }: { thread: Thread; onSkip: () => void }) {
  const summary = summarize(thread.activity);
  const latest = thread.activity.findLast((a) => a.kind === 'message' && a.who !== 'you' && a.who !== 'harness');
  const doneCount = thread.steps.filter((s) => s.status === 'done').length;
  const liveSteps = thread.steps.filter((s) => s.status !== 'dropped');

  return (
    <Card size="sm" className="min-h-0">
      <CardHeader>
        <CardDescription className="flex min-w-0 items-center gap-1.5 type-caption">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
          {!!thread.repo && <span className="min-w-0 truncate font-mono">{thread.repo.branch}</span>}
          <ProviderMarks providers={thread.providers} size={12} />
        </CardDescription>
        <CardTitle>{thread.title}</CardTitle>
      </CardHeader>
      <ScrollArea className="min-h-0 flex-1">
        <CardContent className="flex flex-col gap-4">
          <Fact label="Goal">{thread.goal}</Fact>
          {!!latest && <Fact label="Summary">{latest.text}</Fact>}
          <Fact label="Progress">
            <span className="flex items-center gap-3">
              <span className="tabular">
                {doneCount} of {liveSteps.length} steps done
              </span>
              {summary.added + summary.removed > 0 && <DiffStat added={summary.added} removed={summary.removed} />}
            </span>
          </Fact>
          <Fact label="Pull requests">
            {thread.prs.length === 0 ? (
              <span className="text-subtle-foreground">{thread.repo ? 'None yet. Push and open one from the diff.' : 'None. This chat has no project.'}</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {thread.prs.map((pr) => (
                  <li key={pr.number} className="flex min-w-0 items-center gap-2">
                    <PrStateIcon state={pr.state} className="size-3.5" />
                    <span className="tabular">#{pr.number}</span>
                    <span className="min-w-0 truncate">{pr.title}</span>
                    <span className="ml-auto shrink-0 type-caption text-subtle-foreground">{pr.state}</span>
                  </li>
                ))}
              </ul>
            )}
          </Fact>
        </CardContent>
      </ScrollArea>
      <CardFooter>
        <ReviewActions thread={thread} onSkip={onSkip} />
      </CardFooter>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="type-caption text-subtle-foreground">{label}</h3>
      <div className="type-body text-pretty whitespace-pre-line">{children}</div>
    </section>
  );
}

function ReviewActions({ thread, onSkip }: { thread: Thread; onSkip: () => void }) {
  const { state, dispatch } = useHarness();
  const withUndo = useUndoable();
  const { confirm, dialog } = useConfirm();
  const [isRequesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');
  const openPrs = thread.prs.filter((p) => p.state === 'open');

  const approve = async () => {
    const ok = await confirm({
      title: `Approve "${thread.title}"?`,
      description: openPrs.length ? `${openPrs.map((p) => `#${p.number}`).join(', ')} merge and the thread settles.` : 'There is no open pull request; the thread settles as it is.',
      confirm: openPrs.length ? 'Approve and merge' : 'Approve and settle',
      cancel: 'Not yet',
    });
    if (!ok) return;
    const item = state.queue.find((q) => q.kind === 'review' && q.threadId === thread.id);
    withUndo(`Approved ${thread.title}`, () => {
      if (item) dispatch({ type: 'answer', queueId: item.id });
      dispatch({ type: 'settle', threadId: thread.id });
    });
  };

  const requestChanges = () => {
    const text = message.trim();
    if (!text) return;
    withUndo('Changes requested. The agent is back on it.', () => dispatch({ type: 'send', threadId: thread.id, text, drift: 'scope-add', reason: 'review feedback' }));
  };

  if (isRequesting)
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          requestChanges();
        }}
      >
        <Textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isMod(e)) e.currentTarget.form?.requestSubmit();
            if (e.key === 'Escape') setRequesting(false);
          }}
          placeholder="What should the agent change?"
          aria-label="Requested changes"
          className="min-h-20 resize-none text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRequesting(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!message.trim()}>
            Send to agent
          </Button>
        </div>
      </form>
    );

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button size="sm" onClick={approve}>
        <CheckCircle data-icon="inline-start" />
        Approve
      </Button>
      <Button variant="outline" size="sm" onClick={() => setRequesting(true)}>
        <MessageEdit data-icon="inline-start" />
        Request changes
      </Button>
      <Button variant="ghost" size="sm" onClick={onSkip} className="ml-auto text-muted-foreground">
        Skip
        <Next data-icon="inline-end" />
      </Button>
      {dialog}
    </div>
  );
}

/** The thread's Changes and Preview tabs, reused as-is; the preview shares the pane's page when the thread has one. */
function ReviewSurface({ thread }: { thread: Thread }) {
  const { state } = useHarness();
  const pane: Pane = state.panes.find((p) => p.threadId === thread.id) ?? { threadId: thread.id, isOpen: false, tabs: [], activeTab: '' };
  const preview = pane.tabs.find((t) => t.kind === 'browser') ?? reviewPreviewTab(thread);
  const changes: PaneTab = pane.tabs.find((t) => t.kind === 'changes') ?? { id: 'review-changes', kind: 'changes' };

  return (
    <Tabs defaultValue="diff" className="min-h-0 flex-1 gap-0 overflow-hidden rounded-2xl bg-sidebar">
      <TabsList variant="line" className="mx-3 mt-1.5 shrink-0">
        <TabsTrigger value="diff">Diff</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="diff" className="min-h-0">
        <ChangesTab thread={thread} pane={pane} tab={changes} />
      </TabsContent>
      <TabsContent value="preview" className="min-h-0">
        <BrowserTab thread={thread} pane={pane} tab={preview} />
      </TabsContent>
    </Tabs>
  );
}

function reviewPreviewTab(thread: Thread): PaneTab {
  return { id: 'review-preview', kind: 'browser', url: `localhost:3000/${thread.repo?.branch.split('/')[1] ?? ''}` };
}

function NothingToReview({ onClose }: { onClose: () => void }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CheckCircle />
        </EmptyMedia>
        <EmptyTitle>Nothing to review</EmptyTitle>
        <EmptyDescription>Threads land here when every step is done.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onClose}>
          Back to work
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function useReviewKeys(step: (by: 1 | -1) => void, close: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable], [role=dialog], [role=alertdialog]')) return;
      if (e.key === 'j') step(1);
      if (e.key === 'k') step(-1);
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close]);
}

/** Opening a thread, view or space from the sidebar or palette leaves review mode. */
function useCloseOnNavigate(close: () => void) {
  const { state } = useHarness();
  // The layout object changes on every go, focus or split, even when the view it lands on is unchanged.
  const layout = state.layouts[state.spaceId];
  const opened = useRef(layout);
  useEffect(() => {
    if (layout !== opened.current) close();
  }, [layout, close]);
}
