import type { OAuthClientInformationMixed } from '@modelcontextprotocol/client';
import {
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
} from '../../src/library/connectors.ts';

/**
 * Mochi's own OAuth app per provider whose MCP servers can't register clients (`OAUTH_PROVIDERS`). Each is a native or
 * desktop app: its client id is public and baked in here. `MOCHI_OAUTH_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET` override
 * them, from the environment or, in the Electron build, from `.env.local` (vite.config.ts), which is where the secrets
 * that providers treat as confidential live: this repo is public. An empty id means Mochi has no app for the provider yet,
 * and accounts on it bring their own.
 */
const BAKED = {
  // None: Mochi's Google app (mochi-511921) is in Testing, open only to its listed test users, so each user brings their own (its
  // setup recipe). MOCHI_OAUTH_GOOGLE_CLIENT_ID and _CLIENT_SECRET still point a dev build at one.
  google: { clientId: '', clientSecret: '' },
  // The Mochi OAuth App (frstycodes); device flow, so no secret.
  github: { clientId: 'Ov23liprlzoHyVDFz3Ih', clientSecret: '' },
  // None: Slack's MCP server takes only Marketplace-listed apps and a workspace's own, so each user brings an app of their own (LIBRARY.md).
  slack: { clientId: '', clientSecret: '' },
} satisfies Record<
  OAuthProviderId | 'google',
  { clientId: string; clientSecret: string }
>;

export function mochiOAuthApp(
  provider: OAuthProviderId | 'google',
): OAuthClientInformationMixed | undefined {
  const env = (name: string) => {
    const key = `MOCHI_OAUTH_${provider.toUpperCase()}_${name}`;
    return process.env[key] ?? BUILD_ENV[key];
  };
  const clientId = env('CLIENT_ID') ?? BAKED[provider].clientId;
  const clientSecret = env('CLIENT_SECRET') ?? BAKED[provider].clientSecret;
  if (!clientId) return undefined;
  return {
    client_id: clientId,
    ...(clientSecret && { client_secret: clientSecret }),
  };
}

// Replaced by the Electron build (vite.config.ts); undefined in tests.
declare const __MOCHI_OAUTH_ENV__: Record<string, string> | undefined;

const BUILD_ENV =
  typeof __MOCHI_OAUTH_ENV__ === 'undefined' ? {} : __MOCHI_OAUTH_ENV__;

/** The providers Mochi can sign accounts in with by itself. */
export function mochiOAuthProviders() {
  return OAUTH_PROVIDER_IDS.filter((id) => !!mochiOAuthApp(id));
}
