import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Star } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import type { AgentModel } from './host/types/agent';
import { effortFor, effortName, optionFor, type ModelOption } from './runtime/models';
import { setPrefs, usePrefs } from './settings/prefs';
import { ScrollDock, WheelStepper } from './ScrollDock';
import { host } from './host';
import type { AgentInstall } from './host/types/settings';
import { linkedAccountId } from './settings/accounts';
import { HARNESS_IDS } from './settings/harnesses';
import { useSpace } from './store';
import { ProviderMark } from './ui';

const HARNESSES = { claude: 'Claude Code', codex: 'Codex' } satisfies Record<Provider, string>;

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
  const harnesses = (Object.keys(HARNESSES) as Provider[]).filter((h) => !isLocked || h === provider);
  const listed = harnesses.flatMap((h) => (catalog[h] ?? []).map((m): ModelOption => ({ ...m, harness: h })));
  const model = optionFor(catalog[provider], value, provider);
  const models = listed.some((m) => m.harness === model.harness && m.id === model.id) ? listed : [...listed, model];
  const docked = models.filter((m) => m === model || (m.harness === model.harness && m.id === model.id) || (!unavailable[m.harness] && !m.isUnavailable && (favorites.includes(m.id) || defaults?.[m.harness] === m.id)));
  const select = (id: string) => onChange(models.find((m) => m.id === id)!);
  const toggleFavorite = (id: string) => setPrefs({ starredModels: toggleStar(favorites, id) });

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <ScrollDock
        label="Model"
        value={model.id}
        onChange={select}
        items={docked.map((m) => ({ value: m.id, label: m.name, icon: <ProviderMark provider={m.harness} size={18} /> }))}
      >
        <PopoverTrigger asChild>
          <Button id={id} variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground">
            <ProviderMark provider={model.harness} size={14} />
            {model.name}
            {model.isUnavailable && <span className="type-caption text-warning">Unavailable</span>}
            <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
          </Button>
        </PopoverTrigger>
      </ScrollDock>
      <PopoverContent align="start" className="w-80 p-0">
        <ModelMenu
          models={models}
          pending={harnesses.filter((h) => !catalog[h])}
          harnesses={harnesses}
          isChecked={(m) => m.harness === model.harness && m.id === model.id}
          onPick={(m) => {
            select(m.id);
            setOpen(false);
          }}
          starred={favorites}
          onToggleStar={(m) => toggleFavorite(m.id)}
          unavailable={unavailable}
        >
          <p className="px-3 py-2 type-caption text-subtle-foreground">Starred models show up when you scroll over the model button.</p>
        </ModelMenu>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Harnesses first (plus Starred, where stars apply), then one list's models; typing searches every harness at once, and
 * Backspace in an empty search goes back. `pending`: harnesses whose list hasn't arrived yet.
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
  children?: ReactNode;
}) {
  const space = useSpace();
  const notes = useHarnessNotes(space.id);
  const [page, setPage] = useState<Provider | 'starred' | null>(harnesses.length === 1 ? harnesses[0] : null);
  const [search, setSearch] = useState('');
  const canGoBack = !!page && harnesses.length > 1 && !search;
  const shown = search ? harnesses : page && page !== 'starred' ? [page] : [];
  const starredModels = models.filter((m) => starred?.includes(m.id));
  const hasStarredPage = !!onToggleStar && starredModels.length > 0;
  const isLoading = pending.length === harnesses.length;
  const row = (m: ModelOption, hasMark?: boolean) => (
    <ModelRow
      key={`${m.harness}:${m.id}`}
      model={m}
      isChecked={isChecked(m)}
      isDisabled={!!unavailable[m.harness] || !!m.isUnavailable}
      onPick={onPick}
      isStarred={!!starred?.includes(m.id)}
      onToggleStar={onToggleStar}
      hasMark={hasMark}
    />
  );

  return (
    <Command filter={matchesEvery}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={page && !search ? `Search ${page === 'starred' ? 'starred' : HARNESSES[page]} models` : 'Search models'}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && canGoBack) setPage(null);
        }}
      />
      {canGoBack && (
        <button type="button" onClick={() => setPage(null)} className="mx-1 mt-1 flex items-center gap-1.5 rounded-md px-2 py-1 type-meta text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft aria-hidden className="size-3.5" />
          All models
        </button>
      )}
      <CommandList className="max-h-80">
        <CommandEmpty>{isLoading ? 'Asking the harnesses for their models…' : page === 'starred' && !search ? 'Nothing starred anymore.' : 'No model matches.'}</CommandEmpty>
        {page === 'starred' && !search && <CommandGroup>{starredModels.map((m) => row(m, true))}</CommandGroup>}
        {!page && !search && (
          <CommandGroup>
            {hasStarredPage && (
              <CommandItem value="Starred" onSelect={() => setPage('starred')} className="gap-2 [&>svg:last-child]:hidden">
                {/* A span, not the svg itself: the item recolours its direct svg children when highlighted. */}
                <span aria-hidden className="text-warning">
                  <Star className="size-4 [&_*]:fill-current" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">Starred</span>
                  <span className="truncate type-caption text-subtle-foreground">{starredModels.map((m) => m.name).join(', ')}</span>
                </span>
                <ChevronRight aria-hidden className="text-subtle-foreground" />
              </CommandItem>
            )}
            {harnesses.map((h) => (
              <CommandItem key={h} value={HARNESSES[h]} onSelect={() => setPage(h)} className="gap-2 [&>svg:last-child]:hidden">
                <ProviderMark provider={h} size={16} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{HARNESSES[h]}</span>
                  <span className="truncate type-caption text-subtle-foreground">{[harnessSummary(models.filter((m) => m.harness === h), isChecked, pending.includes(h)), notes[h]].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="type-caption text-subtle-foreground">{unavailable[h] ?? space.plans[h]}</span>
                <ChevronRight aria-hidden className="text-subtle-foreground" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {shown.map((h) => (
          <CommandGroup key={h} heading={search ? <HarnessHeading harness={h} /> : undefined}>
            {models.filter((m) => m.harness === h).map((m) => row(m))}
          </CommandGroup>
        ))}
      </CommandList>
      {children}
    </Command>
  );
}

function ModelRow({ model, isChecked, isDisabled, onPick, isStarred, onToggleStar, hasMark }: { model: ModelOption; isChecked: boolean; isDisabled: boolean; onPick: (model: ModelOption) => void; isStarred: boolean; onToggleStar?: (model: ModelOption) => void; hasMark?: boolean }) {
  return (
    <CommandItem value={`${HARNESSES[model.harness]} ${model.name} ${model.id}`} data-checked={isChecked} disabled={isDisabled} onSelect={() => onPick(model)} className="gap-2">
      {!!onToggleStar && <FavoriteToggle isOn={isStarred} name={model.name} onToggle={() => onToggleStar(model)} />}
      {hasMark && <ProviderMark provider={model.harness} size={14} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{model.name}</span>
        <span className={cn('truncate type-caption', model.isUnavailable ? 'text-warning' : 'text-subtle-foreground')}>{model.description}</span>
      </span>
    </CommandItem>
  );
}

// cmdk's default fuzzy match finds "luna" in "cLaUde soNnet 5.5"; every typed word must appear as written instead.
function matchesEvery(value: string, search: string) {
  const text = value.toLowerCase();
  return search.toLowerCase().split(/\s+/).every((word) => text.includes(word)) ? 1 : 0;
}

function HarnessHeading({ harness }: { harness: Provider }) {
  return (
    <span className="flex items-center gap-1.5">
      <ProviderMark provider={harness} size={12} />
      {HARNESSES[harness]}
    </span>
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
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm text-subtle-foreground hover:text-foreground"
    >
      <Star className={cn('size-3.5', isOn && 'text-warning [&_*]:fill-current')} />
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
