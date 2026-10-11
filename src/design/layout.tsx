import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section id={`design-${id}`} className="flex scroll-mt-20 flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h2 className="type-heading">{title}</h2>
        <p className="max-w-[62ch] type-body text-muted-foreground">{intro}</p>
      </div>
      {children}
    </section>
  );
}

export function Block({ title, use, wide, children }: { title: string; use: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', wide && 'md:col-span-2')}>
      <div>
        <h3 className="type-title">{title}</h3>
        <p className="type-meta text-muted-foreground">{use}</p>
      </div>
      {children}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-2">{children}</div>;
}
