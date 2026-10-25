import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Schema } from 'effect';
import { connectorServer } from './proxy.ts';

async function connected(server: { connect: Server['connect'] }) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const WhoamiInput = Schema.Struct({ greeting: Schema.optional(Schema.String) });

/** A stand-in upstream: `whoami` answers with the account it belongs to. */
function upstream(account: string) {
  const server = new Server(
    { name: 'linear', version: '1' },
    { capabilities: { tools: {} }, instructions: 'Linear tools.' },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: 'whoami',
        description: 'Who is signed in',
        inputSchema: {
          ...Schema.toJsonSchemaDocument(WhoamiInput).schema,
          type: 'object' as const,
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    const { greeting } = Schema.decodeUnknownSync(WhoamiInput)(
      params.arguments ?? {},
    );
    return {
      content: [{ type: 'text', text: `${greeting ?? 'hi'} ${account}` }],
    };
  });
  return connected(server);
}

test('two accounts share one tool list, and each call goes to the account it names', async () => {
  const clients = {
    work: await upstream('work'),
    personal: await upstream('personal'),
  };
  const proxy = await connected(
    await connectorServer(
      'linear',
      ['work', 'personal'],
      async (alias) => clients[alias as keyof typeof clients],
    ),
  );
  const { tools } = await proxy.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ['whoami'],
  );
  assert.deepEqual(tools[0].inputSchema.properties?.__mochi_account, {
    type: 'string',
    enum: ['work', 'personal'],
    description: 'Which account to act as.',
  });
  assert.ok(tools[0].inputSchema.required?.includes('__mochi_account'));
  assert.match(
    proxy.getInstructions() ?? '',
    /Linear tools\.[\s\S]*"work", "personal"/,
  );

  const call = (args: Record<string, unknown>) =>
    proxy.callTool({ name: 'whoami', arguments: args });
  assert.deepEqual(
    (await call({ __mochi_account: 'personal', greeting: 'hey' })).content,
    [{ type: 'text', text: 'hey personal' }],
  );
  assert.deepEqual((await call({ __mochi_account: 'work' })).content, [
    { type: 'text', text: 'hi work' },
  ]);
  assert.equal((await call({})).isError, true);
  assert.equal((await call({ __mochi_account: 'nobody' })).isError, true);
  assert.deepEqual((await proxy.listResources()).resources, []);
});

test('with one account the tools look native', async () => {
  const work = await upstream('work');
  const proxy = await connected(
    await connectorServer('linear', ['work'], async () => work),
  );
  const { tools } = await proxy.listTools();
  assert.equal(tools[0].inputSchema.properties?.__mochi_account, undefined);
  assert.deepEqual(
    (await proxy.callTool({ name: 'whoami', arguments: {} })).content,
    [{ type: 'text', text: 'hi work' }],
  );
});
