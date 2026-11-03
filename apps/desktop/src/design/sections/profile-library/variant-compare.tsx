import { Fragment, useEffect, useRef, useState } from 'react';
import { Copy, Lock, Minus, Plus } from '@/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { OverflowIcon, SpaceIcon } from '../../../ui';
import type { Space } from '../../../model';
import type { LibItem } from '../../profileLibraryFixtures';
import {
  byService,
  KINDS,
  matches,
  STATE_LABELS,
  type ProfileLibrary,
} from './model';
import {
  KeyHints,
  KindChips,
  kindLabel,
  MockFrame,
  onSlashSearch,
  SearchField,
  SourceLabel,
  type KindFilter,
} from './parts';

/**
 * D · Compare. Items down, profiles across, a tick per cell. Shows how profiles differ, copies one profile's set into
 * another, and starts a new profile from one. Connector accounts get a row each, so which Gmail is in which profile
 * reads straight off the grid. Below the container's `xl`, two profiles side by side, picked at the top.
 */
export function CompareVariant({
  lib,
  isNarrow,
}: {
  lib: ProfileLibrary;
  isNarrow: boolean;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [isDiffOnly, setDiffOnly] = useState(false);
  const [pair, setPair] = useState(['personal', 'work']);
  const differs = (i: LibItem) => {
    const states = lib.profiles
      .filter((p) => lib.stateOf(i, p.id) !== 'other-account')
      .map((p) => lib.isIn(i, p.id));
    return new Set(states).size > 1;
  };
  const shown = lib.items.filter(
    (i) =>
      (kind === 'all' || i.kind === kind) &&
      matches(i, query) &&
      (!isDiffOnly || differs(i)),
  );
  const isPaired = (p: Space) => pair.includes(p.id);
  const grid = useRef<HTMLTableElement>(null);
  // One tab stop: when no cell holds it (first render, or its row was filtered out), the first visible cell takes it.
  useEffect(() => {
    const cells = [
      ...(grid.current?.querySelectorAll<HTMLElement>('[data-grid-cell]') ??
        []),
    ];
    if (cells.some((c) => c.tabIndex === 0 && c.offsetParent)) return;
    const first = cells.find((c) => c.offsetParent);
    if (first) first.tabIndex = 0;
  });
  return (
    <MockFrame isNarrow={isNarrow}>
      <div className="flex flex-col gap-4" onKeyDown={onSlashSearch}>
        <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search every profile"
            className="@xl:w-56"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 @xl:flex-1">
            <div className="no-scrollbar overflow-x-auto">
              <KindChips value={kind} onChange={setKind} />
            </div>
            <Toggle
              size="sm"
              variant="outline"
              pressed={isDiffOnly}
              onPressedChange={setDiffOnly}
            >
              Only differences
            </Toggle>
          </div>
        </div>
        <div className="flex items-center gap-2 @xl:hidden">
          {[0, 1].map((side) => (
            <Fragment key={side}>
              {side === 1 && (
                <span className="type-caption text-muted-foreground">with</span>
              )}
              <Select
                value={pair[side]}
                onValueChange={(id) =>
                  setPair((p) => (side ? [p[0], id] : [id, p[1]]))
                }
              >
                <SelectTrigger
                  size="sm"
                  className="min-w-0 flex-1"
                  aria-label={side ? 'Second profile' : 'First profile'}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lib.profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <SpaceIcon space={p} />
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Fragment>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table
            ref={grid}
            className="w-full border-collapse"
            onKeyDown={moveInGrid}
          >
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left type-caption font-medium text-muted-foreground">
                  Item
                </th>
                {lib.profiles.map((p) => (
                  <th
                    key={p.id}
                    className={cn(
                      'w-12 px-1 py-2 @md:w-24 @xl:w-28',
                      !isPaired(p) && 'hidden @xl:table-cell',
                    )}
                  >
                    <ColumnHead lib={lib} profile={p} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!shown.length && (
                <tr>
                  <td colSpan={lib.profiles.length + 1}>
                    <Empty className="py-8">
                      <EmptyDescription>
                        {isDiffOnly && !query
                          ? 'Every profile loads the same here'
                          : 'Nothing matches'}
                      </EmptyDescription>
                    </Empty>
                  </td>
                </tr>
              )}
              {KINDS.map(([k, label]) => {
                const rows = shown.filter((i) => i.kind === k);
                if (!rows.length) return null;
                return (
                  <Fragment key={k}>
                    <GroupRow label={label} span={lib.profiles.length + 1} />
                    {k === 'connector'
                      ? byService(rows).map((g) =>
                          g.members[0].service ? (
                            <Fragment key={g.key}>
                              <GroupRow
                                label={g.name}
                                span={lib.profiles.length + 1}
                                isSub
                              />
                              {g.members.map((acct) => (
                                <GridRow
                                  key={acct.id}
                                  lib={lib}
                                  item={acct}
                                  isPaired={isPaired}
                                />
                              ))}
                            </Fragment>
                          ) : (
                            <GridRow
                              key={g.key}
                              lib={lib}
                              item={g.members[0]}
                              isPaired={isPaired}
                            />
                          ),
                        )
                      : rows.map((item) => (
                          <GridRow
                            key={item.id}
                            lib={lib}
                            item={item}
                            isPaired={isPaired}
                          />
                        ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-1 type-caption text-muted-foreground">
          Claude Code and Codex items are ticked until turned off, in Mochi
          only. A dash: that profile runs on another account, so it never loads
          the item.
        </p>
        <KeyHints
          hints={[
            ['←↑↓→', 'Move between cells'],
            ['Space', 'Toggle'],
            ['/', 'Search'],
          ]}
        />
      </div>
    </MockFrame>
  );
}

function GroupRow({
  label,
  span,
  isSub,
}: {
  label: string;
  span: number;
  isSub?: boolean;
}) {
  return (
    <tr>
      <th
        colSpan={span}
        scope="colgroup"
        className={cn(
          'px-3 text-left font-medium',
          isSub
            ? 'pt-2 pb-0.5 pl-6 type-caption text-muted-foreground'
            : 'bg-muted/40 py-1.5 type-caption text-foreground',
        )}
      >
        {label}
      </th>
    </tr>
  );
}

/** A profile's column head: its name, how many items it loads, and copying into or from it. */
function ColumnHead({ lib, profile }: { lib: ProfileLibrary; profile: Space }) {
  const count = lib.items.filter((i) => lib.isIn(i, profile.id)).length;
  const others = lib.profiles.filter((p) => p.id !== profile.id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto w-full flex-col gap-0 py-1"
          aria-label={`${profile.name}, ${count} items. Actions`}
        >
          <span className="flex max-w-full items-center gap-1">
            <SpaceIcon space={profile} className="size-3.5 shrink-0" />
            <span className="hidden truncate @md:inline">{profile.name}</span>
            <OverflowIcon
              vertical
              className="hidden size-3 shrink-0 text-subtle-foreground @md:block"
            />
          </span>
          <span className="type-caption font-normal text-subtle-foreground tabular">
            {count}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-60">
        <DropdownMenuLabel>{`Make ${profile.name} match`}</DropdownMenuLabel>
        {others.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => lib.copyAll(p.id, profile.id)}
          >
            <Copy />
            {`Copy ${p.name}’s set`}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => lib.duplicate(profile.id)}>
          <Plus />
          {`New profile from ${profile.name}`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GridRow({
  lib,
  item,
  isPaired,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  isPaired: (p: Space) => boolean;
}) {
  return (
    <tr data-grid-row className="border-t border-border/60">
      <td className="max-w-0 px-3 py-1.5">
        <span
          className={cn('block truncate type-meta', item.service && 'pl-3')}
        >
          {item.service ? item.account : item.name}
        </span>
        <span className="hidden truncate type-caption text-subtle-foreground @md:block">
          {kindLabel(item)} · <SourceLabel source={item.source} />
        </span>
      </td>
      {lib.profiles.map((p) => (
        <td
          key={p.id}
          className={cn('text-center', !isPaired(p) && 'hidden @xl:table-cell')}
        >
          <Cell lib={lib} item={item} profile={p} />
        </td>
      ))}
    </tr>
  );
}

/** A tick where the profile can choose; a lock where it can't turn the item off; a dash on another account. */
function Cell({
  lib,
  item,
  profile,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  profile: Space;
}) {
  const state = lib.stateOf(item, profile.id);
  const label = `${item.name} in ${profile.name}: ${STATE_LABELS[state]}`;
  if (state === 'locked' || state === 'other-account')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-grid-cell
            tabIndex={-1}
            aria-label={label}
            className="inline-flex size-7 items-center justify-center rounded-md text-subtle-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {state === 'locked' ? (
              <Lock className="size-3.5" />
            ) : (
              <Minus className="size-3.5" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {state === 'locked'
            ? item.lockedReason
            : `${profile.name} runs on another account, so it never loads this.`}
        </TooltipContent>
      </Tooltip>
    );
  return (
    <span className="inline-flex size-7 items-center justify-center">
      <Checkbox
        data-grid-cell
        tabIndex={-1}
        checked={lib.isIn(item, profile.id)}
        onCheckedChange={(isOn) => lib.setIn([item], profile.id, isOn === true)}
        aria-label={label}
      />
    </span>
  );
}

/**
 * Arrow keys move focus between visible cells, and the tab stop moves with it. Hidden columns (narrow) are skipped
 * because they have no layout box.
 */
function moveInGrid(e: React.KeyboardEvent<HTMLTableElement>) {
  const moves = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  };
  const move = moves[e.key as keyof typeof moves];
  const from = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-grid-cell]',
  );
  if (!move || !from) return;
  e.preventDefault();
  const rows = [...e.currentTarget.querySelectorAll('[data-grid-row]')].map(
    (row) =>
      [...row.querySelectorAll<HTMLElement>('[data-grid-cell]')].filter(
        (c) => c.offsetParent,
      ),
  );
  const r = rows.findIndex((cells) => cells.includes(from));
  const c = rows[r].indexOf(from);
  const next =
    rows[Math.min(Math.max(r + move[0], 0), rows.length - 1)]?.[
      Math.min(Math.max(c + move[1], 0), rows[r].length - 1)
    ];
  if (!next) return;
  from.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}
