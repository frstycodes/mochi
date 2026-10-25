import type { CaptureKind } from '../../src/library/recipes.ts';

/** What a setup run left in main for `connect_account`'s `fromSetup`: captured values, and the run's own params (a workspace). */
export interface SetupCapture {
  values: Partial<Record<CaptureKind, string>>;
  params: Record<string, string>;
}

interface Client {
  clientId: string;
  clientSecret: string;
}

/** Where apps Mochi made are kept (the keychain) and how a new one is made (`apps.manifest.create`); passed in, so tests need no Electron. */
export interface SlackApps {
  read(key: string): Promise<Client | undefined>;
  save(key: string, client: Client): Promise<void>;
  create(configToken: string): Promise<Client>;
}

/**
 * The client a Slack setup run yields, never a second app for one workspace: an existing app's captured credentials, else
 * the app Mochi made in that workspace before, else a new one from the configuration token, kept for next time.
 */
export async function slackClientFrom(
  { values, params }: SetupCapture,
  apps: SlackApps,
): Promise<Client> {
  const key = params.workspace
    ? `app:slack:${params.workspace.toLowerCase()}`
    : undefined;
  const keep = async (client: Client) => (
    key && (await apps.save(key, client)),
    client
  );
  if (values.slackClientId && values.slackClientSecret)
    return keep({
      clientId: values.slackClientId,
      clientSecret: values.slackClientSecret,
    });
  const known = key && (await apps.read(key));
  if (known) return known;
  if (!values.slackConfigToken)
    throw new Error(
      'This setup run captured no Slack app or token: run_setup again',
    );
  return keep(await apps.create(values.slackConfigToken));
}

/** A Google setup run's Desktop client, for the local Workspace server (`addConnectorAccount` keeps it once for every account). */
export function googleClientFrom({ values }: SetupCapture): Client {
  if (!values.googleClientId || !values.googleClientSecret)
    throw new Error(
      'This setup run captured no Google client: run_setup again',
    );
  return {
    clientId: values.googleClientId,
    clientSecret: values.googleClientSecret,
  };
}
