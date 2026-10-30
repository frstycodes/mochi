import { Fragment, useState } from 'react';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { toast } from '@/toast/store';
import { SubThreadGuide } from '../goals/SubThreads';
import type { Thread } from '../model';
import { MachinesProvider } from '../remote/useMachines';
import { RowSwipe } from '../RowSwipe';
import { ROW_EXIT, ThreadItem } from '../Sidebar';
import { snoozeTimes } from '../snooze';
import { HarnessProvider, useHarness } from '../store';
import { verdictFixtures } from './verdictFixtures';

// GAP: throwaway mock route (#thread-rows) for the sidebar row redesign; delete once snoozing ships.
export function ThreadRowsPage() {
  return (
    <HarnessProvider>
      <MachinesProvider>
        <ScrollArea className="h-full">
          <ThreadRows />
        </ScrollArea>
      </MachinesProvider>
    </HarnessProvider>
  );
}

interface Entry {
  thread: Thread;
  caption: string;
  isSub?: boolean;
  isLast?: boolean;
  isActive?: boolean;
}

function ThreadRows() {
  const { state } = useHarness();
  const rl = state.threads.find((t) => t.id === 'rl')!;
  const [snoozed, setSnoozed] = useState<
    Record<string, Thread['snoozedUntil']>
  >(() => initialSnoozes());
  const [settled, setSettled] = useState<string[]>([]);
  const groups = rowGroups(rl, snoozed, settled);
  const snooze = (id: string) => (until: Thread['snoozedUntil']) => {
    setSnoozed((s) => ({ ...s, [id]: until }));
    toast(until === undefined ? 'Unsnoozed' : 'Snoozed');
  };
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header className="flex items-center gap-3">
        <h1 className="type-heading flex-1">Sidebar thread rows</h1>
        <ThemeButtons />
      </header>
      <p className="type-body text-muted-foreground">
        The real `ThreadItem` in every state. Hover a row for Snooze and Settle,
        or drag it sideways: right snoozes until tomorrow, left settles. A short
        drag slides back unless it was a flick.
      </p>
      <SidebarProvider className="min-h-0">
        <div
          data-sidebar="sidebar"
          className="grid w-full grid-cols-[288px_minmax(0,1fr)] overflow-hidden rounded-xl border"
        >
          {groups.map((group) => (
            <Fragment key={group.label}>
              <div className="bg-sidebar px-2 pt-4 text-sidebar-foreground">
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              </div>
              <div />
              <AnimatePresence initial={false} custom={false}>
                {group.entries.map((e) => (
                  <motion.div
                    key={e.thread.id}
                    variants={ROW_EXIT}
                    exit="exit"
                    className="col-span-2 grid grid-cols-subgrid"
                  >
                    <div className="overflow-hidden bg-sidebar px-2 text-sidebar-foreground">
                      <SidebarMenu>
                        <SidebarMenuItem className={e.isSub ? 'pl-[27px]' : ''}>
                          {e.isSub && (
                            <SubThreadGuide
                              isLast={!!e.isLast}
                              className="left-[15px]"
                            />
                          )}
                          <RowSwipe
                            onSnooze={() =>
                              snooze(e.thread.id)(snoozeTimes()[1].at)
                            }
                            onSettle={() => {
                              setSettled((s) => [...s, e.thread.id]);
                              toast('Settled');
                            }}
                          >
                            <ThreadItem
                              thread={e.thread}
                              isSub={e.isSub}
                              isActive={!!e.isActive}
                              onSelect={() => toast(e.caption)}
                              onSnooze={snooze(e.thread.id)}
                            />
                          </RowSwipe>
                        </SidebarMenuItem>
                      </SidebarMenu>
                    </div>
                    <div className="flex items-center px-4 type-meta text-muted-foreground">
                      {e.caption}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </Fragment>
          ))}
          <div className="h-3 bg-sidebar" />
          <div />
        </div>
      </SidebarProvider>
    </main>
  );
}

function ThemeButtons() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <div className="flex gap-1">
      {(['light', 'dark'] as const).map((t) => (
        <Button
          key={t}
          size="sm"
          variant={resolvedTheme === t ? 'secondary' : 'ghost'}
          onClick={() => setTheme(t)}
        >
          {t === 'light' ? 'Light' : 'Dark'}
        </Button>
      ))}
    </div>
  );
}

const TOMORROW_9 = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
})();

function initialSnoozes(): Record<string, Thread['snoozedUntil']> {
  return { 'mock-snooze-time': TOMORROW_9, 'mock-snooze-asks': 'needs-you' };
}

/** Pinned, Threads (every verdict, unread, a sub-thread family), Snoozed and Settled, from the demo `rl` thread and the verdict fixtures. */
function rowGroups(
  rl: Thread,
  snoozed: Record<string, Thread['snoozedUntil']>,
  settled: string[],
) {
  const fixtures = verdictFixtures(rl);
  const fixture = (label: string) => fixtures.find((f) => f.label === label)!;
  const seen = (t: Thread) => ({ ...t, seenActivity: t.activity.length });
  const pr = (number: number, state: 'open' | 'merged' | 'draft') => ({
    number,
    state,
    title: `PR ${number}`,
  });
  const make = (
    id: string,
    from: Thread,
    patch: Partial<Thread> = {},
  ): Thread => ({ ...seen(from), id, subagents: [], ...patch });

  const parent = make('mock-parent', fixture('Done · in review').thread, {
    title: 'Remote device architecture design',
  });
  const all: Entry[] = [
    {
      thread: make('mock-working', rl, { subagents: rl.subagents }),
      caption: 'Working · pinned and open: pulse, shimmer, agents',
      isActive: true,
    },
    ...fixtures.map((f, i) => ({
      thread: make(`mock-verdict-${i}`, f.thread),
      caption: f.label,
    })),
    {
      thread: {
        ...make('mock-unread', fixture('Done · merged').thread, {
          title: 'Unread: finished while you were away',
        }),
        seenActivity: 0,
      },
      caption: 'Done · unread',
    },
    { thread: parent, caption: 'Parent with three sub-threads' },
    {
      thread: make('mock-sub-working', rl, {
        title: 'PR 13: Backends registry in the app',
        parent: { threadId: parent.id },
        prs: [pr(141, 'draft')],
      }),
      caption: 'Sub · working, draft PR',
      isSub: true,
    },
    {
      thread: make(
        'mock-sub-asks',
        fixture('Needs you · asked in prose').thread,
        {
          title: 'PR 14: Pair a phone over the relay',
          parent: { threadId: parent.id },
          prs: [pr(142, 'open')],
        },
      ),
      caption: 'Sub · needs you, second line only now',
      isSub: true,
    },
    {
      thread: make('mock-sub-done', fixture('Done · merged').thread, {
        title: 'PR 15: Machine filter per window over the merged views',
        parent: { threadId: parent.id },
        prs: [pr(143, 'merged'), pr(144, 'open')],
      }),
      caption: 'Sub · done, two PRs, long title',
      isSub: true,
      isLast: true,
    },
    {
      thread: make('mock-snooze-time', fixture('Done · no PR yet').thread, {
        title: 'Thread view extra widgets',
      }),
      caption: 'Snoozed to a time · wakes unread',
    },
    {
      thread: make('mock-snooze-asks', rl, {
        title: 'Find undersized UI elements',
      }),
      caption: 'Snoozed until it needs you · keeps working',
    },
  ];
  const withSnooze = all.map((e) => ({
    ...e,
    thread: { ...e.thread, snoozedUntil: snoozed[e.thread.id] },
  }));
  const isSnoozed = (e: Entry) =>
    !e.isSub && e.thread.snoozedUntil !== undefined;
  const isSettled = (e: Entry) => settled.includes(e.thread.id);
  const rest = withSnooze.slice(1).filter((e) => !isSettled(e));
  return [
    { label: 'Pinned', entries: withSnooze.slice(0, 1) },
    { label: 'Threads', entries: rest.filter((e) => !isSnoozed(e)) },
    { label: 'Snoozed', entries: rest.filter(isSnoozed) },
    {
      label: 'Settled',
      entries: withSnooze
        .filter(isSettled)
        .map((e) => ({ ...e, isSub: false })),
    },
  ];
}
