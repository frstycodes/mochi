import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Server } from 'node:http';
import { afterEach, onTestFinished, test, vi } from 'vite-plus/test';
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  CODEX_BROWSER_PLUGINS_OFF,
  mochiInstructions,
} from '@mochi/core/agents/instructions';
import { useAgentConfig } from '@mochi/core/agents/config';
import { claudeServer as coreClaudeServer } from '@mochi/core/agents/mochiTools';
import {
  GOAL_TOOLS,
  isGoalTool,
  SETTINGS_CHAT_TOOLS,
  TOOL_NAMES,
} from '../../src/runtime/toolTable.ts';

afterEach(() => vi.restoreAllMocks());

test('browser instructions route to Mochi, and Codex loses the cua_repl browser it reached for instead', () => {
  assert.match(mochiInstructions(), /mcp__mochi__browser_open/);
  assert.match(mochiInstructions(), /mcp__mochi__browser_snapshot/);
  assert.equal(
    CODEX_BROWSER_PLUGINS_OFF[
      'plugins.unified-computer-use@openai-bundled.enabled'
    ],
    false,
  );
});

test('goals off leaves goals out of the instructions, browser guidance stays', () => {
  assert.match(mochiInstructions(), /mcp__mochi__propose_goal/);
  assert.doesNotMatch(mochiInstructions({ isGoalsOff: true }), /goal/i);
  assert.match(
    mochiInstructions({ isGoalsOff: true }),
    /mcp__mochi__browser_open/,
  );
});

test('only the settings chat is told to read Mochi settings first; threads are told to hand off', () => {
  assert.match(
    mochiInstructions({ isSettingsChat: true }),
    /mcp__mochi__get_settings/,
  );
  assert.doesNotMatch(
    mochiInstructions({ isSettingsChat: true }),
    /browser_open|update_plan/,
  );
  assert.match(mochiInstructions(), /mcp__mochi__open_settings_chat/);
});

test('Codex HTTP exposes the same browser tools as Claude and dispatches to the caller thread', async () => {
  vi.doMock('electron', () => ({ app: { isPackaged: true } }));
  vi.doMock('../window.ts', () => {
    const webContents = Object.assign(new EventEmitter(), {
      async send(channel: string, call: { id: string }) {
        const { resolveToolCall } = await import('./server.ts');
        resolveToolCall(call.id, {
          text: JSON.stringify({ channel, ...call }),
        });
      },
    });
    return { mainWindow: () => ({ webContents }) };
  });
  onTestFinished(() => {
    vi.doUnmock('electron');
    vi.doUnmock('../window.ts');
  });
  // oxlint-disable-next-line typescript/unbound-method -- Invoked with the intercepted server as this.
  const listen = Server.prototype.listen;
  vi.spyOn(Server.prototype, 'listen').mockImplementation(function (
    this: Server,
    ...args: Parameters<typeof listen>
  ) {
    onTestFinished(
      () =>
        new Promise<void>((resolve) => {
          this.close(() => resolve());
          this.closeAllConnections();
        }),
    );
    return listen.apply(this, args);
  });
  const { callMochi, codexUrl } = await import('./server.ts');
  useAgentConfig({
    read: () => undefined,
    write: async () => {},
    keychain: {
      isAvailable: async () => false,
      encrypt: async () => '',
      decrypt: async () => '',
    },
  });
  // Core builds Claude's in-process server; its calls come back to main's `callMochi`, as Codex's HTTP ones do.
  const claudeServer = (
    thread: string,
    spaceId: string,
    cwd: string,
    scope?: Parameters<typeof coreClaudeServer>[4],
  ) => coreClaudeServer(thread, spaceId, cwd, callMochi, scope);
  const claude = new Client({ name: 'claude-check', version: '1' });
  const codex = new Client({ name: 'codex-check', version: '1' });
  onTestFinished(async () => {
    await claude.close();
    await codex.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await claudeServer('claude-thread', 'space', '/tmp').instance.connect(
    serverTransport,
  );
  await claude.connect(clientTransport);
  await codex.connect(
    new StreamableHTTPClientTransport(new URL(await codexUrl('codex-thread'))),
  );
  const browsers = (tools: { name: string }[]) =>
    tools
      .filter((tool) => tool.name.startsWith('browser_'))
      .map((tool) => tool.name)
      .sort();
  assert.deepEqual(
    browsers((await codex.listTools()).tools),
    browsers((await claude.listTools()).tools),
  );
  assert.deepEqual(
    browsers((await codex.listTools()).tools),
    TOOL_NAMES.filter((name) => name.startsWith('browser_')).sort(),
  );
  const goalTools = (tools: { name: string }[]) =>
    tools
      .map((tool) => tool.name)
      .filter(isGoalTool)
      .sort();
  assert.deepEqual(
    goalTools((await codex.listTools()).tools),
    [...GOAL_TOOLS].sort(),
  );
  const claudeOff = new Client({ name: 'claude-off', version: '1' });
  const codexOff = new Client({ name: 'codex-off', version: '1' });
  onTestFinished(async () => {
    await claudeOff.close();
    await codexOff.close();
  });
  const [offClient, offServer] = InMemoryTransport.createLinkedPair();
  await claudeServer('claude-thread', 'space', '/tmp', {
    isGoalsOff: true,
  }).instance.connect(offServer);
  await claudeOff.connect(offClient);
  await codexOff.connect(
    new StreamableHTTPClientTransport(
      new URL(await codexUrl('codex-thread', { isGoalsOff: true })),
    ),
  );
  assert.deepEqual(goalTools((await claudeOff.listTools()).tools), []);
  assert.deepEqual(goalTools((await codexOff.listTools()).tools), []);
  assert.doesNotMatch(codexOff.getInstructions() ?? '', /goal/i);
  assert.equal(
    browsers((await codexOff.listTools()).tools).length,
    browsers((await codex.listTools()).tools).length,
  );
  const names = async (client: Client) =>
    (await client.listTools()).tools.map((tool) => tool.name).sort();
  const settingsTools: string[] = [...SETTINGS_CHAT_TOOLS].sort();
  for (const client of [claude, codex, claudeOff, codexOff]) {
    assert.deepEqual(
      (await names(client)).filter((name) => settingsTools.includes(name)),
      [],
    );
    assert.ok((await names(client)).includes('open_settings_chat'));
  }
  const claudeSettings = new Client({ name: 'claude-settings', version: '1' });
  const codexSettings = new Client({ name: 'codex-settings', version: '1' });
  onTestFinished(async () => {
    await claudeSettings.close();
    await codexSettings.close();
  });
  const [settingsClient, settingsServer] = InMemoryTransport.createLinkedPair();
  await claudeServer('settings-thread', 'space', '/tmp', {
    isGoalsOff: true,
    isSettingsChat: true,
  }).instance.connect(settingsServer);
  await claudeSettings.connect(settingsClient);
  await codexSettings.connect(
    new StreamableHTTPClientTransport(
      new URL(
        await codexUrl('settings-thread', {
          isGoalsOff: true,
          isSettingsChat: true,
        }),
      ),
    ),
  );
  assert.deepEqual(await names(claudeSettings), settingsTools);
  assert.deepEqual(await names(codexSettings), settingsTools);
  assert.match(codexSettings.getInstructions() ?? '', /get_settings/);
  const result = await codex.callTool({
    name: 'browser_open',
    arguments: { url: 'about:blank' },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0].text), {
    channel: 'agent:onToolCall',
    id: 'tool-1',
    threadId: 'codex-thread',
    name: 'browser_open',
    args: { url: 'about:blank' },
  });
});
