import path from 'node:path';
import { Effect, Layer, Queue, Stream } from 'effect';
import type { AgentEvent } from '../../../../apps/desktop/src/host/types/agent.ts';
import type { AgentLogin } from '../../../../apps/desktop/src/host/types/settings.ts';
import { Capabilities } from '../hostServer.ts';
import { clientFromRun, useCoreClient } from '../runClient.ts';
import { Run } from '../run.ts';
import { Projection } from '../store/projection.ts';
import { Store } from '../store/store.ts';
import { ThreadContext } from '../switch/context.ts';
import { UtilityQueue } from '../utility/queue.ts';
import { reloadAgentConfig, useAgentConfig } from './config.ts';
import {
  BUSY_CHANNEL,
  busyThreads,
  emitAgentEvent,
  onPush,
  useEventLog,
  type Push,
  type SeqEvent,
} from './events.ts';
import type { HistoryArgs } from '../switch/history.ts';
import { disposeAgents, threadHistory, useAgentServices } from './handlers.ts';
import { useLimitDocs } from './limits.ts';
import { useMain } from './main.ts';
import { setThreadHistory } from './mochiTools.ts';
import { noteLogin } from './models.ts';
import { setDataDir } from './paths.ts';
import { setImageDir } from './images.ts';
import { useAgentDriven } from './processKill.ts';
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
      const context = yield* ThreadContext;
      if (userData) {
        setDataDir(userData);
        setImageDir(path.join(userData, 'images'));
      }
      settingsDoc = yield* store
        .getDoc('settings', 'agent')
        .pipe(Effect.orElseSucceed(() => undefined));
      const call = (
        capability: 'main' | 'secureStorage',
        method: string,
        args: ReadonlyArray<unknown>,
      ) =>
        Effect.runPromise(
          capabilities
            .call({ capability, method, args })
            .pipe(
              Effect.catch((error) =>
                Effect.die(
                  typeof error === 'string' ? new Error(error) : error,
                ),
              ),
            ),
        );
      useAgentConfig({
        read: () => settingsDoc,
        write: async () => {
          throw new Error('Agent settings are written by main');
        },
        keychain: {
          // Nothing serves it under `mochi serve`: keys are refused there rather than stored without the OS keychain.
          isAvailable: async () => capabilities.offers('secureStorage'),
          encrypt: (text) =>
            call('secureStorage', 'encrypt', [text]) as Promise<string>,
          decrypt: (base64) =>
            call('secureStorage', 'decrypt', [base64]) as Promise<string>,
        },
      });
      // The call crosses as JSON: an `undefined` field is dropped and an `undefined` argument arrives as null.
      useMain((method, args) =>
        call(
          'main',
          method,
          JSON.parse(JSON.stringify(args)) as ReadonlyArray<unknown>,
        ),
      );
      useCoreClient(Promise.resolve(clientFromRun(run)));
      // In emit order: one fiber appends them, so the log's sequence follows the agents' own.
      const appends = yield* Queue.unbounded<SeqEvent>();
      useEventLog((event) => Queue.offerUnsafe(appends, event));
      yield* Stream.fromQueue(appends).pipe(
        Stream.runForEach((event) =>
          store
            .append({
              type: `agent.${event.type}`,
              threadId: event.threadId,
              payload: event,
              eventId: `agent-${event.seq}`,
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError(`Logging agent.${event.type} failed`, cause),
              ),
            ),
        ),
        Effect.forkScoped,
      );
      useLimitDocs({
        list: () => Effect.runPromise(store.listDocs('limits')),
        set: (accountId, limits) =>
          Effect.runPromise(store.setDoc('limits', accountId, limits)),
      });
      useAgentServices({ turns, queue, context });
      const projection = yield* Projection;
      useAgentDriven(
        (threadId) =>
          !!Effect.runSync(projection.current).domain.threads.find(
            (t) => t.id === threadId,
          )?.turn?.isAgentDriven,
      );
      setThreadHistory(threadHistory);
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
          Queue.offerUnsafe(queue, {
            channel: BUSY_CHANNEL,
            payload: busyThreads(),
          });
          return onPush((item) => Queue.offerUnsafe(queue, item));
        }),
        (off) => Effect.sync(off),
      ),
    ),
  agentEmit: ({ event }: { event: unknown }) =>
    Effect.sync(() => emitAgentEvent(event as AgentEvent)),
  agentThreadHistory: ({
    threadId,
    args,
  }: {
    threadId: string;
    args: unknown;
  }) => Effect.promise(() => threadHistory(threadId, args as HistoryArgs)),
  agentNoteLogin: ({
    accountId,
    login,
  }: {
    accountId: string;
    login: unknown;
  }) => Effect.sync(() => noteLogin(accountId, login as AgentLogin)),
};
