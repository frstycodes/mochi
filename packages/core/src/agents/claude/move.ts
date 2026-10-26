import { access, cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeCwd } from '../../usage/claude.ts';
import { transcriptFile } from './fork.ts';

/** Claude Code's refusal to resume a session with no transcript under its cwd's folder (2.1.310); the start ends with it and nothing runs. */
export const MISSING_SESSION = 'No conversation found with session ID';

export const FRESH_SESSION_NOTICE =
  "Claude Code couldn't find this thread's session in its new folder, so a fresh session started from a handoff of the thread so far";

/**
 * Copies the session's transcript, and its subagents' folder beside it, to where a start in `cwd` resumes it from; the original
 * stays. False when the account has no transcript of it.
 */
export async function copyTranscript(
  configDir: string | null,
  sessionId: string,
  cwd: string,
) {
  const dir = configDir ?? join(homedir(), '.claude');
  const file = await transcriptFile(dir, sessionId);
  if (!file) return false;
  const to = transcriptFolder(dir, cwd);
  if (dirname(file) === to) return true;
  await mkdir(to, { recursive: true });
  await cp(file, join(to, `${sessionId}.jsonl`));
  const subagents = join(dirname(file), sessionId);
  if (await isThere(subagents))
    await cp(subagents, join(to, sessionId), { recursive: true });
  return true;
}

// GAP: Claude Code shortens and hashes long paths its own way; a copy that misses its folder fails the resume with `MISSING_SESSION`,
// and the start falls back to a fresh session (`startFresh` in sessions.ts).
export function transcriptFolder(configDir: string, cwd: string) {
  return join(configDir, 'projects', encodeCwd(cwd));
}

const isThere = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
