import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAUTH_PROVIDER_IDS, type OAuthProviderId } from '../../src/library/connectors.ts';

/**
 * Mochi's own OAuth app per provider whose MCP servers can't register clients (`OAUTH_PROVIDERS`). Each is a native or
 * desktop app: its client id is public and baked in here. `MOCHI_OAUTH_<PROVIDER>_CLIENT_ID` and `_CLIENT_SECRET` override
 * them, from the environment or, in the Electron build, from `.env.local` (vite.config.ts), which is where the secrets
 * that providers treat as confidential live: this repo is public. An empty id means Mochi has no app for the provider yet,
 * and accounts on it bring their own.
 */
const BAKED = {
  // "Mochi desktop" in Google Cloud project mochi-511921, used by the local Google Workspace server (googleWorkspace.ts). Its secret
  // isn't confidential (Google's docs) but GitHub's push protection blocks it, so it's in .env.local too.
  google: { clientId: '396170665891-1rg13stbmhbo6hhr79rkktc2hd73faap.apps.googleusercontent.com', clientSecret: '' },
  // The Mochi OAuth App (frstycodes); device flow, so no secret.
  github: { clientId: 'Ov23liprlzoHyVDFz3Ih', clientSecret: '' },
  // Slack app A0CAXA24GJU in the "Myself" workspace: Slack's MCP only takes directory-listed apps outside it (LIBRARY.md).
  slack: { clientId: '8325458480016.12371342152640', clientSecret: '' },
  asana: { clientId: '1219604610749623', clientSecret: '' },
  // MCP Connector 57544003 in portal 247722501; https redirects only, so it signs in through the relay.
  hubspot: { clientId: '14020a11-4d32-49fe-a3ac-d27ed717c054', clientSecret: '' },
} satisfies Record<OAuthProviderId | 'google', { clientId: string; clientSecret: string }>;

export function mochiOAuthApp(provider: OAuthProviderId | 'google'): OAuthClientInformationMixed | undefined {
  const env = (name: string) => {
    const key = `MOCHI_OAUTH_${provider.toUpperCase()}_${name}`;
    return process.env[key] ?? BUILD_ENV[key];
  };
  const clientId = env('CLIENT_ID') ?? BAKED[provider].clientId;
  const clientSecret = env('CLIENT_SECRET') ?? BAKED[provider].clientSecret;
  if (!clientId) return undefined;
  return { client_id: clientId, ...(clientSecret && { client_secret: clientSecret }) };
}

// Replaced by the Electron build (vite.config.ts); undefined under node --test.
declare const __MOCHI_OAUTH_ENV__: Record<string, string> | undefined;

const BUILD_ENV = typeof __MOCHI_OAUTH_ENV__ === 'undefined' ? {} : __MOCHI_OAUTH_ENV__;

/** The providers Mochi can sign accounts in with by itself. */
export function mochiOAuthProviders() {
  return OAUTH_PROVIDER_IDS.filter((id) => !!mochiOAuthApp(id));
}
