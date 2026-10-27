import { useState } from 'react';
import { ChevronDown, Warning } from '@/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { plural } from '@mochi/domain/lib/format';
import type { MergeMethod, MergeMode, PrCheck } from '../host/types/git';
import { CheckList } from './Checks';

export const MERGE_METHODS = {
  squash: {
    action: 'Squash and merge',
    body: 'Combines every commit into one on the base branch.',
  },
  merge: {
    action: 'Create a merge commit',
    body: 'Keeps every commit and joins them with a merge commit.',
  },
  rebase: {
    action: 'Rebase and merge',
    body: 'Replays each commit onto the base branch, no merge commit.',
  },
} satisfies Record<MergeMethod, { action: string; body: string }>;

const METHODS = Object.keys(MERGE_METHODS) as MergeMethod[];

/** Checks that keep a PR from merging cleanly now. */
export interface CheckTally {
  failed: number;
  running: number;
}

export const checkTally = (checks: PrCheck[]): CheckTally => ({
  failed: checks.filter((c) => c.state === 'fail').length,
  running: checks.filter((c) => c.state === 'pending').length,
});

/** The remembered method when the repository allows it, else the first it allows. */
export const pickMethod = (
  allowed: readonly MergeMethod[],
  preferred: MergeMethod,
) => (allowed.includes(preferred) ? preferred : allowed[0]);

/**
 * `request(method)` merges now when no check is failing or running, else asks to bypass them first. Render `dialog` outside
 * any hover card or menu: those close as focus moves to it.
 */
export function useMergeFlow({
  head,
  base,
  tally,
  checks,
  onMerge,
}: {
  head: string;
  base: string;
  tally: CheckTally;
  /** The checks themselves, listed in the dialog when known. */
  checks?: PrCheck[];
  onMerge: (method: MergeMethod, mode: MergeMode) => void;
}) {
  const [asking, setAsking] = useState<MergeMethod | null>(null);
  const request = (method: MergeMethod) =>
    tally.failed + tally.running > 0
      ? setAsking(method)
      : onMerge(method, 'now');
  const dialog = (
    <BypassChecksDialog
      open={!!asking}
      onOpenChange={(open) => !open && setAsking(null)}
      head={head}
      base={base}
      tally={tally}
      blocking={checks?.filter(
        (c) => c.state === 'fail' || c.state === 'pending',
      )}
      onBypass={() => asking && onMerge(asking, 'bypass')}
      onAutoMerge={() => asking && onMerge(asking, 'auto')}
    />
  );
  return { request, dialog };
}

/** GitHub's merge split button: the primary merges with `method`, the chevron changes it. */
export function MergeButton({
  head,
  base,
  tally,
  checks,
  isConflicting,
  method,
  allowed,
  isBusy,
  onMethodChange,
  onMerge,
}: {
  head: string;
  base: string;
  tally: CheckTally;
  checks?: PrCheck[];
  isConflicting: boolean;
  method: MergeMethod;
  /** The methods the repository allows; the others show disabled. */
  allowed: readonly MergeMethod[];
  isBusy: boolean;
  onMethodChange: (method: MergeMethod) => void;
  onMerge: (method: MergeMethod, mode: MergeMode) => void;
}) {
  const { request, dialog } = useMergeFlow({
    head,
    base,
    tally,
    checks,
    onMerge,
  });
  return (
    <>
      <ButtonGroup>
        <Button
          size="xs"
          disabled={isBusy || isConflicting}
          title={isConflicting ? 'Resolve the conflicts first' : undefined}
          onClick={() => request(method)}
        >
          {isBusy && <Spinner data-icon="inline-start" />}
          {MERGE_METHODS[method].action}
        </Button>
        <ButtonGroupSeparator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              disabled={isBusy}
              aria-label="Choose how to merge"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuRadioGroup
              value={method}
              onValueChange={(v) => onMethodChange(v as MergeMethod)}
            >
              {METHODS.map((m) => (
                <DropdownMenuRadioItem
                  key={m}
                  value={m}
                  disabled={!allowed.includes(m)}
                  className="items-start"
                >
                  <MethodText method={m} isAllowed={allowed.includes(m)} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {dialog}
    </>
  );
}

function MethodText({
  method,
  isAllowed,
}: {
  method: MergeMethod;
  isAllowed: boolean;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="type-body font-medium">
        {MERGE_METHODS[method].action}
      </span>
      <span className="type-meta text-pretty text-muted-foreground">
        {isAllowed
          ? MERGE_METHODS[method].body
          : 'Not allowed in this repository.'}
      </span>
    </span>
  );
}

function BypassChecksDialog({
  open,
  onOpenChange,
  head,
  base,
  tally,
  blocking,
  onBypass,
  onAutoMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  head: string;
  base: string;
  tally: CheckTally;
  blocking?: PrCheck[];
  onBypass: () => void;
  onAutoMerge: () => void;
}) {
  const { failed, running } = tally;
  const title = failed
    ? `${failed} ${plural(failed, 'check', 'checks')} failing`
    : `${running} ${plural(running, 'check', 'checks')} still running`;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warning/10 text-warning">
            <Warning />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            <code className="font-mono text-xs">{head}</code> merges into{' '}
            <code className="font-mono text-xs">{base}</code> without waiting
            for them. If the branch requires these checks, your admin rights
            bypass the rule.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!!blocking?.length && (
          <div className="max-h-40 overflow-y-auto rounded-lg border px-1 py-1">
            <CheckList checks={blocking} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not yet</AlertDialogCancel>
          {!failed && (
            <AlertDialogAction variant="outline" onClick={onAutoMerge}>
              Merge when ready
            </AlertDialogAction>
          )}
          <AlertDialogAction variant="danger" onClick={onBypass}>
            Bypass checks and merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
