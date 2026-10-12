import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentAskContext, AgentAskMessage } from '../../../src/host/types/agent.ts';
import type { Thread } from '../../../src/model.ts';
import { accountEnv, accountFor, userPath } from '../config.ts';
import { detectClaude, type ClaudeInstall } from './install.ts';

const ASK_MODEL = 'claude-sonnet-5-5';
const CLASSIFY_MODEL = 'claude-haiku-5-5';
const DETECT_TTL_MS = 5 * 60_000;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['on-goal', 'scope-add', 'off-goal'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
  additionalProperties: false,
};

/** Side chat: a tool-less, unsaved query that never touches the thread's own session. Yields text deltas. */
export async function* askClaude(spaceId: string, context: AgentAskContext, messages: AgentAskMessage[], abort: AbortController) {
  const prompt = messages.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`).join('\n\n');
  const systemPrompt = `You answer side questions about a coding agent's thread in Mochi. You cannot run tools or change anything; answer from the context below, briefly, in Markdown.\n\n<thread>\n${JSON.stringify(context, null, 1)}\n</thread>`;
  for await (const message of query({ prompt, options: { ...(await baseOptions(spaceId, abort)), model: ASK_MODEL, systemPrompt, includePartialMessages: true } })) {
    if (message.type === 'stream_event' && message.event.type === 'content_block_delta' && message.event.delta.type === 'text_delta') yield message.event.delta.text;
    if (message.type === 'result' && message.subtype !== 'success') throw new Error(message.errors?.join('\n') || `Claude stopped: ${message.subtype}`);
  }
}

/** Drift guard's model pass; resolves to the raw structured output, which the caller validates. */
export async function classifyClaude(prompt: string, thread: Thread, signal: AbortSignal) {
  const abort = new AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true });
  const open = thread.steps.filter((s) => s.status !== 'done' && s.status !== 'dropped');
  const systemPrompt = 'Classify a message sent to a coding agent against its goal. on-goal: works toward the goal or an open step. scope-add: related, but asks for something the plan does not cover. off-goal: unrelated to the goal. reason: one short sentence.';
  const input = `Goal: ${thread.goal}\nTitle: ${thread.title}\nOpen steps:\n${open.map((s) => `- ${s.title}${s.footprint.length ? ` (${s.footprint.join(', ')})` : ''}`).join('\n') || '- none'}\n\nMessage: ${prompt}`;
  for await (const message of query({ prompt: input, options: { ...(await baseOptions(thread.spaceId, abort)), model: CLASSIFY_MODEL, systemPrompt, outputFormat: { type: 'json_schema', schema: VERDICT_SCHEMA } } })) {
    if (message.type === 'result') return message.subtype === 'success' ? message.structured_output : null;
  }
  return null;
}

/** The user's own Claude Code on the profile's account; no tools, settings files or saved transcript. Throws a message the UI can show. */
async function baseOptions(spaceId: string, abortController: AbortController): Promise<Options> {
  const { account, configDir, executable } = await accountFor(spaceId, 'claude');
  if (!executable) throw new Error('Claude Code is not installed. Install it from https://code.claude.com, or set its path in Settings.');
  // Not `agentEnv()`: it adds the stored API key, which only a thread the user explicitly switched to the key may use.
  const env = { ...accountEnv('claude', configDir), PATH: await userPath() };
  const install = await detect(account.id, executable, env);
  if (!install.loggedIn) throw new Error(configDir ? `The Claude account for this profile is logged out. Run \`CLAUDE_CONFIG_DIR=${configDir} claude auth login\` in a terminal, then try again.` : 'Claude Code is logged out. Run `claude auth login` in a terminal, then try again.');
  return { pathToClaudeCodeExecutable: install.path, tools: [], settingSources: [], persistSession: false, abortController, env };
}

// `detectClaude` spawns `claude` twice; a 4s classify budget can't pay that every time. Only logged-in results are kept.
const detected = new Map<string, { at: number; install: ClaudeInstall }>();

async function detect(accountId: string, executable: string, env: NodeJS.ProcessEnv) {
  const key = `${accountId}\0${executable}`;
  const hit = detected.get(key);
  if (hit && Date.now() - hit.at < DETECT_TTL_MS) return hit.install;
  const install = await detectClaude({ executablePath: executable }, env);
  if (install.loggedIn) detected.set(key, { at: Date.now(), install });
  return install;
}
