import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  tlsCert: Option.none(),
  tlsKey: Option.none(),
};
const tls = {
  tlsCert: Option.some('cert.pem'),
  tlsKey: Option.some('key.pem'),
};

const refusal = (overrides: Partial<Parameters<typeof resolveAuth>[0]>) =>
  resolveAuth({ ...flags, ...overrides }).pipe(Effect.flip);

it.effect('a bind beyond loopback without TLS refuses, token or not', () =>
  Effect.gen(function* () {
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'mochi.local']) {
      const withToken = yield* refusal({
        host,
        token: Option.some(Redacted.make(TOKEN)),
      });
      assert.match(withToken.message, /plain http/);
      assert.match(withToken.message, /Settings › Remote access/);
    }
    const half = yield* refusal({ tlsCert: tls.tlsCert });
    assert.match(half.message, /go together/);
  }),
);

it.effect('TLS beyond loopback needs a token and serves https origins', () =>
  Effect.gen(function* () {
    for (const host of ['0.0.0.0', '192.168.1.20'])
      assert.match((yield* refusal({ host, ...tls })).message, /--token/);
    const ok = yield* resolveAuth({
      ...flags,
      ...tls,
      host: '192.168.1.20',
      token: Option.some(Redacted.make(TOKEN)),
    });
    assert.ok(ok.tls);
    assert.ok(ok.origins.includes('https://192.168.1.20:4747'));
    assert.ok(!ok.origins.some((origin) => origin.startsWith('http:')));
  }),
);

it.effect('a bad token or port refuses to start', () =>
  Effect.gen(function* () {
    const short = yield* refusal({
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
      ...tls,
      host: '0.0.0.0',
      token: Option.some(Redacted.make(TOKEN)),
      scopes: ['read'],
      origins: ['https://mochi.example'],
    });
    assert.ok(!given.isGenerated);
    assert.deepEqual([...given.tokens], [[TOKEN, ['read']]]);
    assert.ok(given.origins.includes('https://0.0.0.0:4747'));
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

it.live('Core started with a certificate serves wss', () =>
  Effect.gen(function* () {
    const dir = mkdtempSync(path.join(tmpdir(), 'mochi-tls-'));
    const [keyFile, certFile] = [
      path.join(dir, 'key.pem'),
      path.join(dir, 'cert.pem'),
    ];
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyFile,
        '-out',
        certFile,
        '-subj',
        '/CN=localhost',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    const context = yield* Layer.build(
      layerCore({
        port: 0,
        tokens: new Map([[TOKEN, Capabilities.allScopes]]),
        origins: [],
        tls: { cert: readFileSync(certFile), key: readFileSync(keyFile) },
      }),
    );
    const { port } = Context.get(context, HttpServer.HttpServer).address as {
      port: number;
    };
    const opened = yield* Effect.promise(
      () =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket(
            coreUrl(port, TOKEN).split('#')[0]!.replace('ws:', 'wss:'),
            Capabilities.subprotocolsFor(TOKEN),
            { rejectUnauthorized: false },
          );
          ws.on('open', () => (ws.close(), resolve(true)));
          ws.on('error', () => resolve(false));
        }),
    );
    assert.ok(opened);
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
