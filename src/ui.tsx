import { type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Book, Briefcase, ClipboardTick, Code, Coffee, Home, Layers, MoreH, Rocket, Star, RecordCircle as Circle, CheckCircle as CircleCheck, Forbidden as CircleSlash, Hand, Link as Link2, createIcon, MessageQuestion as MessageCircleQuestion, type IconComponent as LucideIcon, type IconProps } from 'reicon-react';
import type { LineSlot, Provider, Space, SpaceIconName, StepStatus, ThreadStatus } from './model';

export function lineColor(slot: LineSlot) {
  return `var(--chart-${slot})`;
}

export const SPACE_ICONS = { work: Briefcase, home: Home, layers: Layers, code: Code, book: Book, rocket: Rocket, coffee: Coffee, star: Star } satisfies Record<SpaceIconName, LucideIcon>;

export function SpaceIcon({ space, className }: { space: Space; className?: string }) {
  const Icon = SPACE_ICONS[space.icon];
  return <Icon aria-hidden className={className} />;
}

export function ProviderMark({ provider, size = 16, className }: { provider: Provider; size?: number; className?: string }) {
  if (provider === 'claude') return <ClaudeMark size={size} className={className} />;
  return <CodexMark size={size} className={className} />;
}

function ClaudeMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Claude" className={cn('shrink-0', className)}>
      <path
        fill="#D97757"
        d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      />
    </svg>
  );
}

function CodexMark({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Codex" className={cn('shrink-0 text-foreground', className)}>
      <path
        fill="currentColor"
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"
      />
    </svg>
  );
}

export function ProviderMarks({ providers, size = 14 }: { providers: Provider[]; size?: number }) {
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {providers.map((p) => (
        <ProviderMark key={p} provider={p} size={size} className="rounded-sm ring-2 ring-sidebar" />
      ))}
    </span>
  );
}

export function LiveDot({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn('pulse relative inline-block size-2 shrink-0 rounded-full bg-current', className)} style={style} />;
}

export function ThreadStatusIcon({ status }: { status: ThreadStatus }) {
  if (status === 'running') return <LiveDot className="mx-1 text-success" />;
  if (status === 'needs-you') return <MessageCircleQuestion aria-label="Needs you" className="size-4 shrink-0 text-warning" />;
  if (status === 'review') return <ClipboardTick aria-label="Ready for review" className="size-4 shrink-0 text-muted-foreground" />;
  return <CircleCheck aria-label="Settled" className="size-4 shrink-0 text-subtle-foreground" />;
}

const STEP_ICONS = {
  done: CircleCheck,
  ready: Circle,
  waiting: Link2,
  blocked: Hand,
  dropped: CircleSlash,
} satisfies Record<Exclude<StepStatus, 'running'>, LucideIcon>;

const STEP_LABELS = {
  done: 'Done',
  running: 'Running',
  ready: 'Up next',
  waiting: 'Waiting on another thread',
  blocked: 'Needs you',
  dropped: 'Dropped',
} satisfies Record<StepStatus, string>;

export function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <LiveDot className="mx-1" style={{ color: stepColor(status) }} />;
  const Icon = STEP_ICONS[status];
  return <Icon aria-label={STEP_LABELS[status]} className="size-4 shrink-0" style={{ color: stepColor(status) }} />;
}

function stepColor(status: StepStatus) {
  return STEP_COLORS[status];
}

const STEP_COLORS = {
  done: 'var(--success)',
  running: 'var(--chart-1)',
  ready: 'var(--muted-foreground)',
  waiting: 'var(--chart-5)',
  blocked: 'var(--warning)',
  dropped: 'var(--subtle-foreground)',
} satisfies Record<StepStatus, string>;

export function stepLabel(status: StepStatus) {
  return STEP_LABELS[status];
}

/**
 * One segment per criterion, filled as each is met and green once all are, so it reads as a count, never a share of the work.
 * No criteria: the ring shows state only. `isWorking` set: it spins in the line colour (a quarter arc when nothing is met yet,
 * so it still moves) and rests grey when idle.
 */
export function ProgressRing({ met, total, slot, size = 16, isWorking }: { met: number; total: number; slot: LineSlot; size?: number; isWorking?: boolean }) {
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? Math.min(2, c / total / 3) : 0;
  const segment = total ? c / total - gap : 0;
  const isDone = total > 0 && met === total;
  const color = isDone ? 'var(--success)' : isWorking === false ? 'var(--muted-foreground)' : lineColor(slot);
  // Dash pattern: `met` segments then the rest of the circle blank; with nothing met while working, the spinner's quarter arc.
  const fill = met > 0 ? `${Array.from({ length: met }, () => `${segment} ${gap}`).join(' ')} 0 ${c}` : isWorking ? `${c / 4} ${c}` : `0 ${c}`;
  const circle = { cx: size / 2, cy: size / 2, r, fill: 'none', strokeWidth: 2 };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className={cn('shrink-0 -rotate-90', isWorking && 'origin-center animate-spin motion-reduce:animate-none')}>
      <circle {...circle} stroke="var(--muted-foreground)" strokeOpacity={0.4} strokeDasharray={total > 1 ? `${segment} ${gap}` : undefined} />
      <circle {...circle} stroke={color} strokeDasharray={fill} />
    </svg>
  );
}

/**
 * Icon-only button with a real tooltip (never a native `title`). `label` is also its accessible name; `hint` adds a second line.
 * A disabled button gets no pointer events, so the tooltip hangs on a wrapper and can still say why it is disabled.
 */
export function TooltipIconButton({ label, hint, children, ...props }: { label: string; hint?: ReactNode } & Omit<ComponentProps<typeof Button>, 'aria-label'>) {
  const button = (
    <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{props.disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
      <TooltipContent className="max-w-60 flex-col items-start gap-0.5">
        <span className="block font-medium">{label}</span>
        {!!hint && <span className="block opacity-80">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The overflow-menu icon: reicon MoreH, filled. `vertical` (⋮, reicon has no MoreV, so the same dots turned 90°) is for a menu that belongs
 * to one item or card and for the end of an address bar; horizontal (⋯) is for app headers and toolbars.
 */
export function OverflowIcon({ vertical, className, ...props }: IconProps & { vertical?: boolean }) {
  return <MoreH weight="Filled" className={cn(vertical && 'rotate-90', className)} {...props} />;
}

// reicon has no fork arrow (a line that splits in two, like `-<`): drawn on its 24px grid at its 1.5 stroke. The one fork icon everywhere.
export const ForkIcon = createIcon('ForkIcon', {
  O: `<path d="M3.75 12h5.5l6.5-6.25M9.25 12l6.5 6.25M13.25 5.75h2.5v2.5M13.25 18.25h2.5v-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
});
