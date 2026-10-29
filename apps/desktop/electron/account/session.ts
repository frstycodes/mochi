import { Effect } from 'effect';
import type { MochiAccount } from '@mochi/domain/host/types/account';
import { coreClient, mainCoreClient } from '@mochi/core/host';
import { makeHostCaller } from '@mochi/core/hostClient';

/**
 * Main's copy of the account Core keeps (packages/core/src/account), for the services here that follow it: remote access
 * and its relay connection. Core pushes each change (`account:onChange`, relayed in agents/events.ts).
 */
let account: MochiAccount = { status: 'signed-out', isPersistent: true };

export const current = () => account;

const changeListeners = new Set<(account: MochiAccount) => void>();

export function onAccountChange(listener: (account: MochiAccount) => void) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export function noteAccount(next: MochiAccount) {
  account = next;
  for (const listener of changeListeners) listener(account);
}

/** Core's account once it answers; its pushes keep it current from then on. */
void mainCoreClient()
  .then((client) => makeHostCaller(client)('account.get', []))
  .then((first) => noteAccount(first as MochiAccount))
  .catch(() => {});

/** An access token for the relay, from Core: callers put it in a request header, never a URL, and it never reaches a window. */
export const accessToken = async () =>
  Effect.runPromise((await coreClient())['account.relayToken']());
