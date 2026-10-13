import { useEffect, type Dispatch } from 'react';
import { host } from '../host';
import type { Thread } from '../model';
import type { Action } from '../store';
import { parseOutcome } from '../utility/prompts';
import { goalDraftRequest, localGoalDraft } from './draft';

// Once per message per launch: a message no model could read keeps the local verdict.
const asked = new Set<string>();

/** Drafts a goal for each thread whose newest message has none yet, on the Settings › Background tasks model; never blocks the send. */
export function useGoalDrafts(threads: Thread[], dispatch: Dispatch<Action>) {
  useEffect(() => {
    for (const t of threads) {
      const request = goalDraftRequest(t);
      if (!request || asked.has(request.key)) continue;
      asked.add(request.key);
      const answer = host.isDesktop ? host.agent.utility('outcome', t.spaceId, request.prompt) : Promise.resolve(null);
      void answer
        .catch((error: unknown) => {
          console.warn('Goal not drafted', error);
          return null;
        })
        .then((text) => {
          const proposal = (text && parseOutcome(text)) || localGoalDraft(request.text);
          if (proposal.kind === 'task') dispatch({ type: 'goal-drafted', threadId: t.id, outcome: proposal.outcome, criteria: proposal.criteria });
        });
    }
  }, [threads, dispatch]);
}
