import type { ReactNode } from 'react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { Fold, FoldContent, FoldTrigger } from './Fold';

/** A sidebar group folded under its label and count (Settled, Projects); the label toggles it. */
export function FoldGroup({
  label,
  count,
  isInitiallyOpen = false,
  children,
}: {
  label: string;
  count: number;
  isInitiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Fold
      render={<SidebarGroup className="mt-1 pt-0" />}
      defaultOpen={isInitiallyOpen}
    >
      <SectionToggle label={label} count={count} />
      <FoldContent>
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      </FoldContent>
    </Fold>
  );
}

/** A sidebar section's header inside a Fold: a full-width row with the rows' hover fill, its name, an optional count and the chevron. */
export function SectionToggle({
  label,
  count,
  className,
  actions,
  ...props
}: {
  label: string;
  count?: number;
  className?: string;
  actions?: ReactNode;
} & Record<`data-${string}`, unknown>) {
  const trigger = (
    <FoldTrigger
      {...props}
      className={cn(
        'flex h-7 w-full shrink-0 items-center gap-1 rounded-md px-2 text-left type-caption font-semibold text-sidebar-foreground/65 outline-hidden ring-sidebar-ring hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:ring-2',
        actions && 'min-w-0 flex-1 shrink hover:bg-transparent',
        className,
      )}
    >
      {label}
      {count !== undefined && <span className="tabular">{count}</span>}
    </FoldTrigger>
  );
  if (!actions) return trigger;
  return (
    <div className="flex h-7 items-center rounded-md pr-1 hover:bg-sidebar-accent/40">
      {trigger}
      {actions}
    </div>
  );
}
