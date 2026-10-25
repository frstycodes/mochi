import { Schema } from 'effect';
import { AgentEvent, AgentStartOptions } from '../agent.ts';
import { event, Id, invoke, Str } from '../checks.ts';
import { AutofixEvent } from '../model.ts';
import { PrCheck } from './git.ts';

const opt = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const T = Schema.Tuple;
const Void = Schema.Void;

export const PrEvent = Schema.Literals([
  'opened',
  'review-requested',
  'ci-failed',
]);
export type PrEvent = typeof PrEvent.Type;

/** GAP: main also parses the cron expression (`parseCron`, `src/schedule/cron.ts`); only its length is checked here. */
export const TriggerWhen = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('cron'), cron: Str(256) }),
  Schema.Struct({
    kind: Schema.Literal('pr'),
    event: PrEvent,
    branch: opt(Str(256)),
    label: opt(Str(256)),
  }),
]);
export type TriggerWhen = typeof TriggerWhen.Type;

export const MissedRuns = Schema.Literals(['run-once', 'skip']);

const {
  prompt: _prompt,
  images: _images,
  resume: _resume,
  useApiKey: _useApiKey,
  ...startFields
} = AgentStartOptions.fields;

export const TriggerInput = Schema.Struct({
  threadId: Id,
  name: Str(200),
  prompt: Str(100_000),
  when: TriggerWhen,
  missed: MissedRuns,
  start: Schema.Struct(startFields),
  sessionId: opt(Str(256)),
  githubUser: opt(Str(256)),
});
export type TriggerInput = typeof TriggerInput.Type;

export const RunStatus = Schema.Literals([
  'running',
  'done',
  'failed',
  'interrupted',
  'limited',
  'skipped',
]);

export const ScheduleRun = Schema.Struct({
  id: S,
  threadId: S,
  reason: S,
  startedAt: N,
  endedAt: opt(N),
  status: RunStatus,
  summary: opt(S),
  error: opt(S),
  resetsAt: opt(S),
});
export type ScheduleRun = typeof ScheduleRun.Type;

export const Trigger = Schema.Struct({
  ...TriggerInput.fields,
  isPaused: Schema.Boolean,
  createdAt: N,
  checkedAt: N,
  seen: opt(Schema.Array(S)),
  runs: Schema.Array(ScheduleRun),
});
export type Trigger = typeof Trigger.Type;

/** A watched PR's settled checks (`src/notify/watch.ts`). */
export const CiResult = Schema.Struct({
  pr: N,
  url: S,
  status: Schema.Literals(['pass', 'fail']),
  failed: Schema.Array(PrCheck),
});
export type CiResult = typeof CiResult.Type;

export const ScheduleEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('run-start'),
    run: ScheduleRun,
    name: S,
    prompt: S,
  }),
  Schema.Struct({ type: Schema.Literal('run-end'), run: ScheduleRun, name: S }),
  Schema.Struct({ type: Schema.Literal('ci'), threadId: S, result: CiResult }),
  Schema.Struct({
    type: Schema.Literal('autofix'),
    threadId: S,
    event: AutofixEvent,
  }),
  Schema.Struct({ type: Schema.Literal('agent'), event: AgentEvent }),
]);
export type ScheduleEvent = typeof ScheduleEvent.Type;

export const scheduleRpc = {
  list: invoke(T([]), Schema.Array(Trigger)),
  set: invoke(T([TriggerInput]), Void),
  remove: invoke(T([Id]), Void),
  setPaused: invoke(T([Id, Schema.Boolean]), Void),
  runNow: invoke(T([Id]), Void),
  drain: invoke(T([]), Schema.Array(ScheduleEvent)),
  onChange: event(Schema.Array(Trigger)),
  onEvent: event(ScheduleEvent),
};
