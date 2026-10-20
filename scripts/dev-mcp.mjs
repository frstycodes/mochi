import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [file, tool, input = '{}'] = process.argv.slice(2);
if (!file) throw new Error('Usage: node scripts/dev-mcp.mjs <dev-mcp.json> [inspect|start_task|accept_goal|continue_task] [JSON arguments]');
const { url } = JSON.parse(await readFile(file, 'utf8'));
const client = new Client({ name: 'mochi-dev', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const result = tool ? await client.callTool({ name: tool, arguments: JSON.parse(input) }) : await client.listTools();
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
