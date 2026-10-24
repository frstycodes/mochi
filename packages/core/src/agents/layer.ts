import path from 'node:path';
import { Effect, Layer, Queue, Stream } from 'effect';
import type { AgentEvent } from '../../../../src/host/types/agent.ts';
import type { AgentLogin } from '../../../../src/host/types/settings.ts';
import { Capabilities } from '../hostServer.ts';
import { clientFromRun, useCoreClient } from '../runClient.ts';
import { Run } from '../run.ts';
import { Store } from '../store/store.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { reloadAgentConfig, useAgentConfig } from './config.ts';
import { BUSY_CHANNEL, busyThreads, emitAgentEvent, onPush, useEventLog, type Push } from './events.ts';
import { disposeAgents, useAgentServices } from './handlers.ts';
import { useLimitDocs } from './limits.ts';
import { useMain } from './main.ts';
import { noteLogin } from './models.ts';
import { setDataDir } from './paths.ts';
import { setImageDir } from './images.ts';
import { Turns } from './turns.ts';

let settingsDoc: unknown;

/** Main saved the agent settings document: the adapters read it fresh from here on. */
export function agentSettingsSaved(value: unknown) {
  settingsDoc = value;
  reloadAgentConfig();
}

/**
 * The agents service: the Claude and Codex adapters run in Core, their events append to Core's log, their child
 * processes run through `run`, and each thread's session is a fiber on `Turns`. What needs Electron is asked of main
 * through the `main` and `secureStorage` capabilities.
 */
export const layerAgents = (userData: string | undefined) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const store = yield* Store;
      const capabilities = yield* Capabilities;
      const run = yield* Run;
      const queue = yield* UtilityQueue;
      const turns = yield* Turns;
      if (userData) {
        setDataDir(userData);
        setImageDir(path.join(userData, 'images'));
      }
      settingsDoc = yield* store.getDoc('settings', 'agent').pipe(Effect.orElseSucceed(() => undefined));
      const call = (capability: 'main' | 'secureStorage', method: string, args: ReadonlyArray<unknown>) =>
        Effect.runPromise(capabilities.call({ capability, method, args }).pipe(Effect.catch((message) => Effect.die(new Error(message)))));
      useAgentConfig({
        read: () => settingsDoc,
        write: async () => {
          throw new Error('Agent settings are written by main');
        },
        keychain: {
          isAvailable: async () => true,
          encrypt: (text) => call('secureStorage', 'encrypt', [text]) as Promise<string>,
          decrypt: (base64) => call('secureStorage', 'decrypt', [base64]) as Promise<string>,
        },
      });
      // The call crosses as JSON: an `undefined` field is dropped and an `undefined` argument arrives as null.
      useMain((method, args) => call('main', method, JSON.parse(JSON.stringify(args)) as ReadonlyArray<unknown>));
      useCoreClient(Promise.resolve(clientFromRun(run)));
      // In emit order: each append waits for the one before, so the log's sequence follows the agents' own.
      let appending: Promise<unknown> = Promise.resolve();
      useEventLog((event) => {
        const append = store.append({ type: `agent.${event.type}`, threadId: event.threadId, payload: event, eventId: `agent-${event.seq}` });
        appending = appending.then(() => Effect.runPromise(append)).catch((error: unknown) => console.error(`Logging agent.${event.type} failed`, error));
      });
      useLimitDocs({
        list: () => Effect.runPromise(store.listDocs('limits')),
        set: (accountId, limits) => Effect.runPromise(store.setDoc('limits', accountId, limits)),
      });
      useAgentServices({ turns, queue });
      yield* Effect.addFinalizer(() => Effect.sync(disposeAgents));
    }),
  );

/** The handlers of `AgentRpcs`. */
export const agentRpcHandlers = {
  agentPush: () =>
    Stream.callback<Push>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          // A fresh subscriber (main after a reconnect) learns which threads are working before anything else.
          Queue.offerUnsafe(queue, { channel: BUSY_CHANNEL, payload: busyThreads() });
          return onPush((item) => Queue.offerUnsafe(queue, item));
        }),
        (off) => Effect.sync(off),
      ),
    ),
  agentEmit: ({ event }: { event: unknown }) => Effect.sync(() => emitAgentEvent(event as AgentEvent)),
  agentNoteLogin: ({ accountId, login }: { accountId: string; login: unknown }) => Effect.sync(() => noteLogin(accountId, login as AgentLogin)),
};
