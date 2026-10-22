import { createInterface } from 'node:readline';
import { runCommand, RunError, spawnCommand } from '@mochi/core/runClient';
import type { Account, AgentInstall, AgentLogin } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import { parseClaudeAuth, parseCodexAccount, parseVersion } from '../../src/settings/parse.ts';
import { accountEnv, resolveExecutable, userPath } from '../agents/config.ts';
import { HARNESSES } from '../../src/settings/harnesses.ts';
import { killTree, spawnable } from '../platform.ts';

const TIMEOUT_MS = 10_000;

export async function latestVersion(provider: Provider): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(HARNESSES[provider].package)}/latest`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    const data = await response.json() as { version?: unknown };
    if (typeof data.version !== 'string') return null;
    if (provider === 'codex') {
      const binary = await fetch(`https://registry.npmjs.org/%40openai%2Fcodex/${data.version}-${process.platform}-${process.arch}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!binary.ok) return null;
    }
    return data.version;
  } catch {
    return null;
  }
}

export async function updateHarness(provider: Provider): Promise<void> {
  const path = await resolveExecutable(provider);
  if (!path) throw new Error(`${HARNESSES[provider].name} is not installed`);
  const target = spawnable(path, ['update']);
  try {
    await runCommand(target.file, target.args, { env: { ...accountEnv(provider, null), PATH: await userPath() }, timeout: 180_000, shell: target.shell });
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(failure.stderr?.trim().split('\n').at(-1) || failure.message);
  }
}

/** Asks the user's own install what this account's folder is logged in with. Reads no credential files; parses only what the tools print. */
export async function detect(account: Account): Promise<AgentInstall> {
  const { provider, id: accountId } = account;
  const path = await resolveExecutable(provider);
  if (!path) return { provider, accountId, path: null, version: null, login: { state: 'unknown', reason: 'Not installed' } };
  // Without Harness's own API key: this reports the account's login, not what Harness adds on top.
  const env = { ...accountEnv(provider, account.configDir), PATH: await userPath() };
  const version = await run(path, ['--version'], env);
  if (version.error) return { provider, accountId, path, version: null, login: { state: 'unknown', reason: version.error } };
  const login = await LOGIN_CHECKS[provider](path, env);
  return { provider, accountId, path, version: parseVersion(version.stdout), login };
}

/** How each harness reports its login: the one per-harness piece of code a new registry entry needs. */
const LOGIN_CHECKS: Record<Provider, (path: string, env: NodeJS.ProcessEnv) => Promise<AgentLogin>> = { claude: claudeLogin, codex: codexLogin };

async function claudeLogin(path: string, env: NodeJS.ProcessEnv): Promise<AgentLogin> {
  // Exits 1 when logged out but still prints the JSON.
  const { stdout, error } = await run(path, ['auth', 'status', '--json'], env);
  if (!stdout.trim()) return { state: 'unknown', reason: error ?? 'No output from claude auth status' };
  return parseClaudeAuth(stdout);
}

// A short-lived app-server, separate from the adapter's: initialize, account/read, kill. Verified with codex-cli 0.155.1
// that it reports an existing `codex login` with no login call.
function codexLogin(path: string, env: NodeJS.ProcessEnv): Promise<AgentLogin> {
  return new Promise((resolve) => {
    const target = spawnable(path, ['app-server']);
    const child = spawnCommand(target.file, target.args, { env, shell: target.shell });
    const finish = (login: AgentLogin) => {
      clearTimeout(timer);
      killTree(child);
      resolve(login);
    };
    const timer = setTimeout(() => finish({ state: 'unknown', reason: 'codex app-server did not answer in time' }), TIMEOUT_MS);
    child.on('error', (error: Error) => finish({ state: 'unknown', reason: error.message }));
    child.on('exit', () => finish({ state: 'unknown', reason: 'codex app-server exited early' }));
    // EPIPE when the server dies before reading: unhandled, it would crash the main process. `exit` reports it.
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== 1) return;
      finish(message.error ? { state: 'unknown', reason: message.error.message ?? 'account/read failed' } : parseCodexAccount(message.result));
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ method: 'initialize', id: 0, params: { clientInfo: { name: 'harness', version: '0.0.0' } } });
    send({ method: 'initialized' });
    send({ method: 'account/read', id: 1, params: { refreshToken: false } });
  });
}

async function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; error?: string }> {
  const target = spawnable(file, args);
  try {
    return { stdout: (await runCommand(target.file, target.args, { env, timeout: TIMEOUT_MS, shell: target.shell })).stdout };
  } catch (error) {
    if (!(error instanceof RunError)) throw error;
    return { stdout: error.stdout ?? '', error: error.timedOut ? `${args.join(' ')} timed out` : (error.stderr.trim() || error.message).split('\n')[0] };
  }
}
