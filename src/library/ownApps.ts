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
 * Fast: Mochi's setup recipe generates an app configuration token (`run_setup`), and Mochi creates the app from the
 * manifest through Slack's API (`apps.manifest.create`, which returns the credentials), so no console page is clicked
 * through by the agent. The agent's own clicks, then the manifest link, are the fallbacks.
 */
function slackSetup(redirectUrl: string): OwnAppSetup {
  return {
    openUrl: 'https://api.slack.com/apps',
    steps: [
      'run_setup with connector "slack": Mochi generates an app configuration token in your tab and keeps it. Follow its next: ask the user which workspace if it asks, sign-in included.',
      'connect_account with connector "slack", an account name (the workspace\'s, lowercased) and fromSetup: true: Mochi creates the app with its MCP server on and opens the sign-in page. Click Allow there, then list_connectors until it isSignedIn.',
      'If a run step fails and you can\'t fix it with update_setup_step: on openUrl click Generate Token, pick the workspace, Generate, snapshot, and connect_account with configTokenRef (the Access Token\'s Copy button).',
      `If Slack refuses the app (connect_account says so): browser_open ${slackManifestUrl(redirectUrl)} (Create app from manifest, Mochi filled in), pick the workspace, Next, Create; then Settings › Basic Information › App Credentials: read the Client ID, and connect_account with the Client ID and secretRef (the Client Secret or its Copy button).`,
    ],
  };
}

function slackManifestUrl(redirectUrl: string) {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(redirectUrl)))}`;
}

const GOOGLE_SETUP: OwnAppSetup = {
  openUrl: 'https://console.cloud.google.com/projectcreate',
  steps: [
    'run_setup with connector "google-workspace": Mochi creates a Cloud project for your Mochi app, enables Gmail, Calendar and Drive, sets up the consent screen with you as its test user, publishes it (with Mochi on GitHub as its home page and privacy policy) so sign-ins don\'t expire after 7 days, and creates a Desktop client, keeping its secret. It asks you on its cards to agree to Google\'s policy and to publish; follow its next, sign-in included. If you don\'t want it published, run_setup again with fromStep "client": the app stays in Testing and Google asks you to sign in again every 7 days.',
    'connect_account with connector "google-workspace", an account name and fromSetup: true. On the pages it opens pick your account, approve Mochi\'s own consent page, then Google\'s "unverified app" screen (Advanced, Go to Mochi; it\'s your own app, say so in chat) and Continue. Then list_connectors until it isSignedIn; later Google accounts reuse this client.',
    'A Google Workspace organization can block its members from creating Cloud projects, and run_setup then stops saying so. Tell the user a personal Google account can own the app while their Workspace account signs in through it; ask which personal account (signed in to this browser), then run_setup with params.owner set to it and params.signInEmail set to the Workspace account, and connect_account as usual. Their organization may still block unverified apps at sign-in; if Google says so, only its admin can allow it.',
  ],
};
