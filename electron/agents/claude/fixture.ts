// Shaped after the SDK's message types (sdk.d.ts 0.3.296), trimmed to the fields the mapper reads.
const usage = { input_tokens: 1000, cache_read_input_tokens: 200, cache_creation_input_tokens: 50, output_tokens: 10 };
const base = { parent_tool_use_id: null, session_id: 'sess-1', uuid: 'u' };
const assistant = (content: object[]) => ({ ...base, type: 'assistant', message: { role: 'assistant', content, usage } });
const toolResult = (id: string, content: string, isError = false, result?: unknown) => ({ ...base, type: 'user', tool_use_result: result, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
const stream = (event: object) => ({ ...base, type: 'stream_event', event });

export const FIXTURE = [
  { ...base, type: 'system', subtype: 'init', cwd: '/repo', model: 'claude-opus-5-5', permissionMode: 'default', tools: [] },
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Adding' } }),
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' a test.' } }),
  assistant([{ type: 'text', text: 'Adding a test.' }]),
  assistant([{ type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [{ content: 'Add a test', status: 'in_progress', activeForm: 'Adding a test' }] } }]),
  toolResult('todo', 'Todos have been modified successfully'),
  assistant([{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' } }]),
  toolResult('edit', 'The file /repo/src/a.ts has been updated.'),
  assistant([{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'pnpm test', description: 'Run tests' } }]),
  toolResult('bash', 'Exit code 2\n1 failing', true),
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }),
  { ...base, type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.02, usage, modelUsage: { 'claude-opus-5-5': { inputTokens: 1000, outputTokens: 40, cacheReadInputTokens: 200, cacheCreationInputTokens: 100, contextWindow: 200000, costUSD: 0.02, webSearchRequests: 0, maxOutputTokens: 32000 } } },
];
