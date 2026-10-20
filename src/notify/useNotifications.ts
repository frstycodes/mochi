import { useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from '../toast/store.ts';
import { queueToast } from '../QueueToast';
import { host } from '../host';
import { isListed } from '../model';
import { threadCwd } from '../host/cwd';
import type { WatchConfig } from '../host/types/notify';
import { getProfiles } from '../profiles';
import { usePrefs } from '../settings/prefs';
import { useHarness, type State } from '../store';
import { isAddressed, isAlertKind, isQuiet, type Notice, type NoticeKind } from './model';
import { saveNotifySettings } from './slice';
import { useRemoteAlerts } from './useRemoteAlerts';
import { useMachines, type FollowedView } from '../remote/useMachines';

/** For watched threads main shows these itself (`electron/notify/watch.ts`), so the renderer doesn't alert them twice. */
const MAIN_ALERTS: NoticeKind[] = ['needs-you', 'limit', 'ci'];

/** Side effects of the notification center: OS notifications while the window is in the background, toasts for watched threads while it's focused, main's watch config (OS alerts, CI, dock badge), and click-to-jump. */
export function useNotifications() {
  const { state } = useHarness();
  const { items, muted, quiet } = state.notifications;
  const jump = useJump();
  const openThread = useOpenThread();
  const latest = useRef({ items, jump, openThread });
  latest.current = { items, jump, openThread };
  const shown = useRef(items);
  const prefs = usePrefs();
  const { alertKinds, watchedToasts, idleAlerts } = prefs;
  const view = state.views[state.spaceId];
  const viewedId = view?.kind === 'thread' ? view.id : undefined;
  const { machines } = useMachines();
  // Threads change every tick; main only hears about it when what it needs changed.
  const config = JSON.stringify(watchConfig(state, prefs, machines));

  useEffect(() => {
    const before = new Set(shown.current.map((n) => n.id));
    const ids = new Set(items.map((n) => n.id));
    // Addressed, cleared or deleted in the center: its OS notification is no news either.
    const gone = shown.current.filter((n) => !ids.has(n.id)).map((n) => n.id);
    if (gone.length) host.notify.close(gone).catch(() => undefined);
    shown.current = items;
    const isFocused = document.hasFocus();
    // Idle verdicts alert for a thread you aren't looking at: any while Mochi is in the background, others' while it's in front.
    const idle = items.filter((n) => !before.has(n.id) && !!n.verdict && idleAlerts.includes(n.verdict) && !(isFocused && n.threadId === viewedId));
    const alerts = [...items.filter((n) => !before.has(n.id) && isAlertKind(n.kind)), ...idle];
    if (alerts.length === 0 || isQuiet(quiet, new Date())) return;
    if (!isFocused) {
      const background = alerts.filter((n) => (n.kind === 'idle' || alertKinds.includes(n.kind)) && !(state.watched.includes(n.threadId) && MAIN_ALERTS.includes(n.kind)));
      if (background.length === 0) return;
      const [first] = background;
      // A burst in one tick becomes one OS notification instead of a stack.
      const notice = background.length > 2 ? { id: first.id, title: `${background.length} threads need a look`, body: background.map((n) => n.title).join('\n') } : null;
      for (const n of notice ? [notice] : background) host.notify.show({ id: n.id, title: n.title, body: n.body }).catch(() => undefined);
      return;
    }
    for (const n of idle) toast(n.title, { description: n.body, action: { label: 'Open', onClick: () => latest.current.jump(n) } });
    if (!watchedToasts) return;
    for (const n of alerts) {
      if (n.kind === 'idle' || !state.watched.includes(n.threadId)) continue;
      toast(n.title, { description: n.body, ...(n.queueId && queueToast(n.queueId)), action: { label: 'Open', onClick: () => latest.current.jump(n) } });
    }
  }, [items, quiet, state.watched, alertKinds, watchedToasts, idleAlerts, viewedId]);

  useAddressedOnView(viewedId);
  useRemoteAlerts();

  useEffect(() => {
    host.notify.watch(JSON.parse(config) as WatchConfig).catch((error: unknown) => console.error('Syncing watched threads failed', error));
  }, [config]);

  useEffect(
    () =>
      host.notify.onClick((id) => {
        const n = latest.current.items.find((x) => x.id === id);
        if (n) latest.current.jump(n);
      }),
    [],
  );

  useEffect(() => {
    const off = host.notify.onOpenThread((id) => latest.current.openThread(id));
    // A click that opened this window with every other one closed.
    void host.notify.pendingOpen().then((id) => id && latest.current.openThread(id));
    return off;
  }, []);

  useEffect(() => saveNotifySettings({ muted, quiet }), [muted, quiet]);
}

/** Looking at a thread in a focused window settles the notices that only asked you to look, here and in main. */
function useAddressedOnView(threadId: string | undefined) {
  const { state, dispatch } = useHarness();
  const isFocused = useSyncExternalStore(subscribeFocus, () => document.hasFocus());
  const isViewed = isFocused && !!threadId;
  const hasAddressed = isViewed && state.notifications.items.some((n) => n.threadId === threadId && isAddressed(n, { isViewed: true }));
  useEffect(() => {
    if (!isViewed || !threadId) return;
    host.notify.addressed({ threadId, isViewed: true }).catch(() => undefined);
  }, [isViewed, threadId]);
  useEffect(() => {
    if (hasAddressed && threadId) dispatch({ type: 'notify-viewed', threadId });
  }, [hasAddressed, threadId, dispatch]);
}

function subscribeFocus(onChange: () => void) {
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
  };
}

function watchConfig(state: State, { alertKinds, dockBadge }: { alertKinds: string[]; dockBadge: boolean }, machines: FollowedView[]): WatchConfig {
  const profiles = getProfiles();
  const threads = state.threads
    .filter((t) => state.watched.includes(t.id))
    .map((t) => ({ id: t.id, title: t.title, cwd: threadCwd(t) ?? undefined, githubUser: profiles.find((p) => p.id === t.spaceId)?.github || undefined }));
  const autofix = state.threads.flatMap((t) => {
    const cwd = threadCwd(t);
    if (!t.live || t.status === 'settled' || !cwd) return [];
    const githubUser = profiles.find((p) => p.id === t.spaceId)?.github || undefined;
    return t.prs.flatMap((pr) => (pr.autofixSince && pr.state !== 'merged' && pr.state !== 'closed' ? [{ threadId: t.id, title: t.title, pr: pr.number, cwd, githubUser, since: pr.autofixSince }] : []));
  });
  const { muted, quiet } = state.notifications;
  // Another computer's threads count toward the badge too, keyed by machine so ids never collide with this one's.
  const remoteNeedsYou = machines.flatMap(({ machine, state }) => (state?.threads ?? []).filter((t) => t.status === 'needs-you').map((t) => `${machine.id}/${t.id}`));
  return { threads, autofix, kinds: alertKinds, quiet, muted, needsYou: [...state.threads.filter((t) => t.status === 'needs-you' && isListed(t)).map((t) => t.id), ...remoteNeedsYou], dockBadge };
}

/** Opens what a notice is about: its queue item while that's still open, else its thread. */
export function useJump() {
  const { dispatch } = useHarness();
  const openThread = useOpenThread();
  return (n: Notice) => {
    dispatch({ type: 'notify-read', ids: [n.id] });
    openThread(n.threadId, n.queueId);
  };
}

/** Shows a thread, switching space first; with `queueId` still open, the Queue instead. */
function useOpenThread() {
  const { state, dispatch } = useHarness();
  return (threadId: string, queueId?: string) => {
    const thread = state.threads.find((t) => t.id === threadId);
    if (!thread) return;
    if (thread.spaceId !== state.spaceId) dispatch({ type: 'space', id: thread.spaceId });
    const isQueued = !!queueId && state.queue.some((q) => q.id === queueId);
    dispatch({ type: 'go', view: isQueued ? { kind: 'queue' } : { kind: 'thread', id: thread.id } });
  };
}
