import type { Dispatch } from 'react';
import type { AgentEvent } from '../host/types/agent.ts';
import type { ActivityEntry, Handoff, Provider, Thread } from '../model.ts';
import { controlsOf, DEFAULT_CONTROLS } from '../runtime/controls.ts';
import { log, mapThread } from '../store/threads.ts';
import type { Action, State } from '../store/types.ts';
import { PROVIDER_NAME } from './handoff.ts';

/** The provider a thread's next message goes to. */
export const providerOf = (thread: Thread) =>
  thread.live?.restart && 'switchFrom' in thread.live.restart
    ? thread.providers[0]
    : (thread.session?.provider ?? thread.providers[0]);

export const otherProvider = (thread: Thread): Provider =>
  providerOf(thread) === 'claude' ? 'codex' : 'claude';

/** Switches the thread to `to` from your next message, on that provider's default model. */
export const switchHere = (
  thread: Thread,
  dispatch: Dispatch<Action>,
  to = otherProvider(thread),
) => dispatch({ type: 'provider-switch', threadId: thread.id, to });

export const isSwitchPending = (thread: Thread) => pendingIndex(thread) >= 0;

/** The thread's switch row still waiting on your next message; -1 when none is. */
const pendingIndex = (thread: Thread) =>
  thread.activity.findLastIndex((e) => e.handoff?.status === 'pending');

/**
 * Moves the thread to `to` from your next message on (`PROVIDER-SWITCH.md` §6): the old session stays as it is until then, and
 * the next start runs `to` with the thread so far, which Core assembles. Picking again before that message replaces the pending
 * switch; picking the provider it came from drops it.
 */
export function switchProvider(
  state: State,
  threadId: string,
  to: Provider,
  model = '',
): State {
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => {
      if (t.isSettingsChat) return t;
      const i = pendingIndex(t);
      const from = i >= 0 ? t.activity[i].handoff!.from : providerOf(t);
      const fromModel =
        i >= 0 ? t.activity[i].handoff!.fromModel : controlsOf(t).model;
      const kept = i >= 0 ? { ...t, activity: t.activity.toSpliced(i, 1) } : t;
      if (from === to && providerOf(t) === to) return t;
      const controls = {
        ...DEFAULT_CONTROLS[to],
        access: controlsOf(t).access,
        model,
      };
      const moved: Thread = {
        ...kept,
        providers: [to, ...t.providers.filter((p) => p !== to)],
        controls,
        // The old session's own report (its model, tools): the new one sends its own once it starts.
        session: undefined,
        agent: undefined,
        ...(t.live && {
          live: {
            ...t.live,
            limit: undefined,
            isOnApiKey: undefined,
            restart: { switchFrom: from },
          },
        }),
      };
      if (from === to) return moved;
      return log(
        moved,
        switchEntry(state.now, {
          from,
          to,
          status: 'pending',
          fromModel,
          ...(model && { model }),
        }),
      );
    }),
  };
}

/** Core handed `to` the thread so far: the pending row records the package, so it opens to exactly what was sent. */
export function switchDelivered(
  thread: Thread,
  event: Extract<AgentEvent, { type: 'context' }>,
  now: number,
): Thread {
  const i = pendingIndex(thread);
  const handoff: Handoff = {
    from: event.from,
    fromModel: i >= 0 ? thread.activity[i].handoff!.fromModel : undefined,
    to: event.to,
    status: 'started',
    prompt: event.text,
    contents: event.contents,
    ...(event.model && { model: event.model }),
  };
  if (i < 0) return log(thread, switchEntry(now, handoff));
  return {
    ...thread,
    activity: thread.activity.with(
      i,
      switchEntry(thread.activity[i].at, handoff),
    ),
  };
}

const switchEntry = (at: number, handoff: Handoff): ActivityEntry => ({
  at,
  who: 'harness',
  kind: 'event',
  text:
    handoff.status === 'pending'
      ? `Switches to ${PROVIDER_NAME[handoff.to]} on your next message`
      : `Switched to ${PROVIDER_NAME[handoff.to]}`,
  handoff,
});
