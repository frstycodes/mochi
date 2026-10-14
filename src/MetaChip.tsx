import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A filled chip in the meta row, like Claude's: the project, branch and worktree. */
export function MetaChip({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="sm" className={cn('h-7 max-w-48 rounded-lg bg-foreground/5 px-2 font-normal text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 dark:hover:bg-foreground/10', className)} {...props} />;
}
