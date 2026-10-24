import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentReviewRequest } from '../../../../src/host/types/agent.ts';
import { VERDICT_SCHEMA } from '../../../../src/secondOpinion/verdict.ts';
import { detect } from '../../../../electron/settings/detect.ts';
import { createMapper } from './claude/map.ts';
import { DEFAULT_MODEL } from './claude/sessions.ts';
import { accountEnv, accountFor, userPath } from './config.ts';

export type ReviewUpdate = { type: 'step'; text: string } | { type: 'done'; result: unknown };

// Read-only by construction: these are the only tools the session has, `dontAsk` denies anything not pre-approved
// instead of asking, and the write tools are disallowed on top in case a newer Claude Code adds tools to the list.
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash'];
const MAX_TURNS = 40;

/** A Claude second opinion on the profile's Claude account: read-only tools, no saved transcript, a JSON-schema verdict. */
export async function* reviewClaude(request: AgentReviewRequest, abort: AbortController, model: string | undefined): AsyncGenerator<ReviewUpdate> {
  const { account, configDir } = await accountFor(request.spaceId, 'claude');
  const install = await detect(account);
  if (!install.path) throw new Error('Claude Code is not installed. Install it from https://code.claude.com, or set its path in Settings.');
  if (install.login.state === 'logged-out') throw new Error(configDir ? `The Claude account for this profile is logged out. Run \`CLAUDE_CONFIG_DIR=${configDir} claude auth login\` in a terminal, then try again.` : 'Claude Code is logged out. Run `claude auth login` in a terminal, then try again.');
  const mapper = createMapper('review', request.cwd);
  const messages = query({
    prompt: request.prompt,
    options: {
      pathToClaudeCodeExecutable: install.path,
      cwd: request.cwd,
      // Not `agentEnv()`: that adds the stored API key, which only a thread explicitly switched to it may use.
      env: { ...accountEnv('claude', configDir), PATH: await userPath() },
      model: model ?? DEFAULT_MODEL,
      tools: READ_TOOLS,
      allowedTools: READ_TOOLS,
      disallowedTools: WRITE_TOOLS,
      permissionMode: 'dontAsk',
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      maxTurns: MAX_TURNS,
      outputFormat: { type: 'json_schema', schema: VERDICT_SCHEMA },
      abortController: abort,
    },
  });
  for await (const message of messages) {
    for (const event of mapper.map(message)) if (event.type === 'tool' && event.phase === 'start') yield { type: 'step', text: event.text };
    if (message.type !== 'result') continue;
    if (message.subtype !== 'success') throw new Error(message.errors?.join('\n') || `Claude stopped: ${message.subtype}`);
    return yield { type: 'done', result: message.structured_output ?? message.result };
  }
  throw new Error('Claude ended without a verdict');
}
