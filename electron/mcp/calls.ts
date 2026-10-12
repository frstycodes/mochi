import type { AgentToolCall, AgentToolResult } from '../../src/host/types/agent.ts';

/** The slice of Electron's `WebContents` a call needs: where it goes, and the events that drop the renderer's widgets. */
export interface Renderer {
  send(channel: 'agent:onToolCall', call: AgentToolCall): void;
  on(event: 'did-start-navigation', listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void): unknown;
  on(event: 'render-process-gone', listener: () => void): unknown;
  once(event: 'destroyed', listener: () => void): unknown;
}

export const RELOADED = 'Mochi reloaded before it answered; nothing was done. Call again if it is still needed.';

/**
 * Mochi calls waiting on the renderer. Any call may wait on the user (a delete, a setting, a browser escalation
 * mid-run), so none is cut short by its tier: the renderer withdraws its widget at APPROVAL_TIMEOUT_MS and answers, and
 * `timeoutMs` only catches a renderer that never does. A reload or crash takes the renderer's widgets with it, so its
 * calls fail at once instead of hanging until the timeout.
 */
export function toolCalls(timeoutMs: number) {
  let nextId = 0;
  const pending = new Map<string, { renderer: Renderer; resolve: (result: AgentToolResult) => void }>();
  const watched = new WeakSet<Renderer>();

  const resolve = (id: string, result: AgentToolResult) => {
    pending.get(id)?.resolve(result);
    pending.delete(id);
  };

  const watch = (renderer: Renderer) => {
    if (watched.has(renderer)) return;
    watched.add(renderer);
    const failAll = () => {
      for (const [id, call] of pending) if (call.renderer === renderer) resolve(id, { text: RELOADED, isError: true });
    };
    renderer.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => isMainFrame && !isSameDocument && failAll());
    renderer.on('render-process-gone', failAll);
    renderer.once('destroyed', failAll);
  };

  const call = (renderer: Renderer, request: Omit<AgentToolCall, 'id'>) =>
    new Promise<AgentToolResult>((done) => {
      const id = `tool-${++nextId}`;
      const timer = setTimeout(() => resolve(id, { text: 'Mochi did not answer in time', isError: true }), timeoutMs);
      pending.set(id, { renderer, resolve: (result) => (clearTimeout(timer), done(result)) });
      watch(renderer);
      renderer.send('agent:onToolCall', { id, ...request });
    });

  return { call, resolve };
}
