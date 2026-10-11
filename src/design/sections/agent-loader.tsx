import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AgentLoader, PHASE_LABELS } from '../../AgentLoader';
import { PHASES, type AgentPhase } from '../../agentShape';
import { Block } from '../layout';

export function AgentLoaderBlock() {
  const [phase, setPhase] = useState<AgentPhase>('think');
  const [isCycling, setCycling] = useState(true);

  useEffect(() => {
    if (!isCycling) return;
    const id = setInterval(() => setPhase((p) => PHASES[(PHASES.indexOf(p) + 1) % PHASES.length]), 2200);
    return () => clearInterval(id);
  }, [isCycling]);

  function pick(next: string) {
    if (!next) return;
    setPhase(next as AgentPhase);
    setCycling(false);
  }

  return (
    <Block wide title="Agent loader" use="One set of dots, shaded by depth, that rearranges into a form per phase and keeps its own rhythm. Switch phases mid-morph: it retargets from where it is.">
      <div className="flex flex-col gap-4 rounded-xl border p-4">
        <div className="flex items-center gap-8">
          <AgentLoader phase={phase} className="size-12" />
          <span className="flex items-center gap-1.5 type-meta text-muted-foreground">
            <AgentLoader phase={phase} className="text-foreground" />
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
