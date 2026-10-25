import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { Data, Effect, Option, Redacted } from 'effect';
import { Capabilities } from '@mochi/schema';

/** Why `mochi serve` would not start. */
export class ServeRefused extends Data.TaggedError('ServeRefused')<{
  readonly message: string;
}> {}

/** 32 bytes of base64url, what a generated token has. */
export const MIN_TOKEN_LENGTH = 43;

export interface ServeFlags {
  readonly host: string;
  readonly port: number;
  readonly token: Option.Option<Redacted.Redacted<string>>;
  /** The token's scopes; none given means all of them. */
  readonly scopes: ReadonlyArray<Capabilities.AuthScope>;
  /** Page origins allowed besides the served UI's own. */
  readonly origins: ReadonlyArray<string>;
}

/**
 * The token and the origins `mochi serve` accepts. Beyond loopback a token is required and must be long; on loopback one is
 * generated when none is given. The served UI's own origin is always allowed.
 */
export const resolveAuth = (flags: ServeFlags) =>
  Effect.gen(function* () {
    if (!Number.isInteger(flags.port) || flags.port < 1 || flags.port > 65535)
      return yield* new ServeRefused({
        message: `Port ${flags.port} is not 1–65535`,
      });
    if (!isLoopback(flags.host) && Option.isNone(flags.token))
      return yield* new ServeRefused({
        message: `${flags.host} is reachable beyond this computer: pass --token or set MOCHI_SERVE_TOKEN`,
      });
    const token = Option.match(flags.token, {
      onNone: () => randomBytes(32).toString('base64url'),
      onSome: Redacted.value,
    });
    if (token.length < MIN_TOKEN_LENGTH)
      return yield* new ServeRefused({
        message: `The token is ${token.length} characters; it needs ${MIN_TOKEN_LENGTH} (openssl rand -hex 32)`,
      });
    // A browser sends the token as a WebSocket subprotocol, which can't hold `/`, `=` or `+`.
    if (!/^[\w.~-]+$/.test(token))
      return yield* new ServeRefused({
        message: 'The token may hold only letters, digits and . _ ~ -',
      });
    const scopes = flags.scopes.length ? flags.scopes : Capabilities.allScopes;
    return {
      token,
      isGenerated: Option.isNone(flags.token),
      tokens: new Map([[token, scopes]]),
      origins: [
        ...new Set([
          ...servedOrigins(flags.host, flags.port),
          ...flags.origins,
        ]),
      ],
    };
  });

const WILDCARDS = new Set(['0.0.0.0', '::']);

export const isLoopback = (host: string) =>
  host === 'localhost' ||
  host === '::1' ||
  (isIP(host) === 4 && host.startsWith('127.'));

/** The origins a browser reports for the UI served at `host:port`; a wildcard bind is also reached through loopback. */
const servedOrigins = (host: string, port: number) => {
  const local = ['localhost', '127.0.0.1', '[::1]'];
  const hosts =
    isLoopback(host) || WILDCARDS.has(host)
      ? [...local, urlHost(host)]
      : [urlHost(host)];
  return hosts.map((name) => `http://${name}:${port}`);
};

const urlHost = (host: string) => (isIP(host) === 6 ? `[${host}]` : host);
