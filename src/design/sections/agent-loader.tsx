import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AgentLoader, MOCHI_FLAVORS, type MochiFlavor } from '../../AgentLoader';
import { PHASE_LABELS } from '../../agentPhase';
import { PHASES, type AgentPhase } from '../../agentShape';
import { Block } from '../layout';

const FLAVORS = Object.keys(MOCHI_FLAVORS) as MochiFlavor[];

export function AgentLoaderBlock() {
  const [phase, setPhase] = useState<AgentPhase>('start');
  const [flavor, setFlavor] = useState<MochiFlavor>('vanilla');
  const [isCycling, setCycling] = useState(true);

  useEffect(() => {
    if (!isCycling) return;
    const id = setInterval(() => setPhase((p) => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]), 3400);
    return () => clearInterval(id);
  }, [isCycling]);

  function pick(next: string) {
    if (!next) return;
    setPhase(next as AgentPhase);
    setCycling(false);
  }

  return (
    <Block
      wide
      title="Agent loader"
      use="Mochi acts out what the agent is doing: dozes with z's then jolts awake (starting), a thought cloud (thinking), an open book (reading), a pencil (editing), hopping with speed lines (running), a magnifying glass (browsing), a question bubble (waiting on you). Switch phases mid-move: it blends from where it is."
    >
      <div className="flex flex-col gap-6 rounded-xl border p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-4">
          {PHASES.map((p) => (
            <div key={p} className="flex flex-col items-center gap-2">
              <AgentLoader phase={p} flavor={flavor} className="size-24 text-foreground" />
              <span className="type-caption text-muted-foreground">{PHASE_LABELS[p]}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-4">
          {FLAVORS.map((f) => (
            <button key={f} type="button" aria-pressed={f === flavor} onClick={() => setFlavor(f)} className="flex flex-col items-center gap-2 rounded-xl py-2 hover:bg-accent/60 aria-pressed:bg-accent">
              <AgentLoader phase="wait" flavor={f} className="size-14 text-foreground" />
              <span className="type-caption text-muted-foreground capitalize">{f}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-8">
          <AgentLoader phase={phase} flavor={flavor} className="size-16 text-foreground" />
          <span className="flex items-center gap-1.5 type-meta text-muted-foreground">
            <AgentLoader phase={phase} flavor={flavor} className="text-foreground" />
            {PHASE_LABELS[phase]}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={phase} onValueChange={pick} aria-label="Agent phase">
            {PHASES.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {PHASE_LABELS[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <Switch id="loader-cycle" checked={isCycling} onCheckedChange={setCycling} />
            <Label htmlFor="loader-cycle">Cycle phases</Label>
          </div>
        </div>
      </div>
    </Block>
  );
}
