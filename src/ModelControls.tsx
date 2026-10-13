import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Search, Star } from 'reicon-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import type { AgentModel } from './host/types/agent';
import { effortFor, effortName, optionFor, searchModels, type ModelOption } from './runtime/models';
import { setPrefs, usePrefs } from './settings/prefs';
import { ScrollDock, WheelStepper } from './ScrollDock';
import { host } from './host';
import type { AgentInstall } from './host/types/settings';
import { linkedAccountId } from './settings/accounts';
import { HARNESS_IDS, HARNESSES } from './settings/harnesses';
import { useSpace } from './store';
import { ProviderMark } from './ui';

/**
 * `isLocked` keeps the list to `provider`: a live thread changes provider only through a handoff. `unavailable` greys out
 * a harness's models with the reason (not installed, signed out) and keeps them off the dock. The lists are the profile's
 * accounts' own (`useModels`); a stored model the account no longer offers shows as Unavailable.
 */
export function ModelPicker({ id, value, provider, isLocked, unavailable = {}, onChange }: { id?: string; value: string; provider: Provider; isLocked?: boolean; unavailable?: Unavailable; onChange: (model: ModelOption) => void }) {
  const space = useSpace();
  const catalog = useModels(space.id);
  const defaults = useDefaultModels();
  const favorites = usePrefs().starredModels;
  const [isOpen, setOpen] = useState(false);
  const harnesses = HARNESS_IDS.filter((h) => !isLocked || h === provider);
  const listed = harnesses.flatMap((h) => (catalog[h] ?? []).map((m): ModelOption => ({ ...m, harness: h })));
  const model = optionFor(catalog[provider], value, provider);
  const models = listed.some((m) => m.harness === model.harness && m.id === model.id) ? listed : [...listed, model];
  const docked = models.filter((m) => m === model || (m.harness === model.harness && m.id === model.id) || (!unavailable[m.harness] && !m.isUnavailable && (favorites.includes(m.id) || defaults?.[m.harness] === m.id)));

  return (
    // Controlled: the dock keeps mouse presses from the trigger so a drag can't open the menu, and opens it on a plain click.
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <ScrollDock
        label="Model"
        value={model.id}
        onChange={(id) => onChange(models.find((m) => m.id === id)!)}
        onTap={() => setOpen(true)}
        items={docked.map((m) => ({ value: m.id, label: m.name, icon: <ProviderMark provider={m.harness} size={18} /> }))}
      >
        <DropdownMenuTrigger asChild>
          <Button id={id} variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground">
            <ProviderMark provider={model.harness} size={14} />
            {model.name}
            {model.isUnavailable && <span className="type-caption text-warning">Unavailable</span>}
            <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </ScrollDock>
      <ModelMenu
        models={models}
        pending={harnesses.filter((h) => !catalog[h])}
        harnesses={harnesses}
        isChecked={(m) => m.harness === model.harness && m.id === model.id}
        onPick={onChange}
        starred={favorites}
        onToggleStar={(m) => setPrefs({ starredModels: toggleStar(favorites, m.id) })}
        unavailable={unavailable}
      >
        <p className="px-1.5 pt-1 pb-0.5 type-caption text-subtle-foreground">Starred models show up when you scroll over the model button.</p>
      </ModelMenu>
    </DropdownMenu>
  );
}

/**
 * The menu body for a `DropdownMenu`: a Starred row (where stars apply), then one row per harness, each opening a submenu of its
 * models; typing filters every harness's models into one flat list. Where a submenu can't sit beside the menu, or nothing can
 * hover, the harness rows drill in instead. `pending`: harnesses whose list hasn't arrived yet. `keepsOpen`: picking doesn't close (star mode).
 */
export function ModelMenu({
  models,
  pending,
  harnesses,
  isChecked,
  onPick,
  starred,
  onToggleStar,
  unavailable = {},
  keepsOpen,
  align = 'start',
  children,
}: {
  models: ModelOption[];
  pending: Provider[];
  harnesses: Provider[];
  isChecked: (model: ModelOption) => boolean;
  onPick: (model: ModelOption) => void;
  starred?: string[];
  onToggleStar?: (model: ModelOption) => void;
  unavailable?: Unavailable;
  keepsOpen?: boolean;
  align?: 'start' | 'end';
  children?: ReactNode;
}) {
  const space = useSpace();
  const notes = useHarnessNotes(space.id);
  const isNarrow = useSyncExternalStore(onDrillInChange, () => window.matchMedia(DRILL_IN).matches);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<Provider | 'starred' | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSingle = harnesses.length === 1;
  const drilled = isSingle ? harnesses[0] : isNarrow ? page : null;
  const found = search ? searchModels(models, search) : [];
  const starredModels = onToggleStar && !isSingle ? models.filter((m) => starred?.includes(m.id)) : [];
  const isLoading = pending.length === harnesses.length;
  const ofHarness = (h: Provider) => models.filter((m) => m.harness === h);
  const items = (list: ModelOption[], hasMark?: boolean) =>
    list.map((m) => (
      <ModelItem
        key={`${m.harness}:${m.id}`}
        model={m}
        isChecked={isChecked(m)}
        isDisabled={!!unavailable[m.harness] || !!m.isUnavailable}
        onPick={onPick}
        keepsOpen={keepsOpen}
        isStarred={!!starred?.includes(m.id)}
        onToggleStar={onToggleStar}
        hasMark={hasMark}
      />
    ));
  const lists = [
    ...(starredModels.length
      ? [{ id: 'starred' as const, row: <MenuRow icon={<StarredMark />} title="Starred" summary={starredModels.map((m) => m.name).join(', ')} />, content: items(starredModels, true) }]
      : []),
    ...harnesses.map((h) => ({
      id: h,
      row: <MenuRow icon={<ProviderMark provider={h} size={16} />} title={HARNESSES[h].name} summary={[harnessSummary(ofHarness(h), isChecked, pending.includes(h)), notes[h]].filter(Boolean).join(' · ')} trailing={unavailable[h] ?? space.plans[h]} />,
      content: pending.includes(h) ? <MenuNote>Asking {HARNESSES[h].name} for its models…</MenuNote> : items(ofHarness(h)),
    })),
  ];
  const firstItem = () => contentRef.current?.querySelector<HTMLElement>('[role^=menuitem]:not([data-disabled])');
  const back = () => {
    setPage(null);
    inputRef.current?.focus();
  };

  // Keys reaching the menu itself: letters go to the search instead of Radix's typeahead; ArrowUp off the first item and
  // ArrowLeft in a drilled-in list come back up. Keys from a submenu bubble here through React but aren't inside this content.
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.target === inputRef.current || !e.currentTarget.contains(e.target as Node)) return;
    const isTyping = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (isTyping || (e.key === 'ArrowUp' && e.target === firstItem())) {
      e.preventDefault();
      inputRef.current?.focus();
      if (isTyping) setSearch((s) => s + e.key);
      return;
    }
    if (e.key === 'ArrowLeft' && page && !search) {
      e.preventDefault();
      back();
    }
  };
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') return;
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      firstItem()?.focus();
    }
    if (e.key === 'Enter') firstItem()?.click();
    if (e.key === 'Backspace' && !search && page) back();
  };

  return (
    <DropdownMenuContent
      ref={contentRef}
      align={align}
      collisionPadding={8}
      className="w-80"
      // Radix focuses the content on open and whenever the pointer leaves an item; the search takes it, so typing always filters.
      onFocus={(e) => e.target === e.currentTarget && inputRef.current?.focus()}
      onCloseAutoFocus={() => {
        setSearch('');
        setPage(null);
      }}
      onKeyDown={onMenuKeyDown}
    >
      <label className="mb-1 flex h-7 items-center gap-2 rounded-lg bg-input/30 px-2">
        <Search aria-hidden className="size-4 shrink-0 opacity-50" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search models"
          aria-label="Search models"
          className="w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
        />
      </label>
      <div className="max-h-80 overflow-y-auto">
        {!!search && <SearchResults found={found} isLoading={isLoading} items={items} />}
        {!search && !!drilled && (
          <>
            {!isSingle && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  back();
                }}
                className="type-meta text-muted-foreground"
              >
                <ArrowLeft aria-hidden className="size-3.5" />
                All models
              </DropdownMenuItem>
            )}
            {lists.find((l) => l.id === drilled)?.content}
          </>
        )}
        {!search &&
          !drilled &&
          lists.map(({ id, row, content }) =>
            isNarrow ? (
              <DropdownMenuItem
                key={id}
                onSelect={(e) => {
                  e.preventDefault();
                  setPage(id);
                }}
              >
                {row}
                <ChevronRight aria-hidden className="text-subtle-foreground" />
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub key={id}>
                <DropdownMenuSubTrigger>{row}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent collisionPadding={8} className="max-h-(--radix-dropdown-menu-content-available-height) w-72 overflow-y-auto">
                  {content}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ),
          )}
      </div>
      {children}
    </DropdownMenuContent>
  );
}

// The menu (320px) and a submenu (288px) side by side, plus collision padding. `md` (768px) drilled in on a 758px pane with room to spare.
const DRILL_IN = '(max-width: 639px), (hover: none)';

function onDrillInChange(onChange: () => void) {
  const query = window.matchMedia(DRILL_IN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function SearchResults({ found, isLoading, items }: { found: ModelOption[]; isLoading: boolean; items: (list: ModelOption[], hasMark?: boolean) => ReactNode }) {
  if (!found.length) return <MenuNote>{isLoading ? 'Asking the harnesses for their models…' : 'No model matches.'}</MenuNote>;
  return HARNESS_IDS.filter((h) => found.some((m) => m.harness === h)).map((h) => (
    <DropdownMenuGroup key={h}>
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <ProviderMark provider={h} size={12} />
        {HARNESSES[h].name}
      </DropdownMenuLabel>
      {items(found.filter((m) => m.harness === h))}
    </DropdownMenuGroup>
  ));
}

function MenuNote({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-4 text-center type-meta text-muted-foreground">{children}</p>;
}

function MenuRow({ icon, title, summary, trailing }: { icon: ReactNode; title: string; summary: string; trailing?: string }) {
  return (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        <span className="truncate type-caption text-subtle-foreground">{summary}</span>
      </span>
      {!!trailing && <span className="type-caption text-subtle-foreground">{trailing}</span>}
    </>
  );
}

function StarredMark() {
  // `!` on the svg and its paths: a focused menu item recolours every descendant, and the path fills with its own colour.
  return <Star aria-hidden weight="Filled" className="size-4 text-warning! [&_*]:text-warning!" />;
}

function ModelItem({
  model,
  isChecked,
  isDisabled,
  onPick,
  keepsOpen,
  isStarred,
  onToggleStar,
  hasMark,
}: {
  model: ModelOption;
  isChecked: boolean;
  isDisabled: boolean;
  onPick: (model: ModelOption) => void;
  keepsOpen?: boolean;
  isStarred: boolean;
  onToggleStar?: (model: ModelOption) => void;
  hasMark?: boolean;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={isChecked}
      disabled={isDisabled}
      onSelect={(e) => {
        if (keepsOpen) e.preventDefault();
        onPick(model);
      }}
      className="gap-2"
    >
      {!!onToggleStar && <FavoriteToggle isOn={isStarred} name={model.name} onToggle={() => onToggleStar(model)} />}
      {hasMark && <ProviderMark provider={model.harness} size={14} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{model.name}</span>
        {!!model.description && <span className={cn('truncate type-caption', model.isUnavailable ? 'text-warning' : 'text-subtle-foreground')}>{model.description}</span>}
      </span>
    </DropdownMenuCheckboxItem>
  );
}

const MODEL_COUNT = new Intl.PluralRules('en');

/** The checked models' names, else how many the harness offers. */
function harnessSummary(models: ModelOption[], isChecked: (model: ModelOption) => boolean, isLoading: boolean) {
  if (isLoading) return 'Loading models…';
  const checked = models.filter(isChecked);
  if (checked.length) return checked.map((m) => m.name).join(', ');
  return `${models.length} ${MODEL_COUNT.select(models.length) === 'one' ? 'model' : 'models'}`;
}

/** Per harness, why its models can't be picked right now. */
export type Unavailable = Partial<Record<Provider, string>>;

/** Harnesses the profile can't run: not installed, or its linked account signed out. Empty in the web build, which answers with a mock. */
export function useUnavailableHarnesses(spaceId: string) {
  const [unavailable, setUnavailable] = useState<Unavailable>({});
  useEffect(() => {
    if (!host.isDesktop) return;
    let isCurrent = true;
    void host.settings.accounts().then(({ links }) =>
      HARNESS_IDS.forEach((h) =>
        host.settings.detect(linkedAccountId(links, spaceId, h)).then(
          (install) => isCurrent && setUnavailable((prev) => ({ ...prev, [h]: unavailableReason(install) })),
          () => {},
        ),
      ),
    );
    return () => {
      isCurrent = false;
    };
  }, [spaceId]);
  return unavailable;
}

// GAP: read once per profile per launch, so signing in another way shows the old note until Mochi restarts.
const harnessNotes = new Map<string, Promise<Partial<Record<Provider, string>>>>();

/** Per harness, what its model list leaves out on this login; the picker's harness row says it. */
function useHarnessNotes(spaceId: string) {
  const [notes, setNotes] = useState<Partial<Record<Provider, string>>>({});
  useEffect(() => {
    if (!host.isDesktop) return;
    let isCurrent = true;
    let read = harnessNotes.get(spaceId);
    if (!read) {
      read = host.settings.accounts().then(({ links }) => host.settings.detect(linkedAccountId(links, spaceId, 'codex'))).then((install) => ({ codex: codexPlanNote(install) }));
      harnessNotes.set(spaceId, read);
      read.catch(() => harnessNotes.delete(spaceId));
    }
    read.then((n) => isCurrent && setNotes(n), () => {});
    return () => {
      isCurrent = false;
    };
  }, [spaceId]);
  return notes;
}

// Seen with codex-cli 0.155.1 on a ChatGPT Plus login (2026-10-13): gpt-6.1-sol is missing from `model/list` even with
// `includeHidden`, and asking for it fails with "not supported when using Codex with a ChatGPT account".
function codexPlanNote(install: AgentInstall) {
  return install.login.state === 'logged-in' && install.login.method === 'ChatGPT' ? 'Some models need an API key' : undefined;
}

function unavailableReason(install: AgentInstall) {
  if (!install.path) return 'Not installed';
  if (install.login.state === 'logged-out') return 'Signed out';
}

/** Each harness's models on the profile's account, from main (cached there per account); a harness missing until its list arrives, [] when it can't be read. */
export function useModels(spaceId: string) {
  const [models, setModels] = useState<Partial<Record<Provider, AgentModel[]>>>({});
  useEffect(() => {
    let isCurrent = true;
    setModels({});
    HARNESS_IDS.forEach((h) =>
      host.agent.models(h, spaceId).then(
        (list) => isCurrent && setModels((prev) => ({ ...prev, [h]: list })),
        () => isCurrent && setModels((prev) => ({ ...prev, [h]: [] })),
      ),
    );
    return () => {
      isCurrent = false;
    };
  }, [spaceId]);
  return models;
}

export const toggleStar = (starred: string[], id: string) => (starred.includes(id) ? starred.filter((x) => x !== id) : [...starred, id]);
/** Each harness's default model from Settings ('' = the harness's own); null until read. */
export function useDefaultModels() {
  const [models, setModels] = useState<Record<Provider, string> | null>(null);
  useEffect(() => {
    let isCurrent = true;
    host.settings.get().then(
      (s) => isCurrent && setModels({ claude: s.harnesses.claude.model, codex: s.harnesses.codex.model }),
      () => {},
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  return models;
}

function FavoriteToggle({ isOn, name, onToggle }: { isOn: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={isOn ? `Unstar ${name}` : `Star ${name}`}
      aria-pressed={isOn}
      // Radix items select on pointerup when they never saw the pointerdown, so both stay here.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm text-subtle-foreground hover:text-foreground"
    >
      {/* `!` on the svg and its paths: a focused menu item recolours every descendant. */}
      <Star weight={isOn ? 'Filled' : undefined} className={cn('size-3.5', isOn && 'text-warning! [&_*]:text-warning!')} />
    </button>
  );
}

/** Effort levels `model` takes, from its provider; hidden for a model that takes none. A chosen level the model lacks shows (and runs) as the model's default. */
export function EffortPicker({ model, value, onChange: setEffort }: { model: AgentModel; value: string; onChange: (effort: string) => void }) {
  const [isOpen, setOpen] = useState(false);
  const { efforts } = model;
  if (!efforts.length) return null;
  const effort = effortFor(model, value);
  const label = effort ? effortName(effort) : 'Default';
  return (
    // Controlled: the stepper keeps mouse presses from the trigger so a drag can't open the menu, and opens it on a plain click.
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <WheelStepper values={efforts} value={effort ?? ''} onChange={setEffort} onTap={() => setOpen(true)}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" aria-label={`Reasoning effort: ${label}`}>
            <EffortMeter levels={efforts.length} level={effort ? efforts.indexOf(effort) + 1 : 0} />
            {label}
            <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </WheelStepper>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={effort ?? ''} onValueChange={setEffort}>
            {efforts.map((e, i) => (
              <DropdownMenuRadioItem key={e} value={e} className="gap-2">
                <EffortMeter levels={efforts.length} level={i + 1} />
                {effortName(e)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortMeter({ levels, level }: { levels: number; level: number }) {
  return (
    <span aria-hidden className="flex h-3 items-end gap-px">
      {Array.from({ length: levels }, (_, i) => (
        <span key={i} className={cn('w-[3px] rounded-full bg-current', i >= level && 'opacity-25')} style={{ height: `${40 + (i * 60) / Math.max(1, levels - 1)}%` }} />
      ))}
    </span>
  );
}
