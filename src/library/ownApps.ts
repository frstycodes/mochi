import type { ConnectorId } from './connectors.ts';

/**
 * How an agent sets up the user's own app for a service Mochi has no app for (`list_connectors` hands it these), so the
 * user never hunts for settings: the agent does it in their browser, copies the client ID into `connect_account`, and
 * the user pastes only the secret, on the card. One-time per service (Slack: per workspace).
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

/** An app made from a manifest (Slack's ?new_app=1&manifest_json=), so creating it is one click in the user's workspace. */
function slackSetup(redirectUrl: string): OwnAppSetup {
  const manifest = {
    display_information: { name: 'Mochi', description: 'Lets your Mochi agents use Slack as you.' },
    oauth_config: { redirect_urls: [redirectUrl], scopes: { user: SLACK_USER_SCOPES } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  };
  return {
    openUrl: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifest))}`,
    steps: [
      'Open openUrl in the browser: Slack shows "Create app from manifest" with Mochi filled in. The user picks their workspace and clicks Next, then Create.',
      'In the new app, open Features › Agents and turn on "Slack Model Context Protocol (MCP) Server". Slack lets only a workspace\'s own apps (and listed ones) use its MCP server, which this app is.',
      'Open Settings › Basic Information and read the Client ID under App Credentials. Never read, reveal or copy the Client Secret.',
      'Call connect_account with connector "slack", the Client ID, and an account name. The user pastes the secret on the card and signs in.',
    ],
  };
}

const GOOGLE_SETUP: OwnAppSetup = {
  openUrl: 'https://console.cloud.google.com/projectcreate',
  steps: [
    'Create a project named "Mochi" (if Cloud asks for 2-Step Verification first, the user turns it on).',
    'In that project, enable the Gmail API, Google Calendar API and Google Drive API (APIs & Services › Library).',
    'Google Auth Platform › Branding: app name "Mochi", the user\'s email as support and developer contact. Audience: External.',
    'Audience: Publish app, so sign-ins don\'t expire after 7 days. Google then shows the user an "unverified app" screen on sign-in, which is expected for an app only they use.',
    'Clients › Create client › Application type "Desktop app", name "Mochi". Read the Client ID from the dialog; never read, reveal or copy the Client secret.',
    'Call connect_account with connector "google-workspace", the Client ID, and an account name. The user pastes the secret on the card and signs in; every later Google account reuses this client.',
  ],
};
