import { app } from 'electron';
import { writeFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScheduleEvent } from '../../src/host/types/schedule.ts';
import { autofixQuery, autofixStep, autofixTitle, parseAutofix, type AutofixBaseline, type AutofixEvent, type AutofixTarget } from '../../src/git/autofix.ts';
import { githubAccount, runGh } from '../git/gh.ts';
import { topLevel } from '../git/run.ts';
import { failedLog } from '../ipc/git.ts';
import type { OsNotice } from '../../src/notify/watch.ts';

/**
 * Auto-fix: main reads each PR you turned it on for and sends the thread's agent one event per new state (CI failure, conflict,
 * review comments). Baselines are saved, so a relaunch never fires what was already sent.
 */
interface Saved {
  version: 1;
  baselines: Record<string, AutofixBaseline>;
}

const BASE_MS = 2 * 60_000;
// Review comments wait at most this long once a PR has gone quiet.
const MAX_MS = 10 * 60_000;
// Per failing check, and how many checks get a log: enough for the assertion and stack, small enough for one message.
const LOG_LINES = 80;
const MAX_LOGS = 3;

// GAP: baselines of PRs you turned Auto-fix off for stay in the file (a few hundred bytes each); prune by thread if it grows.
let baselines: Record<string, AutofixBaseline> | null = null;
const due = new Map<string, { dueAt: number; delay: number; signature: string }>();

const file = () => join(app.getPath('userData'), 'autofix.json');
const keyOf = (t: AutofixTarget) => `${t.threadId}#${t.pr}`;

/** Runs from the scheduler's poll, after CI for watched threads. `alert` is the watch's OS notification (quiet hours, muting apply). */
export async function pollAutofix(targets: AutofixTarget[], deliver: (event: ScheduleEvent) => void, alert: (notice: OsNotice) => void) {
  baselines ??= await readFile(file(), 'utf8').then((text) => (JSON.parse(text) as Saved).baselines, () => ({}));
  for (const target of targets) {
    const key = keyOf(target);
    const now = Date.now();
    const timing = due.get(key) ?? { dueAt: 0, delay: BASE_MS, signature: '' };
    if (timing.dueAt > now || (baselines[key]?.stopped && baselines[key].since === target.since)) continue;
    try {
      const top = await topLevel(target.cwd);
      const account = githubAccount(target.githubUser);
      const snap = parseAutofix(await runGh(top, autofixQuery(target.pr), account));
      if (!snap) continue;
      const { baseline, events } = autofixStep(baselines[key], target, snap);
      baselines[key] = baseline;
      save();
      const signature = `${snap.head}:${baseline.seen.length}:${snap.checks.map((c) => c.state).join()}`;
      const isQuiet = signature === timing.signature && !snap.checks.some((c) => c.state === 'pending');
      const delay = isQuiet ? Math.min(timing.delay * 2, MAX_MS) : BASE_MS;
      // Due a little early, so the scheduler's next tick on the same interval doesn't miss it by milliseconds.
      due.set(key, { dueAt: now + delay - 5_000, delay, signature });
      for (const event of events) {
        deliver({ type: 'autofix', threadId: target.threadId, event: await withLogs(event, top, account) });
        if (event.kind === 'stopped' && event.reason === 'cap') alert({ threadId: target.threadId, kind: 'ci', title: target.title, body: autofixTitle(event) });
      }
    } catch (error) {
      console.warn(`Auto-fix poll for ${key} failed: ${(error as Error).message}`);
      due.set(key, { ...timing, dueAt: now + Math.min(timing.delay * 2, MAX_MS), delay: Math.min(timing.delay * 2, MAX_MS) });
    }
  }
}

/** A CI event gets the tail of each failing Actions job's log; a check elsewhere, or a log gh can't read, goes without. */
async function withLogs(event: AutofixEvent, top: string, account: ReturnType<typeof githubAccount>): Promise<AutofixEvent> {
  if (event.kind !== 'ci') return event;
  const jobs = event.failed.filter((c) => c.link?.includes('/actions/runs/')).slice(0, MAX_LOGS);
  const logs = await Promise.all(jobs.map((c) => failedLog(top, c.link!, account, LOG_LINES).then((text) => ({ name: c.name, text }), () => null)));
  return { ...event, logs: logs.filter((l) => !!l) };
}

// Saves are serialized and go through a temp file, so a quit mid-write leaves the previous file whole.
let writing: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
const snapshot = () => JSON.stringify({ version: 1, baselines: baselines ?? {} } satisfies Saved);

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    const text = snapshot();
    writing = writing.catch(() => {}).then(async () => {
      await writeFile(`${file()}.tmp`, text, { mode: 0o600 });
      await rename(`${file()}.tmp`, file());
    });
  }, 200);
}

app.on('before-quit', () => {
  if (!timer) return;
  clearTimeout(timer);
  writeFileSync(file(), snapshot(), { mode: 0o600 });
});
