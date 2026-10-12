import { PR_EVENTS, type ScheduleHost, type TriggerInput } from '../../src/host/types/schedule.ts';
import { parseCron } from '../../src/schedule/cron.ts';
import { scheduler } from '../schedule/scheduler.ts';
import { startWorkspace } from './agent.ts';
import { record, string, type Handlers } from './handlers.ts';

const PROVIDERS = ['claude', 'codex'];
const MISSED = ['run-once', 'skip'];

export const schedule = {
  async list() {
    return scheduler.list();
  },
  async set(_sender, value) {
    scheduler.set(triggerInput(value));
  },
  async remove(_sender, threadId) {
    scheduler.remove(string(threadId, 'threadId', 256));
  },
  async setPaused(_sender, threadId, isPaused) {
    if (typeof isPaused !== 'boolean') throw new TypeError('isPaused must be a boolean');
    scheduler.setPaused(string(threadId, 'threadId', 256), isPaused);
  },
  async runNow(_sender, threadId) {
    await scheduler.runNow(string(threadId, 'threadId', 256));
  },
  async drain() {
    return scheduler.drain();
  },
} satisfies Handlers<ScheduleHost>;

function triggerInput(value: unknown): TriggerInput {
  const v = record(value, 'trigger');
  const when = record(v.when, 'trigger.when');
  if (when.kind === 'cron') parseCron(string(when.cron, 'when.cron', 256));
  else if (when.kind === 'pr') {
    if (!PR_EVENTS.includes(when.event as never)) throw new TypeError(`when.event must be one of ${PR_EVENTS.join(', ')}`);
    for (const key of ['branch', 'label']) if (when[key] !== undefined) string(when[key], `when.${key}`, 256);
  } else throw new TypeError('when.kind must be cron or pr');
  if (!MISSED.includes(v.missed as string)) throw new TypeError('missed must be run-once or skip');
  const start = record(v.start, 'trigger.start');
  if (!PROVIDERS.includes(start.provider as string)) throw new TypeError('start.provider must be claude or codex');
  string(start.spaceId, 'start.spaceId', 256);
  if (start.cwd !== null) string(start.cwd, 'start.cwd');
  for (const key of ['model', 'effort', 'permissionMode']) if (start[key] !== undefined) string(start[key], `start.${key}`, 256);
  const workspace = startWorkspace(start.workspace);
  for (const key of ['sessionId', 'githubUser']) if (v[key] !== undefined) string(v[key], key, 256);
  string(v.threadId, 'threadId', 256);
  string(v.name, 'name', 200);
  string(v.prompt, 'prompt', 100_000);
  // startAgent checks the folder and options again when a run starts; only these fields are kept.
  const { provider, spaceId, cwd, model, effort, permissionMode } = start;
  return { threadId: v.threadId, name: v.name, prompt: v.prompt, when: when as TriggerInput['when'], missed: v.missed, start: { provider, spaceId, cwd, workspace, model, effort, permissionMode }, sessionId: v.sessionId, githubUser: v.githubUser } as TriggerInput;
}
