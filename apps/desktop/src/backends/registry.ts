import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Backend as Schema } from '@mochi/schema';
import type { Replica } from '../store/replica.ts';
import type { Transport } from './transport.ts';

/**
 * This computer's entry. Its thread ids are bare and every other computer's are machine-aware (`src/remote/ids.ts`), so the
 * entry is keyed the way its threads name it; the Core's own id is in its descriptor.
 */
export const LOCAL_BACKEND = 'local';

/** One connected Core: who it says it is, how it's reached, and its store as this window follows it. */
export interface Backend {
  /** `LOCAL_BACKEND`, or the machine id another computer was paired under. */
  id: string;
  isLocal: boolean;
  /** From `backend.watch`; undefined until it first answers (or where nothing can, the web build). */
  descriptor: Schema.BackendInfo | undefined;
  transport: Transport;
  /** Its `replica` stream folded through `createReplica`, ids as the Core sends them; this computer's is the window's store. */
  replica: Replica;
  call: Transport['call'];
}

export type BackendInput = Omit<Backend, 'descriptor' | 'call'>;

/** A dropped `backend.watch` is followed again this often. */
const RESUME_MS = 1000;

/** The interface's Cores, this computer's first. One per window: each window connects to each Core on its own. */
export function createBackends(resumeMs = RESUME_MS) {
  const store = createStore<{ backends: Backend[] }>(() => ({ backends: [] }));
  const stops = new Map<string, () => void>();
  const set = (backends: Backend[]) =>
    store.setState({
      backends: [...backends].sort((a, b) => +b.isLocal - +a.isLocal),
    });
  const patch = (id: string, change: Partial<Backend>) =>
    set(
      store
        .getState()
        .backends.map((b) => (b.id === id ? { ...b, ...change } : b)),
    );

  /** Follows its descriptor while it's in the registry; the web build's page has none to follow. */
  const watch = (backend: Backend) => {
    if (backend.transport.kind === 'page') return () => {};
    let stop = () => {};
    let isStopped = false;
    const follow = () => {
      stop = backend.transport.stream(
        'backend.watch',
        undefined,
        (info) => patch(backend.id, { descriptor: info as Schema.BackendInfo }),
        () => !isStopped && setTimeout(follow, resumeMs),
      );
    };
    follow();
    return () => {
      isStopped = true;
      stop();
    };
  };

  const remove = (id: string) => {
    const backend = registry.get(id);
    if (!backend) return;
    stops.get(id)?.();
    stops.delete(id);
    if (!backend.isLocal) backend.replica.stop();
    set(store.getState().backends.filter((b) => b.id !== id));
  };

  const registry = {
    list: () => store.getState().backends,
    get: (id: string) => store.getState().backends.find((b) => b.id === id),
    /** Adds it (replacing one with the same id) and follows its descriptor until `remove`. */
    add(input: BackendInput) {
      remove(input.id);
      const backend: Backend = {
        ...input,
        descriptor: undefined,
        call: input.transport.call,
      };
      set([...store.getState().backends, backend]);
      stops.set(backend.id, watch(backend));
      return backend;
    },
    /** Stops following it; another computer's replica stops with it, this computer's stays the window's store. */
    remove,
    subscribe: (listener: (backends: Backend[]) => void) =>
      store.subscribe((s) => listener(s.backends)),
    store,
  };
  return registry;
}

export type Backends = ReturnType<typeof createBackends>;

/** This window's registry. */
export const backends = createBackends();

export const useBackends = () => useStore(backends.store, (s) => s.backends);

export const useBackend = (id: string) =>
  useStore(backends.store, (s) => s.backends.find((b) => b.id === id));
