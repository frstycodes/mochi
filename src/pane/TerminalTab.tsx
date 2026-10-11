import { Check } from 'reicon-react';
import type { PaneTabProps } from './tabs';

export function TerminalTab({ thread }: PaneTabProps) {
  const runs = thread.activity.filter((a) => a.kind === 'tool' && a.text.startsWith('Run '));
  return (
    <div className="m-2 h-[calc(100%-1rem)] overflow-y-auto rounded-xl bg-card p-3 font-mono text-xs leading-relaxed ring-1 ring-border">
      {runs.length === 0 && <span className="text-subtle-foreground">No commands yet.</span>}
      {runs.map((r, i) => (
        <div key={i}>
          <span className="text-subtle-foreground">$ </span>
          {r.text.slice(4)}
          <div className="flex items-center gap-1 text-success">
            <Check className="size-3" />
            done
          </div>
        </div>
      ))}
    </div>
  );
}
