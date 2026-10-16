import type { Author, Criterion, Size, Step, Thread } from '../model.ts';

export interface DraftStep {
  id?: string;
  title: string;
  size: Size;
  gate: boolean;
  acceptance?: { text: string; command?: string };
  isRemoved: boolean;
  isLocked: boolean;
}

export interface DraftCriterion {
  id?: string;
  text: string;
  command?: string;
}

export interface GoalDraft {
  goal: string;
  criteria: DraftCriterion[];
  steps: DraftStep[];
}

/** Dropped steps stay out of the draft; done steps come in locked. */
export function draftFrom(thread: Thread): GoalDraft {
  return {
    goal: thread.goal,
    criteria: (thread.criteria ?? []).map(({ id, text, command }) => ({ id, text, command })),
    steps: thread.steps
      .filter((s) => s.status !== 'dropped')
      .map((s) => ({ id: s.id, title: s.title, size: s.size, gate: !!s.gate, acceptance: s.acceptance, isRemoved: false, isLocked: s.status === 'done' })),
  };
}

/**
 * Applies a draft. A change to what done means (the goal text or a step's acceptance criteria) is a new revision whose
 * `diff` lists every change; plan-only edits (steps added, dropped, renamed, resized, reordered) are logged, not versioned.
 * Returns the thread unchanged when nothing changed.
 */
export function applyDraft(thread: Thread, draft: GoalDraft, now: number, by: Author = 'you'): Thread {
  const latest = thread.revisions.at(-1)?.n ?? 1;
  const goalDiff: string[] = [];
  const planDiff: string[] = [];
  const goal = draft.goal.trim() || thread.goal;
  if (goal !== thread.goal) goalDiff.push(thread.goal ? `~ Goal: "${thread.goal}" → "${goal}"` : `+ Goal: ${goal}`);
  const criteria = goal ? criteriaFrom(thread, draft, latest + 1, goalDiff) : [];

  const byId = new Map(thread.steps.map((s) => [s.id, s]));
  const steps: Step[] = [];
  draft.steps.forEach((d, i) => {
    const title = d.title.trim();
    const old = d.id ? byId.get(d.id) : undefined;
    if (!old) {
      if (d.isRemoved || !title) return;
      planDiff.push(`+ ${title}`);
      steps.push({ id: `${thread.id}-e${thread.steps.length}-${i}`, title, size: d.size, status: 'ready', progress: 0, footprint: [], addedAt: now, addedBy: by, revision: latest, gate: d.gate || undefined, acceptance: acceptanceOf(d) });
      if (acceptanceOf(d)) goalDiff.push(`~ ${title}: acceptance criteria set`);
      return;
    }
    if (d.isRemoved && !d.isLocked) {
      planDiff.push(`− ${old.title}`);
      steps.push({ ...old, status: 'dropped', droppedAt: now, note: `Dropped: removed by ${by === 'you' ? 'you' : by}` });
      if (old.acceptance) goalDiff.push(`~ ${old.title}: acceptance criteria removed`);
      return;
    }
    const next = { ...old, title: title || old.title, size: d.size, gate: d.gate || undefined, acceptance: acceptanceOf(d) };
    if (next.title !== old.title) planDiff.push(`~ "${old.title}" renamed to "${next.title}"`);
    if (next.size !== old.size) planDiff.push(`~ ${next.title}: size ${old.size} → ${next.size}`);
    if (!!next.gate !== !!old.gate) planDiff.push(`~ ${next.title}: ${next.gate ? 'pause before it' : 'no pause'}`);
    if (JSON.stringify(next.acceptance) !== JSON.stringify(old.acceptance)) goalDiff.push(`~ ${next.title}: acceptance criteria ${next.acceptance ? 'set' : 'removed'}`);
    steps.push(next);
  });

  const kept = (ids: (string | undefined)[]) => ids.filter((id) => id && byId.get(id)?.status !== 'dropped');
  const before = kept(thread.steps.map((s) => s.id));
  const after = kept(draft.steps.filter((d) => !d.isRemoved).map((d) => d.id));
  const surviving = before.filter((id) => after.includes(id));
  if (surviving.join() !== after.filter((id) => surviving.includes(id)).join()) planDiff.push('~ Reordered steps');

  const diff = [...goalDiff, ...planDiff];
  if (diff.length === 0) return thread;
  thread.steps.forEach((s, i) => s.status === 'dropped' && steps.splice(Math.min(i, steps.length), 0, s));
  const label = diff.length === 1 ? diff[0].slice(2) : `${diff.length} edits`;
  if (!goalDiff.length) return { ...thread, steps, activity: [...thread.activity, { at: now, who: 'harness', kind: 'event', text: `Plan: ${label}` }] };
  const n = latest + 1;
  return {
    ...thread,
    goal,
    criteria,
    isGoalOff: undefined,
    steps: steps.map((s) => (s.addedAt === now && !byId.has(s.id) ? { ...s, revision: n } : s)),
    revisions: [...thread.revisions, { n, at: now, label, by, diff }],
    activity: [...thread.activity, { at: now, who: 'harness', kind: 'event', text: `Goal v${n}: ${label}` }],
  };
}

/** Pushes one diff line per criterion added, reworded or removed; ids survive rewording. */
function criteriaFrom(thread: Thread, draft: GoalDraft, n: number, diff: string[]): Criterion[] {
  const old = thread.criteria ?? [];
  const next: Criterion[] = [];
  draft.criteria.forEach((c, i) => {
    const text = c.text.trim();
    const command = c.command?.trim() || undefined;
    if (!text) return;
    const before = old.find((o) => o.id === c.id);
    if (!before) diff.push(`+ Done when: ${text}`);
    else if (before.text !== text) diff.push(`~ Done when: "${before.text}" → "${text}"`);
    if (before && before.command !== command) diff.push(`~ ${text}: check ${command ? `\`${command}\`` : 'removed'}`);
    // A reworded criterion or a new check is a different promise: its old claim and check result no longer count.
    const isSame = before?.text === text && before.command === command;
    next.push(before && isSame ? before : { id: before?.id ?? `${thread.id}-c${n}-${i}`, text, ...(command && { command }) });
  });
  for (const o of old) if (!next.some((c) => c.id === o.id)) diff.push(`− Done when: ${o.text}`);
  return next;
}

/** The message that tells the agent about steps you added: it plans in its own task tools, so a step added only to Mochi's goal never reaches it. Null when nothing was added. */
export function addedStepsNote(draft: GoalDraft) {
  const added = draft.steps.filter((d) => !d.id && !d.isRemoved && d.title.trim());
  if (!added.length) return null;
  const lines = added.map((d) => {
    const acceptance = acceptanceOf(d);
    const done = acceptance && [acceptance.text, acceptance.command && `\`${acceptance.command}\``].filter(Boolean).join(': ');
    return `- ${d.title.trim()}${done ? ` (done when ${done})` : ''}`;
  });
  return `I added to the goal's plan while you worked:\n${lines.join('\n')}\nFit it into your plan; get_goal has the step ids.`;
}

function acceptanceOf(d: DraftStep) {
  const text = d.acceptance?.text.trim() ?? '';
  const command = d.acceptance?.command?.trim() || undefined;
  return text || command ? { text, command } : undefined;
}

/** What changed in a revision. Older revisions without a stored diff fall back to the steps they added. */
export function revisionDiff(thread: Thread, n: number): string[] {
  const rev = thread.revisions.find((r) => r.n === n);
  if (rev?.diff) return rev.diff;
  return thread.steps.filter((s) => s.revision === n).map((s) => `+ ${s.title}`);
}
