import { useState } from 'react';
import { toast } from '@/toast/store';
import { Box, Check, ChevronRight, DocumentCopy, TerminalSquare } from 'reicon-react';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatElapsed, useElapsed } from '../agents/parts';
import { host } from '../host';
import type { SetupChoice, SetupStep, WorktreeSetup } from '../host/types/agent';
import type { Thread } from '../model';
import { useHarness } from '../store';
import { CallList, Expand, RunOutput, TrailIcon } from '../WorkLog';
import { outputLines } from './output';

/**
 * The worktree's preparation before the agent's first turn, at the top of the thread: one line like a work group, open while
 * it runs or waits on you, folded to "Worktree ready in 14s" once done. A failed step waits for Retry, Skip setup or a look in
 * the terminal; the agent doesn't start until you pick.
 */
export function SetupRow({ thread, setup }: { thread: Thread; setup: WorktreeSetup }) {
  const [isOpenByYou, setOpenByYou] = useState<boolean>();
  const isActive = setup.status === 'running' || setup.status === 'failed';
  const isOpen = isOpenByYou ?? isActive;
  const elapsed = useElapsed(setup.startedAt, setup.endedAt);

  return (
    <div className="-mx-2 flex flex-col">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpenByYou(!isOpen)}
        className="group/log flex h-7 min-w-0 cursor-default items-center gap-2 self-start rounded-lg px-2 text-left type-meta text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        {setup.status === 'running' ? <Shimmer as="span">Setting up worktree</Shimmer> : <span className="truncate">{setupTitle(setup.status, formatElapsed(elapsed))}</span>}
        {setup.status === 'running' && <span className="tabular text-subtle-foreground">{formatElapsed(elapsed)}</span>}
        <TrailIcon isWaiting={setup.status === 'failed'} isOpen={isOpen} />
      </button>
      <Expand isOpen={isOpen}>
        <div className="mx-2 mt-1 flex flex-col gap-3">
          <CallList>
            {setup.steps.map((step) => (
              <SetupStepRow key={step.id} step={step} />
            ))}
          </CallList>
          {setup.status === 'failed' && <SetupFailedActions threadId={thread.id} />}
        </div>
      </Expand>
    </div>
  );
}

function setupTitle(status: WorktreeSetup['status'], elapsed: string) {
  return {
    running: 'Setting up worktree',
    failed: 'Worktree setup failed',
    ready: `Worktree ready in ${elapsed}`,
    skipped: 'Worktree setup skipped',
    cancelled: 'Worktree setup stopped',
  }[status];
}

const STEP_ICONS = { copy: DocumentCopy, install: Box, script: TerminalSquare } as Record<string, typeof Box>;

function SetupStepRow({ step }: { step: SetupStep }) {
  const [isOpen, setOpen] = useState(step.status === 'failed');
  const Icon = STEP_ICONS[step.id] ?? TerminalSquare;
  const hasDetail = !!step.output || !!step.command;
  const isRunning = step.status === 'running';

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={hasDetail ? isOpen : undefined}
        disabled={!hasDetail}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-9 min-w-0 cursor-default items-center gap-2.5 px-3 text-left type-meta', hasDetail && 'hover:bg-accent/60')}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        {isRunning ? (
          <Shimmer as="span" className="min-w-0 flex-1 truncate">
            {step.label}
          </Shimmer>
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', step.status === 'pending' || step.status === 'skipped' ? 'text-subtle-foreground' : 'text-foreground')}>{step.label}</span>
        )}
        <StepStatus step={step} />
        {hasDetail ? <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-subtle-foreground transition-transform duration-150', isOpen && 'rotate-90')} /> : <span aria-hidden className="size-3.5 shrink-0" />}
      </button>
      {hasDetail && (
        <Expand isOpen={isOpen}>
          <div className="px-3 pb-3">{step.command ? <RunOutput command={step.command} run={step.exitCode === undefined && !step.output ? undefined : { exitCode: step.exitCode ?? 0, lines: outputLines(step.output ?? '') }} /> : <pre className="max-h-64 overflow-auto rounded-lg border bg-card px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">{step.output}</pre>}</div>
        </Expand>
      )}
    </li>
  );
}

function StepStatus({ step }: { step: SetupStep }) {
  const elapsed = useElapsed(step.startedAt ?? 0, step.endedAt);
  if (step.status === 'pending') return null;
  if (step.status === 'skipped') return <span className="shrink-0 text-subtle-foreground">Skipped</span>;
  return (
    <span className="flex shrink-0 items-center gap-2 tabular">
      {step.status === 'failed' && <span className="font-mono text-xs text-destructive">{step.exitCode === undefined ? 'failed' : `exit ${step.exitCode}`}</span>}
      <span className="text-subtle-foreground">{formatElapsed(elapsed)}</span>
      {step.status === 'done' && <Check aria-label="Done" className="size-3.5 text-success" />}
    </span>
  );
}

function SetupFailedActions({ threadId }: { threadId: string }) {
  const { dispatch } = useHarness();
  const choose = (choice: SetupChoice) => host.agent.setupChoice(threadId, choice).catch((error: Error) => toast.error('Could not continue the setup', { description: error.message }));
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'pane-open-tab', threadId, kind: 'terminal' })}>
        <TerminalSquare />
        Open terminal
      </Button>
      <Button size="sm" variant="outline" onClick={() => choose('skip')}>
        Skip setup
      </Button>
      <Button size="sm" onClick={() => choose('retry')}>
        Retry
      </Button>
    </div>
  );
}
