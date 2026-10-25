import type { AgentEvent, SwitchFrom } from '../host/types/agent.ts';
import type { ActivityEntry, Handoff, Provider, Thread } from '../model.ts';
import { controlsOf, DEFAULT_CONTROLS } from '../runtime/controls.ts';
import { log, mapThread } from '../store/threads.ts';
import type { State } from '../store/types.ts';
import { PROVIDER_NAME } from './handoff.ts';

/**
 * The switch the thread's next start takes up: the one you picked, or one a send already began when Mochi quit (that send took
 * the restart and the old session, and the new one never reported).
 */
export function pendingSwitch(thread: Thread): SwitchFrom | undefined {
  const restart = thread.live?.restart;
  if (restart && 'switchFrom' in restart) return restart.switchFrom;
  const i = openIndex(thread);
  const open = i >= 0 ? thread.activity[i].handoff! : undefined;
  if (!open || thread.session) return;
  return {
    provider: open.from,
    ...(open.fromModel && { model: open.fromModel }),
  };
}

/** The provider a thread's next message goes to. */
export const providerOf = (thread: Thread) =>
  pendingSwitch(thread)
    ? thread.providers[0]
    : (thread.session?.provider ?? thread.providers[0]);

/** A start that takes up a pending switch leaves the old provider's session: the new one reports its own. */
export const leftSession = (thread: Thread): Partial<Thread> =>
  pendingSwitch(thread) ? { session: undefined } : {};

/** The thread's switch row still waiting on its next start (pending, or its handoff being written); -1 when none is. */
const openIndex = (thread: Thread) =>
  thread.activity.findLastIndex(
    (e) =>
      e.handoff?.isSwitch &&
      (e.handoff.status === 'pending' || e.handoff.status === 'drafting'),
  );

/**
 * Moves the thread to `to` on `model` from your next message on (`PROVIDER-SWITCH.md` §6). Nothing runs now: that message's
 * start writes the handoff and starts `to`. Picking again before it replaces the pending switch; picking back what it came from
 * drops it. Another model of the same provider is no switch (the session resumes on it), except after a usage limit, when it
 * starts a fresh session from its own handoff.
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
      const i = openIndex(t);
      const open = i >= 0 ? t.activity[i].handoff! : undefined;
      const restart = t.live?.restart;
      const from = open?.from ?? providerOf(t);
      const fromModel = open ? (open.fromModel ?? '') : controlsOf(t).model;
      const isLimited =
        restart && 'switchFrom' in restart
          ? !!restart.switchFrom.isLimited
          : !!t.live?.limit;
      const kept = open ? { ...t, activity: t.activity.toSpliced(i, 1) } : t;
      const access = controlsOf(t).access;
      const settled = (provider: Provider, m: string): Thread => ({
        ...kept,
        providers: [provider, ...t.providers.filter((p) => p !== provider)],
        controls: { ...DEFAULT_CONTROLS[provider], access, model: m },
        ...(t.live && { live: { ...t.live, restart: undefined } }),
      });
      if (to === from && (model === fromModel || !isLimited))
        return open || model !== controlsOf(t).model ? settled(to, model) : t;
      const moved: Thread = {
        ...settled(to, model),
        // The old session's own report (its model, tools): the new one sends its own once it starts.
        agent: undefined,
        ...(t.live && {
          live: {
            ...t.live,
            limit: undefined,
            isOnApiKey: undefined,
            restart: {
              switchFrom: {
                provider: from,
                ...(fromModel && { model: fromModel }),
                ...(isLimited && { isLimited: true }),
              },
            },
          },
        }),
      };
      return log(
        moved,
        switchEntry(state.now, {
          from,
          to,
          status: 'pending',
          isSwitch: true,
          fromModel,
          ...(model && { model }),
        }),
      );
    }),
  };
}

/** Core is writing the handoff the next start begins from: the open switch row says so. */
export function switchWriting(thread: Thread): Thread {
  const i = openIndex(thread);
  if (i < 0) return thread;
  const entry = thread.activity[i];
  return {
    ...thread,
    activity: thread.activity.with(
      i,
      switchEntry(entry.at, { ...entry.handoff!, status: 'drafting' }),
    ),
  };
}

/** Core handed `to` the thread so far: the open row records the package, so it opens to exactly what was sent. */
export function switchDelivered(
  thread: Thread,
  event: Extract<AgentEvent, { type: 'context' }>,
  now: number,
): Thread {
  const i = openIndex(thread);
  const handoff: Handoff = {
    from: event.from,
    fromModel: i >= 0 ? thread.activity[i].handoff!.fromModel : undefined,
    to: event.to,
    status: 'started',
    isSwitch: true,
    prompt: event.text,
    contents: event.contents,
    ...(event.model && { model: event.model }),
    ...(event.handoffBy && { handoffBy: event.handoffBy }),
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
    handoff.status === 'started'
      ? `Switched to ${PROVIDER_NAME[handoff.to]}`
      : `Switches to ${PROVIDER_NAME[handoff.to]} on your next message`,
  handoff,
});
