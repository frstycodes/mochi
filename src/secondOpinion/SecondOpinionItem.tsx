import { Scale } from 'reicon-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { useReviewer } from './reviewer';
import { askSecondOpinion } from './run';
import { providerName } from './verdict';

/** The thread menu's "Ask <other> for a second opinion": disabled with the reason while the other agent can't review. */
export function SecondOpinionItem({ thread }: { thread: Thread }) {
  const { dispatch } = useHarness();
  const { provider, reason } = useReviewer(thread);
  const label = `Ask ${providerName(provider)} for a second opinion`;
  if (!reason)
    return (
      <DropdownMenuItem onSelect={() => askSecondOpinion(thread, dispatch)}>
        <Scale />
        {label}
      </DropdownMenuItem>
    );
  // Not Radix `disabled`: that drops the item from focus and pointer events, so its reason could never show.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuItem aria-disabled onSelect={(e) => e.preventDefault()} className="opacity-50 focus:bg-transparent">
          <Scale />
          {label}
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-64">
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
