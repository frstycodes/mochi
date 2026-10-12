import { useState } from 'react';
import { Check, ChevronDown, Star } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import { ScrollDock, WheelStepper } from './ScrollDock';
import { useSpace } from './store';
import { ProviderMark } from './ui';

export interface ModelOption {
  id: string;
  harness: Provider;
  name: string;
  note: string;
  context: string;
}

// GAP: fake catalog. The real list comes from each harness (Claude Agent SDK, Codex app-server) at connect time.
const MODELS: ModelOption[] = [
  { id: 'opus-5.5', harness: 'claude', name: 'Opus 5.5', note: 'Hardest problems and long runs', context: '200K' },
  { id: 'sonnet-5.5', harness: 'claude', name: 'Sonnet 5.5', note: 'Fast, strong default', context: '200K' },
  { id: 'haiku-5.5', harness: 'claude', name: 'Haiku 5.5', note: 'Quick edits and lookups', context: '200K' },
  { id: 'gpt-5.5-codex', harness: 'codex', name: 'GPT-5.5 Codex', note: 'Tuned for agentic coding', context: '272K' },
  { id: 'gpt-5.5', harness: 'codex', name: 'GPT-5.5', note: 'General reasoning', context: '272K' },
  { id: 'gpt-5.5-mini', harness: 'codex', name: 'GPT-5.5 mini', note: 'Cheap and fast', context: '128K' },
];

const HARNESSES = { claude: 'Claude Code', codex: 'Codex' } satisfies Record<Provider, string>;
const DEFAULT_FAVORITES = ['opus-5.5', 'sonnet-5.5', 'gpt-5.5-codex'];
const EFFORTS = ['Low', 'Medium', 'High', 'Extra high'] as const;
type Effort = (typeof EFFORTS)[number];

export function ModelPicker({ provider, onModelChange }: { provider: Provider; onModelChange?: (model: ModelOption) => void }) {
  const space = useSpace();
  const [modelId, setModelId] = useState(() => MODELS.find((m) => m.harness === provider)!.id);
  const [favorites, setFavorites] = useState(DEFAULT_FAVORITES);
  const [isOpen, setOpen] = useState(false);
  const model = MODELS.find((m) => m.id === modelId)!;
  const docked = MODELS.filter((m) => favorites.includes(m.id) || m.id === modelId);
  const select = (id: string) => {
    setModelId(id);
    onModelChange?.(MODELS.find((m) => m.id === id)!);
  };
  const toggleFavorite = (id: string) => setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <ScrollDock
        label="Model"
        value={modelId}
        onChange={select}
        items={docked.map((m) => ({ value: m.id, label: m.name, icon: <ProviderMark provider={m.harness} size={18} /> }))}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground">
            <ProviderMark provider={model.harness} size={14} />
            {model.name}
            <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
          </Button>
        </PopoverTrigger>
      </ScrollDock>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search models" />
          <CommandList className="max-h-80">
            <CommandEmpty>No model matches.</CommandEmpty>
            {(Object.keys(HARNESSES) as Provider[]).map((h) => (
              <CommandGroup
                key={h}
                heading={
                  <span className="flex items-center gap-1.5">
                    <ProviderMark provider={h} size={12} />
                    {HARNESSES[h]}
                    <span className="ml-auto font-normal text-subtle-foreground">{space.plans[h]}</span>
                  </span>
                }
              >
                {MODELS.filter((m) => m.harness === h).map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${HARNESSES[h]} ${m.name}`}
                    onSelect={() => {
                      select(m.id);
                      setOpen(false);
                    }}
                    className="gap-2"
                  >
                    <FavoriteToggle isOn={favorites.includes(m.id)} name={m.name} onToggle={() => toggleFavorite(m.id)} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{m.name}</span>
                      <span className="truncate type-caption text-subtle-foreground">{m.note}</span>
                    </span>
                    <span className="font-mono text-xs text-subtle-foreground tabular">{m.context}</span>
                    <Check className={cn('size-4', m.id !== modelId && 'invisible')} />
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

export function EffortPicker() {
  const [effort, setEffort] = useState<Effort>('High');
  return (
    <DropdownMenu>
      <WheelStepper values={EFFORTS} value={effort} onChange={setEffort}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground" aria-label={`Reasoning effort: ${effort}`}>
            <EffortMeter level={EFFORTS.indexOf(effort) + 1} />
            {effort}
            <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </WheelStepper>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={effort} onValueChange={(v) => setEffort(v as Effort)}>
            {EFFORTS.map((e, i) => (
              <DropdownMenuRadioItem key={e} value={e} className="gap-2">
                <EffortMeter level={i + 1} />
                {e}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EffortMeter({ level }: { level: number }) {
  return (
    <span aria-hidden className="flex h-3 items-end gap-px">
      {EFFORTS.map((_, i) => (
        <span key={i} className={cn('w-[3px] rounded-full bg-current', i >= level && 'opacity-25')} style={{ height: `${40 + i * 20}%` }} />
      ))}
    </span>
  );
}
