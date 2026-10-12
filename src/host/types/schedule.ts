import type { AgentEvent, AgentStartOptions } from './agent.ts';
import type { Manifest } from './manifest.ts';

export const PR_EVENTS = ['opened', 'review-requested', 'ci-failed'] as const;
export type PrEvent = (typeof PR_EVENTS)[number];

/** Presets (nightly, weekdays, hourly) are cron expressions too; the editor recognizes them. */
export type TriggerWhen =
  | { kind: 'cron'; cron: string }
  /** Polled through gh in the thread's repository. `branch` takes `*` wildcards; empty filters match every PR. */
  | { kind: 'pr'; event: PrEvent; branch?: string; label?: string };

/** What happens to runs that came due while Mochi was quit. */
export type MissedRuns = 'run-once' | 'skip';

/** One trigger per thread, so the thread id is its id. */
export interface TriggerInput {
  threadId: string;
  /** Names the run in the Queue: "<name> finished: …". */
  name: string;
  prompt: string;
  when: TriggerWhen;
  missed: MissedRuns;
  /** How main starts the thread's agent, as the renderer would; the run adds the prompt and the latest session to resume. */
  start: Omit<AgentStartOptions, 'prompt' | 'images' | 'resume' | 'useApiKey'>;
  sessionId?: string;
  /** The profile's GitHub account for PR polling; unset uses gh's active login. */
  githubUser?: string;
}

export interface Trigger extends TriggerInput {
  isPaused: boolean;
  createdAt: number;
  /** Epoch ms up to which cron runs are accounted for: the next run is the first one after this. */
  checkedAt: number;
  /** PR events already handled (`opened:12`, `ci:12:<sha>`); unset until the first poll sets the baseline. */
  seen?: string[];
  /** Newest last, the last few. */
  runs: ScheduleRun[];
}

export type RunStatus = 'running' | 'done' | 'failed' | 'interrupted' | 'limited' | 'skipped';

export interface ScheduleRun {
  id: string;
  threadId: string;
  /** "Every day at 02:00", "PR #12 opened", "Run now". */
  reason: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  /** The first line of the agent's last message. */
  summary?: string;
  error?: string;
  /** For `limited`: when the account's limit resets. */
  resetsAt?: string;
}

/** What main tells windows about runs. Sent live when a window is open, otherwise kept and handed out by `drain` on the next window. */
export type ScheduleEvent =
  | { type: 'run-start'; run: ScheduleRun; name: string; prompt: string }
  | { type: 'run-end'; run: ScheduleRun; name: string }
  /** An agent event that happened while no window was open. */
  | { type: 'agent'; event: AgentEvent };

export interface ScheduleHost {
  list(): Promise<Trigger[]>;
  /** Creates or replaces the thread's trigger; keeps its runs and pause state. */
  set(input: TriggerInput): Promise<void>;
  remove(threadId: string): Promise<void>;
  setPaused(threadId: string, isPaused: boolean): Promise<void>;
  /** Starts a run now unless one is going; a busy thread throws. */
  runNow(threadId: string): Promise<void>;
  /** Events kept while no window was open, oldest first; returns each only once. */
  drain(): Promise<ScheduleEvent[]>;
  onChange(listener: (triggers: Trigger[]) => void): () => void;
  onEvent(listener: (event: ScheduleEvent) => void): () => void;
}

export const scheduleMethods = {
  list: 'invoke',
  set: 'invoke',
  remove: 'invoke',
  setPaused: 'invoke',
  runNow: 'invoke',
  drain: 'invoke',
  onChange: 'event',
  onEvent: 'event',
} satisfies Manifest<ScheduleHost>;
