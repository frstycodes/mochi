import { useId, useRef, useState, type CSSProperties } from 'react';
import { useAnimationFrame, useInView, useReducedMotionConfig } from 'motion/react';
import { cn } from '@/lib/utils';
import { blendPose, BODY, GROUND, oneHot, PHASES, poseAttributes, propShapes, stepWeights, VIEW_BOX, type AgentPhase, type Shape } from './agentShape';
import { PHASE_LABELS } from './agentPhase';

export type { AgentPhase } from './agentShape';

/** Mochi flavours: the body's lit, base and shaded tones, the eye, and the blush. Vanilla is the logo's. Same in both themes: it's an object, not chrome. */
export const MOCHI_FLAVORS = {
  vanilla: { light: 'oklch(0.995 0.004 90)', base: 'oklch(0.95 0.01 85)', shade: 'oklch(0.76 0.025 75)', ink: 'oklch(0.22 0.01 285)', blush: 'oklch(0.8 0.09 15)' },
  matcha: { light: 'oklch(0.95 0.07 128)', base: 'oklch(0.84 0.12 130)', shade: 'oklch(0.6 0.12 135)', ink: 'oklch(0.25 0.04 140)', blush: 'oklch(0.76 0.11 30)' },
  sakura: { light: 'oklch(0.97 0.03 0)', base: 'oklch(0.88 0.07 355)', shade: 'oklch(0.68 0.12 355)', ink: 'oklch(0.27 0.04 350)', blush: 'oklch(0.7 0.15 10)' },
  ube: { light: 'oklch(0.92 0.05 300)', base: 'oklch(0.76 0.11 300)', shade: 'oklch(0.54 0.14 300)', ink: 'oklch(0.22 0.05 300)', blush: 'oklch(0.75 0.11 350)' },
  mango: { light: 'oklch(0.97 0.07 95)', base: 'oklch(0.88 0.14 80)', shade: 'oklch(0.7 0.15 60)', ink: 'oklch(0.27 0.05 50)', blush: 'oklch(0.7 0.16 30)' },
  soda: { light: 'oklch(0.96 0.04 220)', base: 'oklch(0.84 0.09 225)', shade: 'oklch(0.62 0.12 235)', ink: 'oklch(0.24 0.05 240)', blush: 'oklch(0.78 0.09 10)' },
};
export type MochiFlavor = keyof typeof MOCHI_FLAVORS;

type Frame = ReturnType<typeof poseAttributes> & { props: Shape[][] };
const IDLE = PHASES.indexOf('idle');
const IDLE_FRAME_MS = 1000 / 30;

/** Mochi, the logo's dome, acting out each phase with a prop (zzz, thought cloud, book, pencil, lens, question); phases blend instead of cutting. */
export function AgentLoader({ phase, flavor = 'vanilla', className }: { phase: AgentPhase; flavor?: MochiFlavor; className?: string }) {
  const reduce = useReducedMotionConfig();
  const id = `mochi${useId().replace(/\W/g, '')}`;
  const refs = useFrameRefs();
  const svg = useRef<SVGSVGElement>(null);
  // Offscreen (a pinned page beside the one in view, a row scrolled away), the pose holds still instead of costing a frame callback.
  const isOnScreen = useInView(svg);
  const [morph] = useState(() => ({ weights: oneHot(phase), velocities: new Float32Array(PHASES.length) }));
  const [first] = useState(() => frameAt(PHASES.map(() => 1), 0, morph.weights));
  // Animated, React keeps the first frame so a re-render never snaps the pose back; the frame loop owns the attributes.
  const frame = reduce ? frameAt(PHASES.map(() => 1), 0, oneHot(phase)) : first;
  const weights = reduce ? oneHot(phase) : morph.weights;

  const paintedAt = useRef(0);
  useAnimationFrame((time, delta) => {
    if (reduce || !isOnScreen) return;
    stepWeights(morph.weights, morph.velocities, phase, Math.min(delta, 100) / 1000);
    // Settled idle is a slow breath: 30fps reads the same as 120 and repaints (and re-runs the backdrop blurs) a quarter as often.
    const isSettledIdle = phase === 'idle' && morph.weights[IDLE] > 0.999;
    if (isSettledIdle && time - paintedAt.current < IDLE_FRAME_MS) return;
    paintedAt.current = time;
    paint(refs, morph.weights, frameAt(morph.weights, time / 1000));
  });

  const colors = MOCHI_FLAVORS[flavor];
  const style = { '--mochi-light': colors.light, '--mochi-base': colors.base, '--mochi-shade': colors.shade } as CSSProperties;

  return (
    <svg ref={svg} viewBox={VIEW_BOX} role="img" aria-label={PHASE_LABELS[phase]} className={cn('size-5 shrink-0 overflow-visible', className)} style={style}>
      <defs>
        <radialGradient id={`${id}-body`} cx="0.36" cy="0.3" r="0.9">
          <stop offset="0" style={{ stopColor: 'var(--mochi-light)' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--mochi-base)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mochi-shade)' }} />
        </radialGradient>
        <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.7" style={{ stopColor: 'var(--mochi-shade)' }} stopOpacity="0" />
          <stop offset="1" style={{ stopColor: 'var(--mochi-shade)' }} stopOpacity="0.7" />
        </linearGradient>
        <radialGradient id={`${id}-shine`}>
          <stop offset="0" stopColor="white" stopOpacity="0.9" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="black" stopOpacity="0.4" />
          <stop offset="1" stopColor="black" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse ref={refs.shadow} cy={GROUND[1] + 0.3} ry={1.1} {...frame.shadow} fill={`url(#${id}-shadow)`} />
      <g ref={refs.body} transform={frame.body}>
        {/* Light pages wash out the pale flavours; drawn under the body so only the outer 1px shows, at any size. */}
        <path d={BODY} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className="stroke-foreground/25 dark:stroke-transparent" />
        <path d={BODY} fill={`url(#${id}-body)`} />
        <path d={BODY} fill={`url(#${id}-base)`} stroke={colors.shade} strokeOpacity={0.5} strokeWidth={0.3} />
        <ellipse cx={-2.7} cy={-7.2} rx={2.3} ry={1.2} transform="rotate(-25 -2.7 -7.2)" fill={`url(#${id}-shine)`} />
        <ellipse cx={3.3} cy={-2.9} rx={1} ry={0.5} fill={colors.blush} opacity={0.6} />
        <ellipse ref={refs.eye} {...frame.eye} fill={colors.ink} />
        <circle ref={refs.glint} {...frame.glint} fill="white" />
      </g>
      {PHASES.map((p, k) => (
        <g key={p} ref={(el) => void (refs.props.current[k] = el)} opacity={weights[k]} fill="none" strokeLinecap="round" strokeLinejoin="round">
          {frame.props[k].map((s, i) => (
            <path key={i} d={s.d} opacity={s.o} fill={s.fill ?? 'none'} stroke={s.stroke} strokeWidth={s.w} />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Props are only computed for phases on screen; the first render asks for all of them to lay out every shape once. */
function frameAt(visible: ArrayLike<number>, t: number, weights = visible): Frame {
  const pose = blendPose(weights, t);
  return { ...poseAttributes(pose), props: PHASES.map((p, k) => (visible[k] >= 0.002 ? propShapes(p, t, pose) : [])) };
}

function useFrameRefs() {
  // Hooks as statements: React Compiler 1.0 memoizes an object literal of `useRef` calls, so they only run on the first render.
  const shadow = useRef<SVGEllipseElement>(null);
  const body = useRef<SVGGElement>(null);
  const eye = useRef<SVGEllipseElement>(null);
  const glint = useRef<SVGCircleElement>(null);
  const props = useRef<(SVGGElement | null)[]>([]);
  return { shadow, body, eye, glint, props };
}

function paint(refs: ReturnType<typeof useFrameRefs>, weights: ArrayLike<number>, frame: Frame) {
  refs.body.current?.setAttribute('transform', frame.body);
  setAttributes(refs.eye.current, frame.eye);
  setAttributes(refs.glint.current, frame.glint);
  setAttributes(refs.shadow.current, frame.shadow);
  refs.props.current.forEach((group, k) => {
    if (!group) return;
    group.setAttribute('opacity', weights[k].toFixed(3));
    frame.props[k].forEach((s, i) => setAttributes(group.children[i] as SVGElement | undefined, { d: s.d, opacity: s.o.toFixed(3) }));
  });
}

function setAttributes(el: SVGElement | null | undefined, attributes: Record<string, string>) {
  for (const [name, value] of Object.entries(attributes)) el?.setAttribute(name, value);
}
