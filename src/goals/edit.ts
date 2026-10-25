import type { Author, Criterion, Thread } from '../model.ts';

export interface DraftCriterion {
  id?: string;
  text: string;
  command?: string;
}

/** A goal as you or the agent edit it: the outcome and what done means. The agent's plan isn't part of it. */
export interface GoalDraft {
  goal: string;
  criteria: DraftCriterion[];
}

export function draftFrom(thread: Thread): GoalDraft {
  return {
    goal: thread.goal,
    criteria: (thread.criteria ?? []).map(({ id, text, command }) => ({
      id,
      text,
      command,
    })),
  };
}

/** Applies a draft as a new revision whose `diff` lists every change. Returns the thread unchanged when nothing changed. */
export function applyDraft(
  thread: Thread,
  draft: GoalDraft,
  now: number,
  by: Author = 'you',
): Thread {
  const latest = thread.revisions.at(-1)?.n ?? 1;
  const diff: string[] = [];
  const goal = draft.goal.trim() || thread.goal;
  if (goal !== thread.goal)
    diff.push(
      thread.goal ? `~ Goal: "${thread.goal}" → "${goal}"` : `+ Goal: ${goal}`,
    );
  const criteria = goal ? criteriaFrom(thread, draft, latest + 1, diff) : [];
  if (diff.length === 0) return thread;
  const n = latest + 1;
  const label = diff.length === 1 ? diff[0].slice(2) : `${diff.length} edits`;
  return {
    ...thread,
    goal,
    criteria,
    isGoalOff: undefined,
    revisions: [...thread.revisions, { n, at: now, label, by, diff }],
    activity: [
      ...thread.activity,
      { at: now, who: 'harness', kind: 'event', text: `Goal v${n}: ${label}` },
    ],
  };
}

/** Pushes one diff line per criterion added, reworded or removed; ids survive rewording. */
function criteriaFrom(
  thread: Thread,
  draft: GoalDraft,
  n: number,
  diff: string[],
): Criterion[] {
  const old = thread.criteria ?? [];
  const next: Criterion[] = [];
  draft.criteria.forEach((c, i) => {
    const text = c.text.trim();
    const command = c.command?.trim() || undefined;
    if (!text) return;
    const before = old.find((o) => o.id === c.id);
    if (!before) diff.push(`+ Done when: ${text}`);
    else if (before.text !== text)
      diff.push(`~ Done when: "${before.text}" → "${text}"`);
    if (before && before.command !== command)
      diff.push(`~ ${text}: check ${command ? `\`${command}\`` : 'removed'}`);
    // A reworded criterion or a new check is a different promise: its old claim and check result no longer count.
    const isSame = before?.text === text && before.command === command;
    next.push(
      before && isSame
        ? before
        : {
            id: before?.id ?? `${thread.id}-c${n}-${i}`,
            text,
            ...(command && { command }),
          },
    );
  });
  for (const o of old)
    if (!next.some((c) => c.id === o.id)) diff.push(`− Done when: ${o.text}`);
  return next;
}

/** What changed in a revision; older revisions saved no diff. */
export function revisionDiff(thread: Thread, n: number): string[] {
  return thread.revisions.find((r) => r.n === n)?.diff ?? [];
}
