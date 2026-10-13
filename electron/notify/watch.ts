import { app, BrowserWindow, Notification } from 'electron';
import type { AgentEvent } from '../../src/host/types/agent.ts';
import type { WatchConfig } from '../../src/host/types/notify.ts';
import type { ScheduleEvent } from '../../src/host/types/schedule.ts';
import { isQuiet } from '../../src/notify/model.ts';
import { ciTitle, ciTransition, coalesce, type CiSeen, type OsNotice } from '../../src/notify/watch.ts';
import { emitAgentEvent, onAgentEvent } from '../agents/events.ts';
import { githubAccount } from '../git/gh.ts';
import { resolveRequest } from '../ipc/agent.ts';
import { readPr } from '../ipc/git.ts';
import { createWindow, mainWindow } from '../window.ts';

/**
 * OS notifications for watched threads, CI polling and the dock badge live in main, so they keep going with every window closed.
 * The renderer sends `config` on every change; main only alerts while no Mochi window is in front (the renderer toasts then).
 */
// ponytail: config and CI baselines are in memory; a relaunch re-baselines CI silently. Persist them if a restart mid-run must still report.
let config: WatchConfig = { threads: [], kinds: [], quiet: { isOn: false, start: 22, end: 8 }, muted: [], needsYou: [], dockBadge: true };
/** Thread id → approvals and questions waiting on you that main saw arrive, for the badge between renderer syncs. */
const requests = new Map<string, Set<string>>();
let needsYou = new Set<string>();
let pendingOpen: string | null = null;

// A turn ending often lands with its last approval or a CI result; one beat folds them into one notification.
const BURST_MS = 1500;
let burst: OsNotice[] = [];
let burstTimer: ReturnType<typeof setTimeout> | undefined;
// macOS drops click handlers for notifications that get garbage-collected, so live ones are held until clicked or closed.
const live = new Set<Notification>();

const CI_BASE_MS = 2 * 60_000;
const CI_MAX_MS = 30 * 60_000;
const ci = new Map<string, { seen?: CiSeen; dueAt: number; delay: number }>();

export function startWatch() {
  onAgentEvent(onEvent);
}

export const watch = {
  set(next: WatchConfig) {
    config = next;
    needsYou = new Set(next.needsYou);
    badge();
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
  const notice = noticeFor(event, thread.title);
  if (notice) alert(notice);
}

function noticeFor(event: AgentEvent, title: string): OsNotice | null {
  const base = { threadId: event.threadId, title };
  if (event.type === 'approval') return { ...base, kind: 'needs-you', body: `Wants to ${event.title.charAt(0).toLowerCase()}${event.title.slice(1)}`, requestId: event.requestId };
  if (event.type === 'question') return { ...base, kind: 'needs-you', body: event.questions[0]?.text ?? 'Has a question for you' };
  if (event.type === 'limit') return { ...base, kind: 'limit', body: event.resetsAt ? `Hit the usage limit, resumes after ${new Date(event.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Hit the usage limit' };
  if (event.type !== 'turn-end' || event.status === 'interrupted') return null;
  return event.status === 'done' ? { ...base, kind: 'done', body: 'Turn finished, ready for review' } : { ...base, kind: 'failed', body: event.error ?? 'The agent stopped with an error' };
}

function trackRequests(event: AgentEvent) {
  const open = requests.get(event.threadId) ?? new Set<string>();
  if (event.type === 'approval' || event.type === 'question') open.add(event.requestId);
  else if (event.type === 'resolved') open.delete(event.requestId);
  // A turn's end or limit withdraws whatever it was still asking.
  else if (event.type === 'turn-end' || event.type === 'limit') open.clear();
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
  live.add(n);
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
    await resolveRequest(requestId, isAllowed ? { kind: 'allow' } : { kind: 'deny', message: 'Denied from a notification' });
    emitAgentEvent({ threadId, type: 'resolved', requestId });
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

/**
 * Runs from the scheduler's poll: one `gh pr view` + `gh pr checks` per watched thread with a folder that's due. A thread whose
 * checks are running is due every poll; one with no PR, settled checks or a failing gh backs off, doubling up to `CI_MAX_MS`.
 */
export async function pollCi(deliver: (event: ScheduleEvent) => void) {
  const watched = new Set(config.threads.map((t) => t.id));
  for (const id of ci.keys()) if (!watched.has(id)) ci.delete(id);
  for (const thread of config.threads) {
    const now = Date.now();
    const state = ci.get(thread.id) ?? { dueAt: 0, delay: CI_BASE_MS };
    if (!thread.cwd || state.dueAt > now) continue;
    const pr = await readPr(thread.cwd, githubAccount(thread.githubUser)).catch((error: Error) => {
      console.warn(`CI poll for ${thread.id} failed: ${error.message}`);
      return null;
    });
    const { seen, result } = pr?.state === 'OPEN' ? ciTransition(state.seen, pr) : { seen: state.seen, result: undefined };
    const isChanging = seen?.status === 'pending' || seen?.pr !== state.seen?.pr || seen?.status !== state.seen?.status;
    const delay = isChanging ? CI_BASE_MS : Math.min(state.delay * 2, CI_MAX_MS);
    // Due a little early, so the scheduler's next tick on the same interval doesn't miss it by milliseconds.
    ci.set(thread.id, { seen, delay, dueAt: now + delay - 5_000 });
    if (!result) continue;
    deliver({ type: 'ci', threadId: thread.id, result });
    alert({ threadId: thread.id, kind: 'ci', title: thread.title, body: ciTitle(result) });
  }
}
