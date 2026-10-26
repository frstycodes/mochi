import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient } from './query.ts';
import { queryKeys } from './queryKeys.ts';
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { toast } from '@/toast/store';
import { Bolt, ChevronDown, Command, Search, Star } from '@/icons';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import type { AgentModel } from './host/types/agent';
import type { MachineCatalog } from './host/types/remote';
import {
  effortFor,
  effortName,
  FAST,
  listedHarnesses,
  optionFor,
  listedFor,
  openingTab,
  speedFor,
  type MenuTab,
  type ModelOption,
} from './runtime/models';
import { setPrefs, toggleStar, usePrefs } from './settings/prefs';
import { ScrollDock, WheelStepper } from './ScrollDock';
import { host } from './host';
import type { AgentInstall } from './host/types/settings';
import { linkedAccountId } from './settings/accounts';
import { HARNESS_IDS, HARNESSES } from './settings/harnesses';
import { useSpace } from './store';
import { ProviderMark } from './ui';
import { IS_MAC, isMod, shortcutText } from './keys';

/**
 * `isLocked` keeps the list to `provider` (the settings chat); a thread's model of another provider switches it there. Only harnesses that are
 * set up and listed their models show (`useListedModels`); a stored model the account no longer offers shows as Unavailable.
 */
export function ModelPicker({
  id,
  value,
  provider,
  isLocked,
  onChange,
}: {
  id?: string;
  value: string;
  provider: Provider;
  isLocked?: boolean;
  onChange: (model: ModelOption) => void;
}) {
  const space = useSpace();
  const { catalog, harnesses } = useListedModels(
    space.id,
    HARNESS_IDS.filter((h) => !isLocked || h === provider),
  );
  const harnessDefaults = useDefaultModels();
  const favorites = usePrefs().starredModels;
  const [isOpen, setOpen] = useState(false);
  const listed = harnesses.flatMap((h) =>
    (catalog[h] ?? []).map((m): ModelOption => ({ ...m, harness: h })),
  );
  const model = optionFor(catalog[provider], value, provider);
  const models = listed.some(
    (m) => m.harness === model.harness && m.id === model.id,
  )
    ? listed
    : [...listed, model];
  const docked = models.filter(
    (m) =>
      m === model ||
      (m.harness === model.harness && m.id === model.id) ||
      (!m.isUnavailable &&
        (favorites.includes(m.id) || harnessDefaults?.[m.harness] === m.id)),
  );

  return (
    // Controlled: the dock keeps mouse presses from the trigger so a drag can't open the menu, and opens it on a plain click.
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <ScrollDock
        label="Model"
        value={model.id}
        onChange={(id) => onChange(models.find((m) => m.id === id)!)}
        onTap={() => setOpen(true)}
        items={docked.map((m) => ({
          value: m.id,
          label: m.name,
          icon: <ProviderMark provider={m.harness} size={18} />,
        }))}
      >
        <DropdownMenuTrigger asChild>
          <Button
            id={id}
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-muted-foreground"
          >
            <ProviderMark provider={model.harness} size={14} />
            {model.name}
            {model.isUnavailable && (
              <span className="type-caption text-warning">Unavailable</span>
            )}
            <ChevronDown
              data-icon="inline-end"
              className="text-subtle-foreground"
            />
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
        onToggleStar={(m) =>
          setPrefs({ starredModels: toggleStar(favorites, m.id) })
        }
      >
        <p className="px-1.5 pt-1 pb-0.5 type-caption text-subtle-foreground">
          Starred models show up when you scroll over the model button.
        </p>
      </ModelMenu>
    </DropdownMenu>
  );
}

/**
 * The menu body for a `DropdownMenu`, laid out like T3 Code's: a rail of tabs (Starred where stars apply, then one per harness)
 * beside the open tab's models, so a long starred list never pushes the harnesses out of reach. Typing searches every harness;
 * ⌘1–9 picks the listed models in order, ←/→ steps through the tabs. `pending`: harnesses whose list hasn't arrived yet.
 * `keepsOpen`: picking doesn't close (star mode).
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
  children?: ReactNode;
}) {
  const space = useSpace();
  const notes = useHarnessNotes(space.id);
  const [search, setSearch] = useState('');
  const [pickedTab, setTab] = useState<MenuTab | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const starredModels = onToggleStar
    ? models.filter((m) => starred?.includes(m.id))
    : [];
  const tabs: MenuTab[] = onToggleStar ? ['starred', ...harnesses] : harnesses;
  const hasRail = tabs.length > 1;
  const tab =
    pickedTab ??
    openingTab(models, harnesses, isChecked, !!starredModels.length);
  const isLoading = !!pending.length && pending.length === harnesses.length;
  const shown = listedFor(tab, search, models, starredModels);
  const caption =
    !search && tab && tab !== 'starred'
      ? [
          HARNESSES[tab].name,
          !!space.plans[tab] && `${space.plans[tab]} plan`,
          notes[tab],
        ]
          .filter(Boolean)
          .join(' · ')
      : '';
  const items = (list: ModelOption[], hasMark?: boolean) =>
    list.map((m) => {
      const number = shown.indexOf(m) + 1;
      return (
        <ModelItem
          key={`${m.harness}:${m.id}`}
          model={m}
          number={number <= 9 ? number : undefined}
          isChecked={isChecked(m)}
          isDisabled={!!m.isUnavailable}
          onPick={onPick}
          keepsOpen={keepsOpen}
          isStarred={!!starred?.includes(m.id)}
          onToggleStar={onToggleStar}
          hasMark={hasMark}
        />
      );
    });
  const firstItem = () =>
    contentRef.current?.querySelector<HTMLElement>(
      '[role^=menuitem]:not([data-disabled])',
    );
  const openTab = (next: MenuTab) => {
    setTab(next);
    inputRef.current?.focus();
  };
  const stepTab = (by: number) =>
    openTab(tabs[(tabs.indexOf(tab!) + by + tabs.length) % tabs.length]);

  // Shared by the search and the menu: ⌘1–9 picks a listed model, ←/→ step tabs while nothing is typed.
  const onListKeys = (e: KeyboardEvent) => {
    const number = Number(e.key);
    if (isMod(e) && number >= 1 && number <= 9) {
      e.preventDefault();
      contentRef.current
        ?.querySelector<HTMLElement>(`[data-model-number="${number}"]`)
        ?.click();
      return true;
    }
    if (!hasRail || search || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'))
      return false;
    e.preventDefault();
    stepTab(e.key === 'ArrowLeft' ? -1 : 1);
    return true;
  };
  // Keys reaching the menu itself: letters go to the search instead of Radix's typeahead; ArrowUp off the first item comes back
  // up. Keys from a tooltip portal bubble here through React but aren't inside this content.
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.defaultPrevented ||
      e.target === inputRef.current ||
      !e.currentTarget.contains(e.target as Node) ||
      onListKeys(e)
    )
      return;
    const isTyping =
      e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!isTyping && !(e.key === 'ArrowUp' && e.target === firstItem())) return;
    e.preventDefault();
    inputRef.current?.focus();
    if (isTyping) setSearch((s) => s + e.key);
  };
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') return;
    e.stopPropagation();
    if (onListKeys(e)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      firstItem()?.focus();
    }
    if (e.key === 'Enter') firstItem()?.click();
  };

  return (
    <DropdownMenuContent
      ref={contentRef}
      align={align}
      collisionPadding={8}
      className={cn(
        'flex max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] gap-2 overflow-hidden rounded-xl p-2',
        hasRail ? 'w-96' : 'w-80',
      )}
      // Radix focuses the content on open and whenever the pointer leaves an item; the search takes it, so typing always filters.
      onFocus={(e) => e.target === e.currentTarget && inputRef.current?.focus()}
      onCloseAutoFocus={() => {
        setSearch('');
        setTab(null);
      }}
      onKeyDown={onMenuKeyDown}
    >
      {hasRail && (
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Model sources"
          className="relative flex shrink-0 flex-col gap-1 border-r pr-2"
        >
          {tabs.map((t, i) => (
            <Fragment key={t}>
              {i === 1 && t !== 'starred' && tabs[0] === 'starred' && (
                <span
                  aria-hidden
                  className="mx-auto my-1 h-px w-4 shrink-0 bg-border"
                />
              )}
              <RailTab
                value={t}
                label={
                  t === 'starred'
                    ? 'Starred'
                    : [HARNESSES[t].name, space.plans[t]]
                        .filter(Boolean)
                        .join(' · ')
                }
                isSelected={!search && t === tab}
                onSelect={() => {
                  setSearch('');
                  openTab(t);
                }}
              >
                {t === 'starred' ? (
                  <Star filled className="size-4" />
                ) : (
                  <ProviderMark provider={t} size={16} />
                )}
              </RailTab>
            </Fragment>
          ))}
          <RailNotch tab={search ? null : tab} />
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <InputGroup className="h-8 shrink-0">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={
              tab && tab !== 'starred' && !hasRail
                ? `Search ${HARNESSES[tab].name} models`
                : 'Search models'
            }
            aria-label="Search models"
          />
        </InputGroup>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
          {!!search && (
            <SearchResults found={shown} isLoading={isLoading} items={items} />
          )}
          {!search && tab === 'starred' && (
            <DropdownMenuGroup>
              {starredModels.length ? (
                items(starredModels, true)
              ) : (
                <MenuNote>Star a model to keep it here.</MenuNote>
              )}
            </DropdownMenuGroup>
          )}
          {!search && !!tab && tab !== 'starred' && (
            <DropdownMenuGroup>
              {!!caption && (
                <DropdownMenuLabel className="truncate">
                  {caption}
                </DropdownMenuLabel>
              )}
              {pending.includes(tab) ? (
                <MenuNote>
                  Asking {HARNESSES[tab].name} for its models…
                </MenuNote>
              ) : (
                items(shown)
              )}
            </DropdownMenuGroup>
          )}
        </div>
        {children}
      </div>
    </DropdownMenuContent>
  );
}

function RailTab({
  value,
  label,
  isSelected,
  onSelect,
  children,
}: {
  value: MenuTab;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="tab"
          data-tab={value}
          aria-label={label}
          aria-selected={isSelected}
          tabIndex={-1}
          onClick={onSelect}
          className={cn(
            'flex size-8 shrink-0 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            isSelected && 'bg-accent text-foreground',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The open tab's mark on the rail's edge: a short notch that snaps from tab to tab like a dial's tick; hidden while searching. */
function RailNotch({ tab }: { tab: MenuTab | null | undefined }) {
  const notchRef = useRef<HTMLSpanElement>(null);
  // Null until placed; the first placement jumps there, only later moves snap across.
  const [place, setPlace] = useState<{ y: number; isMove: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    const selected =
      tab &&
      // The rail itself, not a ref on it: a parent's ref attaches only after its children's layout effects run.
      notchRef.current?.parentElement?.querySelector<HTMLElement>(
        `[data-tab="${tab}"]`,
      );
    if (!selected) return;
    const y = selected.offsetTop + selected.offsetHeight / 2;
    setPlace((p) => ({ y, isMove: !!p }));
  }, [tab]);
  return (
    <span
      ref={notchRef}
      aria-hidden
      className={cn(
        'pointer-events-none absolute -top-[5px] -right-[1.5px] h-2.5 w-0.5 rounded-full bg-muted-foreground',
        place?.isMove &&
          'transition-[translate,opacity] duration-120 ease-[cubic-bezier(0.23,1,0.32,1)]',
        (!tab || !place) && 'opacity-0',
      )}
      style={{ translate: `0 ${place?.y ?? 0}px` }}
    />
  );
}

function SearchResults({
  found,
  isLoading,
  items,
}: {
  found: ModelOption[];
  isLoading: boolean;
  items: (list: ModelOption[], hasMark?: boolean) => ReactNode;
}) {
  if (!found.length)
    return (
      <MenuNote>
        {isLoading
          ? 'Asking the harnesses for their models…'
          : 'No model matches.'}
      </MenuNote>
    );
  return HARNESS_IDS.filter((h) => found.some((m) => m.harness === h)).map(
    (h) => (
      <DropdownMenuGroup key={h}>
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <ProviderMark provider={h} size={12} />
          {HARNESSES[h].name}
        </DropdownMenuLabel>
        {items(found.filter((m) => m.harness === h))}
      </DropdownMenuGroup>
    ),
  );
}

function MenuNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 py-6 text-center type-meta text-muted-foreground">
      {children}
    </p>
  );
}

// The checkbox item's check is hidden: the picked model takes the menu's highlight fill instead.
const HIDDEN_CHECK =
  'px-2 *:data-[slot=dropdown-menu-checkbox-item-indicator]:hidden data-[state=checked]:bg-accent';

/** One model row: name and description, then its ⌘N and star in columns that line up on every row. */
function ModelItem({
  model,
  number,
  isChecked,
  isDisabled,
  onPick,
  keepsOpen,
  isStarred,
  onToggleStar,
  hasMark,
}: {
  model: ModelOption;
  /** Its ⌘1–9 shortcut, for the first nine listed. */
  number?: number;
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
      data-model-number={number}
      onSelect={(e) => {
        if (keepsOpen) e.preventDefault();
        onPick(model);
      }}
      // A 2px gap, so the picked row and a highlighted neighbour never merge into one block.
      className={cn('group/item gap-2 py-1.5 not-last:mb-0.5', HIDDEN_CHECK)}
    >
      {hasMark && <ProviderMark provider={model.harness} size={14} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{model.name}</span>
        {!!model.description && (
          <span
            className={cn(
              'truncate type-caption',
              model.isUnavailable ? 'text-warning' : 'text-subtle-foreground',
            )}
          >
            {model.description}
          </span>
        )}
      </span>
      {!!number && <ModelShortcut number={number} />}
      {!!onToggleStar && (
        <FavoriteToggle
          isOn={isStarred}
          name={model.name}
          onToggle={() => onToggleStar(model)}
          className={cn(
            !isStarred && 'opacity-0 group-data-highlighted/item:opacity-100',
          )}
        />
      )}
    </DropdownMenuCheckboxItem>
  );
}

/** One key cap for ⌘N (Ctrl N off macOS), lighter than a cap per key. */
function ModelShortcut({ number }: { number: number }) {
  return (
    <Kbd
      aria-label={shortcutText(['mod', String(number)])}
      className="gap-0.5 tabular-nums"
    >
      {IS_MAC ? <Command /> : 'Ctrl'}
      {number}
    </Kbd>
  );
}

/** Each harness's models, and which of `harnesses` the pickers list: set up, and its list read (`listedHarnesses`). */
export function useListedModels(
  spaceId: string,
  harnesses: Provider[] = HARNESS_IDS,
) {
  const catalog = useModels(spaceId);
  const unavailable = useUnavailableHarnesses(spaceId);
  return {
    catalog,
    harnesses: listedHarnesses(harnesses, catalog, unavailable),
  };
}

/** Per harness, why its models can't be picked right now. */
type Unavailable = Partial<Record<Provider, string>>;

/** Harnesses the profile can't run: not installed, or its linked account signed out. Empty in the web build, which answers with a mock. */
function useUnavailableHarnesses(spaceId: string) {
  const unavailableQuery = useQuery({
    queryKey: queryKeys.agent.unavailable(spaceId),
    queryFn: async () => {
      const { links } = await host.settings.accounts();
      return Object.fromEntries(
        await Promise.all(
          HARNESS_IDS.map(async (h) => [
            h,
            unavailableReason(
              await host.settings.detect(linkedAccountId(links, spaceId, h)),
            ),
          ]),
        ),
      );
    },
    enabled: host.isDesktop,
    staleTime: 60_000,
  });
  return (unavailableQuery.data ?? {}) as Unavailable;
}

function useHarnessNotes(spaceId: string) {
  const notesQuery = useQuery({
    queryKey: queryKeys.agent.notes.space(spaceId),
    queryFn: async () => {
      const { links } = await host.settings.accounts();
      return {
        codex: codexPlanNote(
          await host.settings.detect(linkedAccountId(links, spaceId, 'codex')),
        ),
      };
    },
    enabled: host.isDesktop,
    staleTime: 60_000,
  });
  return (notesQuery.data ?? {}) as Partial<
    Record<Provider, string | undefined>
  >;
}

// Seen with codex-cli 0.155.1 on a ChatGPT Plus login (2026-10-13): gpt-6.1-sol is missing from `model/list` even with
// `includeHidden`, and asking for it fails with "not supported when using Codex with a ChatGPT account".
function codexPlanNote(install: AgentInstall) {
  return install.login.state === 'logged-in' &&
    install.login.method === 'ChatGPT'
    ? 'Some models need an API key'
    : undefined;
}

function unavailableReason(install: AgentInstall) {
  if (!install.path) return 'Not installed';
  if (install.login.state === 'logged-out') return 'Signed out';
}

/** Another computer's models and defaults, for a composer starting a thread there; unset, the pickers read this computer's. */
export const MachineModelsContext = createContext<Pick<
  MachineCatalog,
  'models' | 'defaults'
> | null>(null);

/** Each harness's models on the profile's account, from main (cached there per account); a harness missing until its list arrives, [] when it can't be read. */
export function useModels(spaceId: string) {
  const machine = useContext(MachineModelsContext);
  const modelsQueries = useQueries({
    queries: HARNESS_IDS.map((h) => ({
      queryKey: queryKeys.agent.models(spaceId, h),
      queryFn: () => host.agent.models(h, spaceId),
    })),
  });
  const models = Object.fromEntries(
    HARNESS_IDS.flatMap((h, i) =>
      modelsQueries[i].data
        ? [[h, modelsQueries[i].data]]
        : modelsQueries[i].isError
          ? [[h, []]]
          : [],
    ),
  );
  return machine?.models ?? models;
}

/** Each harness's default model from Settings ('' = the harness's own); null until read. Re-read on mount, updated in place by `makeDefaultModel`. */
export function useDefaultModels() {
  const machine = useContext(MachineModelsContext);
  const settingsQuery = useQuery({
    queryKey: queryKeys.agent.settings(),
    queryFn: () => host.settings.get(),
  });
  const settings = settingsQuery.data;
  return (
    machine?.defaults ??
    (settings
      ? {
          claude: settings.harnesses.claude.model,
          codex: settings.harnesses.codex.model,
        }
      : null)
  );
}

/** New threads start on `model`: its harness becomes the default agent and the model that harness's Settings default. Picking in New thread calls it. */
export function makeDefaultModel(model: ModelOption) {
  setPrefs({ agent: model.harness });
  host.settings
    .set({ harnesses: { [model.harness]: { model: model.id } } })
    .then(
      () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.settings() }),
      (error: Error) =>
        toast.error('Default model not saved', { description: error.message }),
    );
}

function FavoriteToggle({
  isOn,
  name,
  onToggle,
  className,
}: {
  isOn: boolean;
  name: string;
  onToggle: () => void;
  className?: string;
}) {
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
      className={cn(
        'flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm text-subtle-foreground hover:text-foreground',
        className,
      )}
    >
      {/* `!` on the icon and its paths: a focused menu item recolours every descendant. */}
      <Star
        filled={isOn}
        className={cn('size-3.5', isOn && 'text-warning! **:text-warning!')}
      />
    </button>
  );
}

/** Effort levels `model` takes, from its provider; hidden for a model that takes none. A chosen level the model lacks shows (and runs) as the model's default. */
export function EffortPicker({
  model,
  value,
  onChange: setEffort,
}: {
  model: AgentModel;
  value: string;
  onChange: (effort: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const { efforts } = model;
  if (!efforts.length) return null;
  const effort = effortFor(model, value);
  const label = effort ? effortName(effort) : 'Default';
  return (
    // Controlled: the stepper keeps mouse presses from the trigger so a drag can't open the menu, and opens it on a plain click.
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <WheelStepper
        values={efforts}
        value={effort ?? ''}
        onChange={setEffort}
        onTap={() => setOpen(true)}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-muted-foreground"
            aria-label={`Reasoning effort: ${label}`}
          >
            <EffortMeter
              levels={efforts.length}
              level={effort ? efforts.indexOf(effort) + 1 : 0}
            />
            {label}
            <ChevronDown
              data-icon="inline-end"
              className="text-subtle-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
      </WheelStepper>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={effort ?? ''}
            onValueChange={setEffort}
          >
            {efforts.map((e, i) => (
              <DropdownMenuRadioItem key={e} value={e} className="gap-2">
                <EffortMeter levels={efforts.length} level={i + 1} />
                <span className="flex-1">{effortName(e)}</span>
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
export function SpeedPicker({
  model,
  value,
  onChange,
}: {
  model: AgentModel;
  value: string;
  onChange: (speed: string) => void;
}) {
  const { speeds } = model;
  if (!speeds.length) return null;
  const speed = speeds.find((s) => s.id === speedFor(model, value));
  const stored = (id: string) =>
    id === STANDARD ? '' : id === speeds[0].id ? FAST : id;
  const choose = (id: string) => onChange(stored(id));
  const label = `Speed: ${speed?.name ?? 'Standard'}`;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={speed ? 'text-foreground' : 'text-muted-foreground'}
              aria-label={label}
            >
              <SpeedIcon level={speed ? speeds.indexOf(speed) + 1 : 0} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Speed</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={speed?.id ?? STANDARD}
            onValueChange={choose}
          >
            <SpeedItem
              value={STANDARD}
              level={0}
              name="Standard"
              description="The model's usual speed and price"
            />
            {speeds.map((s, i) => (
              <SpeedItem
                key={s.id}
                value={s.id}
                level={i + 1}
                name={s.name}
                description={s.description}
              />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Radix menus treat '' as no value.
const STANDARD = 'standard';

function SpeedItem({
  value,
  level,
  name,
  description,
}: {
  value: string;
  level: number;
  name: string;
  description: string;
}) {
  return (
    <DropdownMenuRadioItem value={value} className="items-start gap-2">
      <span className="flex h-5 w-7 shrink-0 items-center">
        <SpeedIcon level={level} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {name}
        {!!description && (
          <span className="type-caption text-muted-foreground">
            {description}
          </span>
        )}
      </span>
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
        <span
          key={i}
          className={cn(
            'w-[3px] rounded-full bg-current',
            i >= level && 'opacity-25',
          )}
          style={{ height: `${40 + (i * 60) / Math.max(1, levels - 1)}%` }}
        />
      ))}
    </span>
  );
}
