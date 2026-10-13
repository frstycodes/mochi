import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { ArrowRight, ArrowUpRight, BranchUp, ClockCircle, CloseCircle, Edit, Eye, MessageEdit, TickCircle, UserTick, type IconComponent } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { GithubStateIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
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
export function RefHoverCard({ item, side, align, children }: Placement & { item: RefItem; children: ReactElement }) {
  return (
    <HoverCard openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} collisionPadding={8} className={cn('flex w-80 flex-col gap-3 p-3', REDUCED_MOTION)}>
        <RefPreview item={item} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** `RefHoverCard` for one of a thread's PRs, reading its live state. */
export function ThreadPrHoverCard({ thread, pr, ...props }: Placement & { thread: Thread; pr: PullRequest; children: ReactElement }) {
  return <RefHoverCard item={useThreadPr(thread, pr)} {...props} />;
}

/** Several refs as one card that pages vertically, one preview per page (native scroll snap); `index` is the page to show. */
export function RefCarouselHoverCard({ items, index, side, align, children }: Placement & { items: RefItem[]; index: number; children: ReactElement }) {
  return (
    <HoverCard openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align={align} collisionPadding={8} className={cn('w-80 p-0', REDUCED_MOTION)}>
        <RefCarousel items={items} index={index} />
      </HoverCardContent>
    </HoverCard>
  );
}

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
        <Button variant="outline" size="sm" className="mt-auto self-start" onClick={() => window.open(url, '_blank', 'noreferrer')}>
          Open on GitHub
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      )}
    </>
  );
}

function RefCarousel({ items, index }: { items: RefItem[]; index: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [page, setPage] = useState(index);
  const reduceMotion = useReducedMotionConfig();
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Opening lands on the page at once; moving to another disc while open pages there.
    el.scrollTo({ top: index * el.clientHeight, behavior: hasScrolled.current && !reduceMotion ? 'smooth' : 'instant' });
    hasScrolled.current = true;
  }, [index, reduceMotion]);
  useWheelPaging(scroller, !reduceMotion);
  return (
    <div className="relative">
      <div
        ref={scroller}
        onScroll={(e) => setPage(Math.round(e.currentTarget.scrollTop / e.currentTarget.clientHeight))}
        style={{ scrollbarWidth: 'none' }}
        className="h-61 snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {items.map((item, i) => (
          <div key={item.label} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`} className="flex h-full snap-start snap-always flex-col gap-3 p-3 pr-6">
            <RefPreview item={item} />
          </div>
        ))}
      </div>
      <div aria-hidden className="absolute top-1/2 right-2.5 flex -translate-y-1/2 flex-col gap-1">
        {items.map((item, i) => (
          <span key={item.label} className={cn('size-1 rounded-full transition-colors', i === page ? 'bg-foreground' : 'bg-muted-foreground/40')} />
        ))}
      </div>
    </div>
  );
}

/**
 * One page per wheel gesture. Chromium snaps a mouse-wheel tick (100px) to the nearest page, which is the one it left, so a
 * plain snap scroller never pages with a mouse; trackpad momentum keeps the gesture alive until it stops, so a fling is one page.
 * On the element, not `window`, so no other wheel in the app waits on it.
 */
function useWheelPaging(scroller: RefObject<HTMLDivElement | null>, isSmooth: boolean) {
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let distance = 0;
    let isPaged = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        distance = 0;
        isPaged = false;
      }, GESTURE_END_MS);
      if (isPaged) return;
      distance += e.deltaY;
      if (Math.abs(distance) < WHEEL_PAGE_PX) return;
      isPaged = true;
      const pages = Math.round(el.scrollHeight / el.clientHeight);
      const next = Math.min(pages - 1, Math.max(0, Math.round(el.scrollTop / el.clientHeight) + Math.sign(distance)));
      el.scrollTo({ top: next * el.clientHeight, behavior: isSmooth ? 'smooth' : 'instant' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(quiet);
    };
  }, [scroller, isSmooth]);
}

const WHEEL_PAGE_PX = 24;
const GESTURE_END_MS = 200;

function RefFacts({ state }: { state: RefState }) {
  const isPr = state.kind === 'pr';
  const hasFacts = !!state.author || !!state.branch || !!state.diff || (isPr && (!!state.checks || !!state.review));
  if (!hasFacts) return null;
  return (
    <dl className="flex flex-col gap-1.5 type-meta">
      {!!state.author && (
        <Fact icon={UserTick} label="Author">
          {state.author}
          {!!state.updatedAt && <span className="text-subtle-foreground"> · updated {timeAgo(minutesSince(state.updatedAt))}</span>}
        </Fact>
      )}
      {!!state.branch && (
        <Fact icon={BranchUp} label="Branch">
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
  pass: { icon: TickCircle, tone: 'text-success', children: 'Checks passing' },
  fail: { icon: CloseCircle, tone: 'text-destructive', children: 'Checks failing' },
  pending: { icon: ClockCircle, tone: 'text-warning', children: 'Checks running' },
} satisfies Record<ChecksState, { icon: IconComponent; tone: string; children: string }>;

const REVIEWS = {
  approved: { icon: TickCircle, tone: 'text-success', children: 'Approved' },
  changes: { icon: MessageEdit, tone: 'text-warning', children: 'Changes requested' },
  required: { icon: Eye, tone: 'text-muted-foreground', children: 'Review requested' },
} satisfies Record<ReviewState, { icon: IconComponent; tone: string; children: string }>;

const PLURAL = new Intl.PluralRules('en');

/** One row: the icon carries the tone, `label` names the row for screen readers only (the value says it). */
function Fact({ icon: Icon, tone, label, children }: { icon: IconComponent; tone?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <Icon aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground', tone)} />
      <dd className="min-w-0 flex-1 truncate text-foreground">{children}</dd>
    </div>
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

function itemUrl({ state, githubRef }: RefItem) {
  return state?.url || (githubRef ? refUrl(githubRef) : null);
}

function minutesSince(iso: string) {
  return Math.max(0, (Date.now() - Date.parse(iso)) / 60_000);
}
