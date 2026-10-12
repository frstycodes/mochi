import type { Dispatch } from 'react';
import { toast } from 'sonner';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { AgentReviewEvent } from '../host/types/agent.ts';
import type { GitDiff } from '../host/types/git.ts';
import type { Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';
import { demoReviewer } from './demo.ts';
import { reviewerFor } from './reviewer.ts';
import { findingsMessage, parseVerdict, providerName, reviewPrompt, type Review } from './verdict.ts';

let nextId = 0;

/** Starts a second opinion on `thread` from the other provider. It runs beside the thread's agent and never waits on or interrupts it. */
export function askSecondOpinion(thread: Thread, dispatch: Dispatch<Action>) {
  const { provider, reason } = reviewerFor(thread);
  if (reason) return void toast.error(`${providerName(provider)} can't review right now`, { description: reason });
  const id = `so-${Date.now().toString(36)}-${++nextId}`;
  const review: Review = { id, provider, afterIndex: thread.activity.length, startedAt: Date.now(), status: 'running', steps: [] };
  dispatch({ type: 'review-start', threadId: thread.id, review });
  void run(thread, review, dispatch).catch((error: unknown) => dispatch({ type: 'review-update', threadId: thread.id, id, patch: { status: 'failed', error: error instanceof Error ? error.message : String(error) } }));
}

async function run(thread: Thread, review: Review, dispatch: Dispatch<Action>) {
  const threadId = thread.id;
  const isReal = !!thread.live && host.isDesktop;
  const cwd = isReal ? (thread.live?.cwd ?? threadCwd(thread)) : threadCwd(thread);
  if (isReal && !cwd) throw new Error("This thread's folder isn't on disk, so there is no diff to review");
  dispatch({ type: 'review-step', threadId, id: review.id, text: 'Read the diff against the base branch' });
  const diff: GitDiff = cwd ? await host.git.diff(cwd, 'branch', thread.repo?.base) : { branch: '', base: '', files: [] };
  const { prompt, isTruncated } = reviewPrompt(thread, diff);
  if (isTruncated) dispatch({ type: 'review-update', threadId, id: review.id, patch: { isTruncated } });

  const reviewer = isReal ? host.agent : demoReviewer;
  // Subscribed before asking: the first events can land before `review` resolves with their id.
  const early: AgentReviewEvent[] = [];
  let handle: string | undefined;
  const settle = { resolve: () => {} };
  const done = new Promise<void>((resolve) => (settle.resolve = resolve));
  const apply = (event: AgentReviewEvent) => {
    if (event.type === 'step') return dispatch({ type: 'review-step', threadId, id: review.id, text: event.text });
    settle.resolve();
    if (event.type === 'error') return dispatch({ type: 'review-update', threadId, id: review.id, patch: { status: 'failed', error: event.text } });
    try {
      dispatch({ type: 'review-update', threadId, id: review.id, patch: { status: 'done', result: parseVerdict(event.result) } });
    } catch (error) {
      dispatch({ type: 'review-update', threadId, id: review.id, patch: { status: 'failed', error: error instanceof Error ? error.message : String(error) } });
    }
  };
  const unsubscribe = reviewer.onReviewEvent((event) => (handle ? event.id === handle && apply(event) : early.push(event)));
  try {
    handle = (await reviewer.review({ provider: review.provider, spaceId: thread.spaceId, cwd: cwd ?? '.', prompt })).id;
    early.filter((e) => e.id === handle).forEach(apply);
    await done;
  } finally {
    unsubscribe();
  }
}

/** Sends the verdict's findings to the thread's own agent as your next message. */
export function sendFindings(thread: Thread, review: Review, dispatch: Dispatch<Action>) {
  if (!review.result) return;
  dispatch({ type: 'send', threadId: thread.id, text: findingsMessage(review.provider, review.result), drift: 'on-goal', reason: 'Second opinion findings' });
  dispatch({ type: 'review-update', threadId: thread.id, id: review.id, patch: { isSent: true } });
}
