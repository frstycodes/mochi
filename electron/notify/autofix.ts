import { app } from 'electron';
import { Effect, Stream } from 'effect';
import { keyedStreams } from '@mochi/core/github/client';
import type { AutofixSnapshot } from '@mochi/core/github/schema';
import { mainCoreClient } from '@mochi/core/host';
import {
  autofixStep,
  autofixTitle,
  type AutofixBaseline,
  type AutofixEvent,
  type AutofixTarget,
} from '../../src/git/autofix.ts';
import { githubAccount } from '../git/gh.ts';
import { readDoc, writeDoc } from '@mochi/core/store/client';
import { topLevel } from '../git/run.ts';
import { failedLog } from '../ipc/git.ts';
import { deliver } from '../schedule/scheduler.ts';
import type { OsNotice } from '../../src/notify/watch.ts';

/**
 * Auto-fix: main watches each PR you turned it on for through Core's `github.ci` stream and sends the thread's agent one event
 * per new state (CI failure, conflict, review comments). Baselines are saved, so a relaunch never fires what was already sent.
 */
interface Saved {
  version: 1;
  baselines: Record<string, AutofixBaseline>;
}

// Per failing check, and how many checks get a log: enough for the assertion and stack, small enough for one message.
const LOG_LINES = 80;
const MAX_LOGS = 3;

// GAP: baselines of PRs you turned Auto-fix off for stay in the file (a few hundred bytes each); prune by thread if it grows.
let baselines: Record<string, AutofixBaseline> | null = null;
let loaded: Promise<Record<string, AutofixBaseline>> | undefined;
let targets: AutofixTarget[] = [];
let alert: (notice: OsNotice) => void = () => {};

const keyOf = (t: Pick<AutofixTarget, 'threadId' | 'pr'>) =>
  `${t.threadId}#${t.pr}`;

type Watched = Pick<AutofixTarget, 'threadId' | 'pr' | 'cwd' | 'githubUser'>;

// Core reads each PR with every other surface on its repository, fast after a push and backing off to every 10 minutes.
const streams = keyedStreams(
  ({ cwd, githubUser, pr }: Watched) =>
    Stream.unwrap(
      Effect.map(Effect.promise(mainCoreClient), (client) =>
        client['github.ci']({ cwd, githubUser, pr }),
      ),
    ),
  (watched, snap) => void onSnapshot(watched, snap),
  (watched, error) =>
    console.warn(
      `Auto-fix watch for ${keyOf(watched)} failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
);

/** The PRs to watch, from the renderer's config. `notify` is the watch's OS notification (quiet hours, muting apply). */
export function syncAutofix(
  next: AutofixTarget[],
  notify: (notice: OsNotice) => void,
) {
  targets = next;
  alert = notify;
  streams(
    next.map(({ threadId, pr, cwd, githubUser }) => ({
      threadId,
      pr,
      cwd,
      githubUser,
    })),
  );
}

async function onSnapshot(watched: Watched, snap: AutofixSnapshot | null) {
  const target = targets.find((t) => keyOf(t) === keyOf(watched));
  if (!snap || !target) return;
  baselines = await (loaded ??= readDoc<Saved>('autofix', 'autofix').then(
    (saved) => saved?.baselines ?? {},
  ));
  const key = keyOf(target);
  if (baselines[key]?.stopped && baselines[key].since === target.since) return;
  const { baseline, events } = autofixStep(baselines[key], target, snap);
  baselines[key] = baseline;
  save();
  if (events.length === 0) return;
  try {
    const top = await topLevel(target.cwd);
    const account = githubAccount(target.githubUser);
    for (const event of events) {
      deliver({
        type: 'autofix',
        threadId: target.threadId,
        event: await withLogs(event, top, account),
      });
      if (event.kind === 'stopped' && event.reason === 'cap')
        alert({
          threadId: target.threadId,
          kind: 'ci',
          title: target.title,
          body: autofixTitle(event),
        });
    }
  } catch (error) {
    console.warn(`Auto-fix for ${key} failed: ${(error as Error).message}`);
  }
}

/** A CI event gets the tail of each failing Actions job's log; a check elsewhere, or a log gh can't read, goes without. */
async function withLogs(
  event: AutofixEvent,
  top: string,
  account: ReturnType<typeof githubAccount>,
): Promise<AutofixEvent> {
  if (event.kind !== 'ci') return event;
  const jobs = event.failed
    .filter((c) => c.link?.includes('/actions/runs/'))
    .slice(0, MAX_LOGS);
  const logs = await Promise.all(
    jobs.map((c) =>
      failedLog(top, c.link!, account, LOG_LINES).then(
        (text) => ({ name: c.name, text }),
        () => null,
      ),
    ),
  );
  return { ...event, logs: logs.filter((l) => !!l) };
}

let timer: ReturnType<typeof setTimeout> | undefined;

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

function flush() {
  timer = undefined;
  // writeDoc logs a failure; the next change writes the whole document again.
  void writeDoc('autofix', 'autofix', {
    version: 1,
    baselines: baselines ?? {},
  } satisfies Saved).catch(() => {});
}

// A save still waiting on its timer goes now; quitting waits for Core to have it (`startCore`).
app.on('before-quit', () => {
  if (!timer) return;
  clearTimeout(timer);
  flush();
});
