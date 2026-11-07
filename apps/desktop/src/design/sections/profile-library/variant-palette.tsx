import { useState } from 'react';
import { Check, Lock, Search, Sparkles } from '@/icons';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Command as CommandPrimitive } from 'cmdk';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { IconImage } from '../../../IconImage';
import { SpaceIcon } from '../../../ui';
import type { LibItem } from '../../profileLibraryFixtures';
import { KINDS, matches, STATE_LABELS, type ProfileLibrary } from './model';
import { kindLabel, MockFrame, SourceLabel } from './parts';

const DISCOVER_VALUE = '__discover';

/**
 * C · Palette. One keyboard surface for the whole library across profiles, Raycast-style: type to find, Enter toggles
 * the item in the target profile, Tab changes the target, ⌘1–3 toggle a profile directly. The detail pane (wide only)
 * shows every profile's state for the selected item.
 */
export function PaletteVariant({
  lib,
  currentId,
  isNarrow,
}: {
  lib: ProfileLibrary;
  currentId: string;
  isNarrow: boolean;
}) {
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState(currentId);
  const [selected, setSelected] = useState('');
  const target = lib.profiles.find((p) => p.id === targetId) ?? lib.profiles[0];
  const shown = lib.items.filter((i) => matches(i, query));
  const item = lib.items.find((i) => i.id === selected) ?? shown[0];
  const cycleTarget = (step: number) => {
    const at = lib.profiles.findIndex((p) => p.id === target.id);
    const n = lib.profiles.length;
    setTargetId(lib.profiles[(at + step + n) % n].id);
  };
  const toggle = (it: LibItem, profileId: string) =>
    lib.setIn([it], profileId, !lib.isIn(it, profileId));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleTarget(e.shiftKey ? -1 : 1);
      return;
    }
    if (!item || !(e.metaKey || e.ctrlKey)) return;
    const profile = lib.profiles[Number(e.key) - 1];
    if (profile) {
      e.preventDefault();
      toggle(item, profile.id);
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      lib.setIn(
        [item],
        lib.profiles.map((p) => p.id),
        true,
      );
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      lib.setIn(
        [item],
        lib.profiles.map((p) => p.id),
        false,
      );
    }
  };
  return (
    <MockFrame isNarrow={isNarrow} className="p-0 @md:p-0">
      <Command
        shouldFilter={false}
        value={item?.id ?? ''}
        onValueChange={setSelected}
        onKeyDown={onKeyDown}
        className="rounded-xl! p-0"
        label="Library palette"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <CommandPrimitive.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Find a skill, plugin or connector"
            className="min-w-0 flex-1 bg-transparent type-body outline-none placeholder:text-subtle-foreground"
          />
          <button
            type="button"
            onClick={() => cycleTarget(1)}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 type-caption outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Target profile: ${target.name}. Tab changes it.`}
          >
            <SpaceIcon space={target} className="size-3" />
            {target.name}
          </button>
        </div>
        <div className="flex min-h-0">
          <CommandList className="max-h-96 min-h-72 flex-1 p-1">
            {lib.isFirstRun && !query && (
              <CommandGroup heading="Get started">
                <CommandItem value={DISCOVER_VALUE}>
                  <Sparkles className="text-muted-foreground" />
                  Find skills, plugins and connectors in Discover
                </CommandItem>
              </CommandGroup>
            )}
            {KINDS.map(([k, label]) => {
              const rows = shown.filter((i) => i.kind === k);
              if (!rows.length) return null;
              return (
                <CommandGroup key={k} heading={label}>
                  {rows.map((it) => (
                    <PaletteRow
                      key={it.id}
                      lib={lib}
                      item={it}
                      targetId={target.id}
                      onToggle={() => toggle(it, target.id)}
                    />
                  ))}
                </CommandGroup>
              );
            })}
            {!!query && (
              <CommandGroup heading="Discover">
                <CommandItem value={DISCOVER_VALUE}>
                  <Search className="text-muted-foreground" />
                  <span className="truncate">{`Search Discover for “${query}”`}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          {!!item && (
            <Detail lib={lib} item={item} onToggle={(id) => toggle(item, id)} />
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2 type-caption text-muted-foreground">
          <span className="truncate">
            {item
              ? `${item.name}: ${STATE_LABELS[lib.stateOf(item, target.id)]} in ${target.name}`
              : 'Nothing selected'}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd>
              Toggle
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>⇥</Kbd>
              Profile
            </span>
            <span className="hidden items-center gap-1 @md:inline-flex">
              <Kbd>⌘1–3</Kbd>
              One profile
            </span>
          </span>
        </div>
      </Command>
    </MockFrame>
  );
}

/** Icon, name, kind and source; on the right a mark per profile: lit where it loads, faint where not, absent on another account. */
function PaletteRow({
  lib,
  item,
  targetId,
  onToggle,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  targetId: string;
  onToggle: () => void;
}) {
  const isIn = lib.isIn(item, targetId);
  return (
    <CommandItem value={item.id} onSelect={onToggle} className="gap-2.5 py-1.5">
      <SmallTile item={item} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate', !isIn && 'text-muted-foreground')}>
          {item.name}
        </span>
        <span className="block truncate type-caption text-subtle-foreground">
          {kindLabel(item)} · <SourceLabel source={item.source} />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
        {lib.profiles.map((p) => {
          const state = lib.stateOf(item, p.id);
          if (state === 'other-account')
            return <span key={p.id} className="size-3.5" />;
          return (
            <SpaceIcon
              key={p.id}
              space={p}
              className={cn(
                'size-3.5',
                lib.isIn(item, p.id)
                  ? 'text-foreground'
                  : 'text-subtle-foreground opacity-40',
                p.id === targetId && 'text-foreground',
              )}
            />
          );
        })}
      </span>
      <span className="sr-only">
        {lib.profiles
          .map((p) => `${p.name}: ${STATE_LABELS[lib.stateOf(item, p.id)]}`)
          .join(', ')}
      </span>
    </CommandItem>
  );
}

function SmallTile({ item }: { item: LibItem }) {
  const letter = (
    <span className="type-caption font-semibold text-muted-foreground uppercase">
      {(item.service ?? item.name)[0]}
    </span>
  );
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background"
    >
      {item.icon ? (
        <IconImage
          src={item.icon}
          fallback={letter}
          className="size-4.5 rounded-sm"
        />
      ) : (
        letter
      )}
    </span>
  );
}

/** The selected item's every profile, with its shortcut, and the all-at-once actions. */
function Detail({
  lib,
  item,
  onToggle,
}: {
  lib: ProfileLibrary;
  item: LibItem;
  onToggle: (profileId: string) => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-4 border-l p-4 @2xl:flex">
      <div className="flex flex-col gap-1">
        <span className="type-title">{item.name}</span>
        <span className="type-caption text-muted-foreground">
          {item.description}
        </span>
        <span className="type-caption break-all text-subtle-foreground">
          {item.where}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span className="type-caption font-medium text-muted-foreground">
          Profiles
        </span>
        {lib.profiles.map((p, n) => {
          const state = lib.stateOf(item, p.id);
          const isOn = lib.isIn(item, p.id);
          return (
            <button
              key={p.id}
              type="button"
              tabIndex={-1}
              disabled={!lib.canChange(item, p.id)}
              onClick={() => onToggle(p.id)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left type-meta transition-colors hover:bg-accent disabled:hover:bg-transparent"
            >
              <span className="flex size-4 items-center justify-center">
                {state === 'locked' ? (
                  <Lock className="size-3.5 text-muted-foreground" />
                ) : (
                  isOn && <Check className="size-3.5" />
                )}
              </span>
              <SpaceIcon space={p} className="size-3.5" />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="type-caption text-subtle-foreground">
                {lib.canChange(item, p.id) ? `⌘${n + 1}` : STATE_LABELS[state]}
              </span>
            </button>
          );
        })}
      </div>
      {item.source !== 'mochi' && (
        <p className="type-caption text-muted-foreground">
          {`On by default. Turning it off is in Mochi only: ${item.source === 'codex' ? 'Codex' : 'Claude Code'} keeps loading it.`}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-1 type-caption text-muted-foreground">
        <span className="flex items-center justify-between">
          Add to every profile <Kbd>⌘⇧↵</Kbd>
        </span>
        <span className="flex items-center justify-between">
          Remove from every profile <Kbd>⌘⌫</Kbd>
        </span>
      </div>
    </aside>
  );
}
