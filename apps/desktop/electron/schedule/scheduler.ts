import { Cause, Effect, Schedule, Stream } from 'effect';
import { asJsonValue, COMMAND_TYPE } from '@mochi/domain';
import { mainCoreClient } from '@mochi/core/host';
import type { Change } from '@mochi/core/schedule/scheduler';
import type { ScheduleEvent } from '../../src/host/types/schedule.ts';
import type { Action } from '../../src/store/types.ts';
import { openWindows } from '../agents/events.ts';

// The scheduler runs in Core (packages/core/src/schedule), so triggers fire while every window is closed, and logs its runs
// there. Main hands Core's trigger changes to its windows, and logs what it watches itself (PR checks, Auto-fix) in Core.

export function startScheduler() {
  // The stream ends with the socket; after Core restarts, the redialled client subscribes again.
  void mainCoreClient().then((client) =>
    Effect.runFork(
      client['schedule.watch']().pipe(
        Stream.runForEach((item) => Effect.sync(() => forward(item as Change))),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            console.warn(
              'Schedule stream ended; subscribing again',
              Cause.pretty(cause),
            ),
          ),
        ),
        Effect.repeat(Schedule.spaced(250)),
      ),
    ),
  );
}

/** A PR's settled checks or an Auto-fix change, as the command Core acts on (an Auto-fix message goes to the agent there). */
export function deliver(
  event: Extract<ScheduleEvent, { type: 'ci' | 'autofix' }>,
) {
  const action: Action =
    event.type === 'ci'
      ? { type: 'ci-result', event }
      : { type: 'autofix', threadId: event.threadId, event: event.event };
  void mainCoreClient()
    .then((client) =>
      Effect.runPromise(
        client['events.append']({
          type: COMMAND_TYPE,
          threadId: event.threadId,
          payload: asJsonValue(action),
        }),
      ),
    )
    .catch((error: unknown) =>
      console.warn(`Logging ${event.type} in Core failed`, error),
    );
}

function forward(change: Change) {
  for (const win of openWindows())
    win.webContents.send('schedule:onChange', change.triggers);
}
