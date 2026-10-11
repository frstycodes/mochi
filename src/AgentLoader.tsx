import { useRef, useState, type RefObject } from 'react';
import { useAnimationFrame, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { blendDots, DOTS, oneHot, PHASES, SHADES, shadePaths, stepWeights, type AgentPhase } from './agentShape';
import type { ActivityEntry, Thread } from './model';
import { toolVerb, type ToolVerb } from './summary';

export type { AgentPhase } from './agentShape';

const VERB_PHASE = { Read: 'read', Edit: 'edit', Write: 'edit', Run: 'run', Browser: 'browse' } satisfies Record<ToolVerb, AgentPhase>;

export const PHASE_LABELS = { think: 'Thinking', read: 'Reading', edit: 'Editing', run: 'Running', browse: 'Browsing', wait: 'Waiting on you' } satisfies Record<AgentPhase, string>;

/** What the agent is doing right now, read from its latest activity. */
export function agentPhase(thread: Thread): AgentPhase {
  if (thread.status === 'needs-you') return 'wait';
  const last = [...thread.activity].reverse().find((e) => e.kind === 'tool' || e.kind === 'reasoning');
  return entryPhase(last);
}

export function entryPhase(entry?: ActivityEntry): AgentPhase {
  if (!entry || entry.kind === 'reasoning') return 'think';
  return VERB_PHASE[toolVerb(entry.text)];
}

/** One set of dots, shaded by depth, that rearranges into a different form per phase and keeps moving in that phase's rhythm. */
export function AgentLoader({ phase, className }: { phase: AgentPhase; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={PHASE_LABELS[phase]} className={cn('size-4 shrink-0', className)} fill="currentColor">
      {reduce ? <Shades paths={shadePaths(blendDots(oneHot(phase), 0))} /> : <MorphingShades phase={phase} />}
    </svg>
  );
}

function MorphingShades({ phase }: { phase: AgentPhase }) {
  const refs = useRef<(SVGPathElement | null)[]>([]);
  const [morph] = useState(() => ({ weights: oneHot(phase), velocities: new Float32Array(PHASES.length), dots: new Float32Array(DOTS * 4) }));
  const [initial] = useState(() => shadePaths(blendDots(morph.weights, 0)));

  useAnimationFrame((time, delta) => {
    stepWeights(morph.weights, morph.velocities, phase, Math.min(delta, 100) / 1000);
    shadePaths(blendDots(morph.weights, time / 1000, morph.dots)).forEach((d, i) => refs.current[i]?.setAttribute('d', d));
  });

  return <Shades paths={initial} refs={refs} />;
}

function Shades({ paths, refs }: { paths: string[]; refs?: RefObject<(SVGPathElement | null)[]> }) {
  return paths.map((d, i) => (
    <path
      key={SHADES[i]}
      ref={(el) => {
        if (refs) refs.current[i] = el;
      }}
      d={d}
      fillOpacity={SHADES[i]}
    />
  ));
}
