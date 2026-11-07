import { useRef, type ReactNode } from 'react';
import { Lock, Search, Warning } from '@/icons';
import { Badge } from '@/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Space } from '../../../model';
import { LibraryIcon } from '../../../library/LibraryParts';
import { ProviderMark, SpaceIcon } from '../../../ui';
import type { Kind, LibItem, Source } from '../../profileLibraryFixtures';
import { KINDS, PART_LABELS, type ItemState } from './model';

/** The variant's own window: a container, so `@md:` rules follow the frame's width (the 375px toggle), not the page's. */
export function MockFrame({
  isNarrow,
  children,
  className,
}: {
  isNarrow: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        '@container mx-auto w-full rounded-xl border bg-background',
        isNarrow && 'max-w-[375px]',
      )}
    >
      <div className={cn('flex flex-col gap-4 p-4 @md:p-6', className)}>
        {children}
      </div>
    </div>
  );
}

const SOURCE_NAMES = {
  mochi: 'Mochi',
  claude: 'Claude Code',
  codex: 'Codex',
} satisfies Record<Source, string>;

/** Where an item comes from: Mochi's library, or the account's own Claude Code or Codex setup. */
export function SourceLabel({ source }: { source: Source }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-subtle-foreground">
      {source !== 'mochi' && <ProviderMark provider={source} size={12} />}
      {SOURCE_NAMES[source]}
    </span>
  );
}

export function kindLabel(item: LibItem) {
  return PART_LABELS[item.part ?? item.kind];
}

/** Icon tile, name with New, the kind and source, the where, one status line; `actions` on the right. */
export function ItemRow({
  item,
  state,
  status,
  actions,
  isCompact,
  className,
  ...rest
}: {
  item: LibItem;
  state: ItemState;
  status?: string | null;
  actions?: ReactNode;
  isCompact?: boolean;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const isDimmed = ['off', 'not-added', 'other-account'].includes(state);
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 px-4 py-2.5 not-first:before:absolute not-first:before:inset-x-4 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border',
        className,
      )}
      {...rest}
    >
      {!isCompact && (
        <span className={cn('flex', isDimmed && 'opacity-60')}>
          <LibraryIcon url={item.icon ?? null} letter={item.name} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'truncate type-body font-medium',
              isDimmed && 'text-muted-foreground',
            )}
          >
            {item.service ? item.account : item.name}
          </span>
          {item.isNew && <Badge variant="secondary">New</Badge>}
        </span>
        {!isCompact && (
          <span className="flex min-w-0 items-center gap-1 type-caption text-subtle-foreground">
            <span className="shrink-0">{kindLabel(item)}</span>
            <span aria-hidden>·</span>
            <SourceLabel source={item.source} />
            <span aria-hidden className="hidden @md:inline">
              ·
            </span>
            <span className="hidden truncate @md:inline">{item.where}</span>
          </span>
        )}
        {!!status && (
          <span
            className={cn(
              'flex items-start gap-1 type-caption',
              item.error ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {!!item.error && (
              <Warning aria-hidden className="mt-0.5 size-3 shrink-0" />
            )}
            {status}
          </span>
        )}
      </div>
      {!!actions && (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </div>
  );
}

/** "Always on" for an item Mochi can't leave out, focusable so the reason is reachable as a tooltip. */
export function LockedMark({ reason }: { reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 type-caption text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Lock aria-hidden className="size-3.5" />
          Always on
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}

/** Up to three profile icons in a row, gapped (they sit on rows whose fill changes), with `+N` past that. */
export function ProfileIcons({ profiles }: { profiles: Space[] }) {
  return (
    <span className="flex items-center gap-1">
      {profiles.slice(0, 3).map((p) => (
        <SpaceIcon key={p.id} space={p} className="size-3.5" />
      ))}
      {profiles.length > 3 && (
        <span className="type-caption tabular">+{profiles.length - 3}</span>
      )}
    </span>
  );
}

export type KindFilter = Kind | 'all';

export function KindChips({
  value,
  onChange,
  counts,
}: {
  value: KindFilter;
  onChange: (kind: KindFilter) => void;
  counts?: Record<Kind, number>;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(v) => onChange((v || 'all') as KindFilter)}
      aria-label="Kind"
    >
      <ToggleGroupItem value="all">All</ToggleGroupItem>
      {KINDS.map(([kind, label]) => (
        <ToggleGroupItem key={kind} value={kind}>
          {label}
          {!!counts && (
            <span className="text-subtle-foreground tabular">
              {counts[kind]}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A search field that `/` focuses from anywhere in its frame and Esc clears. */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <InputGroup className={cn('h-8', className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        data-slash-search
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          if (value) e.stopPropagation();
          onChange('');
        }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <InputGroupAddon align="inline-end" className="hidden @md:flex">
        <Kbd>/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** `/` anywhere inside the frame (outside a field) jumps to its search. */
export function onSlashSearch(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== '/' || isTyping(e.target)) return;
  const input = e.currentTarget.querySelector<HTMLInputElement>(
    '[data-slash-search]',
  );
  if (!input) return;
  e.preventDefault();
  input.focus();
}

export const isTyping = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName));

export function KeyHints({ hints }: { hints: [string, string][] }) {
  return (
    <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 type-caption text-subtle-foreground @md:flex">
      {hints.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <Kbd>{key}</Kbd>
          {label}
        </span>
      ))}
    </p>
  );
}
