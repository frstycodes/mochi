import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Context, Effect, Layer, Option, Redacted } from 'effect';
import { HttpServer } from 'effect/http';
import WebSocket from 'ws';
import { Capabilities } from '@mochi/schema';
import { coreUrl } from '../client.ts';
import { layerCore } from '../server.ts';
import { MIN_TOKEN_LENGTH, resolveAuth, ServeRefused } from './auth.ts';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH);
const flags = {
  host: '127.0.0.1',
  port: 4747,
  token: Option.none(),
  scopes: [],
  origins: [],
};

const refusal = (overrides: Partial<Parameters<typeof resolveAuth>[0]>) =>
  resolveAuth({ ...flags, ...overrides }).pipe(Effect.flip);

it.effect('a bind beyond loopback without a token refuses to start', () =>
  Effect.gen(function* () {
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'mochi.local'])
      assert.ok((yield* refusal({ host })) instanceof ServeRefused);
    const short = yield* refusal({
      host: '0.0.0.0',
      token: Option.some(Redacted.make('short')),
    });
    assert.match(short.message, /characters/);
    const slashed = yield* refusal({
      token: Option.some(Redacted.make(`${TOKEN}/=`)),
    });
    assert.match(slashed.message, /letters/);
    assert.ok((yield* refusal({ port: 0 })) instanceof ServeRefused);
  }),
);

it.effect('loopback generates a token; a given one keeps its scopes', () =>
  Effect.gen(function* () {
    const generated = yield* resolveAuth(flags);
    assert.ok(generated.isGenerated);
    assert.ok(generated.token.length >= MIN_TOKEN_LENGTH);
    assert.deepEqual(
      generated.tokens.get(generated.token),
      Capabilities.allScopes,
    );
    assert.deepEqual(generated.origins, [
      'http://localhost:4747',
      'http://127.0.0.1:4747',
      'http://[::1]:4747',
    ]);

    const given = yield* resolveAuth({
      ...flags,
      host: '0.0.0.0',
      token: Option.some(Redacted.make(TOKEN)),
      scopes: ['read'],
      origins: ['https://mochi.example'],
    });
    assert.ok(!given.isGenerated);
    assert.deepEqual([...given.tokens], [[TOKEN, ['read']]]);
    assert.ok(given.origins.includes('http://0.0.0.0:4747'));
    assert.ok(given.origins.includes('https://mochi.example'));
  }),
);

it.live('Core started with serve’s auth refuses a foreign Origin', () =>
  Effect.gen(function* () {
    const auth = yield* resolveAuth({
      ...flags,
      token: Option.some(Redacted.make(TOKEN)),
    });
    const context = yield* Layer.build(
      layerCore({ port: 0, tokens: auth.tokens, origins: auth.origins }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    const url = coreUrl(port, TOKEN);
    const statuses = yield* Effect.promise(() =>
      Promise.all([
        upgradeStatus(url, 'http://evil.test'),
        upgradeStatus(url, 'http://127.0.0.1:4747'),
      ]),
    );
    assert.deepEqual(statuses, [403, 'open']);
  }),
);

/** The HTTP status Core refused an upgrade with, or `open`. */
function upgradeStatus(url: string, origin: string) {
  const [address, token] = url.split('#') as [string, string];
  return new Promise<number | 'open'>((resolve) => {
    const ws = new WebSocket(address, Capabilities.subprotocolsFor(token), {
      headers: { origin },
    });
    ws.on('unexpected-response', (_request, response) =>
      resolve(response.statusCode!),
    );
    ws.on('open', () => (ws.close(), resolve('open')));
  });
}
