import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { Model } from '@mochi/schema';
import {
  NO_AGENT_PROCESS,
  NO_PENDING_REQUEST,
  type AgentAskEvent,
  type AgentDecision,
  type AgentEvent,
  type AgentHost,
  type AgentReviewEvent,
  type AgentReviewRequest,
  type AgentRunOptions,
  type AgentStartOptions,
  type AgentToolResult,
  type StartWorkspace,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import { classifyWithModel } from '../../../../apps/desktop/src/drift.ts';
import type {
  McpWidgetResource,
  Provider,
  Thread,
} from '../../../../apps/desktop/src/model.ts';
import {
  askClaude,
  classifyClaude,
  claudeLimits,
  discardSpares,
  warmClaude,
} from './claude/oneshot.ts';
import {
  claude,
  readClaudeWidget,
  setClaudeCompactInstructions,
  stopAllClaude,
} from './claude/sessions.ts';
import { CodexAdapter } from './codex/adapter.ts';
import type { HarnessAdapter } from './adapter.ts';
import { reviewClaude, type ReviewUpdate } from './review.ts';
import { accountFor, agentSettings, secondOpinionModel } from './config.ts';
import { limitsOf, recordLimits } from './limits.ts';
import { claudeUsageWindows } from '../../../../apps/desktop/src/usage/limits.ts';
import { VERDICT_SCHEMA } from '../../../../apps/desktop/src/secondOpinion/verdict.ts';
import { ask as askAgent, utility } from './ask.ts';
import { models } from './models.ts';
import { resolveRun } from '../../../../apps/desktop/src/runtime/models.ts';
import { setImageGenerator } from './mochiTools.ts';
import { main } from './main.ts';
import { userData } from './paths.ts';
import type { Turns } from './turns.ts';
import type { UtilityQueue } from '../utility/queue.ts';
import { PRIORITY } from '../utility/queue.ts';
import {
  commandPrompt,
  parseTitle,
  type UtilityTask,
} from '../../../../apps/desktop/src/utility/prompts.ts';
import {
  emitAgentEvent,
  eventsSince,
  forgetEvents,
  isBusy,
  markBusy,
  markIdle,
  onAgentEvent,
  push,
} from './events.ts';
import { createWorktree } from '../git/host.ts';
import { prepareWorktree } from '../git/setup.ts';
import { Starts } from './starts.ts';
import { nameThread } from './naming.ts';
import { threadSessions } from './settle.ts';
import { headOf, switchBranch } from '../git/branches.ts';
import { topLevel } from '../git/run.ts';
import { codexToolConfig } from '@mochi/domain/library/connectorTools';
import { codexServerConfig } from '../../../../apps/desktop/src/library/library.ts';
import {
  codexNativeConfig,
  offItems,
} from '../../../../apps/desktop/src/library/nativeOverrides.ts';
import { readProfileConfig } from './profileConfig.ts';
import { profileInstructions } from './profileFolder.ts';

let nextId = 0;
// Claude rejects images over 5 MB; base64 runs 4/3 of that.
const MAX_IMAGE_CHARS = 6_900_000;

const broadcast = emitAgentEvent;

/** The live read, kept on disk so a view still opens once no Claude session runs (after a restart). The view's own scripts load from the network either way. */
async function readWidget(
  threadId: string,
  server: string,
  uri: string,
): Promise<McpWidgetResource> {
  const file = join(
    userData(),
    'mcp-apps',
    `${createHash('sha256').update(`${server}\n${uri}`).digest('hex')}.json`,
  );
  try {
    const resource = await readClaudeWidget(threadId, server, uri);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(resource));
    return resource;
  } catch (error) {
    const kept = await readFile(file, 'utf8').then(
      (text) => Option.getOrNull(decodeWidget(text)),
      () => null,
    );
    if (kept) return kept;
    throw error;
  }
}

const decodeWidget = Schema.decodeUnknownOption(
  Schema.fromJsonString(Model.McpWidgetResource),
);
// Codex review threads report like any thread; their events go to the review that owns them, never to the store.
const reviewers = new Map<string, (event: AgentEvent) => void>();
const codex = new CodexAdapter(
  (event) => {
    const reviewer = reviewers.get(event.threadId);
    if (reviewer) reviewer(event);
    else broadcast(event);
  },
  undefined,
  undefined,
  (thread, scope) => main.codexUrl(thread, scope),
  async ({ spaceId, cwd, nativeOff }) => {
    const [{ servers, connectors, rules }, native] = await Promise.all([
      main.library(spaceId, 'codex'),
      codexNativeOff(spaceId, cwd, nativeOff),
    ]);
    const tools = Object.entries(rules).map(([key, keyRules]) =>
      codexToolConfig(key, keyRules),
    );
    const mochi = {
      ...codexServerConfig(servers),
      ...Object.fromEntries(
        connectors.map(([name, url]) => [`mcp_servers.${name}.url`, url]),
      ),
    };
    // A turned-off native server shares `mcp_servers.<name>` with a library server or connector of that name; Mochi's own stays on.
    const isMochis = (key: string) =>
      Object.keys(mochi).some((k) => k.startsWith(key.replace(/enabled$/, '')));
    const kept = Object.fromEntries(
      Object.entries(native).filter(
        ([key]) => !key.startsWith('mcp_servers.') || !isMochis(key),
      ),
    );
    return { ...kept, ...mochi, ...Object.assign({}, ...tools) };
  },
  (spaceId) => profileInstructions(spaceId, 'codex'),
);
const ADAPTERS = { claude, codex } satisfies Record<Provider, HarnessAdapter>;
const adapters: HarnessAdapter[] = Object.values(ADAPTERS);
/** The harness holding the thread's live session, if any. */
const adapterOf = (threadId: string) => adapters.find((a) => a.has(threadId));
// One model call per distinct command per launch: agents rerun the same `pnpm test` all day.
const commandTitles = new Map<string, Promise<string>>();
const MAX_COMMAND_TITLES = 500;

// Every thread's events pass here, Claude's and Codex's; a review thread's never do, and its calls stay undescribed.
onAgentEvent((event) => {
  if (event.type === 'tool' && event.command)
    void describeCommand(event.threadId, event.id, event.command);
});

/** A command its agent sent without a description (always on Codex, sometimes on Claude) gets one from the background model, for its row and the sidebar. */
async function describeCommand(threadId: string, id: string, command: string) {
  const spaceId = adapterOf(threadId)?.runOptions(threadId)?.spaceId;
  if (!spaceId) return;
  if (commandTitles.size >= MAX_COMMAND_TITLES) commandTitles.clear();
  let title = commandTitles.get(command);
  if (!title) {
    title = runUtility('command', spaceId, commandPrompt(command)).then(
      (text) => (text && parseTitle(text)) || '',
      () => '',
    );
    commandTitles.set(command, title);
  }
  const description = await title;
  if (description)
    broadcast({ threadId, type: 'tool-description', id, description });
}

/** The profile's turned-off Codex items as thread config, read from the account's config (the thread's project included). */
async function codexNativeOff(
  spaceId: string,
  cwd: string,
  ids: string[] | undefined,
) {
  if (!ids?.length) return {};
  return codexNativeConfig(
    offItems((await readProfileConfig(spaceId, cwd)).codex, ids),
  );
}
codex.onLimits = (accountId, windows) =>
  void recordLimits(accountId, 'codex', windows);
const ASKERS = { claude: askClaude, codex: codex.ask.bind(codex) };
setImageGenerator('codex', codex.generateImage.bind(codex));
const starts = new Starts();
// A delegated task's session id, `<thread>--<agent>` (`backgroundSession` in src/runtime/subagents.ts).
const isBackgroundSession = (threadId: string) => threadId.includes('--');

let turns: Turns['Service'] | undefined;
let queue: UtilityQueue['Service'] | undefined;

/** Set once by the agents layer. */
export function useAgentServices(services: {
  turns: Turns['Service'];
  queue: UtilityQueue['Service'];
}) {
  ({ turns, queue } = services);
}

const required = <A>(service: A | undefined) => {
  if (!service) throw new Error('The agents service is not running');
  return service;
};

/**
 * Each thread's session is a fiber on `Turns` from `start` until `stop`: stopping it interrupts the fiber, whose release
 * stops the adapter, which kills the session's process tree (spawned through `run`) and drops its pending approvals.
 */
async function runSession(threadId: string) {
  const sessions = required(turns);
  await Effect.runPromise(sessions.stop(threadId));
  const session = Effect.acquireRelease(Effect.void, () =>
    Effect.promise(() => stopSession(threadId)),
  ).pipe(Effect.andThen(Effect.never));
  await Effect.runPromise(
    sessions
      .start(threadId, () => session)
      .pipe(Effect.catch((message) => Effect.die(new Error(message)))),
  );
}

async function endSession(threadId: string) {
  if (turns) await Effect.runPromise(turns.stop(threadId));
  // A thread with no fiber (stopped already, or started before a Core restart) still gets its leftovers stopped.
  await stopSession(threadId);
}

type WindowHandlers<T> = {
  [
    K in keyof T as T[K] extends (...args: never[]) => Promise<unknown>
      ? K
      : never
  ]: T[K] extends (...args: infer A) => infer R
    ? (window: number | undefined, ...args: A) => R
    : never;
};

/** `host.agent.*`, served by Core. `window` is the calling window's id, for the answers pushed back to it alone. */
export const agent = {
  async start(_window, threadId, options) {
    await runSession(threadId);
    return startAgent(threadId, options).catch(async (error: unknown) => {
      await endSession(threadId);
      throw error;
    });
  },
  async send(_window, threadId, input) {
    // Sent while the worktree is being set up: it goes to the agent once that start is through.
    await starts.wait(threadId);
    const adapter = adapterOf(threadId);
    const run = adapter?.runOptions(threadId);
    if (!adapter || !run) throw new Error(NO_AGENT_PROCESS);
    const speed = input.policy?.speed;
    // '' is standard; a tier the running model doesn't list runs standard too.
    const tier =
      speed === undefined
        ? undefined
        : ((
            await offered(
              run.provider,
              run.spaceId,
              run.model,
              undefined,
              speed,
            )
          ).speed ?? '');
    markBusy(threadId);
    return adapter.send(threadId, {
      ...input,
      policy: { ...input.policy, speed: tier },
    });
  },
  async unsteer(_window, threadId, steerId) {
    return adapterOf(threadId)?.unsteer(threadId, steerId) ?? true;
  },
  async compact(_window, threadId, focus) {
    await starts.wait(threadId);
    const adapter = adapterOf(threadId);
    if (!adapter) throw new Error(NO_AGENT_PROCESS);
    markBusy(threadId);
    return adapter.compact(threadId, focus);
  },
  async compactInstructions(_window, threadId, instructions) {
    setClaudeCompactInstructions(threadId, instructions);
  },
  async interrupt(_window, threadId) {
    if (starts.abort(threadId)) return;
    // No adapter: nothing running for this thread (already stopped, or never started this launch): nothing to interrupt.
    return adapterOf(threadId)?.interrupt(threadId);
  },
  async setupChoice(_window, threadId, choice) {
    if (!starts.choose(threadId, choice))
      throw new Error("This thread's worktree setup isn't waiting on you");
  },
  async keepTitle(_window, threadId) {
    starts.keepTitle(threadId);
  },
  async resolve(_window, requestId, decision) {
    return resolveRequest(requestId, decision);
  },
  async stop(_window, threadId) {
    return endSession(threadId);
  },
  async settle(_window, threadId) {
    const id = threadId;
    await Promise.all([
      ...threadSessions(id, [
        ...adapters.flatMap((a) => a.threadIds()),
        ...starts.ids(),
      ]).map(endSession),
      main.settle(id),
    ]);
  },
  async attached(_window, threads) {
    return threads
      .filter((t) => adapterOf(t.threadId))
      .map(({ threadId, after }) => ({
        threadId,
        isWorking: isBusy(threadId),
        events: after === undefined ? [] : eventsSince(threadId, after),
      }));
  },
  async stopTask(_window, threadId, taskId) {
    // No adapter: its parent's process is gone, so the task already stopped with it.
    return adapterOf(threadId)?.stopTask(threadId, taskId);
  },
  async warm(_window, spaceId) {
    return warmClaude(spaceId);
  },
  async models(_window, provider, spaceId) {
    return models(codex, provider, spaceId);
  },
  async limits(_window, provider, spaceId, refresh) {
    if (refresh)
      await refreshLimits(provider, spaceId).catch((error) =>
        Effect.runSync(
          Effect.logWarning(`Could not read ${provider} limits`, error),
        ),
      );
    return limitsOf((await accountFor(spaceId, provider)).account.id, provider);
  },
  async rewindFiles(_window, threadId, text) {
    return adapterOf(threadId)?.rewindFiles?.(threadId, text);
  },
  async rewindPoint(_window, threadId, text) {
    return adapterOf(threadId)?.rewindPoint(threadId, text) ?? null;
  },
  async readWidget(_window, threadId, server, uri) {
    return readWidget(threadId, server, uri);
  },
  // GAP: a window that closes mid-answer no longer stops its ask or review; each runs to its end and its events go nowhere.
  async ask(window, context, messages, asker) {
    const id = `ask-${++nextId}`;
    const send = (event: AgentAskEvent) =>
      push({ channel: 'agent:onAskEvent', payload: event, windowId: window });
    const abort = new AbortController();
    void (async () => {
      try {
        const { model } = await offered(
          asker.provider,
          context.spaceId,
          asker.model,
          undefined,
        );
        for await (const text of askAgent(
          ASKERS,
          context,
          messages,
          { provider: asker.provider, model },
          abort,
        ))
          send({ id, type: 'text', text });
        send({ id, type: 'done', text: '' });
      } catch (error) {
        send({
          id,
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return { id };
  },
  async review(window, request) {
    const run = { ...request, cwd: await agentFolder('review', request.cwd) };
    const id = `review-${++nextId}`;
    const send = (event: AgentReviewEvent) =>
      push({
        channel: 'agent:onReviewEvent',
        payload: event,
        windowId: window,
      });
    const abort = new AbortController();
    void (async () => {
      try {
        const { model } = await offered(
          run.provider,
          run.spaceId,
          secondOpinionModel(run.provider),
          undefined,
        );
        for await (const update of run.provider === 'claude'
          ? reviewClaude(run, abort, model)
          : reviewCodex(id, run, abort.signal, model))
          send(
            update.type === 'step'
              ? { id, type: 'step', text: update.text }
              : { id, type: 'done', result: update.result },
          );
      } catch (error) {
        send({
          id,
          type: 'error',
          text: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return { id };
  },
  async pendingToolCalls(window) {
    return main.pendingToolCalls(window ?? null);
  },
  async toolResult(_window, id, result) {
    return main.toolResult(id, {
      text: result.text,
      isError: result.isError,
      ...(result.image !== undefined && { image: imageOf(result.image) }),
    });
  },
  async utility(_window, task, spaceId, prompt) {
    return executeUtility(task, spaceId, prompt);
  },
  async classify(_window, prompt, thread) {
    return classify(prompt, thread);
  },
} satisfies WindowHandlers<AgentHost>;

/** Queued in Core's utility queue, which runs `executeUtility` when it is this job's turn. */
export function runUtility(
  task: UtilityTask,
  spaceId: string,
  prompt: string,
  thread?: string,
) {
  return Effect.runPromise(
    required(queue).submit({
      thread,
      kind: task,
      priority: PRIORITY[task],
      promptChars: prompt.length,
      run: utilityCall(task, spaceId, prompt),
    }),
  );
}

/** The queued model call: a failure answers null, so its caller keeps its local behaviour. */
export const utilityCall = (
  task: UtilityTask,
  spaceId: string,
  prompt: string,
) =>
  Effect.tryPromise(() => executeUtility(task, spaceId, prompt)).pipe(
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning(`utility ${task} failed: ${error}`).pipe(
          Effect.annotateLogs({ source: 'agents' }),
        ),
        null,
      ),
    ),
  );

export const classify = (prompt: string, thread: Thread) =>
  classifyWithModel(prompt, thread, (signal) =>
    classifyClaude(prompt, thread, signal),
  );

/** One model call, no queue. */
async function executeUtility(
  task: UtilityTask,
  spaceId: string,
  prompt: string,
) {
  const offers = (provider: Provider) =>
    models(codex, provider, spaceId).then(
      (list) => list.map((m) => m.id),
      () => [],
    );
  const startedAt = performance.now();
  const answer = await utility(
    ASKERS,
    offers,
    agentSettings().utilityModels[task],
    spaceId,
    task,
    prompt,
  );
  Effect.runSync(
    Effect.logInfo(
      `utility ${task}: ${answer ? `${answer.provider} ${answer.model}` : 'no model answered, local fallback'} in ${Math.round(performance.now() - startedAt)}ms`,
    ),
  );
  return answer?.text ?? null;
}

/** Core is stopping: every agent process goes with it. */
export function disposeAgents() {
  stopAllClaude();
  discardSpares();
  codex.dispose();
}

/** Stopping a session with no agent process is a no-op, so settling twice or settling then deleting never errors. */
async function stopSession(threadId: string) {
  markIdle(threadId);
  forgetEvents(threadId);
  starts.abort(threadId);
  // Every harness: Codex also drops a start still waiting on its app-server.
  await Promise.all(adapters.map((a) => a.stop(threadId)));
}

/** Answers a pending approval or question, from the renderer or a notification's buttons. */
export async function resolveRequest(
  requestId: string,
  decision: AgentDecision,
) {
  for (const adapter of adapters)
    if (await adapter.respond(requestId, decision)) return;
  throw new Error(NO_PENDING_REQUEST);
}

/** Starts a thread's agent from options the renderer (or the scheduler) built. */
export async function startAgent(
  id: string,
  options: AgentStartOptions & { worktree?: string },
) {
  // `speed` goes only through `offered`, which drops one the model doesn't list.
  const { workspace, worktree, speed, ...rest } = options;
  // A trigger saved before workspaces carries `worktree: <branch>` instead of `workspace`.
  const startsIn =
    workspace ??
    (worktree === undefined
      ? undefined
      : ({ mode: 'worktree', branch: worktree } satisfies StartWorkspace));
  const start = starts.begin(id);
  markBusy(id);
  const launch = async (cwd: string) => {
    const run: AgentRunOptions = {
      ...rest,
      cwd,
      ...(await offered(
        options.provider,
        options.spaceId,
        options.model,
        options.effort,
        speed,
      )),
    };
    return ADAPTERS[options.provider].start(id, run, start.signal);
  };
  let isLaunching = false;
  try {
    const folder = await agentFolder(id, options.cwd);
    const { cwd, setup, named } = await workspaceFolder(
      id,
      folder,
      startsIn,
      start,
      options.spaceId,
    );
    // The renderer runs agent calls one after another, so a start that waited out the setup, or an app-server slow to answer,
    // would hold back the Stop (and every other thread's calls) behind it. It returns here; setup and launch report through events.
    isLaunching = true;
    void (setup ?? Promise.resolve())
      .then(() => named?.())
      .then(() => {
        if (!start.signal.aborted) return launch(cwd);
        markIdle(id);
        broadcast({ threadId: id, type: 'turn-end', status: 'interrupted' });
      })
      .catch((error: unknown) => {
        markIdle(id);
        broadcast({
          threadId: id,
          type: 'turn-end',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(start.end);
  } catch (error) {
    markIdle(id);
    throw error;
  } finally {
    if (!isLaunching) start.end();
  }
}

// Claude's read starts a Claude Code process, so a hover reads at most once a minute per profile.
const REFRESH_MS = 60_000;
const refreshedAt = new Map<string, number>();

async function refreshLimits(provider: Provider, spaceId: string) {
  const key = `${provider}:${spaceId}`;
  if (Date.now() - (refreshedAt.get(key) ?? 0) < REFRESH_MS) return;
  refreshedAt.set(key, Date.now());
  if (provider === 'codex') {
    const { accountId, windows } = await codex.readLimits(spaceId);
    return recordLimits(accountId, 'codex', windows, true);
  }
  const read = await claudeLimits(spaceId);
  if (read)
    await recordLimits(
      read.accountId,
      'claude',
      claudeUsageWindows(read.rateLimits),
      true,
    );
}

/**
 * The model, effort and speed a run sends: always an explicit model the account offers, and a speed only that model lists.
 * A list that can't be read passes model and effort through (the run then reports the provider's own error) and drops the speed.
 */
async function offered(
  provider: Provider,
  spaceId: string,
  model: string | undefined,
  effort: string | undefined,
  speed?: string,
) {
  return resolveRun(
    await models(codex, provider, spaceId).catch(() => []),
    model,
    effort,
    speed,
  );
}

/** A Codex review on a thread of its own: tool starts become steps, the turn's last message is the answer. */
async function* reviewCodex(
  id: string,
  request: AgentReviewRequest,
  signal: AbortSignal,
  model: string | undefined,
): AsyncGenerator<ReviewUpdate> {
  const updates: (ReviewUpdate | Error)[] = [];
  let wake = () => {};
  let answer = '';
  reviewers.set(id, (event) => {
    if (event.type === 'message')
      answer = event.isDelta ? answer + event.text : event.text;
    else if (event.type === 'tool' && event.phase === 'start')
      updates.push({ type: 'step', text: event.text });
    else if (event.type === 'turn-end')
      updates.push(
        event.status === 'done'
          ? { type: 'done', result: answer }
          : new Error(event.error ?? `Codex review ${event.status}`),
      );
    wake();
  });
  signal.addEventListener('abort', () => wake(), { once: true });
  try {
    await codex.review(
      id,
      {
        provider: 'codex',
        spaceId: request.spaceId,
        cwd: request.cwd,
        prompt: request.prompt,
        model,
      },
      VERDICT_SCHEMA,
    );
    while (!signal.aborted) {
      const update = updates.shift();
      if (!update) {
        await new Promise<void>((resolve) => (wake = resolve));
        continue;
      }
      if (update instanceof Error) throw update;
      yield update;
      if (update.type === 'done') return;
    }
  } finally {
    reviewers.delete(id);
    await codex.stop(id).catch(() => {});
  }
}

/** The project folder, checked to exist; a folderless chat (null) gets its own folder, so the agent never runs in Mochi's cwd (`/` when packaged). */
async function agentFolder(threadId: string, cwd: string | null) {
  if (cwd === null) {
    if (!/^[\w-]+$/.test(threadId))
      throw new TypeError('threadId must be letters, digits, - or _');
    const dir = join(homedir(), '.harness', 'chats', threadId);
    await mkdir(dir, { recursive: true });
    return dir;
  }
  const dir = cwd;
  if (!isAbsolute(dir))
    throw new TypeError(
      `The project folder must be an absolute path, not "${dir}"`,
    );
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory())
    throw new Error(`The project folder ${dir} doesn't exist anymore`);
  return dir;
}

/**
 * The folder the agent runs in. A worktree thread gets its own worktree, so the panes and the agent see the same files (a folder
 * that isn't a git repo runs the agent in place, but a refused existing branch fails the start). A project folder thread runs in
 * the project's checkout, switched to its branch first when it chose one; a dirty checkout refuses the switch. A new worktree
 * with a `title` is named after it, and one with a `titlePrompt` asks for its title during the setup; `named` waits for it once the setup is through.
 */
async function workspaceFolder(
  threadId: string,
  root: string,
  workspace: StartWorkspace | undefined,
  start: ReturnType<Starts['begin']>,
  spaceId: string,
): Promise<{
  cwd: string;
  setup?: Promise<unknown>;
  named?: () => Promise<void>;
}> {
  if (!workspace) return { cwd: root };
  if (workspace.mode === 'folder') {
    const top = await topLevel(root).catch(() => null);
    if (!top) return { cwd: root };
    if (workspace.isExisting)
      await switchBranch(top, workspace.branch, { changes: 'refuse' });
    // The thread shows what the checkout really has, never the name it was created with: on a detached HEAD that branch doesn't exist.
    const head = await headOf(top).catch(() => null);
    if (head) broadcast({ threadId, type: 'branch', ...head });
    return { cwd: root };
  }
  const isRepo = await topLevel(root).then(
    () => true,
    () => false,
  );
  if (!isRepo) {
    Effect.runSync(
      Effect.logWarning(
        `No worktree for ${threadId}: ${root} isn't a git repo, running there`,
      ),
    );
    return { cwd: root };
  }
  const { dir, isNew } = await createWorktree(
    root,
    threadId,
    workspace.branch,
    workspace,
  );
  broadcast({ threadId, type: 'worktree', path: dir });
  const title = !isNew
    ? undefined
    : workspace.title
      ? Promise.resolve(workspace.title)
      : workspace.titlePrompt
        ? runUtility('title', spaceId, workspace.titlePrompt, threadId).then(
            (text) => (text && parseTitle(text)) || null,
            () => null,
          )
        : undefined;
  const named =
    title &&
    (() =>
      nameThread(threadId, dir, workspace.branch, title, start, broadcast));
  const settings = agentSettings();
  if (!isNew || !settings.prepareWorktrees) return { cwd: dir, named };
  const setup = topLevel(root).then((top) =>
    prepareWorktree({
      root: top,
      dir,
      include: settings.worktreeInclude,
      command: settings.setupCommands[root],
      emit: (setup) => broadcast({ threadId, type: 'setup', setup }),
      // A background agent's setup has no row to answer from: a failed step is skipped.
      choose: isBackgroundSession(threadId)
        ? () => Promise.resolve('skip')
        : start.choose,
      signal: start.signal,
    }),
  );
  return { cwd: dir, setup, named };
}

function imageOf(image: NonNullable<AgentToolResult['image']>) {
  if (image.data.length > MAX_IMAGE_CHARS)
    throw new TypeError(
      `result.image.data must be under ${MAX_IMAGE_CHARS} chars`,
    );
  if (!/^[A-Za-z0-9+/]+=*$/.test(image.data))
    throw new TypeError('result.image.data must be base64');
  return image;
}
