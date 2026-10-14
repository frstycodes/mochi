import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { WatchConfig } from '../host/types/notify';
import { getProfiles } from '../profiles';
import { usePrefs } from '../settings/prefs';
import { useHarness, type State } from '../store';
import { isAlertKind, isQuiet, type Notice, type NoticeKind } from './model';
import { saveNotifySettings } from './slice';

/** For watched threads main shows these itself (`electron/notify/watch.ts`), so the renderer doesn't alert them twice. */
const MAIN_ALERTS: NoticeKind[] = ['needs-you', 'limit', 'review', 'ci'];

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
  const { alertKinds, watchedToasts } = prefs;
  // Threads change every tick; main only hears about it when what it needs changed.
  const config = JSON.stringify(watchConfig(state, prefs));

  useEffect(() => {
    const before = new Set(shown.current.map((n) => n.id));
    shown.current = items;
    const alerts = items.filter((n) => !before.has(n.id) && isAlertKind(n.kind));
    if (alerts.length === 0 || isQuiet(quiet, new Date())) return;
    if (!document.hasFocus()) {
      const background = alerts.filter((n) => alertKinds.includes(n.kind) && !(state.watched.includes(n.threadId) && MAIN_ALERTS.includes(n.kind)));
      if (background.length === 0) return;
      const [first] = background;
      // A burst in one tick becomes one OS notification instead of a stack.
      const notice = background.length > 2 ? { id: first.id, title: `${background.length} threads need a look`, body: background.map((n) => n.title).join('\n') } : null;
      for (const n of notice ? [notice] : background) host.notify.show({ id: n.id, title: n.title, body: n.body }).catch(() => undefined);
      return;
    }
    if (!watchedToasts) return;
    for (const n of alerts) {
      if (!state.watched.includes(n.threadId)) continue;
      toast(n.title, { description: n.body, action: { label: 'Open', onClick: () => latest.current.jump(n) } });
    }
  }, [items, quiet, state.watched, alertKinds, watchedToasts]);

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

function watchConfig(state: State, { alertKinds, dockBadge }: { alertKinds: string[]; dockBadge: boolean }): WatchConfig {
  const profiles = getProfiles();
  const threads = state.threads
    .filter((t) => state.watched.includes(t.id))
    .map((t) => ({ id: t.id, title: t.title, cwd: threadCwd(t) ?? undefined, githubUser: profiles.find((p) => p.id === t.spaceId)?.github || undefined }));
  const { muted, quiet } = state.notifications;
  return { threads, kinds: alertKinds, quiet, muted, needsYou: state.threads.filter((t) => t.status === 'needs-you').map((t) => t.id), dockBadge };
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
