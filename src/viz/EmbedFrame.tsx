import type { ReactNode, Ref } from 'react';
import type { IconComponent } from '@/icons';
import { cn } from '@/lib/utils';

/**
 * Frame for content embedded in the transcript (fenced visuals, widgets, MCP app views): the content in one hairline
 * frame, then a caption row with its name. Actions sit at the row's end, shown on hover or focus, always on touch.
 */
export function EmbedFrame({ icon: Icon, iconClassName, title, actions, isPadded, ref, className, children }: { icon: IconComponent; iconClassName?: string; title: string; actions?: ReactNode; isPadded?: boolean; ref?: Ref<HTMLElement>; className?: string; children: ReactNode }) {
  return (
    <figure ref={ref} className={cn('group/embed flex min-w-0 flex-col gap-1', className)}>
      <div className={cn('min-w-0 overflow-hidden rounded-xl border border-border', isPadded && 'p-3')}>{children}</div>
      <figcaption className="flex h-7 min-w-0 items-center gap-1.5 pl-1 type-caption text-subtle-foreground">
        <Icon aria-hidden className={cn('size-3.5 shrink-0', iconClassName)} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {/* Instant on focus: keyboard-initiated, so no fade. */}
        {!!actions && (
          <span className="flex shrink-0 items-center transition-opacity duration-150 group-focus-within/embed:duration-0 pointer-fine:opacity-0 pointer-fine:has-data-[state=open]:opacity-100 pointer-fine:group-focus-within/embed:opacity-100 pointer-fine:group-hover/embed:opacity-100 [&_svg]:size-3.5">
            {actions}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
