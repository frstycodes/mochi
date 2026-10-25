import type {
  AgentToolCall,
  AgentToolResult,
} from '../../src/host/types/agent.ts';

/** The slice of Electron's `WebContents` a call needs: where it goes, and the events that drop the renderer's widgets. */
export interface Renderer {
  send(channel: 'agent:onToolCall', call: AgentToolCall): void;
  on(
    event: 'did-start-navigation',
    listener: (details: {
      isMainFrame: boolean;
      isSameDocument: boolean;
    }) => void,
  ): unknown;
  on(event: 'render-process-gone', listener: () => void): unknown;
  once(event: 'destroyed', listener: () => void): unknown;
}

export const WINDOW_GONE =
  "Mochi's window closed or crashed before it answered; nothing was done. Call again if it is still needed.";

/**
 * Mochi calls waiting on the renderer. Any call may wait on the user (a delete, a setting, a browser escalation
 * mid-run), so none is cut short by its tier: the renderer withdraws its widget at APPROVAL_TIMEOUT_MS and answers, and
 * `timeoutMs` only catches a renderer that never does. A reload takes the renderer's widgets with it, so the reloaded
 * page takes its calls back with `undelivered` and runs them again; a crash or a closed window fails them at once.
 */
export function toolCalls(timeoutMs: number) {
  let nextId = 0;
  const pending = new Map<
    string,
    {
      renderer: Renderer;
      call: AgentToolCall;
      isDelivered: boolean;
      resolve: (result: AgentToolResult) => void;
    }
  >();
  const watched = new WeakSet<Renderer>();

  const resolve = (id: string, result: AgentToolResult) => {
    pending.get(id)?.resolve(result);
    pending.delete(id);
  };

  const watch = (renderer: Renderer) => {
    if (watched.has(renderer)) return;
    watched.add(renderer);
    const failAll = () => {
      for (const [id, call] of pending)
        if (call.renderer === renderer)
          resolve(id, { text: WINDOW_GONE, isError: true });
    };
    const undeliverAll = () => {
      for (const call of pending.values())
        if (call.renderer === renderer) call.isDelivered = false;
    };
    renderer.on(
      'did-start-navigation',
      ({ isMainFrame, isSameDocument }) =>
        isMainFrame && !isSameDocument && undeliverAll(),
    );
    renderer.on('render-process-gone', failAll);
    renderer.once('destroyed', failAll);
  };

  const call = (renderer: Renderer, request: Omit<AgentToolCall, 'id'>) =>
    new Promise<AgentToolResult>((done) => {
      const call = { id: `tool-${++nextId}`, ...request };
      const timer = setTimeout(
        () =>
          resolve(call.id, {
            text: 'Mochi did not answer in time',
            isError: true,
          }),
        timeoutMs,
      );
      pending.set(call.id, {
        renderer,
        call,
        isDelivered: true,
        resolve: (result) => (clearTimeout(timer), done(result)),
      });
      watch(renderer);
      renderer.send('agent:onToolCall', call);
    });

  /** The calls a reload took from `renderer`'s page, each handed out once. */
  const undelivered = (renderer: Renderer) =>
    [...pending.values()]
      .filter((p) => p.renderer === renderer && !p.isDelivered)
      .map((p) => ((p.isDelivered = true), p.call));

  return { call, resolve, undelivered };
}
