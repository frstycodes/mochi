import { useState } from 'react';
import { Book, Search } from '@/icons';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { revealMessage } from '../chat/Transcript';
import type { Thread } from '../model';
import {
  PaneSection,
  PaneSectionHeader,
  PaneSectionTitle,
} from '../pane/PaneList';
import { useDispatch } from '../store';
import { ThreadAgentMark } from '../threadRow';
import {
  LOGBOOK_KINDS,
  LOGBOOK_LABELS,
  LogbookRows,
  type Logbook,
  type LogbookKind,
} from './LogbookRows';
import { removeAnswer } from './marks';
import { useSpaceLogbooks } from './useLogbook';

/** Every thread's answers, decisions and deferred work in this space, one kind at a time, grouped by thread. */
export function LogbookView() {
  const page = useLogbookPage();
  const dispatch = useDispatch();
  const open = (thread: Thread, index?: number, about?: string) => {
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });
    if (index !== undefined) revealMessage(thread.id, index, about);
  };
  const isEmpty = page.total === 0;
  const isFilteredEmpty = !isEmpty && page.groups.length === 0;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-180 flex-col gap-6 px-4 pt-6 pb-16 md:px-8 md:pt-8">
        <header className="px-1">
          <h1 className="type-display">Logbook</h1>
        </header>
        <div className="flex flex-col gap-3">
          <Tabs
            value={page.kind}
            onValueChange={(kind) => page.setKind(kind as LogbookKind)}
          >
            <TabsList>
              {LOGBOOK_KINDS.map((kind) => (
                <TabsTrigger key={kind} value={kind} className="px-2.5">
                  {LOGBOOK_LABELS[kind]}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {page.counts[kind]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {!isEmpty && (
            <InputGroup className="h-8">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={page.query}
                onChange={(e) => page.setQuery(e.target.value)}
                placeholder={`Search ${LOGBOOK_LABELS[page.kind].toLowerCase()}`}
                aria-label={`Search ${LOGBOOK_LABELS[page.kind].toLowerCase()}`}
              />
            </InputGroup>
          )}
        </div>
        {isEmpty && <NoEntries kind={page.kind} />}
        {isFilteredEmpty && (
          <p className="px-1 py-6 text-center type-meta text-muted-foreground">
            Nothing matches “{page.query.trim()}”.
          </p>
        )}
        {page.groups.map(({ thread, log }) => (
          <PaneSection key={thread.id}>
            <PaneSectionHeader className="h-7">
              <PaneSectionTitle className="min-w-0 type-body text-foreground">
                <button
                  type="button"
                  onClick={() => open(thread)}
                  className="flex min-w-0 items-center gap-2 rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <ThreadAgentMark thread={thread} />
                  <span className="truncate">{thread.title}</span>
                </button>
              </PaneSectionTitle>
            </PaneSectionHeader>
            <LogbookRows
              kind={page.kind}
              log={log}
              now={page.now}
              onOpen={(index, about) => open(thread, index, about)}
              onRemove={(answer) => removeAnswer(thread.id, answer)}
            />
          </PaneSection>
        ))}
      </div>
    </ScrollArea>
  );
}

function useLogbookPage() {
  const { logs, now } = useSpaceLogbooks();
  const [kind, setKind] = useState<LogbookKind>('answers');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const counts = Object.fromEntries(
    LOGBOOK_KINDS.map((k) => [
      k,
      logs.reduce((n, { log }) => n + log[k].length, 0),
    ]),
  ) as Record<LogbookKind, number>;
  const groups = logs
    .map(({ thread, log }) => ({
      thread,
      log: needle ? matching(log, thread, needle) : log,
    }))
    .filter(({ log }) => log[kind].length > 0)
    .sort((a, b) => newest(b.log, kind) - newest(a.log, kind));

  return {
    now,
    kind,
    setKind,
    query,
    setQuery,
    counts,
    groups,
    total: counts[kind],
  };
}

const newest = (log: Logbook, kind: LogbookKind) =>
  Math.max(...log[kind].map((item) => item.at));

/** `log` cut to the rows whose text holds `needle`; a thread whose title matches keeps them all. */
function matching(log: Logbook, thread: Thread, needle: string): Logbook {
  if (thread.title.toLowerCase().includes(needle)) return log;
  const has = (...texts: string[]) =>
    texts.some((t) => t.toLowerCase().includes(needle));
  return {
    answers: log.answers.filter((a) => has(a.question, a.summary)),
    decisions: log.decisions.filter((d) => has(d.text)),
    proposals: log.proposals.filter((p) => has(p.title, p.brief)),
  };
}

const EMPTY_COPY = {
  answers: [
    'No answers yet',
    'When you ask how something works or why it is the way it is, the answer is listed here with a link back to the reply. You can also save any reply from its actions.',
  ],
  decisions: [
    'No decisions yet',
    'Choices the agent made that you could have made differently, and the assumptions it filled gaps with, are listed here as its turns end.',
  ],
  proposals: [
    'Nothing set aside',
    'Threads the agent suggested that were dismissed, expired or are still waiting are listed here.',
  ],
} satisfies Record<LogbookKind, [title: string, description: string]>;

function NoEntries({ kind }: { kind: LogbookKind }) {
  const [title, description] = EMPTY_COPY[kind];
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Book />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
