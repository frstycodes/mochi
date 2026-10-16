import { useEffect, type Dispatch } from 'react';
import { host } from '../host';
import type { Thread } from '../model';
import type { Action } from '../store';
import { parseTitle } from './prompts';
import { titleRequest } from './titles';

// Once per thread per launch: a thread no model could name keeps its truncated first message.
const asked = new Set<string>();

/** Names each live thread after its first exchange, on the Settings › Models › Background tasks model. */
export function useAutoTitles(threads: Thread[], dispatch: Dispatch<Action>) {
  useEffect(() => {
    if (!host.isDesktop) return;
    for (const t of threads) {
      const prompt = !asked.has(t.id) && titleRequest(t);
      if (!prompt) continue;
      asked.add(t.id);
      void host.agent.utility('title', t.spaceId, prompt).then(
        (text) => {
          const title = text && parseTitle(text);
          if (title) dispatch({ type: 'title-generated', threadId: t.id, title });
        },
        (error: unknown) => console.warn('Thread title not generated', error),
      );
    }
  }, [threads, dispatch]);
}
