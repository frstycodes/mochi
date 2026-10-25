import { randomUUID } from 'node:crypto';
import {
  Context,
  Effect,
  Layer,
  PubSub,
  Queue,
  Schedule,
  Scope,
  Stream,
} from 'effect';
import type {
  AgentEvent,
  StartWorkspace,
} from '../../../../src/host/types/agent.ts';
import type {
  ScheduleEvent,
  ScheduleRun,
  Trigger,
  TriggerInput,
} from '../../../../src/host/types/schedule.ts';
import { describeCron, parseCron } from '../../../../src/schedule/cron.ts';
import {
  afterLaunch,
  cronDecision,
  prEvents,
  prPrompt,
  summaryLine,
  SUMMARY_HINT,
  triggerAfter,
  withRun,
} from '../../../../src/schedule/due.ts';
import { isBusy, onAgentEvent } from '../agents/events.ts';
import { agent } from '../agents/handlers.ts';
import { keyedStreams } from '../github/client.ts';
import type { OpenPr } from '../github/schema.ts';
import { GitHub } from '../github/service.ts';
import { Store } from '../store/store.ts';

/** What the scheduler tells whoever is listening (main, which hands it to the windows or keeps it with `keep`). */
export type Change =
  | { readonly type: 'change'; readonly triggers: ReadonlyArray<Trigger> }
  | { readonly type: 'event'; readonly event: ScheduleEvent };

interface Saved {
  version: 1;
  triggers: Trigger[];
  outbox: ScheduleEvent[];
}

const TICK = '30 seconds';
// PR triggers whose thread was busy when their PRs changed fire on this beat once it's idle.
const POLL = '2 minutes';
// A day of quiet windows stays far under this; past it the oldest agent events go, run events are always kept.
const MAX_OUTBOX = 5_000;
const MAX_SEEN = 500;
const SAVE_DEBOUNCE = '200 millis';

type PrWatch = {
  threadId: string;
  cwd: string;
  isReviewRequested: boolean;
  githubUser?: string;
};

const prWatch = (t: Trigger): PrWatch | null =>
  t.when.kind === 'pr' && !t.isPaused && t.start.cwd
    ? {
        threadId: t.threadId,
        cwd: t.start.cwd,
        isReviewRequested: t.when.event === 'review-requested',
        githubUser: t.githubUser,
      }
    : null;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Triggers live in Core, so they fire while every window is closed (Mochi still running). A run starts the thread's
 * agent through the same `agent.start` a window calls, so the concurrency cap and the profile's account apply. While no
 * window is open, main hands run and agent events back with `keep` and the next window's `drain` collects them.
 */
export class Scheduler extends Context.Service<Scheduler>()(
  'mochi/core/Scheduler',
  {
    make: Effect.gen(function* () {
      const store = yield* Store;
      const github = yield* GitHub;
      const scope = yield* Scope.Scope;
      const changes = yield* PubSub.unbounded<Change>();
      const saves = yield* Queue.sliding<void>(1);

      const saved = (yield* store
        .getDoc('schedule', 'schedules')
        .pipe(Effect.orElseSucceed(() => undefined))) as Saved | undefined;
      const launchedAt = Date.now();
      // Runs that were going when Mochi quit stopped with it.
      let triggers: Trigger[] = (saved?.triggers ?? []).map((t) =>
        afterLaunch(
          {
            ...t,
            runs: t.runs.map((r) =>
              r.status === 'running'
                ? {
                    ...r,
                    status: 'interrupted' as const,
                    endedAt: launchedAt,
                    error: 'Mochi quit during the run',
                  }
                : r,
            ),
          },
          launchedAt,
        ),
      );
      let outbox: ScheduleEvent[] = saved?.outbox ?? [];
      /** PR trigger's thread id → the open PRs Core last read for its watch, and which watch they came from. */
      const openPrs = new Map<
        string,
        { key: string; prs: ReadonlyArray<OpenPr> }
      >();
      /** Thread id → its trigger's run in flight, with the agent's latest message for the summary. */
      const active = new Map<
        string,
        { run: ScheduleRun; name: string; message: string }
      >();

      const flush = store
        .setDoc('schedule', 'schedules', {
          version: 1,
          triggers,
          outbox,
        } satisfies Saved)
        .pipe(
          // The next change writes the whole document again.
          Effect.catch((cause) =>
            Effect.logWarning(
              `Saving the schedules failed: ${messageOf(cause)}`,
            ),
          ),
        );
      yield* Stream.fromQueue(saves).pipe(
        Stream.debounce(SAVE_DEBOUNCE),
        Stream.runForEach(() => flush),
        Effect.forkScoped,
      );
      yield* Effect.addFinalizer(() => flush);

      const fork = (effect: Effect.Effect<unknown>) =>
        Effect.runFork(Effect.forkIn(effect, scope));
      const emit = (event: ScheduleEvent) =>
        PubSub.publishUnsafe(changes, { type: 'event', event });

      const prStreams = keyedStreams(
        ({ cwd, isReviewRequested, githubUser }: PrWatch) =>
          github.watchOpenPrs(cwd, isReviewRequested, githubUser),
        (watch, prs) => {
          openPrs.set(watch.threadId, { key: JSON.stringify(watch), prs });
          fork(poll);
        },
        (watch, error) =>
          Effect.runFork(
            Effect.logWarning(
              `PR watch for ${watch.threadId} failed: ${messageOf(error)}`,
            ),
          ),
      );

      const list = () => triggers.map(strip);

      function changed() {
        Queue.offerUnsafe(saves, undefined);
        prStreams(triggers.flatMap((t) => prWatch(t) ?? []));
        PubSub.publishUnsafe(changes, { type: 'change', triggers: list() });
      }

      function update(threadId: string, fn: (t: Trigger) => Trigger) {
        triggers = triggers.map((t) => (t.threadId === threadId ? fn(t) : t));
        changed();
      }

      const record = (trigger: Trigger, run: ScheduleRun) =>
        update(trigger.threadId, (t) => ({
          ...t,
          runs: withRun(t.runs, run),
        }));

      function finish(
        threadId: string,
        outcome: Pick<ScheduleRun, 'status' | 'error' | 'resetsAt'>,
      ) {
        const current = active.get(threadId);
        if (!current) return;
        active.delete(threadId);
        const summary = summaryLine(current.message);
        const run: ScheduleRun = {
          ...current.run,
          ...outcome,
          endedAt: Date.now(),
          ...(summary && { summary }),
        };
        const trigger = triggers.find((t) => t.threadId === threadId);
        if (trigger) record(trigger, run);
        emit({ type: 'run-end', run, name: current.name });
      }

      /** A trigger saved before workspaces carries `worktree: <branch>`; the start RPC takes only `workspace`. */
      const startOptions = (trigger: Trigger, prompt: string) => {
        const { worktree, ...start } = trigger.start as Trigger['start'] & {
          worktree?: string;
        };
        const workspace =
          start.workspace ??
          (worktree === undefined
            ? undefined
            : ({
                mode: 'worktree',
                branch: worktree,
              } satisfies StartWorkspace));
        return {
          ...start,
          ...(workspace && { workspace }),
          prompt: `${prompt}\n\n${SUMMARY_HINT}`,
          ...(trigger.sessionId && { resume: trigger.sessionId }),
        };
      };

      const startRun = (trigger: Trigger, reason: string, prompt: string) =>
        Effect.suspend(() => {
          const run: ScheduleRun = {
            id: runId(),
            threadId: trigger.threadId,
            reason,
            startedAt: Date.now(),
            status: 'running',
          };
          active.set(trigger.threadId, {
            run,
            name: trigger.name,
            message: '',
          });
          record(trigger, run);
          emit({ type: 'run-start', run, name: trigger.name, prompt });
          return Effect.tryPromise({
            try: () =>
              agent.start(
                undefined,
                trigger.threadId,
                startOptions(trigger, prompt),
              ),
            catch: messageOf,
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() =>
                finish(trigger.threadId, { status: 'failed', error }),
              ),
            ),
          );
        });

      const tick = Effect.sync(() => {
        const now = Date.now();
        for (const trigger of triggers) {
          const decision = cronDecision(trigger, now, {
            isRunning: active.has(trigger.threadId),
            isBusy: isBusy(trigger.threadId),
          });
          if (decision.kind === 'idle' || decision.kind === 'wait') continue;
          update(trigger.threadId, (t) => ({ ...t, checkedAt: now }));
          if (decision.kind === 'skip')
            record(trigger, {
              id: runId(),
              threadId: trigger.threadId,
              reason: describe(trigger),
              startedAt: now,
              endedAt: now,
              status: 'skipped',
              error: `Skipped: ${decision.reason}`,
            });
          else fork(startRun(trigger, decision.reason, trigger.prompt));
        }
      });

      /** Each PR trigger's latest open PRs against its baseline; a thread that is working waits, its events stay unseen until it's idle. */
      const pollOne = (trigger: Trigger) =>
        Effect.suspend(() => {
          const watch = prWatch(trigger);
          const latest = openPrs.get(trigger.threadId);
          // A list from the trigger's previous settings (another event or folder) would fire against the new baseline.
          if (!watch || latest?.key !== JSON.stringify(watch))
            return Effect.void;
          if (active.has(trigger.threadId) || isBusy(trigger.threadId))
            return Effect.void;
          const { fires, baseline } = prEvents(
            trigger,
            latest.prs.map((pr) => ({
              ...pr,
              labels: [...pr.labels],
              statusCheckRollup: [...pr.statusCheckRollup],
            })),
          );
          if (baseline)
            update(trigger.threadId, (t) => ({ ...t, seen: baseline }));
          const fire = fires[0];
          if (!fire) return Effect.void;
          update(trigger.threadId, (t) => ({
            ...t,
            seen: [...(t.seen ?? []), fire.key].slice(-MAX_SEEN),
          }));
          return startRun(trigger, fire.reason, prPrompt(trigger.prompt, fire));
        });
      const poll = Effect.suspend(() =>
        Effect.forEach([...triggers], pollOne, { discard: true }),
      );

      yield* Effect.sleep(TICK).pipe(
        Effect.andThen(Effect.repeat(tick, Schedule.spaced(TICK))),
        Effect.forkScoped,
      );
      yield* Effect.repeat(poll, Schedule.spaced(POLL)).pipe(Effect.forkScoped);

      /** Keeps each trigger's session and branch current (`triggerAfter`) and ends runs on their turn's end. */
      const off = onAgentEvent(watchAgent);
      yield* Effect.addFinalizer(() => Effect.sync(off));
      function watchAgent(event: AgentEvent) {
        if (
          (event.type === 'session' || event.type === 'branch') &&
          triggers.some((t) => t.threadId === event.threadId)
        )
          update(event.threadId, (t) => triggerAfter(t, event));
        const current = active.get(event.threadId);
        if (!current) return;
        if (event.type === 'message')
          current.message = event.isDelta
            ? current.message + event.text
            : event.text;
        if (event.type === 'limit')
          finish(event.threadId, {
            status: 'limited',
            resetsAt: event.resetsAt,
          });
        if (event.type === 'turn-end')
          finish(event.threadId, { status: event.status, error: event.error });
      }

      changed();

      const service = {
        list: Effect.sync(list),
        /** Fails with the parser's words when the cron expression is wrong. */
        set: (input: TriggerInput) =>
          Effect.try({
            try: () => {
              if (input.when.kind === 'cron') parseCron(input.when.cron);
            },
            catch: messageOf,
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                const now = Date.now();
                const old = triggers.find((t) => t.threadId === input.threadId);
                const isSameWhen =
                  !!old &&
                  JSON.stringify(old.when) === JSON.stringify(input.when);
                const trigger: Trigger = {
                  ...input,
                  isPaused: old?.isPaused ?? false,
                  createdAt: old?.createdAt ?? now,
                  checkedAt: isSameWhen ? old.checkedAt : now,
                  ...(isSameWhen && old.seen && { seen: old.seen }),
                  sessionId: input.sessionId ?? old?.sessionId,
                  runs: old?.runs ?? [],
                };
                triggers = [
                  ...triggers.filter((t) => t.threadId !== input.threadId),
                  trigger,
                ];
                changed();
              }),
            ),
            Effect.andThen(input.when.kind === 'pr' ? poll : Effect.void),
          ),
        remove: (threadId: string) =>
          Effect.sync(() => {
            triggers = triggers.filter((t) => t.threadId !== threadId);
            changed();
          }),
        setPaused: (threadId: string, isPaused: boolean) =>
          // Resuming doesn't make up for what came due while paused.
          Effect.sync(() =>
            update(threadId, (t) => ({
              ...t,
              isPaused,
              ...(!isPaused && { checkedAt: Date.now() }),
            })),
          ),
        runNow: (threadId: string) =>
          Effect.suspend(() => {
            const trigger = triggers.find((t) => t.threadId === threadId);
            if (!trigger) return Effect.fail('This thread has no schedule');
            if (active.has(threadId) || isBusy(threadId))
              return Effect.fail(
                'The thread is already working; it can run once this turn ends',
              );
            return startRun(trigger, 'Run now', trigger.prompt);
          }),
        drain: Effect.sync(() => {
          const events = outbox;
          outbox = [];
          Queue.offerUnsafe(saves, undefined);
          return events;
        }),
        /** Main had no window to hand `event` to: it waits for the next window's `drain`. Agent text deltas fold into the previous kept event, so a long run keeps one message per turn. */
        keep: (event: ScheduleEvent) =>
          Effect.sync(() => {
            const last = outbox.at(-1);
            if (
              event.type === 'agent' &&
              event.event.type === 'message' &&
              event.event.isDelta &&
              last?.type === 'agent' &&
              last.event.type === 'message' &&
              last.event.threadId === event.event.threadId
            ) {
              outbox = [
                ...outbox.slice(0, -1),
                {
                  type: 'agent',
                  event: {
                    ...last.event,
                    text: last.event.text + event.event.text,
                  },
                },
              ];
            } else {
              outbox = [...outbox, event];
            }
            if (outbox.length > MAX_OUTBOX) {
              const drop = outbox.findIndex((e) => e.type === 'agent');
              if (drop >= 0) outbox.splice(drop, 1);
            }
            Queue.offerUnsafe(saves, undefined);
          }),
        changes: Stream.fromPubSub(changes),
      };
      live = service;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => void (live = undefined)),
      );
      return service;
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make);
}

let live: Scheduler['Service'] | undefined;

/** A deleted thread loses its schedule; for the store's commands, which are built before the scheduler is. */
export const removeSchedule = (threadId: string) =>
  live?.remove(threadId) ?? Effect.void;

const strip = (t: Trigger): Trigger => ({ ...t, seen: undefined });
const runId = () => `run-${randomUUID()}`;
const describe = (t: Trigger) =>
  t.when.kind === 'cron' ? describeCron(t.when.cron) : `PR ${t.when.event}`;
