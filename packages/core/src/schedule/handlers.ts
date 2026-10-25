import { Effect, Schema } from 'effect';
import { definitionOf } from '@mochi/schema';
import type { ScheduleEvent } from '../../../../src/host/types/schedule.ts';
import { Scheduler } from './scheduler.ts';

type Service = Scheduler['Service'];

/** `host.schedule.*`, served in Core: results go out through the method's schema, as `host.agent.*` do. */
export const scheduleHandlers = (scheduler: Service) => {
  const methods = {
    'schedule.list': () => scheduler.list,
    'schedule.set': ([input]: [Parameters<Service['set']>[0]]) =>
      scheduler.set(input),
    'schedule.remove': ([threadId]: [string]) => scheduler.remove(threadId),
    'schedule.setPaused': ([threadId, isPaused]: [string, boolean]) =>
      scheduler.setPaused(threadId, isPaused),
    'schedule.runNow': ([threadId]: [string]) => scheduler.runNow(threadId),
    'schedule.drain': () => scheduler.drain,
  };
  return Object.fromEntries(
    Object.entries(methods).map(([tag, handle]) => {
      const output = Schema.toCodecJson(definitionOf(tag).output);
      return [
        tag,
        (args: ReadonlyArray<unknown>) =>
          (
            handle as (
              args: ReadonlyArray<unknown>,
            ) => Effect.Effect<unknown, string>
          )(args).pipe(
            // A void method's JSON form is null.
            Effect.flatMap((value) =>
              Schema.decodeUnknownEffect(output)(value ?? null).pipe(
                Effect.mapError(String),
              ),
            ),
          ),
      ];
    }),
  );
};

/** The handlers of `ScheduleRpcs`. */
export const scheduleRpcHandlers = (scheduler: Service) => ({
  'schedule.watch': () => scheduler.changes,
  'schedule.keep': ({ event }: { event: unknown }) =>
    scheduler.keep(event as ScheduleEvent),
});
