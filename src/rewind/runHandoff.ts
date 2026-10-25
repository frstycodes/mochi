import type { Dispatch } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host/index.ts';
import { threadCwd } from '../host/cwd.ts';
import type { Handoff, Provider, Thread } from '../model.ts';
import type { Action } from '../store/index.tsx';
import { handoffPrompt, parseHandoff } from '../utility/prompts.ts';
import { runUtility } from '../utility/runUtility.ts';
import {
  draftingIndex,
  handoffSummary,
  PROVIDER_NAME,
  type DiffStat,
} from './handoff.ts';

/** Past this the local summary goes instead: a handoff you asked for shouldn't wait on a slow background model. */
export const DRAFT_TIMEOUT_MS = 15_000;

const TRANSCRIPT_MESSAGES = 12;

export const otherProvider = (thread: Thread): Provider =>
  thread.providers[0] === 'claude' ? 'codex' : 'claude';

export const isHandingOff = (thread: Thread) => draftingIndex(thread) >= 0;

/**
 * Hands the thread to the other agent now: its turn stops, the transcript shows the handoff drafting, and the new agent starts
 * with the draft, or with the local summary when the draft fails or passes `DRAFT_TIMEOUT_MS`.
 */
export function handOffHere(
  thread: Thread,
  dispatch: Dispatch<Action>,
  to = otherProvider(thread),
) {
  if (thread.live?.isWorking)
    dispatch({ type: 'interrupt', threadId: thread.id });
  dispatch({ type: 'handoff-draft', threadId: thread.id, to });
  draftHandoff(thread, to).then(
    ({ prompt, fallback }) =>
      dispatch({
        type: 'handoff',
        threadId: thread.id,
        to,
        summary: prompt,
        fallback,
      }),
    (error: unknown) =>
      dispatch({
        type: 'handoff-fail',
        threadId: thread.id,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
}

/** Drafts the same prompt a handoff would send and copies it; the thread is left as it is. */
export function copyHandoffPrompt(thread: Thread) {
  const to = otherProvider(thread);
  // Written inside the promise so the success toast only says copied once the clipboard has it.
  const work = draftHandoff(thread, to).then(({ prompt }) =>
    navigator.clipboard.writeText(prompt),
  );
  void toast
    .promise(work, {
      loading: `Drafting a handoff prompt for ${PROVIDER_NAME[to]}…`,
      success: 'Copied the handoff prompt',
      error: 'Could not copy the handoff prompt',
    })
    .catch(() => undefined);
}

/** A model's prompt for `to` from the local summary and the latest messages; the local summary itself when that fails or is slow. */
export async function draftHandoff(
  thread: Thread,
  to: Provider,
  timeoutMs = DRAFT_TIMEOUT_MS,
): Promise<{ prompt: string; fallback?: Handoff['fallback'] }> {
  const template = handoffSummary(thread, to, await diffStat(thread));
  const transcript = thread.activity
    .filter((a) => a.kind === 'message' && a.who !== 'harness')
    .slice(-TRANSCRIPT_MESSAGES)
    .map(
      (a) => `${a.who === 'you' ? 'User' : 'Agent'}: ${a.text.slice(0, 1500)}`,
    );
  const draft = runUtility(
    'handoff',
    thread.spaceId,
    handoffPrompt(template, transcript),
    thread.id,
  ).then(
    (text) =>
      text
        ? { prompt: parseHandoff(text) }
        : { prompt: template, fallback: 'error' as const },
    (error: unknown) => {
      console.warn('handoff draft failed', error);
      return { prompt: template, fallback: 'error' as const };
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ prompt: string; fallback: 'timeout' }>(
    (resolve) =>
      (timer = setTimeout(
        () => resolve({ prompt: template, fallback: 'timeout' }),
        timeoutMs,
      )),
  );
  try {
    return await Promise.race([draft, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Branch diff totals for the summary; null when the thread has no folder or git can't read it. */
async function diffStat(thread: Thread): Promise<DiffStat | null> {
  const cwd = threadCwd(thread);
  if (!cwd) return null;
  try {
    const { files } = await host.git.diff(cwd, 'branch', thread.repo?.base);
    return {
      files: files.length,
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
    };
  } catch {
    return null;
  }
}
