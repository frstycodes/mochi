import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
import {
  KILL_GUARD_COMMAND,
  KILL_GUARD_ENV,
  killHookAnswer,
} from '@mochi/core/agents/codex/killGuard';
import { killDecision } from '@mochi/core/agents/processKill';
import { claudeServer as coreClaudeServer } from '@mochi/core/agents/mochiTools';
import {
  SETTINGS_CHAT_TOOLS,
  TOOL_NAMES,
} from '@mochi/domain/runtime/toolTable';

afterEach(() => vi.restoreAllMocks());

// Codex in code mode learns Mochi's tool names only from these instructions, so an unnamed tool is never called.
test('the instructions name start_subagent, which Codex otherwise never finds', () => {
  assert.match(mochiInstructions(), /mcp__mochi__start_subagent/);
});

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

test('the instructions say nothing about goals, browser guidance stays', () => {
  assert.doesNotMatch(mochiInstructions(), /goal/i);
  assert.match(mochiInstructions(), /mcp__mochi__browser_open/);
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
  assert.doesNotMatch(codex.getInstructions() ?? '', /goal/i);
  const names = async (client: Client) =>
    (await client.listTools()).tools.map((tool) => tool.name).sort();
  const settingsTools: string[] = [...SETTINGS_CHAT_TOOLS].sort();
  for (const client of [claude, codex]) {
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
    isSettingsChat: true,
  }).instance.connect(settingsServer);
  await claudeSettings.connect(settingsClient);
  await codexSettings.connect(
    new StreamableHTTPClientTransport(
      new URL(await codexUrl('settings-thread', { isSettingsChat: true })),
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

// Runs the hook's own command (curl, through sh) as Codex would; the commands are only text in the JSON, nothing is killed.
test.skipIf(process.platform === 'win32')(
  "Codex's kill-guard hook denies a pattern kill and lets a PID kill run",
  async () => {
    // A fresh server.ts: an earlier test closed the one it started.
    vi.resetModules();
    vi.doMock('electron', () => ({ app: { isPackaged: true } }));
    vi.doMock('../window.ts', () => ({ mainWindow: () => undefined }));
    // Core's `agentKillHook`, for a session Mochi doesn't know.
    const asked: unknown[] = [];
    vi.doMock('@mochi/core/hostClient', () => ({
      makeHostCaller: () => async (tag: string, args: { input: unknown }) => {
        asked.push(tag);
        return killHookAnswer('', args.input);
      },
    }));
    vi.doMock('@mochi/core/host', () => ({ mainCoreClient: async () => ({}) }));
    onTestFinished(() => {
      vi.doUnmock('electron');
      vi.doUnmock('../window.ts');
      vi.doUnmock('@mochi/core/hostClient');
      vi.doUnmock('@mochi/core/host');
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
    const { killGuardUrl } = await import('./server.ts');
    const url = await killGuardUrl();
    const hook = (command: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn('sh', ['-c', KILL_GUARD_COMMAND], {
          env: { ...process.env, [KILL_GUARD_ENV]: url },
        });
        let out = '';
        child.stdout.on('data', (chunk) => (out += chunk));
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`curl exited ${code}`)),
        );
        child.stdin.end(
          JSON.stringify({
            hook_event_name: 'PreToolUse',
            tool_name: 'Bash',
            tool_input: { command },
            permission_mode: 'bypassPermissions',
            cwd: '/tmp',
            session_id: 'codex-thread',
            turn_id: 'turn',
            tool_use_id: 'call',
          }),
        );
      });
    const denied = JSON.parse(await hook('pkill -f x .'));
    assert.equal(denied.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
    const decision = killDecision('', 'pkill -f x .');
    assert.notEqual(decision.action, 'run');
    assert.equal(
      denied.hookSpecificOutput.permissionDecisionReason,
      decision.action === 'run' ? undefined : decision.reason,
    );
    assert.equal(await hook('kill 123'), '');
    assert.deepEqual(asked, ['agentKillHook', 'agentKillHook']);
  },
);
