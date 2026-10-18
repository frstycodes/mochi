// Curated from the official MCP Registry and each vendor's docs (endpoints checked 2026-10-10). The registry itself is
// open to anyone and full of proxies, so only vendors' own endpoints are listed here.
export interface Connector {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  serverUrl: string;
  note?: string;
}

/** workspace-mcp, which Mochi runs locally for Google Workspace (electron/library/googleWorkspace.ts). `localhost`, not 127.0.0.1: it's the host its OAuth metadata names. */
export const GOOGLE_WORKSPACE_PORT = 47821;
export const GOOGLE_WORKSPACE_URL = `http://localhost:${GOOGLE_WORKSPACE_PORT}/mcp`;

export const CONNECTOR_CATEGORIES = ['Productivity', 'Engineering', 'Design', 'Business'] as const;

type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number];

export const CONNECTORS = [
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Gmail, Calendar and Drive: search and draft email, read your schedule, find files.',
    category: 'Productivity',
    serverUrl: GOOGLE_WORKSPACE_URL,
    note: 'Runs on this computer. The first connection downloads what it needs, which takes a minute or two.',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read and edit pages and databases.',
    category: 'Productivity',
    serverUrl: 'https://mcp.notion.com/mcp',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Search messages and channels, and post replies.',
    category: 'Productivity',
    serverUrl: 'https://mcp.slack.com/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects and cycles.',
    category: 'Engineering',
    serverUrl: 'https://mcp.linear.app/mcp',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues, pull requests and Actions.',
    category: 'Engineering',
    serverUrl: 'https://api.githubcopilot.com/mcp/',
    note: 'Or paste a personal access token as an API key.',
  },
  {
    id: 'atlassian',
    name: 'Jira and Confluence',
    description: 'Atlassian issues and pages.',
    category: 'Engineering',
    serverUrl: 'https://mcp.atlassian.com/v2/mcp',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Errors, issues and releases.',
    category: 'Engineering',
    serverUrl: 'https://mcp.sentry.dev/mcp',
  },
  { id: 'vercel', name: 'Vercel', description: 'Projects, deployments and logs.', category: 'Engineering', serverUrl: 'https://mcp.vercel.com' },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Databases, tables and edge functions.',
    category: 'Engineering',
    serverUrl: 'https://mcp.supabase.com/mcp',
  },
  {
    id: 'cloudflare-bindings',
    name: 'Cloudflare Workers',
    description: 'Workers, KV, R2 and D1 in your account.',
    category: 'Engineering',
    serverUrl: 'https://bindings.mcp.cloudflare.com/mcp',
  },
  {
    id: 'cloudflare-observability',
    name: 'Cloudflare Observability',
    description: 'Logs and analytics for your Workers.',
    category: 'Engineering',
    serverUrl: 'https://observability.mcp.cloudflare.com/mcp',
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Read designs, components and variables.',
    category: 'Design',
    serverUrl: 'https://mcp.figma.com/mcp',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Customers, payments and subscriptions.',
    category: 'Business',
    serverUrl: 'https://mcp.stripe.com',
  },
] as const satisfies Connector[];

export type ConnectorId = (typeof CONNECTORS)[number]['id'];

// The vendor's own site, for its favicon: MCP endpoints (`mcp.linear.app`) serve none. Google Workspace's is Google's G.
const CONNECTOR_SITES = {
  'google-workspace': 'https://www.gstatic.com/images/branding/productlogos/googleg/v6/36px.svg',
  notion: 'notion.so',
  slack: 'slack.com',
  linear: 'linear.app',
  github: 'github.com',
  atlassian: 'atlassian.com',
  sentry: 'sentry.io',
  vercel: 'vercel.com',
  supabase: 'supabase.com',
  'cloudflare-bindings': 'cloudflare.com',
  'cloudflare-observability': 'cloudflare.com',
  figma: 'figma.com',
  stripe: 'stripe.com',
} satisfies Record<ConnectorId, string>;

/** A connector's icon: its product icon or vendor favicon (via Google's favicon service), else the server host's favicon. */
export function connectorIcon(serverUrl: string) {
  const known = connectorFor(serverUrl);
  const site = known ? CONNECTOR_SITES[known.id as ConnectorId] : URL.canParse(serverUrl) ? new URL(serverUrl).hostname.replace(/^mcp\./, '') : null;
  if (site?.startsWith('https://')) return site;
  return site && `https://www.google.com/s2/favicons?domain=${site}&sz=64`;
}

export function connectorFor(serverUrl: string): Connector | undefined {
  return CONNECTORS.find((connector) => isSameServer(connector.serverUrl, serverUrl));
}

export function isSameServer(a: string, b: string) {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/** The server name a connector gets in a session: its directory id, else its host as a slug (`mcp-example-com`). */
export function connectorKey(serverUrl: string) {
  return connectorFor(serverUrl)?.id ?? new URL(serverUrl).hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Providers whose MCP servers don't let a client register itself (checked 2026-10-18: their authorization servers publish
 * no `registration_endpoint`). An account on one signs in with Mochi's own OAuth app for the provider when the build has
 * one (`electron/library/oauthApps.ts`), else with an app of the user's own. `authorizationParams` are added to the
 * sign-in URL. `redirect` is where the provider sends the browser back: `loopback` straight to Mochi on 127.0.0.1 (a
 * desktop client allowed any port), `relay` through Mochi's relay, which bounces it to the loopback port carried in the
 * state, for providers that only take https redirects.
 * `flow: 'device'` signs in with a one-time code instead of a redirect (RFC 8628), for providers whose authorization
 * server offers it: no redirect, and no client secret in the app.
 * Google isn't here: its connector is a local server that registers clients itself (`GOOGLE_WORKSPACE_URL`).
 */
export const OAUTH_PROVIDERS = {
  github: { name: 'GitHub', hosts: [/^api\.githubcopilot\.com$/], consoleUrl: 'https://github.com/settings/applications/new', authorizationParams: {}, redirect: 'loopback', flow: 'device' },
  slack: { name: 'Slack', hosts: [/^mcp\.slack\.com$/], consoleUrl: 'https://api.slack.com/apps', authorizationParams: {}, redirect: 'relay', flow: 'redirect' },
} satisfies Record<string, { name: string; hosts: RegExp[]; consoleUrl: string; authorizationParams: Record<string, string>; redirect: 'loopback' | 'relay'; flow: 'redirect' | 'device' }>;

export type OAuthProviderId = keyof typeof OAUTH_PROVIDERS;

export const OAUTH_PROVIDER_IDS = Object.keys(OAUTH_PROVIDERS) as OAuthProviderId[];

/** A provider whose app signs accounts in: the ones above, and Google for the local Google Workspace server. */
export type AppProviderId = OAuthProviderId | 'google';

export const GOOGLE_APP = { name: 'Google', consoleUrl: 'https://console.cloud.google.com/auth/clients' };

/** Whose app a connector's accounts sign in with, if not one the server registers itself. */
export function appProviderFor(serverUrl: string): AppProviderId | undefined {
  return isSameServer(serverUrl, GOOGLE_WORKSPACE_URL) ? 'google' : oauthProviderFor(serverUrl);
}

export function appInfo(provider: AppProviderId) {
  return provider === 'google' ? GOOGLE_APP : OAUTH_PROVIDERS[provider];
}

export function oauthProviderFor(serverUrl: string): OAuthProviderId | undefined {
  if (!URL.canParse(serverUrl)) return undefined;
  const { hostname } = new URL(serverUrl);
  return OAUTH_PROVIDER_IDS.find((id) => OAUTH_PROVIDERS[id].hosts.some((host) => host.test(hostname)));
}

/** The argument every connector tool gains when a profile has more than one account on it. */
export const ACCOUNT_ARGUMENT = '__mochi_account';

const ALIAS_SUGGESTIONS = ['personal', 'work', 'client', 'team'];

/** The first suggested account name no account on the service has yet. */
export function freeAlias(taken: string[]) {
  return ALIAS_SUGGESTIONS.find((a) => !taken.includes(a)) ?? `account-${taken.length + 1}`;
}

/** OAuth `state` for a sign-in through the relay: the loopback port first, so the relay (`infra/relay/src/oauth.ts`) knows where to send the browser back. */
export function relayState(port: number, nonce: string) {
  return `${port}-${nonce}`;
}

/** A device sign-in waiting on you: enter `userCode` at `verificationUri` to approve the account. */
export interface DeviceCode {
  url: string;
  userCode: string;
  verificationUri: string;
}
