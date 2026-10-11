import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import { useHarness } from '../store';
import { ALERT_KINDS, isQuiet, type Notice } from './model';
import { saveNotifySettings } from './slice';

/** Side effects of the notification center: OS notifications while the window is in the background, toasts for watched threads while it's focused, the dock badge, and click-to-jump. */
export function useNotifications() {
  const { state } = useHarness();
  const { items, muted, quiet } = state.notifications;
  const jump = useJump();
  const latest = useRef({ items, jump });
  latest.current = { items, jump };
  const shown = useRef(items);
  const needsYou = state.threads.filter((t) => t.status === 'needs-you').length;

  useEffect(() => {
    const before = new Set(shown.current.map((n) => n.id));
    shown.current = items;
    const alerts = items.filter((n) => !before.has(n.id) && ALERT_KINDS.has(n.kind));
    if (alerts.length === 0 || isQuiet(quiet, new Date())) return;
    if (!document.hasFocus()) {
      const [first] = alerts;
      // A burst in one tick becomes one OS notification instead of a stack.
      const notice = alerts.length > 2 ? { id: first.id, title: `${alerts.length} threads need a look`, body: alerts.map((n) => n.title).join('\n') } : null;
      for (const n of notice ? [notice] : alerts) host.notify.show({ id: n.id, title: n.title, body: n.body }).catch(() => undefined);
      return;
    }
    for (const n of alerts) {
      if (!state.watched.includes(n.threadId)) continue;
      toast(n.title, { description: n.body, action: { label: 'Open', onClick: () => latest.current.jump(n) } });
    }
  }, [items, quiet, state.watched]);

  useEffect(() => {
    host.notify.setBadge(needsYou).catch(() => undefined);
  }, [needsYou]);

  useEffect(
    () =>
      host.notify.onClick((id) => {
        const n = latest.current.items.find((x) => x.id === id);
        if (n) latest.current.jump(n);
      }),
    [],
  );

  useEffect(() => saveNotifySettings({ muted, quiet }), [muted, quiet]);
}

/** Opens what a notice is about: its queue item while that's still open, else its thread, switching space first. */
export function useJump() {
  const { state, dispatch } = useHarness();
  return (n: Notice) => {
    const thread = state.threads.find((t) => t.id === n.threadId);
    dispatch({ type: 'notify-read', ids: [n.id] });
    if (!thread) return;
    if (thread.spaceId !== state.spaceId) dispatch({ type: 'space', id: thread.spaceId });
    const isQueued = !!n.queueId && state.queue.some((q) => q.id === n.queueId);
    dispatch({ type: 'go', view: isQueued ? { kind: 'queue' } : { kind: 'thread', id: thread.id } });
  };
}
