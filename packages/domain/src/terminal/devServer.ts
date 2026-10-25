import type { ListeningPort } from '../host/types/ports.ts';

const listening = new Map<string, ListeningPort[]>();

/** Where a new browser tab opens: the thread's dev server when exactly one is listening, else a blank page. */
export function defaultBrowserUrl(ports: ListeningPort[] | undefined) {
  if (ports?.length !== 1) return undefined;
  return portUrl(ports[0].port);
}

/** The thread's ports from its latest poll; undefined until something has watched it (see `usePorts`). */
export function listeningPorts(threadId: string) {
  return listening.get(threadId);
}

export function recordListeningPorts(threadId: string, ports: ListeningPort[]) {
  listening.set(threadId, ports);
}

export const portUrl = (port: number) => `http://localhost:${port}`;
