import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Archive, ArrowRight, ArrowUpRight, ClockCircle, XCircle, Edit, Eye, Hierarchy2, MagicStar, MessageEdit, CheckBadge, UserCheck, type IconComponent } from '@/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { GitMergeIcon, GithubStateIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import { usePrSwitches, type PrSwitch, type PrSwitchId } from '../git/prSwitches';
import { useThreadPr } from '../git/useThreadPrs';
import type { PullRequest, Thread } from '../model';
import { timeAgo } from '../progress';
import { refKey, refStatus, refTone, refUrl, STATUS_WORDS, type ChecksState, type GithubRef, type RefState, type ReviewState } from './refs';

/** One PR or issue reference: `githubRef` when its repo is known, `label` (`#482`) for the trigger and the card's fallback title. */
export interface RefItem {
  githubRef: GithubRef | null;
  label: string;
  /** `undefined` while loading, `null` when gh couldn't read it. */
  state: RefState | null | undefined;
}

type Placement = Pick<ComponentProps<typeof HoverCardContent>, 'side' | 'align'>;

/** Wraps a PR or issue trigger; hovering it (300ms) or focusing it opens the preview. The caller already holds the state, from `useRefState`. */
export function RefHoverCard({ item, side, align, footer, children }: Placement & { item: RefItem; footer?: ReactNode; children: ReactElement }) {
  return (
    <HoverCard openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} collisionPadding={8} className={cn('flex w-80 flex-col gap-3 p-3', REDUCED_MOTION)}>
        <RefPreview item={item} />
        {footer}
      </HoverCardContent>
    </HoverCard>
  );
}

/** `RefHoverCard` for one of a thread's PRs, reading its live state, with its switches while Mochi can watch it. */
export function ThreadPrHoverCard({ thread, pr, ...props }: Placement & { thread: Thread; pr: PullRequest; children: ReactElement }) {
  const item = useThreadPr(thread, pr);
  const switches = usePrSwitches(thread, item);
  const footer = switches.length > 0 && (
    <div className="flex flex-col gap-2.5 border-t pt-3">
      {switches.map((s) => (
        <PrSwitchRow key={s.id} item={s} />
      ))}
    </div>
  );
  return <RefHoverCard item={item} footer={footer} {...props} />;
}

const SWITCH_ICONS = { autofix: MagicStar, merge: GitMergeIcon, archive: Archive } satisfies Record<PrSwitchId, unknown>;

function PrSwitchRow({ item }: { item: PrSwitch }) {
  const id = useId();
  const Icon = SWITCH_ICONS[item.id];
  return (
    <div className="flex min-w-0 items-center gap-2 type-meta">
      <Icon aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
      <label htmlFor={id} className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground">{item.label}</span>
        <span className="truncate type-caption text-subtle-foreground">{item.hint}</span>
      </label>
      <Switch id={id} size="sm" checked={item.isOn} onCheckedChange={item.set} />
    </div>
  );
}

/** Every ref in `items` as one compact list, for a stack that shows only some of them. */
export function RefListHoverCard({ items, title, side, align, children }: Placement & { items: RefItem[]; title: string; children: ReactElement }) {
  return (
    <HoverCard openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} collisionPadding={8} className={cn('flex w-80 flex-col gap-1 p-1.5', REDUCED_MOTION)}>
        {items.length > COUNT_FROM && <p className="px-1.5 pt-0.5 type-caption text-subtle-foreground">{title}</p>}
        {/* Every PR at once; a long list scrolls inside the card instead of growing past the screen. */}
        <ScrollArea type="scroll" className="[&>[data-slot=scroll-area-viewport]]:max-h-72">
          <ul className="flex flex-col gap-0.5">
            {items.map((item) => (
              <li key={item.label}>
                <RefListRow item={item} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </HoverCardContent>
    </HoverCard>
  );
}

// A short list counts itself at a glance; the heading only earns its line past this.
const COUNT_FROM = 5;
const OPEN_DELAY = 300;
const CLOSE_DELAY = 100;
// Reduced motion keeps the fade and drops the zoom and slide.
const REDUCED_MOTION = 'motion-reduce:[--tw-enter-scale:1]! motion-reduce:[--tw-exit-scale:1]! motion-reduce:[--tw-enter-translate-x:0]! motion-reduce:[--tw-enter-translate-y:0]!';

function RefPreview({ item }: { item: RefItem }) {
  const { state } = item;
  const url = itemUrl(item);
  return (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <RefIcon item={item} className="mt-0.5 size-4" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="line-clamp-2 font-medium text-foreground">{state?.title ?? item.label}</p>
          <p className="flex min-w-0 items-center gap-1 type-caption text-subtle-foreground">
            <span className="truncate tabular">{item.githubRef ? refKey(item.githubRef) : item.label}</span>
            <span aria-hidden>·</span>
            <span className={cn('shrink-0', REF_TONE_CLASS[refTone(state)])}>{statusWords(state)}</span>
          </p>
        </div>
      </div>
      {!!state && <RefFacts state={state} />}
      {!!url && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => window.open(url, '_blank', 'noreferrer')}>
          Open on GitHub
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      )}
    </>
  );
}

function RefFacts({ state }: { state: RefState }) {
  const isPr = state.kind === 'pr';
  const hasFacts = !!state.author || !!state.branch || !!state.diff || (isPr && (!!state.checks || !!state.review));
  if (!hasFacts) return null;
  return (
    <dl className="flex flex-col gap-1.5 type-meta">
      {!!state.author && (
        <Fact media={<AuthorAvatar author={state.author} />} label="Author">
          {state.author.login}
          {!!state.updatedAt && <span className="text-subtle-foreground"> · updated {timeAgo(minutesSince(state.updatedAt))}</span>}
        </Fact>
      )}
      {!!state.branch && (
        <Fact icon={Hierarchy2} label="Branch">
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate">{state.branch.head}</span>
            <ArrowRight aria-label="into" className="size-3 shrink-0 text-subtle-foreground" />
            <span className="shrink-0">{state.branch.base}</span>
          </span>
        </Fact>
      )}
      {!!state.diff && (
        <Fact icon={Edit} label="Changes">
          <span className="tabular">
            <span className="text-success">+{state.diff.added}</span> <span className="text-destructive">−{state.diff.removed}</span>
            <span className="text-subtle-foreground">
              {' '}
              · {state.diff.files} {PLURAL.select(state.diff.files) === 'one' ? 'file' : 'files'}
            </span>
          </span>
        </Fact>
      )}
      {isPr && !!state.checks && <Fact {...CHECKS[state.checks]} label="Checks" />}
      {isPr && !!state.review && <Fact {...REVIEWS[state.review]} label="Review" />}
    </dl>
  );
}

const CHECKS = {
  pass: { icon: CheckBadge, tone: 'text-success', children: 'Checks passing' },
  fail: { icon: XCircle, tone: 'text-destructive', children: 'Checks failing' },
  pending: { icon: ClockCircle, tone: 'text-warning', children: 'Checks running' },
} satisfies Record<ChecksState, { icon: IconComponent; tone: string; children: string }>;

const REVIEWS = {
  approved: { icon: CheckBadge, tone: 'text-success', children: 'Approved' },
  changes: { icon: MessageEdit, tone: 'text-warning', children: 'Changes requested' },
  required: { icon: Eye, tone: 'text-muted-foreground', children: 'Review requested' },
} satisfies Record<ReviewState, { icon: IconComponent; tone: string; children: string }>;

const PLURAL = new Intl.PluralRules('en');

type FactMedia = { icon: IconComponent; media?: never } | { media: ReactNode; icon?: never };

/** One row: the icon carries the tone, `label` names the row for screen readers only (the value says it). */
function Fact({ icon: Icon, media, tone, label, children }: FactMedia & { tone?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="sr-only">{label}</dt>
      {media ?? (!!Icon && <Icon aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground', tone)} />)}
      <dd className="min-w-0 flex-1 truncate text-foreground">{children}</dd>
    </div>
  );
}

/** The author's GitHub avatar in the icon column; the person icon shows until it loads, and offline. */
function AuthorAvatar({ author }: { author: NonNullable<RefState['author']> }) {
  return (
    <Avatar aria-hidden className="size-3.5">
      <AvatarImage src={author.avatarUrl} alt="" />
      <AvatarFallback className="bg-transparent">
        <UserCheck className="size-3.5 text-subtle-foreground" />
      </AvatarFallback>
    </Avatar>
  );
}

/** Title, then the most pressing status with its icon, the number and the diff, like Claude's PR chip. The row's project already names the repo. */
function RefListRow({ item }: { item: RefItem }) {
  const url = itemUrl(item);
  const { state } = item;
  const content = (
    <>
      <span className="w-full min-w-0 truncate text-foreground">{state?.title ?? item.label}</span>
      <span className="flex w-full min-w-0 items-center gap-1 type-caption text-subtle-foreground">
        <RefIcon item={item} className="size-3" />
        <ListStatus state={state} />
        <span className="ml-auto shrink-0 pl-2 tabular">{item.label}</span>
        {!!state?.diff && (
          <span className="shrink-0 tabular">
            <span className="text-success">+{state.diff.added}</span> <span className="text-destructive">−{state.diff.removed}</span>
          </span>
        )}
      </span>
    </>
  );
  const row = 'flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-1.5 py-1.5 text-left type-meta';
  if (!url) return <div className={row}>{content}</div>;
  return (
    <button type="button" onClick={() => window.open(url, '_blank', 'noreferrer')} className={cn(row, 'transition-colors hover:bg-accent')}>
      {content}
    </button>
  );
}

/** The ref's state icon in its tone; `hasConflicts` adds GitHub's corner mark. */
export function RefIcon({ item, className }: { item: RefItem; className?: string }) {
  const { state } = item;
  return <GithubStateIcon kind={state?.kind ?? item.githubRef?.kind ?? 'pr'} status={refStatus(state)} hasConflicts={state?.hasConflicts} className={cn(className, REF_TONE_CLASS[refTone(state)])} />;
}

/** "Open, has conflicts": the card's rows already say checks and review. */
function statusWords(state: RefState | null | undefined) {
  if (state === undefined) return 'Loading';
  if (state === null) return "GitHub couldn't be read";
  const status = state.isNotPlanned ? 'Not planned' : STATUS_WORDS[state.status];
  return state.status === 'open' && state.hasConflicts ? `${status}, has conflicts` : status;
}

/** A list row names only the most pressing thing about an open PR, in that thing's colour. */
function ListStatus({ state }: { state: RefState | null | undefined }) {
  const flag = state?.status === 'open' ? OPEN_FLAGS.find(([is]) => is(state)) : undefined;
  if (!flag) return <span className={cn('shrink-0 type-caption', REF_TONE_CLASS[refTone(state)])}>{statusWords(state)}</span>;
  return <span className={cn('shrink-0 type-caption', flag[2])}>{flag[1]}</span>;
}

const OPEN_FLAGS: [(state: RefState) => boolean, string, string][] = [
  [(s) => s.hasConflicts, 'Conflicts', 'text-warning'],
  [(s) => s.checks === 'fail', 'Checks failing', 'text-destructive'],
  [(s) => s.review === 'changes', 'Changes requested', 'text-warning'],
  [(s) => s.review === 'required', 'Review requested', 'text-muted-foreground'],
  [(s) => s.checks === 'pending', 'Checks running', REF_TONE_CLASS.success],
];

function itemUrl({ state, githubRef }: RefItem) {
  return state?.url || (githubRef ? refUrl(githubRef) : null);
}

function minutesSince(iso: string) {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 60_000);
}
