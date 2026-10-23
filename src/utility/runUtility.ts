import { localClassifier, type DriftVerdict } from '../drift.ts';
import { host } from '../host/index.ts';
import { callCore } from '../host/desktop/rpc.ts';
import type { Thread } from '../model.ts';
import type { UtilityTask } from './prompts.ts';

/** Where the calls go: Core on desktop, nothing on web. Tests swap `call`. */
export const utilityCore = { call: <T>(tag: string, payload: unknown) => (host.isDesktop ? callCore<T>(tag, payload) : Promise.resolve(null as T)) };

/**
 * Asks Core's utility queue for a background task's raw answer. Null when no model answers, the job was replaced by a newer
 * one for the same `thread` and task, or this is the web build; the caller keeps its local behaviour. Without `thread` the
 * job is never replaced.
 */
export function runUtility(task: UtilityTask, spaceId: string, prompt: string, thread?: string) {
  return utilityCore.call<string | null>('utility.run', { task, spaceId, prompt, thread });
}

/** The drift guard's model pass, ahead of everything else in the queue; the local pass when Core has no verdict. */
export async function classifyInCore(prompt: string, thread: Thread): Promise<DriftVerdict> {
  if (!host.isDesktop) return host.agent.classify(prompt, thread);
  return (await utilityCore.call<DriftVerdict | null>('utility.classify', { prompt, thread })) ?? localClassifier(prompt, thread);
}
