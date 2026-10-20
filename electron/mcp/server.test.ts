import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CODEX_BROWSER_PLUGINS_OFF, mochiInstructions } from '../agents/instructions.ts';
import { GOAL_TOOLS, isGoalTool, TOOL_NAMES } from '../../src/runtime/toolTable.ts';

test('browser instructions route to Mochi, and Codex loses the cua_repl browser it reached for instead', () => {
  assert.match(mochiInstructions(), /mcp__mochi__browser_open/);
  assert.match(mochiInstructions(), /mcp__mochi__browser_snapshot/);
  assert.equal(CODEX_BROWSER_PLUGINS_OFF['plugins.unified-computer-use@openai-bundled.enabled'], false);
});

test('goals off leaves goals out of the instructions, browser guidance stays', () => {
  assert.match(mochiInstructions(), /mcp__mochi__propose_goal/);
  assert.doesNotMatch(mochiInstructions(true), /goal/i);
  assert.match(mochiInstructions(true), /mcp__mochi__browser_open/);
});

test('Codex HTTP exposes the same browser tools as Claude and dispatches to the caller thread', async (t) => {
  const serverUrl = new URL('./server.ts', import.meta.url).href;
  const windowStub = `
    import { EventEmitter } from 'node:events';
    class Renderer extends EventEmitter {
      async send(channel, call) {
        const { resolveToolCall } = await import(${JSON.stringify(serverUrl)});
        resolveToolCall(call.id, { text: JSON.stringify({ channel, ...call }) });
      }
    }
    const webContents = new Renderer();
    export const mainWindow = () => ({ webContents });
  `;
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL !== serverUrl) return next(specifier, context);
      if (specifier === 'electron') return { url: 'data:text/javascript,export const app = { isPackaged: true };', shortCircuit: true };
      const source = specifier === '../window.ts' ? windowStub : specifier === '../agents/config.ts' ? 'export const agentSettings = () => ({ imageGen: "off" });' : null;
      return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : next(specifier, context);
    },
  });
  t.after(() => hooks.deregister());
  // oxlint-disable-next-line typescript/unbound-method -- Invoked with the intercepted server as this.
  const listen = Server.prototype.listen;
  t.mock.method(Server.prototype, 'listen', function (this: Server, ...args: Parameters<typeof listen>) {
    t.after(() => new Promise<void>((resolve) => {
      this.close(() => resolve());
      this.closeAllConnections();
    }));
    return listen.apply(this, args);
  });
  const { claudeServer, codexUrl } = await import('./server.ts');
  const claude = new Client({ name: 'claude-check', version: '1' });
  const codex = new Client({ name: 'codex-check', version: '1' });
  t.after(async () => { await claude.close(); await codex.close(); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await claudeServer('claude-thread', 'space', '/tmp').instance.connect(serverTransport);
  await claude.connect(clientTransport);
  await codex.connect(new StreamableHTTPClientTransport(new URL(await codexUrl('codex-thread'))));
  const browsers = (tools: { name: string }[]) => tools.filter((tool) => tool.name.startsWith('browser_')).map((tool) => tool.name).sort();
  assert.deepEqual(browsers((await codex.listTools()).tools), browsers((await claude.listTools()).tools));
  assert.deepEqual(browsers((await codex.listTools()).tools), TOOL_NAMES.filter((name) => name.startsWith('browser_')).sort());
  const goalTools = (tools: { name: string }[]) => tools.map((tool) => tool.name).filter(isGoalTool).sort();
  assert.deepEqual(goalTools((await codex.listTools()).tools), [...GOAL_TOOLS].sort());
  const claudeOff = new Client({ name: 'claude-off', version: '1' });
  const codexOff = new Client({ name: 'codex-off', version: '1' });
  t.after(async () => { await claudeOff.close(); await codexOff.close(); });
  const [offClient, offServer] = InMemoryTransport.createLinkedPair();
  await claudeServer('claude-thread', 'space', '/tmp', true).instance.connect(offServer);
  await claudeOff.connect(offClient);
  await codexOff.connect(new StreamableHTTPClientTransport(new URL(await codexUrl('codex-thread', true))));
  assert.deepEqual(goalTools((await claudeOff.listTools()).tools), []);
  assert.deepEqual(goalTools((await codexOff.listTools()).tools), []);
  assert.doesNotMatch(codexOff.getInstructions() ?? '', /goal/i);
  assert.equal(browsers((await codexOff.listTools()).tools).length, browsers((await codex.listTools()).tools).length);
  const result = await codex.callTool({ name: 'browser_open', arguments: { url: 'about:blank' } });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse((result.content as { text: string }[])[0].text), {
    channel: 'agent:onToolCall', id: 'tool-1', threadId: 'codex-thread', name: 'browser_open', args: { url: 'about:blank' },
  });
});
