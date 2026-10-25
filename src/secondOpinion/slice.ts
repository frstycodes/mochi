import type { Action, State } from '../store/types.ts';
import type { Review } from './verdict.ts';

export type ReviewAction =
  | { type: 'review-start'; threadId: string; review: Review }
  | { type: 'review-step'; threadId: string; id: string; text: string }
  | {
      type: 'review-update';
      threadId: string;
      id: string;
      patch: Partial<Omit<Review, 'id'>>;
    };

/** Second opinions live on their thread (`Thread.reviews`), so they persist and rewind with it; nothing here touches the thread's own agent. */
export function reviewsReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'review-start':
      return patchThread(state, action.threadId, (reviews) => [
        ...reviews,
        action.review,
      ]);
    case 'review-step':
      return patchReview(state, action.threadId, action.id, (r) => ({
        steps: [...r.steps, action.text],
      }));
    case 'review-update':
      return patchReview(state, action.threadId, action.id, () => action.patch);
    default:
      return state;
  }
}

function patchThread(
  state: State,
  threadId: string,
  fn: (reviews: Review[]) => Review[],
): State {
  return {
    ...state,
    threads: state.threads.map((t) =>
      t.id === threadId ? { ...t, reviews: fn(t.reviews ?? []) } : t,
    ),
  };
}

function patchReview(
  state: State,
  threadId: string,
  id: string,
  fn: (review: Review) => Partial<Review>,
): State {
  return patchThread(state, threadId, (reviews) =>
    reviews.map((r) => (r.id === id ? { ...r, ...fn(r) } : r)),
  );
}
