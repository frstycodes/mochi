import { useState } from 'react';
import { ChevronDown, WarningAlt } from '@/icons';
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

/** GitHub's merge split button: the primary merges with `method`, the chevron changes it; unfinished or failing checks ask before bypassing them. */
export function MergeButton({
  head,
  base,
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
  checks: PrCheck[];
  isConflicting: boolean;
  method: MergeMethod;
  /** The methods the repository allows; the others show disabled. */
  allowed: MergeMethod[];
  isBusy: boolean;
  onMethodChange: (method: MergeMethod) => void;
  onMerge: (method: MergeMethod, mode: MergeMode) => void;
}) {
  const [isAsking, setAsking] = useState(false);
  const blocking = blockingChecks(checks);
  const merge = () =>
    blocking.length > 0 ? setAsking(true) : onMerge(method, 'now');

  return (
    <>
      <ButtonGroup>
        <Button
          size="xs"
          disabled={isBusy || isConflicting}
          title={isConflicting ? 'Resolve the conflicts first' : undefined}
          onClick={merge}
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
              {(Object.keys(MERGE_METHODS) as MergeMethod[]).map((m) => (
                <DropdownMenuRadioItem
                  key={m}
                  value={m}
                  disabled={!allowed.includes(m)}
                  className="items-start"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="type-body font-medium">
                      {MERGE_METHODS[m].action}
                    </span>
                    <span className="type-meta text-pretty text-muted-foreground">
                      {allowed.includes(m)
                        ? MERGE_METHODS[m].body
                        : 'Not allowed in this repository.'}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      <BypassChecksDialog
        open={isAsking}
        onOpenChange={setAsking}
        head={head}
        base={base}
        blocking={blocking}
        onBypass={() => onMerge(method, 'bypass')}
        onAutoMerge={() => onMerge(method, 'auto')}
      />
    </>
  );
}

function BypassChecksDialog({
  open,
  onOpenChange,
  head,
  base,
  blocking,
  onBypass,
  onAutoMerge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  head: string;
  base: string;
  blocking: PrCheck[];
  onBypass: () => void;
  onAutoMerge: () => void;
}) {
  const failed = blocking.filter((c) => c.state === 'fail').length;
  const running = blocking.length - failed;
  const title = failed
    ? `${failed} ${plural(failed, 'check', 'checks')} failing`
    : `${running} ${plural(running, 'check', 'checks')} still running`;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warning/10 text-warning">
            <WarningAlt />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            <code className="font-mono text-xs">{head}</code> merges into{' '}
            <code className="font-mono text-xs">{base}</code> without waiting
            for them. If the branch requires these checks, your admin rights
            bypass the rule.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-40 overflow-y-auto rounded-lg border px-1 py-1">
          <CheckList checks={blocking} />
        </div>
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

const blockingChecks = (checks: PrCheck[]) =>
  checks.filter((c) => c.state === 'fail' || c.state === 'pending');
