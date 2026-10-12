import os from 'node:os';
import * as sdk from '@anthropic-ai/claude-agent-sdk';
import { query, type Options, type SDKMessage, type SpareProcess } from '@anthropic-ai/claude-agent-sdk';
import { app } from 'electron';
import type { AgentAskContext, AgentAskMessage } from '../../../src/host/types/agent.ts';
import type { AgentInstall } from '../../../src/host/types/settings.ts';
import type { Thread } from '../../../src/model.ts';
import { detect } from '../../settings/detect.ts';
import { accountEnv, accountFor, userPath } from '../config.ts';

const ASK_MODEL = 'claude-sonnet-5-5';
const CLASSIFY_MODEL = 'claude-haiku-5-5';
const DETECT_TTL_MS = 5 * 60_000;
const SPARE_IDLE_MS = 10 * 60_000;

// Fixed at prewarm, so it is shared by side chat and classify; each call's own instructions go in `appendSystemPrompt`.
const BASE_PROMPT = 'You are a helper inside Mochi, an app that runs coding agents. You cannot run tools or change anything.';
const CLASSIFY_PROMPT =
  'Classify a message sent to a coding agent against its goal. on-goal: works toward the goal or an open step. scope-add: related, but asks for something the plan does not cover. off-goal: unrelated to the goal. Reply with only a JSON object {"verdict": "on-goal" | "scope-add" | "off-goal", "reason": "<one short sentence>"}, nothing else.';

/** Side chat: a tool-less, unsaved query that never touches the thread's own session. Yields text deltas. */
export async function* askClaude(spaceId: string, context: AgentAskContext, messages: AgentAskMessage[], abort: AbortController) {
  const prompt = messages.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n\n');
  const instructions = `Answer side questions about a coding agent's thread from the context below, briefly, in Markdown.\n\n<thread>\n${JSON.stringify(context, null, 1)}\n</thread>`;
  for await (const message of run(await runner(spaceId), prompt, ASK_MODEL, instructions, abort)) {
    if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') yield message.event.delta.text;
    if (message.type === 'result' && message.subtype !== 'success') throw new Error(message.errors?.join('\n') || `Claude stopped: ${message.subtype}`);
  }
}

/**
 * Drift guard's model pass; resolves to the parsed `{ verdict, reason }`, which the caller validates.
 * The JSON comes from the prompt, not `outputFormat`: that option is fixed at prewarm, and the spare is shared with side chat.
 */
export async function classifyClaude(prompt: string, thread: Thread, signal: AbortSignal) {
  const abort = new AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true });
  const open = thread.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped');
  const input = `Goal: ${thread.goal}\nTitle: ${thread.title}\nOpen steps:\n${open.map((s) => `- ${s.title}${s.footprint.length ? ` (${s.footprint.join(', ')})` : ''}`).join('\n') || '- none'}\n\nMessage: ${prompt}`;
  for await (const message of run(await runner(thread.spaceId), input, CLASSIFY_MODEL, CLASSIFY_PROMPT, abort)) {
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success') return null;
    return JSON.parse(message.result.slice(message.result.indexOf('{'), message.result.lastIndexOf('}') + 1)) as unknown;
  }
  return null;
}

/** Parks a Claude Code process for the profile's account, so its next side question or classify skips the startup. */
export async function warmClaude(spaceId: string) {
  park(await runner(spaceId));
}

interface Runner {
  accountId: string;
  /** What a parked process was started with; a spare is reused only while it matches. */
  key: string;
  options: Options;
}

/** The user's own Claude Code on the profile's account; no tools, settings files or saved transcript. Throws a message the UI can show. */
async function runner(spaceId: string): Promise<Runner> {
  const { account, configDir } = await accountFor(spaceId, 'claude');
  const install = await detectCached(account.id, () => detect(account));
  if (!install.path) throw new Error('Claude Code is not installed. Install it from https://code.claude.com, or set its path in Settings.');
  if (install.login.state === 'logged-out') throw new Error(configDir ? `The Claude account for this profile is logged out. Run \`CLAUDE_CONFIG_DIR=${configDir} claude auth login\` in a terminal, then try again.` : 'Claude Code is logged out. Run `claude auth login` in a terminal, then try again.');
  // Not `agentEnv()`: it adds the stored API key, which only a thread the user explicitly switched to the key may use.
  const PATH = await userPath();
  const env = { ...accountEnv('claude', configDir), PATH };
  const options: Options = { pathToClaudeCodeExecutable: install.path, env, tools: [], settingSources: [], persistSession: false, includePartialMessages: true, thinking: { type: 'disabled' }, systemPrompt: BASE_PROMPT };
  // Not the whole `env`: the SDK writes CLAUDE_AGENT_SDK_VERSION into `process.env` on every query and prewarm, so a
  // key over the env changes after the first one and the parked process would never match.
  return { accountId: account.id, key: JSON.stringify([install.path, configDir, PATH]), options };
}

/** A claimed spare when one is parked, else a cold `query()`; either way the account's next spare starts parking. */
async function* run(runner: Runner, prompt: string, model: string, instructions: string, abort: AbortController): AsyncGenerator<SDKMessage> {
  const spare = await take(runner);
  park(runner);
  if (spare) {
    try {
      const claimed = spare.claim({ prompt, options: { cwd: os.tmpdir(), model, appendSystemPrompt: instructions } });
      abort.signal.addEventListener('abort', () => claimed.close(), { once: true });
      // `option_not_applied` means the prompt runs anyway; every other refusal answers with a `not_claimed` error result.
      const isRefused = spare.claimed.then(() => false, (error: Error) => !error.message.startsWith('option_not_applied'));
      for await (const message of claimed) {
        if (message.type === 'result' && (await isRefused)) break;
        yield message;
      }
      if (!(await isRefused)) return;
    } catch (error) {
      if (abort.signal.aborted) throw error;
    }
  }
  yield* query({ prompt, options: { ...runner.options, cwd: os.tmpdir(), model, systemPrompt: `${BASE_PROMPT}\n\n${instructions}`, abortController: abort } });
}

// At most one parked process per account (~250 MB each, SDK docs). It closes after SPARE_IDLE_MS unused, when it is
// claimed (a new one parks right away), when the account's options change, and on quit.
const spares = new Map<string, { key: string; spare: Promise<SpareProcess | null>; idle: NodeJS.Timeout }>();

// `prewarm` is @alpha: an SDK without it falls back to cold starts instead of failing.
const prewarm = (sdk as { prewarm?: typeof sdk.prewarm }).prewarm;

function park(runner: Runner) {
  if (!prewarm) return;
  const { key } = runner;
  const parked = spares.get(runner.accountId);
  if (parked?.key === key) return void parked.idle.refresh();
  if (parked) discard(runner.accountId);
  const spare = prewarm({ options: runner.options }).catch((error: unknown) => {
    console.warn('Claude prewarm failed, using cold starts', error);
    return null;
  });
  const idle = setTimeout(() => discard(runner.accountId), SPARE_IDLE_MS);
  const entry = { key, spare, idle };
  spares.set(runner.accountId, entry);
  void spare.then((s) => s?.exited.then(() => spares.get(runner.accountId) === entry && discard(runner.accountId)));
}

async function take(runner: Runner) {
  const parked = spares.get(runner.accountId);
  if (!parked || parked.key !== runner.key) return null;
  clearTimeout(parked.idle);
  spares.delete(runner.accountId);
  return parked.spare;
}

function discard(accountId: string) {
  const parked = spares.get(accountId);
  if (!parked) return;
  clearTimeout(parked.idle);
  spares.delete(accountId);
  void parked.spare.then((s) => s?.close());
}

app.on('before-quit', () => [...spares.keys()].forEach(discard));

// `detect` spawns `claude` twice; a 4s classify budget can't pay that every time. Only logged-in results are kept.
const detected = new Map<string, { at: number; install: AgentInstall }>();

async function detectCached(accountId: string, fresh: () => Promise<AgentInstall>) {
  const hit = detected.get(accountId);
  if (hit && Date.now() - hit.at < DETECT_TTL_MS) return hit.install;
  const install = await fresh();
  if (install.login.state === 'logged-in') detected.set(accountId, { at: Date.now(), install });
  return install;
}
