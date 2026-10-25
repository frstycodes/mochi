import { slackManifest } from '../../src/library/ownApps.ts';

/**
 * Creates Mochi's Slack app in the user's workspace from its manifest (`apps.manifest.create`), with an app configuration
 * token the user generated on api.slack.com/apps, and returns its credentials: no console page clicked through.
 */
export async function createSlackApp(
  configToken: string,
  redirectUrl: string,
  post: typeof fetch = fetch,
) {
  const res = await post('https://slack.com/api/apps.manifest.create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: configToken,
      manifest: JSON.stringify(slackManifest(redirectUrl)),
    }),
  });
  const answer = (await res.json()) as ManifestAnswer;
  if (!answer.ok || !answer.credentials)
    throw new Error(
      `Slack refused to create the app (${[answer.error, ...(answer.errors ?? []).map((e) => `${e.pointer}: ${e.message}`)].filter(Boolean).join('; ') || res.status}); use the manifest link instead`,
    );
  return {
    appId: answer.app_id!,
    clientId: answer.credentials.client_id,
    clientSecret: answer.credentials.client_secret,
  };
}

interface ManifestAnswer {
  ok: boolean;
  error?: string;
  errors?: { message: string; pointer: string }[];
  app_id?: string;
  credentials?: { client_id: string; client_secret: string };
}
