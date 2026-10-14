import type { Provider, Step, Thread } from '../model.ts';
import { log, mapThread } from '../store/threads.ts';
import type { State } from '../store/index.tsx';

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export const PROVIDER_NAME = { claude: 'Claude', codex: 'Codex' } satisfies Record<Provider, string>;

const RECENT_DECISIONS = 3;

export function stepOwner(thread: Thread, step: Step) {
  return step.owner ?? thread.providers[0];
}

/** The context the receiving agent starts from: goal, done and open steps, your latest decisions and the diff so far. */
export function handoffSummary(thread: Thread, to: Provider, step: Step | undefined, diff: DiffStat | null) {
  const isOpen = (s: Step) => s.status !== 'done' && s.status !== 'dropped';
  const decisions = thread.activity.filter((a) => a.who === 'you' && a.kind === 'message').slice(-RECENT_DECISIONS);
  const list = (lines: string[]) => (lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- None yet');
  return [
    `**Handoff to ${PROVIDER_NAME[to]}**: ${step ? `step "${step.title}"` : 'the whole thread'}`,
    `**Goal:** ${thread.goal}`,
    `**Done**\n${list(thread.steps.filter((s) => s.status === 'done').map((s) => s.title))}`,
    `**Open**\n${list(thread.steps.filter(isOpen).map((s) => `${s.title} (${s.status})`))}`,
    `**Recent decisions**\n${list(decisions.map((d) => (d.text.length > 140 ? `${d.text.slice(0, 139)}…` : d.text)))}`,
    `**Diff so far:** ${diff ? `${diff.files} files, +${diff.added} −${diff.removed}` : 'not read'}`,
  ].join('\n\n');
}

// For a live thread, `agentCalls` (src/runtime/live.ts) also stops the old agent and starts the new one in the same worktree
// with `summary` as its first prompt. A demo thread, or a one-step handoff, only changes who the model says owns the work.
/** Moves the thread (or one step) to `to`, logged as a harness event and the summary the new agent starts from. Not a goal revision: what done means is unchanged. */
export function handoff(state: State, threadId: string, stepId: string | undefined, to: Provider, summary: string): State {
  const now = state.now;
  return {
    ...state,
    threads: mapThread(state.threads, threadId, (t) => {
      const step = stepId ? t.steps.find((s) => s.id === stepId) : undefined;
      if (stepId && !step) return t;
      const from = step ? stepOwner(t, step) : t.providers[0];
      if (from === to) return t;
      const what = step ? `"${step.title}"` : 'the thread';
      const moved: Thread = step
        ? { ...t, providers: t.providers.includes(to) ? t.providers : [...t.providers, to], steps: t.steps.map((s) => (s.id === step.id ? { ...s, owner: to } : s)) }
        : {
            ...t,
            providers: [to, ...t.providers.filter((p) => p !== to)],
            // Finished steps keep who did them; open ones follow the thread to its new agent.
            steps: t.steps.map((s) => (s.status === 'done' || s.status === 'dropped' ? { ...s, owner: stepOwner(t, s) } : { ...s, owner: undefined })),
          };
      const logged = log(moved, { at: now, who: 'harness', kind: 'event', text: `Handed ${what} from ${PROVIDER_NAME[from]} to ${PROVIDER_NAME[to]} with a context summary` });
      return log(logged, { at: now, who: 'harness', kind: 'message', text: summary });
    }),
  };
}
