import type { Author, Size, Step, Thread } from '../model.ts';

export interface DraftStep {
  id?: string;
  title: string;
  size: Size;
  gate: boolean;
  acceptance?: { text: string; command?: string };
  isRemoved: boolean;
  isLocked: boolean;
}

export interface GoalDraft {
  goal: string;
  steps: DraftStep[];
}

/** Dropped steps stay out of the draft; done steps come in locked. */
export function draftFrom(thread: Thread): GoalDraft {
  return {
    goal: thread.goal,
    steps: thread.steps
      .filter((s) => s.status !== 'dropped')
      .map((s) => ({ id: s.id, title: s.title, size: s.size, gate: !!s.gate, acceptance: s.acceptance, isRemoved: false, isLocked: s.status === 'done' })),
  };
}

/** Applies a draft as one new revision whose `diff` lists each change. Returns the thread unchanged when nothing changed. */
export function applyDraft(thread: Thread, draft: GoalDraft, now: number, by: Author = 'you'): Thread {
  const n = thread.revisions.length + 1;
  const diff: string[] = [];
  const goal = draft.goal.trim() || thread.goal;
  if (goal !== thread.goal) diff.push(`~ Goal: "${thread.goal}" → "${goal}"`);

  const byId = new Map(thread.steps.map((s) => [s.id, s]));
  const steps: Step[] = [];
  draft.steps.forEach((d, i) => {
    const title = d.title.trim();
    const old = d.id ? byId.get(d.id) : undefined;
    if (!old) {
      if (d.isRemoved || !title) return;
      diff.push(`+ ${title}`);
      steps.push({ id: `${thread.id}-r${n}-${i}`, title, size: d.size, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: by, revision: n, gate: d.gate || undefined, acceptance: d.acceptance });
      return;
    }
    if (d.isRemoved && !d.isLocked) {
      diff.push(`− ${old.title}`);
      steps.push({ ...old, status: 'dropped', droppedAt: now, note: `Dropped: removed by ${by === 'you' ? 'you' : by} in v${n}` });
      return;
    }
    const next = { ...old, title: title || old.title, size: d.size, gate: d.gate || undefined, acceptance: d.acceptance?.text.trim() ? d.acceptance : undefined };
    if (next.title !== old.title) diff.push(`~ "${old.title}" renamed to "${next.title}"`);
    if (next.size !== old.size) diff.push(`~ ${next.title}: size ${old.size} → ${next.size}`);
    if (!!next.gate !== !!old.gate) diff.push(`~ ${next.title}: ${next.gate ? 'pause before it' : 'no pause'}`);
    if (JSON.stringify(next.acceptance) !== JSON.stringify(old.acceptance)) diff.push(`~ ${next.title}: acceptance criteria ${next.acceptance ? 'set' : 'removed'}`);
    steps.push(next);
  });

  const kept = (ids: (string | undefined)[]) => ids.filter((id) => id && byId.get(id)?.status !== 'dropped');
  const before = kept(thread.steps.map((s) => s.id));
  const after = kept(draft.steps.filter((d) => !d.isRemoved).map((d) => d.id));
  const surviving = before.filter((id) => after.includes(id));
  if (surviving.join() !== after.filter((id) => surviving.includes(id)).join()) diff.push('~ Reordered steps');

  if (diff.length === 0) return thread;
  thread.steps.forEach((s, i) => s.status === 'dropped' && steps.splice(Math.min(i, steps.length), 0, s));
  const label = diff.length === 1 ? diff[0].slice(2) : `${diff.length} edits`;
  return {
    ...thread,
    goal,
    steps,
    revisions: [...thread.revisions, { n, at: now, label, by, diff }],
    activity: [...thread.activity, { at: now, who: 'harness', kind: 'event', text: `Goal v${n}: ${label}` }],
  };
}

/** What changed in a revision. Older revisions without a stored diff fall back to the steps they added. */
export function revisionDiff(thread: Thread, n: number): string[] {
  const rev = thread.revisions.find((r) => r.n === n);
  if (rev?.diff) return rev.diff;
  return thread.steps.filter((s) => s.revision === n).map((s) => `+ ${s.title}`);
}
