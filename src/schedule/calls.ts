import type { MissedRuns, TriggerInput, TriggerWhen } from '../host/types/schedule.ts';
import { firstPrompt, type Thread } from '../model.ts';
import { getProfiles } from '../profiles.ts';
import { scheduledStart } from '../runtime/live.ts';
import type { Action, State } from '../store/index.tsx';

export interface TriggerDraft {
  when: TriggerWhen;
  missed: MissedRuns;
}

/** Triggers an action registers in main: a thread created with a schedule gets one, your first message as the prompt. */
export function scheduleCalls(state: State, action: Action, next: () => State): TriggerInput[] {
  if (action.type !== 'create' || !action.schedule) return [];
  const draft = action.schedule;
  return next()
    .threads.filter((t) => !state.threads.some((s) => s.id === t.id))
    .flatMap((t) => triggerInput(t, { ...draft, name: t.title, prompt: firstPrompt(t) }) ?? []);
}

/** Undefined for a thread that can't run (a project with no folder on disk). */
export function triggerInput(thread: Thread, draft: TriggerDraft & { name: string; prompt: string }): TriggerInput | undefined {
  const start = scheduledStart(thread);
  if (!start) return;
  const githubUser = getProfiles().find((p) => p.id === thread.spaceId)?.github || undefined;
  return { threadId: thread.id, ...draft, start, sessionId: thread.session?.id, githubUser };
}
