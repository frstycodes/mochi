import type { ActivityEntry } from '../model.ts';
import type { ChatRow } from './rows.ts';

export interface SendOrigin {
  /** The composer's text area at the moment of sending. */
  box: DOMRect;
  /** The first character's box, where the text starts its flight. */
  text: { left: number; top: number; height: number };
  /** The composer card's corner, which the bubble's fill starts from. */
  radius: number;
  /** The fill's opacity: none from the composer, some when a flight is handed on mid-way. */
  opacity: number;
}

// Long enough for a send that saves images or waits on another computer's mirror; after it, the bubble just appears.
const MAX_WAIT_MS = 1000;

let pending:
  | { threadId: string; origin: SendOrigin; at: number; claimedBy?: string }
  | undefined;

export function recordSend(
  threadId: string,
  origin: SendOrigin,
  now = performance.now(),
) {
  pending = { threadId, origin, at: now };
}

/**
 * The flight of the message just sent in `threadId`, for the bubble `key` that shows it. The first bubble to claim it keeps it, so
 * a remount (StrictMode, the virtualizer) flies again while older bubbles mounting meanwhile never do.
 */
export function claimSend(
  threadId: string,
  key: string,
  now = performance.now(),
) {
  if (!pending || pending.threadId !== threadId) return undefined;
  if (now - pending.at > MAX_WAIT_MS) return undefined;
  if (pending.claimedBy && pending.claimedBy !== key) return undefined;
  pending.claimedBy = key;
  return pending.origin;
}

/**
 * The bubble `key` left mid-flight (a steer the agent read moves into the transcript): the next bubble to claim the flight picks it up
 * from where it was on screen.
 */
export function handOnSend(key: string, from: SendOrigin) {
  if (pending?.claimedBy !== key) return;
  pending = { ...pending, origin: from, claimedBy: undefined };
}

/** Landed: nothing flies again, even if the bubble remounts. */
export function finishSend(key: string) {
  if (pending?.claimedBy === key) pending = undefined;
}

/** The row's key if it shows the newest message of yours: only that one can be the message just sent. */
export function newestYoursKey(activity: ActivityEntry[], row: ChatRow) {
  if (row.kind !== 'message' || row.entry.who !== 'you') return undefined;
  const newest = activity.findLastIndex(
    (e) => e.who === 'you' && e.kind === 'message',
  );
  return newest === row.index ? row.key : undefined;
}
