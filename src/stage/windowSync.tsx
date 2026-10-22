import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { host } from '@/host';
import { HarnessScope, useHarness, type Action, type State } from '../store';

/**
 * Multi-window sync. The main window's store is the only store: it runs the tick and owns persistence. A torn-off window
 * holds no reducer; it mirrors the state the main window broadcasts and forwards every action back to it.
 */
type WindowMessage = { kind: 'hello' } | { kind: 'state'; state: State } | { kind: 'action'; action: Action };

/** Main window: answers a torn-off window's hello with the state, then keeps it current and applies the actions it sends. */
export function useWindowSyncHost() {
  const { state, dispatch } = useHarness();
  const latest = useRef(state);
  latest.current = state;
  const hasPeers = useRef(false);

  useEffect(
    () =>
      host.windows.onMessage((raw) => {
        const message = raw as WindowMessage;
        if (message.kind === 'action') return dispatch(message.action);
        if (message.kind !== 'hello') return;
        hasPeers.current = true;
        send({ kind: 'state', state: latest.current });
      }),
    [dispatch],
  );

  useEffect(() => {
    if (hasPeers.current) send({ kind: 'state', state });
  }, [state]);
}

/** Torn-off window: renders nothing until the main window's first state arrives. */
export function MirrorProvider({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    const off = host.windows.onMessage((raw) => {
      const message = raw as WindowMessage;
      if (message.kind === 'state') setState(message.state);
    });
    send({ kind: 'hello' });
    return off;
  }, []);
  const dispatch = useCallback((action: Action) => send({ kind: 'action', action }), []);
  if (!state) return fallback;
  return <HarnessScope state={state} dispatch={dispatch}>{children}</HarnessScope>;
}

function send(message: WindowMessage) {
  void host.windows.broadcast(message);
}
