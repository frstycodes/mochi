import { useState } from 'react';
import { Archive, Chat, Refresh, Search, Trash } from '@/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { plural } from '@mochi/domain/lib/format';
import type { Thread } from '../model';
import { ProjectIcon } from '../ProjectIcon';
import { timeAgo } from '../progress';
import { useProjectAt } from '../projects';
import {
  matchesProjectFilter,
  NO_PROJECT,
  useProjectFilter,
} from '../projectFilter';
import { settledThreads } from '../reorder';
import { openSettings } from '../routes/nav';
import { SettingsCard, SettingsSection } from '../settings/parts';
import { useDispatch, useHarnessSelector, useSpaceListing } from '../store';
import { useNow } from '../useNow';
import { OverflowIcon } from '../ui';
import { toggleSettle } from '../useSettle';
import { requestDelete } from './DeleteThreads';
import { groupByDate, matchesQuery, settledMsOf } from './settled';

/** Rows the page renders before Show more. */
const PAGE = 50;

/** Every settled thread in this space, newest first under date headings, with search and bulk Reactivate and Delete. */
export function SettledView() {
  const page = useSettledPage();
  const dispatch = useDispatch();
  const selected = page.threads.filter((t) => page.selectedIds.has(t.id));
  const isFilteredEmpty = page.total > 0 && page.matchCount === 0;

  return (
    <ScrollArea type="scroll" className="h-full">
      <div className="mx-auto flex w-full max-w-180 flex-col gap-6 px-4 pt-6 pb-16 md:px-8 md:pt-8">
        <header className="flex items-end justify-between gap-3 px-1">
          <h1 className="type-display">
            Settled
            {page.total > 0 && (
              <span className="ml-2 font-normal text-subtle-foreground tabular">
                {page.total}
              </span>
            )}
          </h1>
        </header>
        {!!page.filterName && (
          <p className="-mt-3 px-1 type-meta text-muted-foreground">
            Showing {page.filterName} only, as the sidebar does.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={page.clearFilter}
            >
              Show all projects
            </button>
          </p>
        )}
        {page.total === 0 && <NoSettled />}
        {page.total > 0 && (
          <div className="flex flex-col gap-3">
            <InputGroup className="h-8">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={page.query}
                onChange={(e) => page.setQuery(e.target.value)}
                placeholder="Search by title, branch or PR"
                aria-label="Search settled threads"
              />
            </InputGroup>
            <div className="flex min-h-7 items-center gap-3 px-4">
              <Checkbox
                checked={page.allState}
                onCheckedChange={page.toggleAll}
                disabled={page.matchCount === 0}
                aria-label="Select every thread shown"
              />
              <span className="flex-1 type-meta text-muted-foreground tabular">
                {selected.length > 0
                  ? `${selected.length} selected`
                  : plural(
                      page.matchCount,
                      '1 thread',
                      `${page.matchCount} threads`,
                    )}
              </span>
              {selected.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      toggleSettle(selected, dispatch);
                      page.clearSelection();
                    }}
                  >
                    <Refresh data-icon="inline-start" />
                    Reactivate
                  </Button>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => requestDelete(selected.map((t) => t.id))}
                  >
                    <Trash data-icon="inline-start" />
                    Delete…
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        {isFilteredEmpty && (
          <p className="px-1 py-6 text-center type-meta text-muted-foreground">
            No settled thread matches “{page.query.trim()}”.
          </p>
        )}
        {page.groups.map((group) => (
          <SettingsSection key={group.label} title={group.label}>
            <SettingsCard>
              {group.threads.map((t) => (
                <SettledRow
                  key={t.id}
                  thread={t}
                  now={page.now}
                  isSelected={page.selectedIds.has(t.id)}
                  onSelect={(isOn) => page.select(t.id, isOn)}
                />
              ))}
            </SettingsCard>
          </SettingsSection>
        ))}
        {page.hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            onClick={page.showMore}
          >
            Show {Math.min(PAGE, page.hiddenCount)} more
          </Button>
        )}
        {page.total > 0 && (
          <p className="px-1 type-caption text-muted-foreground">
            Settled threads keep their history until you delete them.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => openSettings('general', 'settledCleanup')}
            >
              Delete them automatically
            </button>
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

/**
 * The page's settled threads, narrowed to the sidebar's project filter and the search, cut to the shown rows and grouped by
 * date, with the selection.
 */
function useSettledPage() {
  const spaceId = useHarnessSelector((s) => s.spaceId);
  const listing = useSpaceListing(spaceId);
  const projectFilter = useProjectFilter(spaceId, listing);
  const { selected: filter } = projectFilter;
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const now = useNow(60_000);

  const threads = settledThreads(listing).filter((t) =>
    matchesProjectFilter(t, filter),
  );
  const matches = threads.filter((t) => matchesQuery(t, query));
  const shown = matches.slice(0, limit);
  const shownSelected = shown.filter((t) => selectedIds.has(t.id)).length;
  const select = (id: string, isOn: boolean) =>
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (isOn) next.add(id);
      else next.delete(id);
      return next;
    });

  return {
    now,
    filterName:
      filter === NO_PROJECT
        ? 'threads without a project'
        : projectFilter.options.find((o) => o.ref === filter)?.name,
    clearFilter: () => projectFilter.select(null),
    query,
    setQuery: (q: string) => {
      setQuery(q);
      setLimit(PAGE);
    },
    threads,
    total: threads.length,
    matchCount: matches.length,
    hiddenCount: matches.length - shown.length,
    groups: groupByDate(shown, now),
    showMore: () => setLimit((n) => n + PAGE),
    selectedIds,
    select,
    clearSelection: () => setSelectedIds(new Set()),
    allState:
      shownSelected === 0
        ? false
        : shownSelected === shown.length
          ? true
          : ('indeterminate' as const),
    toggleAll: () =>
      setSelectedIds(
        shownSelected === shown.length
          ? new Set()
          : new Set(shown.map((t) => t.id)),
      ),
  };
}

function SettledRow({
  thread,
  now,
  isSelected,
  onSelect,
}: {
  thread: Thread;
  now: number;
  isSelected: boolean;
  onSelect: (isOn: boolean) => void;
}) {
  const dispatch = useDispatch();
  const project = useProjectAt(thread.spaceId, thread.repo?.path);
  const ms = settledMsOf(thread);
  const lastPr = thread.prs.at(-1);
  const open = () =>
    dispatch({ type: 'go', view: { kind: 'thread', id: thread.id } });

  return (
    <div className="relative flex items-center gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border">
      <Checkbox
        checked={isSelected}
        onCheckedChange={(checked) => onSelect(checked === true)}
        aria-label={`Select ${thread.title}`}
      />
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="w-full truncate type-body font-medium text-foreground">
          {thread.title}
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 type-caption text-muted-foreground">
          <span
            className="flex size-3.5 shrink-0 items-center justify-center [&>*]:scale-[0.875]"
            title={thread.repo?.project ?? 'No project'}
          >
            {thread.repo ? (
              <ProjectIcon name={thread.repo.project} icon={project?.icon} />
            ) : (
              <Chat aria-label="No project" className="size-4 shrink-0" />
            )}
          </span>
          <span className="shrink-0">
            {ms === undefined
              ? 'Settled'
              : `Settled ${timeAgo((now - ms) / 60_000)}`}
          </span>
          {!!thread.repo && (
            <span className="min-w-0 truncate">· {thread.repo.branch}</span>
          )}
          {!!lastPr && (
            <span className="shrink-0 tabular">
              · #{lastPr.number} {lastPr.state}
            </span>
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`${thread.title} actions`}
          >
            <OverflowIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={open}>Open thread</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleSettle([thread], dispatch)}>
            <Refresh />
            Reactivate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => requestDelete([thread.id])}
          >
            <Trash />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NoSettled() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Archive />
        </EmptyMedia>
        <EmptyTitle>No settled threads</EmptyTitle>
        <EmptyDescription>
          Settle a thread once its work is done. It moves here with its history,
          and you can reactivate it any time.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
