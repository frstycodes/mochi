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
    <Fold asChild defaultOpen={isInitiallyOpen}>
      <SidebarGroup className="mt-1 pt-0">
        <SectionToggle label={label} count={count} />
        <FoldContent>
          <SidebarGroupContent>
            <SidebarMenu>{children}</SidebarMenu>
          </SidebarGroupContent>
        </FoldContent>
      </SidebarGroup>
    </Fold>
  );
}

/** A sidebar section's header inside a Fold: a full-width row with the rows' hover fill, its name, an optional count and the chevron. */
export function SectionToggle({
  label,
  count,
  className,
  ...props
}: {
  label: string;
  count?: number;
  className?: string;
} & Record<`data-${string}`, unknown>) {
  return (
    <FoldTrigger
      {...props}
      className={cn(
        'flex h-7 w-full shrink-0 items-center gap-1 rounded-md px-2 text-left type-caption font-semibold text-sidebar-foreground/65 outline-hidden ring-sidebar-ring hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:ring-2',
        className,
      )}
    >
      {label}
      {count !== undefined && <span className="tabular">{count}</span>}
    </FoldTrigger>
  );
}
