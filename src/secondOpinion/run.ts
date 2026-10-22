import { v7 as uuidv7 } from 'uuid';
import type { Dispatch } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { AgentReviewEvent } from '../host/types/agent.ts';
import type { GitDiff } from '../host/types/git.ts';
import type { Provider, Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';
import { demoReviewer } from './demo.ts';
import { checkReviewer, reviewerFor } from './reviewer.ts';
import { findingsMessage, parseVerdict, providerName, reviewPrompt, type Review, type Verdict } from './verdict.ts';

/** Starts a second opinion on `thread` from the other provider. It runs beside the thread's agent and never waits on or interrupts it. */
export function askSecondOpinion(thread: Thread, dispatch: Dispatch<Action>) {
  const { provider, reason } = reviewerFor(thread);
  if (reason) return void toast.error(`${providerName(provider)} can't review right now`, { description: reason });
  start(thread, provider, dispatch);
}

/** The agent's own request: throws why it can't, else starts it and resolves with the reviewer; the verdict comes back to the agent as a message. */
export async function agentAskSecondOpinion(thread: Thread, dispatch: Dispatch<Action>): Promise<Provider> {
  const { provider, reason } = await checkReviewer(thread);
  if (reason) throw new Error(`${providerName(provider)} can't review right now: ${reason}`);
  if (thread.reviews?.some((r) => r.status === 'running')) throw new Error('A second opinion is already running on this thread; its verdict will come to you');
  start(thread, provider, dispatch, true);
  return provider;
}

function start(thread: Thread, provider: Provider, dispatch: Dispatch<Action>, isAgentAsked?: boolean) {
  const id = `so-${uuidv7()}`;
  const review: Review = { id, provider, afterIndex: thread.activity.length, startedAt: Date.now(), status: 'running', steps: [], ...(isAgentAsked && { isAgentAsked }) };
  dispatch({ type: 'review-start', threadId: thread.id, review });
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dispatch({ type: 'review-update', threadId: thread.id, id, patch: { status: 'failed', error: message } });
    if (isAgentAsked) dispatch({ type: 'send', threadId: thread.id, text: `[Second opinion you asked for] ${providerName(provider)} couldn't review: ${message}. Carry on without it.`, reason: 'Second opinion failed', steers: true, secondOpinion: { reviewId: id, provider } });
  };
  void run(thread, review, dispatch).then((result) => isAgentAsked && sendFindings(thread, { ...review, result }, dispatch), fail);
}

/** Resolves with the verdict, already on the review; a failure is the caller's to record. */
async function run(thread: Thread, review: Review, dispatch: Dispatch<Action>): Promise<Verdict> {
  const threadId = thread.id;
  const isReal = !!thread.live && host.isDesktop;
  const cwd = threadCwd(thread);
  if (isReal && !cwd) throw new Error("This thread's folder isn't on disk, so there is no diff to review");
  dispatch({ type: 'review-step', threadId, id: review.id, text: 'Read the diff against the base branch' });
  const diff: GitDiff = cwd ? await host.git.diff(cwd, 'branch', thread.repo?.base) : { branch: '', base: '', files: [] };
  const { prompt, isTruncated } = reviewPrompt(thread, diff);
  if (isTruncated) dispatch({ type: 'review-update', threadId, id: review.id, patch: { isTruncated } });

  const reviewer = isReal ? host.agent : demoReviewer;
  // Subscribed before asking: the first events can land before `review` resolves with their id.
  const early: AgentReviewEvent[] = [];
  let handle: string | undefined;
  const settle = { resolve: (_: Verdict) => {}, reject: (_: unknown) => {} };
  const done = new Promise<Verdict>((resolve, reject) => Object.assign(settle, { resolve, reject }));
  const apply = (event: AgentReviewEvent) => {
    if (event.type === 'step') return dispatch({ type: 'review-step', threadId, id: review.id, text: event.text });
    if (event.type === 'error') return settle.reject(new Error(event.text));
    try {
      const result = parseVerdict(event.result);
      dispatch({ type: 'review-update', threadId, id: review.id, patch: { status: 'done', result } });
      settle.resolve(result);
    } catch (error) {
      settle.reject(error);
    }
  };
  const unsubscribe = reviewer.onReviewEvent((event) => (handle ? event.id === handle && apply(event) : early.push(event)));
  try {
    handle = (await reviewer.review({ provider: review.provider, spaceId: thread.spaceId, cwd: cwd ?? '.', prompt })).id;
    early.filter((e) => e.id === handle).forEach(apply);
    return await done;
  } finally {
    unsubscribe();
  }
}

/** Sends the verdict's findings to the thread's own agent as your next message. */
export function sendFindings(thread: Thread, review: Review, dispatch: Dispatch<Action>) {
  if (!review.result) return;
  const agentAsked = review.isAgentAsked && { steers: true, secondOpinion: { reviewId: review.id, provider: review.provider } };
  dispatch({ type: 'send', threadId: thread.id, text: findingsMessage(review.provider, review.result, review.isAgentAsked), drift: 'on-goal', reason: 'Second opinion findings', ...agentAsked });
  dispatch({ type: 'review-update', threadId: thread.id, id: review.id, patch: { isSent: true } });
}
