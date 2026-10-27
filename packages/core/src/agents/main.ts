import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  AgentToolCall,
  AgentToolResult,
} from '../../../../apps/desktop/src/host/types/agent.ts';
import type { McpServerDef } from '../../../../apps/desktop/src/settings/agentConfig.ts';
import type { ToolRules } from '@mochi/domain/library/connectorTools';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import type { MochiScope } from '@mochi/domain/runtime/toolTable';

/**
 * What the agents ask of main, over the `main` capability: the window that runs Mochi's tools, the library (its OAuth
 * connectors and keychain-backed servers stay in main), and the terminals and compare servers a settled thread leaves.
 * Main serves these in electron/agents/events.ts.
 */
export interface MainForAgents {
  mochiTool(
    thread: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult>;
  /** `null`: the window that asked is unknown (main picks its main window). */
  pendingToolCalls(windowId: number | null): Promise<AgentToolCall[]>;
  toolResult(id: string, result: AgentToolResult): Promise<void>;
  codexUrl(thread: string, scope: MochiScope): Promise<string>;
  /** Where Codex's pattern-kill hook POSTs (packages/core/src/agents/codex/killGuard.ts). */
  killGuardUrl(): Promise<string>;
  library(spaceId: string, provider: Provider): Promise<SessionLibrary>;
  settle(threadId: string): Promise<void>;
}

export interface SessionLibrary {
  servers: McpServerDef[];
  pluginDirs: string[];
  /** Connector name and its local proxy URL. */
  connectors: [string, string][];
  rules: Record<string, ToolRules>;
}

type Call = (method: string, args: ReadonlyArray<unknown>) => Promise<unknown>;

let call: Call = async (method) => {
  throw new Error(`Main is not connected, so ${method} can't run`);
};

/** Set once by the agents layer: a capability call to main. */
export const useMain = (next: Call) => void (call = next);

export const main = new Proxy({} as MainForAgents, {
  get:
    (_target, method: string) =>
    (...args: unknown[]) =>
      call(method, args),
});
