import type { AgentEvent, StartWorkspace } from '../host/types/agent.ts';
import type { PrEvent, ScheduleRun, Trigger } from '../host/types/schedule.ts';
import { describeCron, nextRun } from './cron.ts';

/** What the scheduler does with a trigger on a tick. `skip` accounts for the due run without running it; `wait` leaves it due. */
export type Decision = { kind: 'idle' } | { kind: 'wait' } | { kind: 'skip'; reason: string } | { kind: 'run'; reason: string };

export interface RunState {
  /** This trigger's own run is still going. */
  isRunning: boolean;
  /** The thread's agent is mid-turn for another reason (you're chatting with it). */
  isBusy: boolean;
}

/**
 * A cron trigger is due when a run falls between `checkedAt` and now; however many fell in that window, it runs once.
 * Never two runs of one trigger at once: a run that comes due during the previous one is skipped. A thread you're
 * working in holds the run until its turn ends.
 */
export function cronDecision(trigger: Trigger, now: number, state: RunState): Decision {
  if (trigger.when.kind !== 'cron' || trigger.isPaused) return { kind: 'idle' };
  const due = nextRun(trigger.when.cron, trigger.checkedAt);
  if (due === null || due > now) return { kind: 'idle' };
  if (state.isRunning) return { kind: 'skip', reason: 'the previous run was still going' };
  if (state.isBusy) return { kind: 'wait' };
  return { kind: 'run', reason: describeCron(trigger.when.cron) };
}

/** On launch: runs missed while Mochi was quit either stay due (they run once on the first tick) or are skipped. */
export function afterLaunch(trigger: Trigger, now: number): Trigger {
  if (trigger.when.kind !== 'cron' || trigger.missed !== 'skip') return trigger;
  const due = nextRun(trigger.when.cron, trigger.checkedAt);
  return due !== null && due <= now ? { ...trigger, checkedAt: now } : trigger;
}

/** The subset of `gh pr list --json` the poller reads. */
export interface PrSnapshot {
  number: number;
  title: string;
  headRefName: string;
  headRefOid: string;
  labels: { name: string }[];
  statusCheckRollup?: { conclusion?: string | null; state?: string | null }[] | null;
  /** Set when the list came from `--search review-requested:@me`. */
  isReviewRequested?: boolean;
}

export interface PrFire {
  key: string;
  reason: string;
  pr: PrSnapshot;
}

export const PR_EVENT_LABELS = { opened: 'opened', 'review-requested': 'review requested', 'ci-failed': 'CI failed' } satisfies Record<PrEvent, string>;

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'STARTUP_FAILURE']);

/** Unseen events for this trigger in a poll, oldest PR first. The first poll after a trigger is set only records what is already there. */
export function prEvents(trigger: Trigger, prs: PrSnapshot[]): { fires: PrFire[]; baseline?: string[] } {
  if (trigger.when.kind !== 'pr') return { fires: [] };
  const { event, branch, label } = trigger.when;
  const matching = prs.filter((pr) => (!branch || branchMatches(branch, pr.headRefName)) && (!label || pr.labels.some((l) => l.name === label)));
  const all = matching.flatMap((pr) => {
    const key = eventKey(event, pr);
    return key ? [{ key, reason: `PR #${pr.number} ${PR_EVENT_LABELS[event]}`, pr }] : [];
  });
  if (!trigger.seen) return { fires: [], baseline: all.map((f) => f.key) };
  const seen = new Set(trigger.seen);
  return { fires: all.filter((f) => !seen.has(f.key)).sort((a, b) => a.pr.number - b.pr.number) };
}

function eventKey(event: PrEvent, pr: PrSnapshot) {
  if (event === 'opened') return `opened:${pr.number}`;
  if (event === 'review-requested') return pr.isReviewRequested ? `review:${pr.number}` : null;
  // Once per pushed commit: a fix that fails again fires again.
  return pr.statusCheckRollup?.some((c) => FAILED.has(c.conclusion ?? '') || FAILED.has(c.state ?? '')) ? `ci:${pr.number}:${pr.headRefOid}` : null;
}

/** `*` matches any run of characters; everything else is literal. */
export function branchMatches(pattern: string, branch: string) {
  const source = pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(branch);
}

/** The prompt a PR run gets: the trigger's, plus which PR woke it. */
export function prPrompt(prompt: string, fire: PrFire) {
  return `${prompt}\n\nTriggered by ${fire.reason}: "${fire.pr.title}" (branch ${fire.pr.headRefName}).`;
}

export const SUMMARY_HINT = 'Start your final message with a one-line summary of the result, for example "2 findings" or "No changes needed".';

/** The first line of the agent's last message, without markdown markers, for the Queue title. */
export function summaryLine(text: string) {
  const line = text.split('\n').map((l) => l.replace(/^[#>*\-\s]+|[*_`]+/g, '').trim()).find(Boolean) ?? '';
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

const MAX_RUNS = 20;

export function withRun(runs: ScheduleRun[], run: ScheduleRun) {
  return [...runs.filter((r) => r.id !== run.id), run].slice(-MAX_RUNS);
}

/**
 * The trigger after its thread's agent `event`: a session means the first run started, so later runs resume it and neither name
 * the thread again nor refuse their own branch (`isNew`); a worktree branch renamed after the title is the one later runs check out.
 */
export function triggerAfter(trigger: Trigger, event: AgentEvent): Trigger {
  const { workspace } = trigger.start;
  if (event.type === 'session') return { ...trigger, sessionId: event.sessionId, start: { ...trigger.start, workspace: workspace && laterRun(workspace) } };
  if (event.type === 'branch' && workspace?.mode === 'worktree') return { ...trigger, start: { ...trigger.start, workspace: { ...workspace, branch: event.branch } } };
  return trigger;
}

const laterRun = ({ isNew: _, titlePrompt: __, title: ___, ...workspace }: StartWorkspace): StartWorkspace => workspace;
