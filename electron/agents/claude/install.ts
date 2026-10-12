import { execFile } from 'node:child_process';
import { access, constants, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, safeStorage } from 'electron';

const run = promisify(execFile);

/**
 * Harness settings the Claude adapter reads, from `<userData>/agent-settings.json` (the settings session writes it):
 * `{ "claude": { "executablePath"?: string, "useApiKey"?: boolean, "apiKey"?: <safeStorage-encrypted, base64>, "maxConcurrent"?: number } }`.
 */
export interface ClaudeSettings {
  executablePath?: string;
  useApiKey?: boolean;
  apiKey?: string;
  maxConcurrent?: number;
}

export interface ClaudeInstall {
  path: string;
  version: string;
  loggedIn: boolean;
  /** As `claude auth status --json` reports it; `none` when logged out. */
  authMethod: string;
}

export async function readSettings(): Promise<ClaudeSettings> {
  try {
    const file = await readFile(path.join(app.getPath('userData'), 'agent-settings.json'), 'utf8');
    return (JSON.parse(file) as { claude?: ClaudeSettings }).claude ?? {};
  } catch {
    return {};
  }
}

/** The user's own `claude`: the settings override, else the usual install paths, else `PATH` (a Finder-launched app gets a minimal one). */
export async function findClaude(settings: ClaudeSettings): Promise<string | null> {
  const home = os.homedir();
  const candidates = settings.executablePath
    ? [settings.executablePath]
    : [path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, 'claude'))];
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/** Detects the install and its login. Throws a message the UI can show as is; never prompts for credentials. */
export async function detectClaude(settings: ClaudeSettings, env?: NodeJS.ProcessEnv): Promise<ClaudeInstall> {
  const file = await findClaude(settings);
  if (!file) throw new Error(settings.executablePath ? `Claude Code not found at ${settings.executablePath}. Fix the path in Settings.` : 'Claude Code is not installed. Install it from https://code.claude.com, then try again.');
  // `auth status` exits 1 when logged out but still prints its JSON.
  const status = run(file, ['auth', 'status', '--json'], { timeout: 15_000, env }).then(
    (r) => r.stdout,
    (error: { stdout?: string }) => (error.stdout ? error.stdout : Promise.reject(error)),
  );
  const [{ stdout: version }, statusJson] = await Promise.all([run(file, ['--version'], { timeout: 15_000 }), status]);
  const auth = JSON.parse(statusJson) as { loggedIn?: boolean; authMethod?: string };
  return { path: file, version: version.trim(), loggedIn: !!auth.loggedIn, authMethod: auth.authMethod ?? 'none' };
}

/** The env override for the API-key option only: an `ANTHROPIC_API_KEY` moves billing off the user's subscription, so it is never set otherwise. */
export function apiKeyEnv(settings: ClaudeSettings, base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> | undefined {
  if (!settings.useApiKey || !settings.apiKey) return undefined;
  // `env` replaces the child environment, so PATH, HOME and the rest must be spread in.
  return { ...base, ANTHROPIC_API_KEY: safeStorage.decryptString(Buffer.from(settings.apiKey, 'base64')) };
}

async function isExecutable(file: string) {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
