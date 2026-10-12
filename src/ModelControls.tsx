import { useEffect, useState } from 'react';
import { Check, ChevronDown, Star } from 'reicon-react';
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
        <Command>
          <CommandInput placeholder="Search models" />
          <CommandList className="max-h-80">
            <CommandEmpty>No model matches.</CommandEmpty>
            {harnesses.map((h) => (
              <CommandGroup
                key={h}
                heading={
                  <span className="flex items-center gap-1.5">
                    <ProviderMark provider={h} size={12} />
                    {HARNESSES[h]}
                    <span className="ml-auto font-normal text-subtle-foreground">{unavailable[h] ?? space.plans[h]}</span>
                  </span>
                }
              >
                {models.filter((m) => m.harness === h).map((m) => (
                  <CommandItem
                    key={`${h}:${m.id}`}
                    value={`${HARNESSES[h]} ${m.name}`}
                    disabled={!!unavailable[h] || m.isUnavailable}
                    onSelect={() => {
                      select(m.id);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <FavoriteToggle isOn={favorites.includes(m.id)} name={m.name} onToggle={() => toggleFavorite(m.id)} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{m.name}</span>
                      <span className={cn('truncate type-caption', m.isUnavailable ? 'text-warning' : 'text-subtle-foreground')}>{m.description}</span>
                    </span>
                    <Check className={cn('size-4', m.id !== model.id && 'invisible')} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <p className="px-3 py-2 type-caption text-subtle-foreground">Starred models show up when you scroll over the model button.</p>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
  const { efforts } = model;
  if (!efforts.length) return null;
  const effort = effortFor(model, value);
  const label = effort ? effortName(effort) : 'Default';
  return (
    <DropdownMenu>
      <WheelStepper values={efforts} value={effort ?? ''} onChange={setEffort}>
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
