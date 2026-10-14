import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Account, AgentInstall, AgentLogin } from '../../src/host/types/settings.ts';
import type { Provider } from '../../src/model.ts';
import { parseClaudeAuth, parseCodexAccount, parseVersion } from '../../src/settings/parse.ts';
import { accountEnv, resolveExecutable, userPath } from '../agents/config.ts';
import { killTree, spawnable } from '../platform.ts';

const TIMEOUT_MS = 10_000;

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
    const child = spawn(target.file, target.args, { env, stdio: ['pipe', 'pipe', 'ignore'], shell: target.shell, windowsHide: true });
    const finish = (login: AgentLogin) => {
      clearTimeout(timer);
      killTree(child);
      resolve(login);
    };
    const timer = setTimeout(() => finish({ state: 'unknown', reason: 'codex app-server did not answer in time' }), TIMEOUT_MS);
    child.on('error', (error) => finish({ state: 'unknown', reason: error.message }));
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

function run(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; error?: string }> {
  const target = spawnable(file, args);
  return new Promise((resolve) =>
    execFile(target.file, target.args, { env, timeout: TIMEOUT_MS, maxBuffer: 1 << 20, shell: target.shell, windowsHide: true }, (error, stdout) =>
      resolve({ stdout: String(stdout), error: error ? (error.killed ? `${args.join(' ')} timed out` : error.message.split('\n')[0]) : undefined }),
    ),
  );
}
