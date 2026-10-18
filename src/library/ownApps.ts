import type { ConnectorId } from './connectors.ts';

/**
 * How an agent sets up the user's own app for a service Mochi has no app for (`list_connectors` hands it these). The agent
 * does every step in its own browser tab, asking in chat only for what it can't decide or clear; Mochi reads the client
 * secret from the page itself (`connect_account`'s `secretRef`), so it never reaches the agent. One-time per service
 * (Slack: per workspace).
 */
export function ownAppSetup(id: ConnectorId, redirectUrl: string): OwnAppSetup | undefined {
  if (id === 'slack') return slackSetup(redirectUrl);
  if (id === 'google-workspace') return GOOGLE_SETUP;
}

export interface OwnAppSetup {
  /** Where to start, in the user's browser. */
  openUrl: string;
  steps: string[];
}

// Slack's MCP tools, by the scopes they need (docs.slack.dev/ai/mcp-server); all user scopes, so it acts as the user.
const SLACK_USER_SCOPES = [
  'canvases:read', 'canvases:write', 'channels:history', 'channels:read', 'chat:write', 'files:read', 'groups:history', 'groups:read', 'im:history', 'im:read',
  'mpim:history', 'mpim:read', 'reactions:read', 'reactions:write', 'search:read.files', 'search:read.private', 'search:read.public', 'search:read.users', 'users:read', 'users:read.email',
];

/** Mochi's Slack app, as a manifest: user scopes, the relay redirect, and Slack's MCP server on for it. */
export function slackManifest(redirectUrl: string) {
  return {
    display_information: { name: 'Mochi', description: 'Lets your Mochi agents use Slack as you.' },
    oauth_config: { redirect_urls: [redirectUrl], scopes: { user: SLACK_USER_SCOPES } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false, is_mcp_enabled: true },
  };
}

/**
 * Fast: the agent only generates an app configuration token, and Mochi creates the app from the manifest through Slack's
 * API (`apps.manifest.create`, which returns the credentials), so no console page is clicked through. The manifest link
 * is the fallback when the API path fails.
 */
function slackSetup(redirectUrl: string): OwnAppSetup {
  return {
    openUrl: 'https://api.slack.com/apps',
    steps: [
      'browser_open openUrl. If Slack asks to sign in, ask the user to sign in in your tab and wait.',
      'Under "Your App Configuration Tokens" click Generate Token, pick the workspace (ask in chat which one if there are several) and Generate. Take a browser_snapshot and note the Access Token\'s ref (its value shows to you as hidden).',
      'connect_account with connector "slack", an account name (the workspace\'s, lowercased) and configTokenRef: Mochi creates the app with its MCP server on, keeps the credentials, and opens the sign-in page. Click Allow there, then list_connectors until it isSignedIn.',
      `Only if connect_account reports the API refused: browser_open ${slackManifestUrl(redirectUrl)} (Create app from manifest, Mochi filled in), pick the workspace, Next, Create; then Settings › Basic Information › App Credentials: read the Client ID, click Show next to Client Secret, snapshot, and connect_account with the Client ID and secretRef.`,
    ],
  };
}

function slackManifestUrl(redirectUrl: string) {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(redirectUrl)))}`;
}

const GOOGLE_SETUP: OwnAppSetup = {
  openUrl: 'https://console.cloud.google.com/projectcreate',
  steps: [
    'browser_open openUrl and create a project named "Mochi". If Google asks the user to sign in or to turn on 2-Step Verification, ask them in chat and wait.',
    'In that project enable the Gmail API, Google Calendar API and Google Drive API (APIs & Services › Library, Enable on each).',
    'Google Auth Platform › Get started: app name "Mochi", the user\'s email as support and developer contact, Audience External, agree to the policy (ask the user first in chat), Create.',
    'Audience: Publish app, so sign-ins don\'t expire after 7 days. Sign-in will show an "unverified app" screen, expected for an app only the user uses.',
    'Clients › Create client › Desktop app, name "Mochi", Create. In the dialog that follows read the Client ID, take a browser_snapshot and note the Client secret\'s ref (its value shows to you as hidden).',
    'connect_account with connector "google-workspace", an account name, the Client ID and secretRef. On the pages it opens, pick the account, approve Mochi\'s own consent page, then Advanced › Go to Mochi and Continue (say in chat it\'s the user\'s own app), then list_connectors until it isSignedIn. Later Google accounts reuse this client: connect_account without a Client ID.',
  ],
};
