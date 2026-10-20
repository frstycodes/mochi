import { isMet, type Criterion, type Thread } from '../model.ts';
import { bareState, type RefState, type RefTone } from '../chat/refs.ts';
import { resetLabel } from '../usage/limits.ts';
import { subThreadsOf } from '../reorder.ts';
import { getPrefs } from '../settings/prefs.ts';
import { nextStep } from './report.ts';

export type VerdictKind = 'checking' | 'done' | 'needs-you' | 'gaps' | 'stalled' | 'waiting' | 'idle';
export type GapSeverity = 'critical' | 'unverified';

export interface Gap {
  id: string;
  severity: GapSeverity;
  /** Short enough for the sidebar row: "Tests failing". */
  label: string;
  text: string;
  /** The criterion whose check failed, for Show output. */
  criterionId?: string;
  /** The agent's own words, for unverified gaps. */
  quote?: string;
  isAccepted: boolean;
}

export interface Verdict {
  kind: VerdictKind;
  /** The sidebar chip: "Done", "3 gaps", "Limit". */
  chip: string;
  tone: Extract<RefTone, 'success' | 'warning' | 'destructive' | 'muted'>;
  /** The one line after the chip. */
  reason: string;
  gaps: Gap[];
  /** The sub-thread this verdict is about: a parent that needs you because one of its sub-threads does. */
  subThread?: { id: string; title: string; kind: VerdictKind; openGaps: number };
}

/** A sub-thread with its own verdict, for its parent's. */
export interface SubThreadVerdict {
  thread: Thread;
  verdict: Verdict | null;
}

/**
 * Why an idle thread stopped, from what Mochi saw (criteria checks, PR state, the stop itself, the transcript audit) and what you
 * confirmed. The agent's word can hold a thread back (work it says is left, a question), never make it done. Null while the agent
 * works. `prs`: the thread's PRs as GitHub last reported them. `subs`: its sub-threads; while one is out, the parent waits on it
 * quietly, unless it needs you or is done and waits for you to hand it back.
 */
export function idleVerdict(thread: Thread, prs: RefState[], subs: SubThreadVerdict[] = []): Verdict | null {
  if (thread.live?.isWorking) return null;
  const limit = thread.live?.limit;
  if (limit) return { kind: 'stalled', chip: 'Limit', tone: 'destructive', reason: limitReason(limit), gaps: [] };
  if (thread.queuePause === 'failed') return { kind: 'stalled', chip: 'Error', tone: 'destructive', reason: failure(thread) ?? 'The agent stopped with an error', gaps: [] };
  const question = asked(thread);
  if (question) return { kind: 'needs-you', chip: question.chip, tone: 'warning', reason: question.text, gaps: [] };
  if (!getPrefs().goals || !thread.goal) return { kind: 'idle', chip: 'Idle', tone: 'muted', reason: 'Idle', gaps: [] };

  if (thread.criteria?.some((c) => c.check?.status === 'running') || thread.idle?.isGathering) return { kind: 'checking', chip: 'Checking', tone: 'muted', reason: 'Checking the turn', gaps: [] };
  const out = subs.filter((s) => !s.thread.parent?.handedBackAt && s.thread.status !== 'settled');
  const gaps = idleGaps(thread, prs, new Set(out.flatMap((s) => s.thread.parent?.criterionId ?? [])));
  const open = gaps.filter((g) => !g.isAccepted);
  if (open.length) {
    const isCritical = open.some((g) => g.severity === 'critical');
    return { kind: 'gaps', chip: `${open.length} ${open.length === 1 ? 'gap' : 'gaps'}`, tone: isCritical ? 'destructive' : 'warning', reason: gapReason(open), gaps };
  }
  const asking = out.find((s) => s.verdict && s.verdict.kind !== 'checking');
  if (asking) return subNeedsYou(asking.thread, asking.verdict!, gaps);
  if (out.length) return { kind: 'waiting', chip: 'Waiting', tone: 'muted', reason: `Waiting on ${out.length} ${out.length === 1 ? 'sub-thread' : 'sub-threads'}`, gaps };
  if (isStoppedShort(thread)) return { kind: 'stalled', chip: 'Stopped', tone: 'destructive', reason: stoppedReason(thread), gaps };
  const criteria = thread.criteria ?? [];
  const isDone = criteria.length ? criteria.every((c) => counts(thread, c)) : !!thread.idle?.isConfirmed;
  if (isDone) return { kind: 'done', ...doneLine(thread, prs), tone: 'success', gaps };
  // The turn ended cleanly and nothing says work is left: what's unmet is only yours to judge.
  return { kind: 'needs-you', chip: YOUR_CALL, tone: 'warning', reason: 'Did this get you what you wanted?', gaps };
}

/**
 * Ready for review: the idle verdict reads done. For lists outside a thread's view, which hold no live GitHub state, so a PR's
 * CI and conflicts as last read aren't counted; the thread's own card and sidebar chip do count them.
 */
export function isGoalMet(thread: Thread) {
  if (!getPrefs().goals || !thread.goal || thread.status === 'settled') return false;
  return idleVerdict(thread, bareStates(thread))?.kind === 'done';
}

/** A thread's PRs as last read, without live GitHub state: CI and conflicts unknown. */
export function bareStates(thread: Thread) {
  return thread.prs.map((pr) => bareState('pr', pr.state, pr.title, pr.url ?? ''));
}

/** A thread's sub-threads with their own verdicts (PRs as last read), for the parent's. */
export function subThreadVerdicts(threads: Thread[], parentId: string): SubThreadVerdict[] {
  return subThreadsOf(threads, parentId).map((t) => ({ thread: t, verdict: t.status === 'settled' ? null : idleVerdict(t, bareStates(t)) }));
}

/** An idle sub-thread, passed on through its parent: it asks, it's stuck, or it's finished and waits for you to hand it back. */
function subNeedsYou(sub: Thread, verdict: Verdict, gaps: Gap[]): Verdict {
  const openGaps = verdict.gaps.filter((g) => !g.isAccepted).length;
  const reason = verdict.kind === 'done' || verdict.kind === 'idle' ? `${sub.title} is finished: hand it back` : `${sub.title}: ${verdict.reason}`;
  return { kind: 'needs-you', chip: 'Needs you', tone: 'warning', reason, gaps, subThread: { id: sub.id, title: sub.title, kind: verdict.kind, openGaps } };
}

/** The needs-you chip for a turn that ended with nothing open and nothing Mochi can check. */
export const YOUR_CALL = 'Your call';

/** Met for the verdict: Mochi's check passed or the agent claimed one you judge; you confirmed one you judge; or you accepted it unchecked. */
function counts(thread: Thread, c: Criterion) {
  if (isMet(c, thread.idle?.isConfirmed)) return true;
  return !!c.command && !c.check && !!thread.idle?.accepted.includes(uncheckedId(c));
}

/** Evidence the agent stopped short: its plan has items open, or its report says work is left. Unmet criteria alone aren't. */
function isStoppedShort(thread: Thread) {
  return thread.steps.some((s) => s.status !== 'done' && s.status !== 'dropped') || !!turnReport(thread)?.left.length;
}

const uncheckedId = (c: Criterion) => `unchecked-${c.id}`;

/**
 * Every gap Mochi can see, accepted ones included: failing checks, CI and conflicts are critical; what the agent says it didn't verify isn't.
 * `covered`: criteria a sub-thread is still working on, which aren't this thread's gaps until it hands them back.
 */
export function idleGaps(thread: Thread, prs: RefState[], covered = new Set<string>()): Gap[] {
  const accepted = new Set(thread.idle?.accepted);
  const gap = (g: Omit<Gap, 'isAccepted'>): Gap => ({ ...g, isAccepted: accepted.has(g.id) });
  const failedChecks = (thread.criteria ?? []).filter((c) => c.check?.status === 'failed');
  const open = prs.filter((p) => p.kind === 'pr' && (p.status === 'open' || p.status === 'draft'));
  return [
    ...failedChecks.map((c) => gap({ id: `check-${c.id}`, severity: 'critical', label: checkLabel(c.command), text: `Check fails: ${c.text}`, criterionId: c.id })),
    // Its command never ran (checks off, or no folder to run in): a claim alone doesn't meet it.
    ...(thread.criteria ?? []).filter((c) => c.command && !c.check && !covered.has(c.id)).map((c) => gap({ id: uncheckedId(c), severity: 'unverified', label: 'Not checked', text: `Not checked: ${c.text}`, criterionId: c.id })),
    ...open.filter((p) => p.checks === 'fail').map((p) => gap({ id: `ci-${p.url}`, severity: 'critical', label: 'CI failing', text: `CI fails on ${prName(p)}` })),
    ...open.filter((p) => p.hasConflicts).map((p) => gap({ id: `conflict-${p.url}`, severity: 'critical', label: 'Conflicts', text: `${prName(p)} has merge conflicts` })),
    ...(thread.idle?.audit?.unverified ?? []).map((u, i) => gap({ id: `unverified-${i}-${u.text}`, severity: 'unverified', label: u.text, text: u.text, quote: u.quote })),
  ];
}

const REASON_GAPS = 3;

function gapReason(open: Gap[]) {
  const shown = [...open].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1)).slice(0, REASON_GAPS);
  const more = open.length - shown.length;
  return [...shown.map((g) => g.label), ...(more > 0 ? [`${more} more`] : [])].join(' · ');
}

/** "Tests failing" for `pnpm test`; any other command names itself. */
function checkLabel(command: string | undefined) {
  if (!command) return 'Check failing';
  if (/\btest\b/.test(command)) return 'Tests failing';
  if (/\b(lint|check)\b/.test(command)) return 'Lint failing';
  if (/\b(tsc|typecheck)\b/.test(command)) return 'Types failing';
  return `${command} failing`;
}

/** `#135`, or null when the PR is only known from the thread's own record (no URL). */
function prNumber(p: RefState) {
  const n = p.url.match(/\/pull\/(\d+)/)?.[1];
  return n ? `#${n}` : null;
}

function prName(p: RefState) {
  return prNumber(p) ?? 'the pull request';
}

/** A question waiting in the tray, else one the agent asked in prose. */
function asked(thread: Thread) {
  if (thread.status === 'needs-you') {
    const blocked = thread.steps.find((s) => s.status === 'blocked');
    return { chip: blocked ? 'Approval' : 'Question', text: blocked ? `Paused before "${blocked.title}"` : 'Waiting on your answer' };
  }
  if (thread.proposal?.state === 'waiting') return { chip: 'Goal to accept', text: thread.proposal.goal };
  const question = thread.idle?.audit?.question ?? turnReport(thread)?.question;
  return question ? { chip: 'Question', text: question } : null;
}

/** The agent's report_turn from the turn that just ended; an older one describes a turn your later message already answered. */
export function turnReport(thread: Thread) {
  const { report, idle } = thread;
  if (report?.turn !== undefined && idle?.turn !== undefined) return report.turn === idle.turn ? report : undefined;
  return report && report.at >= (idle?.at ?? 0) - TURN_SLACK ? report : undefined;
}

// The agent reports just before its turn ends, so its report lands a moment before Mochi's idle record.
const TURN_SLACK = 1;

function limitReason(limit: NonNullable<NonNullable<Thread['live']>['limit']>) {
  const window = limit.label ? `${limit.label} limit` : 'Usage limit';
  return limit.resetsAt ? `${window} · resumes ${resetLabel(limit.resetsAt)}` : window;
}

const FAILED = 'Turn failed: ';

function failure(thread: Thread) {
  return thread.activity.findLast((e) => e.who === 'harness' && e.text.startsWith(FAILED))?.text.slice(FAILED.length);
}

function stoppedReason(thread: Thread) {
  const next = thread.steps.find((s) => s.status === 'running' || s.status === 'ready');
  if (next) return `Stopped before "${next.title}", asked nothing`;
  const left = turnReport(thread)?.left[0];
  return left ? `Stopped with "${left}" left, asked nothing` : 'Stopped short of the goal, asked nothing';
}

function doneLine(thread: Thread, prs: RefState[]): Pick<Verdict, 'chip' | 'reason'> {
  // No folder, so no branch or PR to come: done is the end.
  if (!thread.repo) return { chip: 'Done', reason: 'Nothing left open' };
  const step = nextStep(prs.map((p) => p.status));
  if (step === 'settle') return { chip: 'Merged', reason: 'Settle thread' };
  const review = prs.find((p) => p.status === 'open' || p.status === 'draft');
  if (step === 'review' && review) return { chip: 'Done', reason: `In review · ${prName(review)}` };
  return { chip: 'Done', reason: 'Open pull request' };
}

export type TileTone = 'success' | 'warning' | 'destructive' | 'info' | 'merged' | 'none';

export interface Tile {
  id: 'criteria' | 'checks' | 'git' | 'pr' | 'agent';
  name: string;
  /** One segment per thing counted, in status colours. */
  bars: TileTone[];
  value: string;
  /** Colours the value when it asks for attention; `none` mutes it. */
  tone?: Extract<TileTone, 'warning' | 'destructive' | 'none'>;
}

/**
 * The card's evidence strip: Criteria, Checks, Git, PR, Agent said, each only where it applies (no folder: no Git or PR; no
 * commands: no Checks; nothing read and nothing asked: no Agent said). Pure, so the card only renders it.
 */
export function verdictTiles(thread: Thread, prs: RefState[], verdict: Verdict): Tile[] {
  const tiles = [criteriaTile(thread), checksTile(thread), thread.repo && gitTile(thread, prs), thread.repo && prTile(prs), agentTile(thread, verdict)];
  return tiles.filter((t): t is Tile => !!t);
}

function criteriaTile(thread: Thread): Tile | null {
  const criteria = thread.criteria ?? [];
  if (!criteria.length) return null;
  const bars = criteria.map((c): TileTone => (c.check?.status === 'failed' ? 'destructive' : c.check?.status === 'passed' || (!c.command && thread.idle?.isConfirmed) ? 'success' : c.claim ? 'info' : 'none'));
  return { id: 'criteria', name: 'Criteria', bars, value: `${criteria.filter((c) => isMet(c, thread.idle?.isConfirmed)).length} of ${criteria.length}` };
}

function checksTile(thread: Thread): Tile | null {
  const checked = (thread.criteria ?? []).filter((c) => c.command);
  if (!checked.length) return null;
  const status = checked.map((c) => c.check?.status);
  const bars = status.map((s): TileTone => (s === 'passed' ? 'success' : s === 'failed' ? 'destructive' : s === 'running' ? 'info' : 'none'));
  const failed = status.filter((s) => s === 'failed').length;
  if (failed) return { id: 'checks', name: 'Checks', bars, value: `${failed} failing`, tone: 'destructive' };
  if (status.includes('running')) return { id: 'checks', name: 'Checks', bars, value: 'running' };
  if (status.every((s) => s === 'passed')) return { id: 'checks', name: 'Checks', bars, value: 'all pass' };
  return { id: 'checks', name: 'Checks', bars, value: 'not run', tone: 'none' };
}

function gitTile(thread: Thread, prs: RefState[]): Tile {
  const uncommitted = thread.idle?.uncommitted;
  if (uncommitted) return { id: 'git', name: 'Git', bars: ['warning'], value: `${uncommitted} uncommitted`, tone: 'warning' };
  if (prs.some((p) => p.status === 'merged')) return { id: 'git', name: 'Git', bars: ['merged'], value: 'merged' };
  if (prs.some((p) => p.status === 'open' || p.status === 'draft')) return { id: 'git', name: 'Git', bars: ['success'], value: 'pushed' };
  if (uncommitted === 0) return { id: 'git', name: 'Git', bars: ['success'], value: 'committed' };
  return { id: 'git', name: 'Git', bars: ['none'], value: thread.repo ? 'not read' : 'no folder', tone: 'none' };
}

function prTile(prs: RefState[]): Tile {
  const pr = prs.find((p) => p.status === 'open' || p.status === 'draft') ?? prs.find((p) => p.status === 'merged');
  if (!pr) return { id: 'pr', name: 'PR', bars: ['none'], value: 'none', tone: 'none' };
  const n = prNumber(pr);
  const name = n ? `PR ${n}` : 'PR';
  if (pr.status === 'merged') return { id: 'pr', name, bars: ['merged'], value: 'merged' };
  if (pr.hasConflicts) return { id: 'pr', name, bars: ['destructive'], value: 'conflicts', tone: 'destructive' };
  if (pr.checks === 'fail') return { id: 'pr', name, bars: ['destructive'], value: 'CI failing', tone: 'destructive' };
  if (pr.checks === 'pass') return { id: 'pr', name, bars: ['success'], value: 'CI passed' };
  return { id: 'pr', name, bars: ['info'], value: pr.checks === 'pending' ? 'CI running' : pr.status };
}

function agentTile(thread: Thread, verdict: Verdict): Tile | null {
  if (verdict.kind === 'stalled' && verdict.chip !== 'Stopped') return { id: 'agent', name: 'Agent said', bars: ['none'], value: 'cut off', tone: 'none' };
  if (verdict.kind === 'needs-you' && verdict.chip !== YOUR_CALL) return { id: 'agent', name: 'Agent said', bars: ['warning'], value: 'asked you', tone: 'warning' };
  // Only what the agent admitted; a check that never ran is the Checks fact's.
  const unverified = verdict.gaps.filter((g) => g.id.startsWith('unverified-'));
  const open = unverified.filter((g) => !g.isAccepted).length;
  if (open) return { id: 'agent', name: 'Agent said', bars: unverified.map((g) => (g.isAccepted ? 'success' : 'warning')), value: `${open} unverified`, tone: 'warning' };
  if (!thread.idle?.audit) return null;
  return { id: 'agent', name: 'Agent said', bars: ['success'], value: 'nothing open' };
}

/** Where the card's question came from; the question itself is the card's body, so the heading never repeats it. */
function needsYouDetail(thread: Thread, verdict: Verdict) {
  if (verdict.chip === YOUR_CALL) return 'Mochi has nothing it can check here';
  if (verdict.subThread) return 'From one of its sub-threads';
  if (thread.status === 'needs-you') return 'Answer it in the composer';
  if (thread.proposal?.state === 'waiting') return 'Accept or keep the proposed goal';
  return 'Asked in its reply';
}

/** The card's title and the line under it. */
export function verdictHeading(verdict: Verdict, thread: Thread): { title: string; detail: string } {
  const critical = verdict.gaps.filter((g) => !g.isAccepted && g.severity === 'critical').length;
  const unverified = verdict.gaps.filter((g) => !g.isAccepted && g.severity === 'unverified').length;
  const accepted = verdict.gaps.filter((g) => g.isAccepted).length;
  switch (verdict.kind) {
    case 'gaps':
      return { title: `Idle with ${verdict.chip}`, detail: [critical && `${critical} critical`, unverified && `${unverified} unverified`, accepted && `${accepted} accepted`].filter(Boolean).join(', ') };
    case 'done':
      return { title: verdict.reason.startsWith('In review') ? 'Done · in review' : verdict.chip, detail: doneDetail(thread, accepted) };
    case 'needs-you':
      return { title: verdict.chip === YOUR_CALL ? YOUR_CALL : 'Needs you', detail: needsYouDetail(thread, verdict) };
    case 'stalled':
      return { title: verdict.chip === 'Stopped' ? 'Stopped mid-plan' : verdict.chip === 'Limit' ? 'Stalled · usage limit' : 'Stalled · the agent exited', detail: verdict.reason };
    case 'checking':
      return { title: 'Checking the turn', detail: 'Running criterion checks and reading the reply' };
    case 'waiting':
      return { title: verdict.reason, detail: 'Mochi asks when one finishes or needs you' };
    case 'idle':
      return { title: 'Idle', detail: 'A question or chat: nothing to check' };
  }
}

function doneDetail(thread: Thread, accepted: number) {
  if (thread.idle?.isConfirmed) return 'You confirmed it';
  return accepted ? `Every criterion met; you accepted ${accepted} ${accepted === 1 ? 'gap' : 'gaps'}` : 'Every criterion met, nothing left open';
}

/**
 * What stands between this thread and a PR: critical gaps block unless you chose Open anyway; unverified ones and those you
 * accepted go into the PR description. Read after open_pr ran the criteria checks again, so `failed` is current.
 */
export function prGate(thread: Thread, policy: 'block' | 'warn' = 'block') {
  const gaps = idleGaps(thread, []);
  const isOpenAnyway = policy === 'warn' || !!thread.idle?.canOpenPr;
  const blocking = isOpenAnyway ? [] : gaps.filter((g) => g.severity === 'critical' && !g.isAccepted);
  return { blocking, noted: gaps.filter((g) => !blocking.includes(g)) };
}

/** The tool error the agent gets, naming each critical gap the way the card does. */
export function gateRefusal(thread: Thread, blocking: Gap[]) {
  const reasons = blocking.map((g) => {
    const check = thread.criteria?.find((c) => c.id === g.criterionId)?.check;
    const line = failureLine(check?.output);
    return line ? `${g.text} (${line})` : g.text;
  });
  return `open_pr refused: ${blocking.length} critical ${blocking.length === 1 ? 'gap' : 'gaps'}: ${reasons.join('; ')}. Fix ${blocking.length === 1 ? 'it' : 'them'}, or ask the user to choose Open anyway on the verdict card.`;
}

/** The line of a failed check's output that says what failed: the first error-looking line, else the last. Node ends a crash with its version, so the last line alone reads "Node.js v26.0.0". */
export function failureLine(output: string | undefined) {
  const lines = output?.trim().split('\n').map((l) => l.trim()).filter(Boolean) ?? [];
  return lines.find((l) => /\b(error|fail(ed|ing|ure)?|assert)/i.test(l)) ?? lines.at(-1);
}
