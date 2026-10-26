import { access, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Claude Code's refusal when `resumeSessionAt` names no entry of the resumed transcript; the start ends with it and nothing runs. */
export const MISSING_FORK_POINT = 'No message found with message.uuid';

export const FORK_MISSING_NOTICE =
  "The rewind point isn't in Claude's session, so the whole session resumed: the agent may still remember the rewound messages";
export const FORK_REFUSED_NOTICE =
  "Claude Code couldn't fork its session at the rewind point, so the whole session resumed: the agent may still remember the rewound messages";

/** What a launch of `session` forks at. A start's `forkAt` is spent by its first launch, so no relaunch replays it; one the transcript lacks is dropped. */
export async function takeForkAt(session: {
  options: { forkAt?: string; resume?: string };
  sessionId?: string;
  account: { configDir?: string };
}): Promise<{ forkAt?: string; isMissing?: boolean }> {
  const { forkAt, resume } = session.options;
  if (!forkAt) return {};
  session.options = { ...session.options, forkAt: undefined };
  if (!resume || session.sessionId !== resume) return {};
  return (await transcriptUuids(session.account.configDir, resume)).has(forkAt)
    ? { forkAt }
    : { isMissing: true };
}

/**
 * Where to fork to drop `sent[index]` and everything after: the chain entry before it, stepping back over messages of ours
 * Claude Code never wrote (yielded mid-turn, then interrupted before it read them). Null when no such entry is in the transcript.
 */
export function forkPoint(
  sent: { uuid: string; after: string | null }[],
  index: number,
  uuids: Set<string>,
): string | null {
  for (let i = index; i >= 0; i--) {
    const { after } = sent[i];
    if (!after) return null;
    if (uuids.has(after)) return after;
    if (after !== sent[i - 1]?.uuid) return null;
  }
  return null;
}

/** Every entry uuid of the session's transcript, `resumeSessionAt`'s candidates; empty when the transcript isn't found. */
export async function transcriptUuids(
  configDir: string | undefined,
  sessionId: string,
): Promise<Set<string>> {
  const file = await transcriptFile(
    configDir ?? join(homedir(), '.claude'),
    sessionId,
  );
  const uuids = new Set<string>();
  if (!file) return uuids;
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const uuid = parse(line)?.uuid;
    if (typeof uuid === 'string') uuids.add(uuid);
  }
  return uuids;
}

// Searched rather than derived from the cwd: Claude Code's folder-name scheme (and its hashing of long paths) is its own.
// Not the SDK's getSessionInfo/getSessionMessages (0.3.296): they take no config dir, so they'd read the default account's folder, and getSessionMessages
// returns only user/assistant entries while resumeSessionAt also accepts the attachment entries a fork point often is.
export async function transcriptFile(configDir: string, sessionId: string) {
  const projects = join(configDir, 'projects');
  const folders = await readdir(projects).catch(() => []);
  for (const folder of folders) {
    const file = join(projects, folder, `${sessionId}.jsonl`);
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return file;
  }
}

// A line Claude Code was still writing when it stopped is cut short.
function parse(line: string): { uuid?: unknown } | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
