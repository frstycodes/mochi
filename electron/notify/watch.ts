import { app, BrowserWindow, Notification } from 'electron';
import { Effect, Stream } from 'effect';
import { keyedStreams } from '@mochi/core/github/client';
import { currentPr } from '@mochi/core/github/nodes';
import type { BranchPrs } from '@mochi/core/github/schema';
import { mainCoreClient } from '@mochi/core/host';
import type { AgentEvent } from '../../src/host/types/agent.ts';
import type { ThreadAddressed, WatchConfig } from '../../src/host/types/notify.ts';
import { isAddressed, isQuiet } from '../../src/notify/model.ts';
import { resetLabel } from '../../src/usage/limits.ts';
import { ciTitle, ciTransition, coalesce, type CiSeen, type OsNotice } from '../../src/notify/watch.ts';
import { onAgentEvent, resolveRequest } from '../agents/events.ts';

import { deliver } from '../schedule/scheduler.ts';
import { syncAutofix } from './autofix.ts';
import { createWindow, mainWindow } from '../window.ts';

/**
 * OS notifications for watched threads, CI polling and the dock badge live in main, so they keep going with every window closed.
 * The renderer sends `config` on every change; main only alerts while no Mochi window is in front (the renderer toasts then).
 */
// ponytail: config and CI baselines are in memory; a relaunch re-baselines CI silently. Persist them if a restart mid-run must still report.
let config: WatchConfig = { threads: [], autofix: [], kinds: [], quiet: { isOn: false, start: 22, end: 8 }, muted: [], needsYou: [], dockBadge: true };
/** Thread id → approvals and questions waiting on you that main saw arrive, for the badge between renderer syncs. */
const requests = new Map<string, Set<string>>();
let needsYou = new Set<string>();
let pendingOpen: string | null = null;
/** Threads whose last word was a limit: a failed turn-end right after it (Codex) is the limit itself, already alerted. */
const limited = new Set<string>();

// A turn ending often lands with its last approval or a CI result; one beat folds them into one notification.
const BURST_MS = 1500;
let burst: OsNotice[] = [];
let burstTimer: ReturnType<typeof setTimeout> | undefined;
// macOS drops click handlers for notifications that get garbage-collected, so live ones are held until clicked or closed.
const live = new Map<Notification, OsNotice>();

/** Thread id → its PR's last CI state, the baseline a pass or fail is reported against. */
const ci = new Map<string, CiSeen | undefined>();

export function startWatch() {
  onAgentEvent(onEvent);
}

export const watch = {
  set(next: WatchConfig) {
    config = next;
    needsYou = new Set(next.needsYou);
    badge();
    syncCi();
    syncAutofix(next.autofix, alert);
  },
  takePendingOpen() {
    const id = pendingOpen;
    pendingOpen = null;
    return id;
  },
};

function onEvent(event: AgentEvent) {
  trackRequests(event);
  const thread = config.threads.find((t) => t.id === event.threadId);
  if (!thread) return;
  const isLimitEnd = event.type === 'turn-end' && event.status === 'failed' && limited.has(event.threadId);
  if (event.type === 'limit') limited.add(event.threadId);
  else if (event.type === 'turn-end') limited.delete(event.threadId);
  const notice = isLimitEnd ? null : noticeFor(event, thread.title);
  if (notice) alert(notice);
}

function noticeFor(event: AgentEvent, title: string): OsNotice | null {
  const base = { threadId: event.threadId, title };
  if (event.type === 'approval') return { ...base, kind: 'needs-you', body: `Wants to ${event.title.charAt(0).toLowerCase()}${event.title.slice(1)}`, requestId: event.requestId };
  if (event.type === 'question') return { ...base, kind: 'needs-you', body: event.questions[0]?.text ?? 'Has a question for you' };
  if (event.type === 'limit') {
    const reset = event.resetsAt ? ` at ${resetLabel(event.resetsAt)}` : '';
    return { ...base, kind: 'limit', body: `Hit the ${event.label ? `${event.label.toLowerCase()} ` : ''}usage limit; ${event.isTurnHeld ? `continues after the reset${reset}` : `stopped until the reset${reset}`}` };
  }
  if (event.type !== 'turn-end' || event.status === 'interrupted') return null;
  return event.status === 'done' ? { ...base, kind: 'done', body: 'Turn finished, ready for review' } : { ...base, kind: 'failed', body: event.error ?? 'The agent stopped with an error' };
}

/** Closes a thread's notifications that what you did in Mochi settled; a summary spans threads, so it stays. */
export function closeAddressed({ threadId, ...signal }: ThreadAddressed) {
  closeWhere((n) => n.threadId === threadId && n.kind !== 'summary' && isAddressed({ kind: n.kind }, signal));
}

function closeWhere(isDone: (notice: OsNotice) => boolean) {
  for (const [n, notice] of live) {
    if (!isDone(notice)) continue;
    n.close();
    live.delete(n);
  }
}

function trackRequests(event: AgentEvent) {
  const open = requests.get(event.threadId) ?? new Set<string>();
  if (event.type === 'approval' || event.type === 'question') open.add(event.requestId);
  else if (event.type === 'resolved') {
    open.delete(event.requestId);
    // Answered in a window or on another device: its Approve/Deny would now answer nothing.
    closeWhere((n) => n.requestId === event.requestId);
  }
  // A turn's end or limit withdraws whatever it was still asking.
  else if (event.type === 'turn-end' || (event.type === 'limit' && !event.isTurnHeld)) open.clear();
  else return;
  requests.set(event.threadId, open);
  if (open.size) needsYou.add(event.threadId);
  else needsYou.delete(event.threadId);
  badge();
}

function badge() {
  app.setBadgeCount(config.dockBadge ? needsYou.size : 0);
}

function alert(notice: OsNotice) {
  if (BrowserWindow.getFocusedWindow() || !config.kinds.includes(notice.kind) || config.muted.includes(notice.threadId) || isQuiet(config.quiet, new Date())) return;
  burst.push(notice);
  burstTimer ??= setTimeout(() => {
    burstTimer = undefined;
    const notices = coalesce(burst);
    burst = [];
    notices.forEach(show);
  }, BURST_MS);
}

function show(notice: OsNotice) {
  // macOS shows the first action as a button and the rest under it only in the Alerts style (System Settings › Notifications).
  const actions = notice.requestId ? ['Approve', 'Deny'] : ['Open'];
  const n = new Notification({ title: notice.title, body: notice.body, actions: actions.map((text) => ({ type: 'button' as const, text })) });
  live.set(n, notice);
  n.on('close', () => live.delete(n));
  n.on('click', () => {
    live.delete(n);
    open(notice.threadId);
  });
  n.on('action', (details) => {
    live.delete(n);
    const label = actions[details.actionIndex];
    if (label === 'Open' || !notice.requestId) return open(notice.threadId);
    void answer(notice.threadId, notice.requestId, label === 'Approve');
  });
  n.show();
}

/** Same as answering the Queue card; the `resolved` event takes the card away in every window, or waits for the next one. */
async function answer(threadId: string, requestId: string, isAllowed: boolean) {
  try {
    await resolveRequest(threadId, requestId, isAllowed ? { kind: 'allow' } : { kind: 'deny', message: 'Denied from a notification' });
  } catch (error) {
    console.warn(`Answering ${requestId} from a notification failed: ${(error as Error).message}`);
    open(threadId);
  }
}

/** Focuses the main window, or opens one when all are closed, and shows the thread; a summary notification has no thread. */
function open(threadId: string) {
  const win = mainWindow();
  app.focus({ steal: true });
  if (!win) {
    pendingOpen = threadId || null;
    return void createWindow();
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (threadId) win.webContents.send('notify:onOpenThread', threadId);
}

type CiWatch = { threadId: string; cwd: string; githubUser?: string };

// Core polls each repository once for every surface: fast for a while after a push, backing off to every 10 minutes.
const ciStreams = keyedStreams(
  ({ cwd, githubUser }: CiWatch) => Stream.unwrap(Effect.map(Effect.promise(mainCoreClient), (client) => client['github.pr']({ cwd, githubUser }))),
  ({ threadId }, prs) => onPrs(threadId, prs),
  ({ threadId }, error) => console.warn(`CI watch for ${threadId} failed: ${error instanceof Error ? error.message : String(error)}`),
);

function syncCi() {
  const watched = config.threads.flatMap((t) => (t.cwd ? [{ threadId: t.id, cwd: t.cwd, githubUser: t.githubUser }] : []));
  for (const id of ci.keys()) if (!watched.some((w) => w.threadId === id)) ci.delete(id);
  ciStreams(watched);
}

/** A watched thread's branch PRs changed: its open PR's CI passing or failing after another state alerts once. */
function onPrs(threadId: string, { prs }: BranchPrs) {
  const pr = currentPr(prs);
  const thread = config.threads.find((t) => t.id === threadId);
  if (pr?.state !== 'OPEN' || !thread) return;
  const { seen, result } = ciTransition(ci.get(threadId), pr);
  ci.set(threadId, seen);
  if (!result) return;
  deliver({ type: 'ci', threadId, result });
  alert({ threadId, kind: 'ci', title: thread.title, body: ciTitle(result) });
}
