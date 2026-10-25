import { Cause, Effect, Schedule, Stream } from 'effect';
import { mainCoreClient } from '@mochi/core/host';
import type { Change } from '@mochi/core/schedule/scheduler';
import type { ScheduleEvent } from '../../src/host/types/schedule.ts';
import { keepWhenClosed, openWindows } from '../agents/events.ts';
import { mainWindow } from '../window.ts';

// The scheduler runs in Core (packages/core/src/schedule), so triggers fire while every window is closed. Main only
// hands what Core reports to its windows, and gives events back to Core to keep when no window is open.

export function startScheduler() {
  keepWhenClosed((event) => keep({ type: 'agent', event }));
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

export function deliver(event: ScheduleEvent) {
  if (!mainWindow()) return keep(event);
  for (const win of openWindows())
    win.webContents.send('schedule:onEvent', event);
}

function forward(change: Change) {
  if (change.type === 'event') return deliver(change.event);
  for (const win of openWindows())
    win.webContents.send('schedule:onChange', change.triggers);
}

const keep = (event: ScheduleEvent) =>
  void mainCoreClient()
    .then((client) => Effect.runPromise(client['schedule.keep']({ event })))
    .catch((error: unknown) =>
      console.warn('Keeping a schedule event failed', error),
    );
