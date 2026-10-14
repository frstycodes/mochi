import type { ComponentProps, ReactNode } from 'react';
import { Item, ItemActions } from '@/components/ui/item';
import { cn } from '@/lib/utils';

export function PaneSection({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props} />;
}

export function PaneSectionHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex h-5 min-w-0 items-center justify-between gap-2 px-1', className)} {...props} />;
}

export function PaneSectionTitle({ count, className, children, ...props }: ComponentProps<'h3'> & { count?: number }) {
  return (
    <h3 className={cn('flex items-baseline gap-1.5 type-caption font-medium text-subtle-foreground', className)} {...props}>
      {children}
      {count !== undefined && <span className="font-normal tabular-nums text-muted-foreground">{count}</span>}
    </h3>
  );
}

export function PaneList({ className, ...props }: ComponentProps<'div'>) {
  return <div role="list" className={cn('flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/40 p-1', className)} {...props} />;
}

export function PaneListItem({ className, ...props }: ComponentProps<typeof Item>) {
  return (
    <Item
      role="listitem"
      size="sm"
      className={cn('min-h-11 flex-nowrap gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/60 has-focus-visible:bg-accent/60', className)}
      {...props}
    />
  );
}

/** Trailing slot: `meta` at rest, swapped for `actions` on row hover or focus; touch screens always show the actions. */
export function PaneListItemTrail({ meta, actions }: { meta?: ReactNode; actions: ReactNode }) {
  return (
    <ItemActions className="grid shrink-0 justify-items-end *:col-start-1 *:row-start-1">
      {!!meta && (
        <span className="hidden self-center type-caption text-muted-foreground tabular-nums group-focus-within/item:invisible group-hover/item:invisible [@media(hover:hover)]:block">
          {meta}
        </span>
      )}
      <span className="flex items-center gap-0.5 group-focus-within/item:opacity-100 group-hover/item:opacity-100 [@media(hover:hover)]:opacity-0">{actions}</span>
    </ItemActions>
  );
}
