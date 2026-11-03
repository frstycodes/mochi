import type {
  MissedRuns,
  TriggerInput,
  TriggerWhen,
} from '../host/types/schedule.ts';
import { firstPrompt, type Thread } from '../model.ts';
import { profilesNow } from '../store/context.ts';
import { scheduledStart } from '../runtime/live.ts';
import type { Action, State } from '../store/types.ts';

export interface TriggerDraft {
  when: TriggerWhen;
  missed: MissedRuns;
}

/** Triggers an action registers in main: a thread created with a schedule gets one, your first message as the prompt. */
export function scheduleCalls(
  state: State,
  action: Action,
  next: () => State,
): TriggerInput[] {
  if (action.type !== 'create' || !action.schedule) return [];
  const draft = action.schedule;
  return next()
    .threads.filter((t) => !state.threads.some((s) => s.id === t.id))
    .flatMap(
      (t) =>
        triggerInput(t, { ...draft, name: t.title, prompt: firstPrompt(t) }) ??
        [],
    );
}

/** Undefined for a thread that can't run (a project with no folder on disk). */
export function triggerInput(
  thread: Thread,
  draft: TriggerDraft & { name: string; prompt: string },
): TriggerInput | undefined {
  const start = scheduledStart(thread);
  if (!start) return;
  const githubUser =
    profilesNow().find((p) => p.id === thread.spaceId)?.github || undefined;
  return {
    threadId: thread.id,
    ...draft,
    start,
    sessionId: thread.session?.id,
    githubUser,
  };
}

/** A scheduled thread's trigger keeps how main starts it; a new workspace before its first run replaces that. Undefined without a trigger. */
export function retargeted(
  thread: Thread,
  trigger:
    | Pick<TriggerInput, 'when' | 'missed' | 'name' | 'prompt'>
    | undefined,
): TriggerInput | undefined {
  return (
    trigger &&
    triggerInput(thread, {
      when: trigger.when,
      missed: trigger.missed,
      name: trigger.name,
      prompt: trigger.prompt,
    })
  );
}
