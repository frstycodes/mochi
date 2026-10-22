import type { ScheduleHost, TriggerInput } from '../../src/host/types/schedule.ts';
import { parseCron } from '../../src/schedule/cron.ts';
import { scheduler } from '../schedule/scheduler.ts';
import type { Handlers } from './handlers.ts';

export const schedule = {
  async list() {
    return scheduler.list();
  },
  async set(_sender, value) {
    scheduler.set(triggerInput(value));
  },
  async remove(_sender, threadId) {
    scheduler.remove(threadId);
  },
  async setPaused(_sender, threadId, isPaused) {
    scheduler.setPaused(threadId, isPaused);
  },
  async runNow(_sender, threadId) {
    await scheduler.runNow(threadId);
  },
  async drain() {
    return scheduler.drain();
  },
} satisfies Handlers<ScheduleHost>;

function triggerInput(input: TriggerInput): TriggerInput {
  if (input.when.kind === 'cron') parseCron(input.when.cron);
  // startAgent checks the folder and options again when a run starts; only these fields are kept.
  const { provider, spaceId, cwd, workspace, model, effort, permissionMode } = input.start;
  return { ...input, start: { provider, spaceId, cwd, workspace, model, effort, permissionMode } };
}
