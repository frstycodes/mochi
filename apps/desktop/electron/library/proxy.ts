import type { Client } from '@modelcontextprotocol/client';
import {
  Server,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/server';
import { ACCOUNT_ARGUMENT } from '../../src/library/connectors.ts';

/**
 * One connector as one MCP server over all of a profile's accounts on it (LIBRARY.md decision 5): the upstream's tools
 * listed once, each taking `__mochi_account` when there is more than one account, every call sent to the account it
 * names. Resources (MCP App views) are read from the first account, whose tool list this is. No Electron here, so the
 * routing can be tested in node.
 */
export async function connectorServer(
  name: string,
  aliases: string[],
  clientFor: (alias: string) => Promise<Client>,
) {
  const [first] = aliases;
  const upstream = await clientFor(first);
  const isShared = aliases.length > 1;
  const note = isShared
    ? `Every tool takes ${ACCOUNT_ARGUMENT}: one of ${aliases.map((a) => `"${a}"`).join(', ')}, the account to act as.`
    : '';
  const server = new Server(
    { name, version: '1.0.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        [upstream.getInstructions(), note].filter(Boolean).join('\n\n') ||
        undefined,
    },
  );
  server.setRequestHandler('tools/list', async () => ({
    tools: (await allTools(upstream)).map((tool) =>
      isShared ? withAccount(tool, aliases) : tool,
    ),
  }));
  server.setRequestHandler('tools/call', async ({ params }) => {
    const { [ACCOUNT_ARGUMENT]: chosen, ...args } = params.arguments ?? {};
    const alias = isShared ? chosen : first;
    if (typeof alias !== 'string' || !aliases.includes(alias))
      return failure(
        `Pass ${ACCOUNT_ARGUMENT} as one of ${aliases.join(', ')}.`,
      );
    try {
      return (await (
        await clientFor(alias)
      ).callTool({ ...params, arguments: args })) as CallToolResult;
    } catch (error) {
      return failure(
        `${alias}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  // An upstream without resources answers "method not found"; the session just sees none.
  server.setRequestHandler('resources/list', (request) =>
    upstream.listResources(request.params).catch(() => ({ resources: [] })),
  );
  server.setRequestHandler('resources/templates/list', (request) =>
    upstream
      .listResourceTemplates(request.params)
      .catch(() => ({ resourceTemplates: [] })),
  );
  server.setRequestHandler('resources/read', (request) =>
    upstream.readResource(request.params),
  );
  return server;
}

// GAP: lists the upstream's tools on every tools/list; cache per account if a slow upstream makes sessions wait.
export async function allTools(client: Client) {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({ cursor });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

function withAccount(tool: Tool, aliases: string[]): Tool {
  const schema = tool.inputSchema;
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties,
        [ACCOUNT_ARGUMENT]: {
          type: 'string',
          enum: aliases,
          description: 'Which account to act as.',
        },
      },
      required: [...(schema.required ?? []), ACCOUNT_ARGUMENT],
    },
  };
}

const failure = (text: string): CallToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});
