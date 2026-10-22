import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient } from './query.ts';
import { queryKeys } from './queryKeys.ts';
import { createContext, useContext, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { toast } from '@/toast/store';
import { ArrowLeft, Bolt, ChevronDown, ChevronRight, Search, Star } from '@/icons';
import { Badge } from '@/components/ui/badge';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import type { AgentModel } from './host/types/agent';
import type { MachineCatalog } from './host/types/remote';
import { effortFor, effortName, FAST, isNewThreadModel, listedHarnesses, optionFor, searchModels, speedFor, type ModelOption } from './runtime/models';
import { setPrefs, toggleStar, usePrefs } from './settings/prefs';
import { ScrollDock, WheelStepper } from './ScrollDock';
import { host } from './host';
import type { AgentInstall } from './host/types/settings';
import { linkedAccountId } from './settings/accounts';
import { HARNESS_IDS, HARNESSES } from './settings/harnesses';
import { useSpace } from './store';
import { ProviderMark } from './ui';

/**
 * `isLocked` keeps the list to `provider`: a live thread changes provider only through a handoff. Only harnesses that are
 * set up and listed their models show (`useListedModels`); a stored model the account no longer offers shows as Unavailable.
 */
export function ModelPicker({ id, value, provider, isLocked, onChange, defaults }: { id?: string; value: string; provider: Provider; isLocked?: boolean; onChange: (model: ModelOption) => void; defaults?: Defaults<ModelOption> }) {
  const space = useSpace();
  const { catalog, harnesses } = useListedModels(space.id, HARNESS_IDS.filter((h) => !isLocked || h === provider));
  const harnessDefaults = useDefaultModels();
  const favorites = usePrefs().starredModels;
  const [isOpen, setOpen] = useState(false);
  const listed = harnesses.flatMap((h) => (catalog[h] ?? []).map((m): ModelOption => ({ ...m, harness: h })));
  const model = optionFor(catalog[provider], value, provider);
  const models = listed.some((m) => m.harness === model.harness && m.id === model.id) ? listed : [...listed, model];
  const docked = models.filter((m) => m === model || (m.harness === model.harness && m.id === model.id) || (!m.isUnavailable && (favorites.includes(m.id) || harnessDefaults?.[m.harness] === m.id)));

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
        defaults={defaults}
      >
        <p className="px-1.5 pt-1 pb-0.5 type-caption text-subtle-foreground">Starred models show up when you scroll over the model button.</p>
      </ModelMenu>
    </DropdownMenu>
  );
}

/**
 * The menu body for a `DropdownMenu`: starred models first (where stars apply), then one row per harness whose submenu lists its
 * models; typing filters every harness's models into one flat list. Below `md` the harness rows drill in instead of opening a
 * submenu beside the menu. `pending`: harnesses whose list hasn't arrived yet. `keepsOpen`: picking doesn't close (star mode).
 */
export function ModelMenu({
  models,
  pending,
  harnesses,
  isChecked,
  onPick,
  starred,
  onToggleStar,
  keepsOpen,
  align = 'start',
  defaults,
  children,
}: {
  models: ModelOption[];
  pending: Provider[];
  harnesses: Provider[];
  isChecked: (model: ModelOption) => boolean;
  onPick: (model: ModelOption) => void;
  starred?: string[];
  onToggleStar?: (model: ModelOption) => void;
  keepsOpen?: boolean;
  align?: 'start' | 'end';
  /** Offers "Make default" per model and badges the one new threads start on. */
  defaults?: Defaults<ModelOption>;
  children?: ReactNode;
}) {
  const space = useSpace();
  const notes = useHarnessNotes(space.id);
  const isNarrow = useIsMobile();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<Provider | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSingle = harnesses.length === 1;
  const drilled = isSingle ? harnesses[0] : isNarrow ? page : null;
  const found = search ? searchModels(models, search) : [];
  const starredModels = onToggleStar && !drilled ? models.filter((m) => starred?.includes(m.id)) : [];
  const isLoading = !!pending.length && pending.length === harnesses.length;
  const ofHarness = (h: Provider) => models.filter((m) => m.harness === h);
  const items = (list: ModelOption[], hasMark?: boolean) =>
    list.map((m) => (
      <ModelItem
        key={`${m.harness}:${m.id}`}
        model={m}
        isChecked={isChecked(m)}
        isDisabled={!!m.isUnavailable}
        onPick={onPick}
        keepsOpen={keepsOpen}
        isStarred={!!starred?.includes(m.id)}
        onToggleStar={onToggleStar}
        hasMark={hasMark}
        defaults={defaults}
      />
    ));
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
          placeholder={drilled && !search ? `Search ${HARNESSES[drilled].name} models` : 'Search models'}
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
            {pending.includes(drilled) ? <MenuNote>Asking {HARNESSES[drilled].name} for its models…</MenuNote> : items(ofHarness(drilled))}
          </>
        )}
        {!search && !drilled && (
          <>
            {starredModels.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>Starred</DropdownMenuLabel>
                {items(starredModels, true)}
              </DropdownMenuGroup>
            )}
            <DropdownMenuGroup>
              {starredModels.length > 0 && <DropdownMenuLabel>Harnesses</DropdownMenuLabel>}
              {harnesses.map((h) => {
                const row = <HarnessRow harness={h} summary={[harnessSummary(ofHarness(h), isChecked, pending.includes(h)), notes[h]].filter(Boolean).join(' · ')} plan={space.plans[h]} />;
                if (isNarrow)
                  return (
                    <DropdownMenuItem
                      key={h}
                      onSelect={(e) => {
                        e.preventDefault();
                        setPage(h);
                      }}
                    >
                      {row}
                      <ChevronRight aria-hidden className="text-subtle-foreground" />
                    </DropdownMenuItem>
                  );
                return (
                  <DropdownMenuSub key={h}>
                    <DropdownMenuSubTrigger>{row}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent collisionPadding={8} className="max-h-(--radix-dropdown-menu-content-available-height) w-72 overflow-y-auto">
                      {pending.includes(h) ? <MenuNote>Asking {HARNESSES[h].name} for its models…</MenuNote> : items(ofHarness(h))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}
      </div>
      {children}
    </DropdownMenuContent>
  );
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

function HarnessRow({ harness, summary, plan }: { harness: Provider; summary: string; plan?: string }) {
  return (
    <>
      <ProviderMark provider={harness} size={16} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{HARNESSES[harness].name}</span>
        <span className="truncate type-caption text-subtle-foreground">{summary}</span>
      </span>
      {!!plan && <span className="type-caption text-subtle-foreground">{plan}</span>}
    </>
  );
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
  defaults,
}: {
  model: ModelOption;
  isChecked: boolean;
  isDisabled: boolean;
  onPick: (model: ModelOption) => void;
  keepsOpen?: boolean;
  isStarred: boolean;
  onToggleStar?: (model: ModelOption) => void;
  hasMark?: boolean;
  defaults?: Defaults<ModelOption>;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={isChecked}
      disabled={isDisabled}
      onSelect={(e) => {
        if (keepsOpen) e.preventDefault();
        onPick(model);
      }}
      onKeyDown={defaults && makeDefaultKeys(() => defaults.make(model))}
      className={cn('group/item gap-2', defaults && UNCHECKED_FLUSH)}
    >
      {!!onToggleStar && <FavoriteToggle isOn={isStarred} name={model.name} onToggle={() => onToggleStar(model)} />}
      {hasMark && <ProviderMark provider={model.harness} size={14} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{model.name}</span>
        {!!model.description && <span className={cn('truncate type-caption', model.isUnavailable ? 'text-warning' : 'text-subtle-foreground')}>{model.description}</span>}
      </span>
      {!!defaults && <DefaultSlot isDefault={defaults.isDefault(model)} name={model.name} onMake={() => defaults.make(model)} />}
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

/** Each harness's models, and which of `harnesses` the pickers list: set up, and its list read (`listedHarnesses`). */
export function useListedModels(spaceId: string, harnesses: Provider[] = HARNESS_IDS) {
  const catalog = useModels(spaceId);
  const unavailable = useUnavailableHarnesses(spaceId);
  return { catalog, harnesses: listedHarnesses(harnesses, catalog, unavailable) };
}

/** Per harness, why its models can't be picked right now. */
type Unavailable = Partial<Record<Provider, string>>;

/** Harnesses the profile can't run: not installed, or its linked account signed out. Empty in the web build, which answers with a mock. */
function useUnavailableHarnesses(spaceId: string) {
  const unavailableQuery = useQuery({ queryKey: queryKeys.agent.unavailable(spaceId), queryFn: async () => {
    const { links } = await host.settings.accounts();
    return Object.fromEntries(await Promise.all(HARNESS_IDS.map(async (h) => [h, unavailableReason(await host.settings.detect(linkedAccountId(links, spaceId, h)))])));
  }, enabled: host.isDesktop, staleTime: 60_000 });
  return (unavailableQuery.data ?? {}) as Unavailable;
}

function useHarnessNotes(spaceId: string) {
  const notesQuery = useQuery({ queryKey: queryKeys.agent.notes.space(spaceId), queryFn: async () => {
    const { links } = await host.settings.accounts();
    return { codex: codexPlanNote(await host.settings.detect(linkedAccountId(links, spaceId, 'codex'))) };
  }, enabled: host.isDesktop, staleTime: 60_000 });
  return (notesQuery.data ?? {}) as Partial<Record<Provider, string | undefined>>;
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

/** Another computer's models and defaults, for a composer starting a thread there; unset, the pickers read this computer's. */
export const MachineModelsContext = createContext<Pick<MachineCatalog, 'models' | 'defaults'> | null>(null);

/** Each harness's models on the profile's account, from main (cached there per account); a harness missing until its list arrives, [] when it can't be read. */
export function useModels(spaceId: string) {
  const machine = useContext(MachineModelsContext);
  const modelsQueries = useQueries({ queries: HARNESS_IDS.map((h) => ({ queryKey: queryKeys.agent.models(spaceId, h), queryFn: () => host.agent.models(h, spaceId) })) });
  const models = Object.fromEntries(HARNESS_IDS.flatMap((h, i) => modelsQueries[i].data ? [[h, modelsQueries[i].data]] : modelsQueries[i].isError ? [[h, []]] : []));
  return machine?.models ?? models;
}

/** Each harness's default model from Settings ('' = the harness's own); null until read. Re-read on mount, updated in place by `makeDefaultModel`. */
export function useDefaultModels() {
  const machine = useContext(MachineModelsContext);
  const settingsQuery = useQuery({ queryKey: queryKeys.agent.settings(), queryFn: () => host.settings.get() });
  const settings = settingsQuery.data;
  return machine?.defaults ?? (settings ? { claude: settings.harnesses.claude.model, codex: settings.harnesses.codex.model } : null);
}

/** New threads start on `model`: its harness becomes the default agent and the model that harness's Settings default. */
export function makeDefaultModel(model: ModelOption) {
  setPrefs({ agent: model.harness });
  host.settings.set({ harnesses: { [model.harness]: { model: model.id } } }).then(() => queryClient.invalidateQueries({ queryKey: queryKeys.agent.settings() }), (error: Error) => toast.error('Default model not saved', { description: error.message }));
}

/** The composer pickers' "Default" and "Make default": what new threads start on, read from and saved to the same settings New thread uses. */
export function useNewThreadDefaults(catalog: Partial<Record<Provider, AgentModel[]>>, model: AgentModel) {
  const harnessModels = useDefaultModels();
  const { agent, effort, speed } = usePrefs();
  return {
    model: { isDefault: (m: ModelOption) => !!harnessModels && isNewThreadModel(m, catalog, harnessModels, agent), make: makeDefaultModel },
    effort: { isDefault: (e: string) => e === effortFor(model, effort), make: (e: string) => setPrefs({ effort: e }) },
    speed: { isDefault: (s: string) => s === speed, make: (s: string) => setPrefs({ speed: s ? FAST : '' }) },
  };
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
      {/* `!`: a focused menu item recolours every descendant. */}
      <Star filled={isOn} className={cn('size-3.5', isOn && 'text-warning!')} />
    </button>
  );
}

/** Effort levels `model` takes, from its provider; hidden for a model that takes none. A chosen level the model lacks shows (and runs) as the model's default. */
export function EffortPicker({ model, value, onChange: setEffort, defaults }: { model: AgentModel; value: string; onChange: (effort: string) => void; defaults?: Defaults<string> }) {
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
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={effort ?? ''} onValueChange={setEffort}>
            {efforts.map((e, i) => (
              <DropdownMenuRadioItem key={e} value={e} onKeyDown={defaults && makeDefaultKeys(() => defaults.make(e))} className={cn('group/item gap-2', defaults && UNCHECKED_FLUSH)}>
                <EffortMeter levels={efforts.length} level={i + 1} />
                <span className="flex-1">{effortName(e)}</span>
                {!!defaults && <DefaultSlot isDefault={defaults.isDefault(e)} name={effortName(e)} onMake={() => defaults.make(e)} />}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The speed tiers `model` reports, under the harness's own names, each with the provider's note on what it costs; hidden
 * for a model that reports none. Picking the first tier stores `fast`, so Fast carries over to another model that has one.
 */
export function SpeedPicker({ model, value, onChange, defaults }: { model: AgentModel; value: string; onChange: (speed: string) => void; defaults?: Defaults<string> }) {
  const { speeds } = model;
  if (!speeds.length) return null;
  const speed = speeds.find((s) => s.id === speedFor(model, value));
  const stored = (id: string) => (id === STANDARD ? '' : id === speeds[0].id ? FAST : id);
  const choose = (id: string) => onChange(stored(id));
  // GAP: the new-thread default holds only standard or `fast`, so a second tier above Fast can't become it.
  const defaultsFor = (id: string) => (defaults && (id === STANDARD || id === speeds[0].id) ? { isDefault: defaults.isDefault(stored(id)), make: () => defaults.make(stored(id)) } : undefined);
  const label = `Speed: ${speed?.name ?? 'Standard'}`;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className={speed ? 'text-foreground' : 'text-muted-foreground'} aria-label={label}>
              <SpeedIcon level={speed ? speeds.indexOf(speed) + 1 : 0} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Speed</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={speed?.id ?? STANDARD} onValueChange={choose}>
            <SpeedItem value={STANDARD} level={0} name="Standard" description="The model's usual speed and price" defaults={defaultsFor(STANDARD)} />
            {speeds.map((s, i) => (
              <SpeedItem key={s.id} value={s.id} level={i + 1} name={s.name} description={s.description} defaults={defaultsFor(s.id)} />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Radix menus treat '' as no value.
const STANDARD = 'standard';

function SpeedItem({ value, level, name, description, defaults }: { value: string; level: number; name: string; description: string; defaults?: { isDefault: boolean; make: () => void } }) {
  return (
    <DropdownMenuRadioItem value={value} onKeyDown={defaults && makeDefaultKeys(defaults.make)} className={cn('group/item items-start gap-2', defaults && UNCHECKED_FLUSH)}>
      <span className="flex h-5 w-7 shrink-0 items-center">
        <SpeedIcon level={level} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {name}
        {!!description && <span className="type-caption text-muted-foreground">{description}</span>}
      </span>
      {!!defaults && <DefaultSlot isDefault={defaults.isDefault} name={name} onMake={defaults.make} />}
    </DropdownMenuRadioItem>
  );
}

/** Standard is an outlined bolt; each tier above it adds a filled one. */
function SpeedIcon({ level }: { level: number }) {
  if (!level) return <Bolt className="size-4" />;
  return (
    <span aria-hidden className="flex -space-x-1.5">
      {Array.from({ length: level }, (_, i) => (
        <Bolt key={i} filled className="size-4" />
      ))}
    </span>
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

/** What new threads start on, for a picker's items: which one it is, and how to make another one it. */
export interface Defaults<T> {
  isDefault: (item: T) => boolean;
  make: (item: T) => void;
}

/** A default-able item's trailing slot: "Default" on the current one, else "Make default" while the item is highlighted (⌘↵ from the keyboard). */
function DefaultSlot({ isDefault, name, onMake }: { isDefault: boolean; name: string; onMake: () => void }) {
  // `!`: a focused menu item recolours every descendant.
  if (isDefault) return <Badge variant="secondary" className="self-center type-caption font-normal text-muted-foreground!">Default</Badge>;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Make ${name} the default for new threads`}
      // Radix items select on pointerup when they never saw the pointerdown, so both stay here.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onMake();
      }}
      className="h-5 shrink-0 cursor-default self-center rounded-sm px-1.5 type-caption text-muted-foreground! opacity-0 group-data-highlighted/item:opacity-100 hover:bg-foreground/10 hover:text-foreground!"
    >
      Make default
    </button>
  );
}

// Items reserve `pr-8` for the check; an unchecked one gives it to the default slot so Make default sits at the edge.
const UNCHECKED_FLUSH = 'data-[state=unchecked]:pr-1';

/** ⌘↵ (Ctrl+↵) on a highlighted item makes it the default instead of picking it. */
function makeDefaultKeys(make: () => void) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    make();
  };
}
