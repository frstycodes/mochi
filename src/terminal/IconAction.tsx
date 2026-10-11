import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A ghost icon button whose `aria-label` doubles as its tooltip. */
export function IconAction({ 'aria-label': label, ...props }: ComponentProps<typeof Button> & { 'aria-label': string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
