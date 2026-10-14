import { host } from '../host';
import { threadCwd } from '../host/cwd';
import type { QueueItem } from '../model';
import { useProfiles } from '../profiles';
import { useHarness } from '../store';

/** Fetches the failed check's log tail through gh and sends it to the thread's agent as your next message, settling the CI card. */
export function useSendCiLog(item: QueueItem) {
  const { state, dispatch } = useHarness();
  const profiles = useProfiles();
  return async () => {
    const thread = state.threads.find((t) => t.id === item.threadId);
    const cwd = thread && threadCwd(thread);
    const check = item.ci?.check;
    if (!thread || !cwd || !check?.link) throw new Error('This thread has no folder to run gh in');
    const log = await host.git.ciLog(cwd, check.link, profiles.find((p) => p.id === thread.spaceId)?.github || undefined);
    const text = `${item.title}. The end of the failing job's log:\n\n\`\`\`\n${log.trim()}\n\`\`\`\n\nFind the cause, fix it and push.`;
    dispatch({ type: 'send', threadId: thread.id, text, reason: 'CI log from the Queue' });
    dispatch({ type: 'answer', queueId: item.id });
  };
}
