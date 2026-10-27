import type { ListeningPort, RunTarget } from '@mochi/domain/host/types/ports';
import { portUrl } from '@mochi/domain/terminal/devServer';
import type { DevServer, Thread } from '../model.ts';
import { BROWSER_TOOLS, tabView } from './browserTools.ts';
import type { ShellOutput, ToolContext, ToolEnv, ToolSpec } from './tools.ts';

// First builds (Next, an Electron app) can take a minute before they listen.
const START_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;
const OUTPUT_LINES = 40;

export const DEV_SERVER_TOOLS = {
  start_dev_server: {
    run: async (ctx) => {
      const { caller, args, env } = ctx;
      const cwd = env.cwdOf(caller);
      if (!cwd)
        throw new Error('This chat has no project folder to run a server in');
      const targets = await env.devServers.targets(cwd);
      const target = pickTarget(targets, args.name);
      if (!target) throw new Error(noTarget(args.name, targets));
      const before = await listening(env, cwd);
      const isRunning = before.some((p) => p.port === target.port);
      const port = isRunning
        ? target.port!
        : await start(env, target, ctx.caller, cwd, before);
      const url = portUrl(port);
      const page = await BROWSER_TOOLS.browser_open.run({
        ...ctx,
        args: { url },
      });
      const preview = await screenshot(ctx, page.result.tabId, url);
      return {
        changed: isRunning ? `opened ${target.name}` : `started ${target.name}`,
        isFinal: true,
        devServer: {
          ...target,
          port,
          ...(preview && { preview }),
        } satisfies DevServer,
        result: {
          name: target.name,
          port,
          url,
          ...(isRunning && { note: 'It was already running; opened it' }),
        },
      };
    },
  },
} satisfies Record<'start_dev_server', ToolSpec<'start_dev_server'>>;

/** A launch.json configuration wins over a package.json script of the same name. */
export function pickTarget(targets: RunTarget[], name: string) {
  const named = targets.filter((t) => t.name === name);
  return named.find((t) => t.source === 'launch.json') ?? named[0];
}

function noTarget(name: string, targets: RunTarget[]) {
  const names = targets.map((t) => t.name).join(', ');
  return `No dev server named "${name}"${names ? `; there is ${names}` : ''}. Add a configuration to .claude/launch.json ({ name, runtimeExecutable, runtimeArgs, port }) and call this again with its name.`;
}

async function start(
  env: ToolEnv,
  target: RunTarget,
  thread: Thread,
  cwd: string,
  before: ListeningPort[],
) {
  const read = await env.devServers.run(target, thread, cwd);
  const end = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const port = startedPort(target, before, await listening(env, cwd));
    if (port) return port;
    const shell = read();
    if (shell.hasFailed || Date.now() > end)
      throw new Error(notListening(target, shell));
  }
}

/** The target's own port once it listens; a target with none (a package.json script) takes the first port that wasn't listening before. */
export function startedPort(
  target: RunTarget,
  before: ListeningPort[],
  now: ListeningPort[],
) {
  if (target.port)
    return now.some((p) => p.port === target.port) ? target.port : undefined;
  return now.find((p) => !before.some((b) => b.port === p.port))?.port;
}

function notListening(target: RunTarget, shell: ShellOutput) {
  const why = shell.hasFailed
    ? 'exited'
    : `isn't listening${target.port ? ` on ${target.port}` : ''} after ${START_TIMEOUT_MS / 1000}s`;
  const tail = shell.output.split('\n').slice(-OUTPUT_LINES).join('\n');
  return `${target.name} ${why}. It is still in your thread's terminal. Its last output:\n${tail}`;
}

async function listening(env: ToolEnv, cwd: string) {
  const [listing] = await env.devServers.list([cwd]);
  if (!listing || 'error' in listing) return [];
  return listing.ports;
}

// The card still shows without a preview, so a capture that fails is not the call's failure.
async function screenshot(
  ctx: ToolContext<unknown>,
  tabId: string,
  url: string,
) {
  try {
    const view = await tabView(ctx, tabId, url);
    const data = (
      await ctx.env.browser.capture(view, { fullPage: false })
    ).replace(/^data:image\/png;base64,/, '');
    return data
      ? await ctx.env.devServers.saveImage('image/png', data)
      : undefined;
  } catch {
    return undefined;
  }
}
