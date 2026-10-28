import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { Backend as Descriptor, Capabilities as Contract } from '@mochi/schema';
import pkg from '../../../../package.json' with { type: 'json' };
import { Capabilities } from '../hostServer.ts';

export interface BackendOptions {
  /** `server` for `mochi serve`; the desktop's Core says the OS it runs on (`osKind`). */
  readonly kind: Descriptor.BackendKind;
  /** Where the id is kept so a restart answers the same one. Unset (tests): a fresh id each start. */
  readonly userData?: string;
}

/** The kind of the OS the desktop app runs on. */
export const osKind = (platform: NodeJS.Platform): Descriptor.BackendKind =>
  platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';

interface Identity {
  readonly id: string;
  readonly name: string;
}

const loadId = (userData: string | undefined) => {
  const file = userData && path.join(userData, 'backend-id');
  try {
    if (file) {
      const saved = readFileSync(file, 'utf8').trim();
      if (saved) return saved;
    }
  } catch {
    // First start: a fresh id below.
  }
  const fresh = randomBytes(12).toString('base64url');
  if (file && userData) {
    mkdirSync(userData, { recursive: true });
    writeFileSync(file, fresh);
  }
  return fresh;
};

/**
 * What this Core says about itself (`backend.info`). The id and name default to a stored id and the hostname; main, which
 * owns the machine's registered id and chosen name, sends them with `backend.identify`. The rest follows what is connected.
 */
export class Backend extends Context.Service<Backend>()('mochi/core/Backend', {
  make: Effect.fnUntraced(function* (options: BackendOptions) {
    const capabilities = yield* Capabilities;
    const identity = yield* SubscriptionRef.make<Identity>({
      id: loadId(options.userData),
      name: hostname(),
    });

    const describe = (scopes: ReadonlyArray<Contract.AuthScope>) =>
      Effect.gen(function* () {
        const { id, name } = yield* SubscriptionRef.get(identity);
        return {
          id,
          name,
          kind: options.kind,
          appVersion: pkg.version,
          protocolVersion: Contract.PROTOCOL_VERSION,
          capabilities: [...(yield* SubscriptionRef.get(capabilities.offered))],
          scopes,
        } satisfies Descriptor.BackendInfo;
      });

    /** The descriptor now, then again each time the identity or the connected clients change it. */
    const watch = (scopes: ReadonlyArray<Contract.AuthScope>) =>
      Stream.merge(
        SubscriptionRef.changes(identity),
        SubscriptionRef.changes(capabilities.offered),
      ).pipe(
        Stream.mapEffect(() => describe(scopes)),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      );

    const identify = (patch: { id?: string; name?: string }) =>
      SubscriptionRef.update(identity, (current) => ({
        id: patch.id ?? current.id,
        name: patch.name?.trim() || current.name,
      }));

    return { describe, watch, identify };
  }),
}) {
  static readonly layer = (options: BackendOptions) =>
    Layer.effect(this, this.make(options));
}
