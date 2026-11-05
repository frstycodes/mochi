import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A card that frames a list: the header on the lighter frame, each item on the page tone flush to the sides and bottom, the frame showing between them. */
export function FramedCard({
  header,
  children,
  className,
  ...props
}: ComponentProps<'section'> & { header?: ReactNode }) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border bg-muted',
        className,
      )}
      {...props}
    >
      {!!header && (
        <div className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 type-meta text-muted-foreground">
          {header}
        </div>
      )}
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

export function FramedItem({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-3 bg-background p-3', className)}
      {...props}
    />
  );
}
