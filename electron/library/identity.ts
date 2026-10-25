import { connectorKey } from '../../src/library/connectors.ts';
import type { LibraryConnector } from '../../src/library/library.ts';

/**
 * Who an account signed in as, asked of the service: a stable id and a label for messages. Slack (`auth.test` with the
 * user token) and GitHub (`/user`) say; for other services Mochi can't tell, and two names may be one account.
 * GAP: Google Workspace's tokens are its local server's, not Google's, so its accounts aren't told apart yet.
 */
export async function identityOf(
  url: string,
  token: string,
  get: typeof fetch = fetch,
): Promise<LibraryConnector['identity']> {
  const key = connectorKey(url);
  if (key === 'slack') {
    const me = (await get('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json())) as {
      ok: boolean;
      team_id?: string;
      user_id?: string;
      team?: string;
      user?: string;
    };
    return me.ok && me.team_id && me.user_id
      ? {
          id: `slack/${me.team_id}/${me.user_id}`,
          label: `${me.user} in ${me.team}`,
        }
      : undefined;
  }
  if (key === 'github') {
    const res = await get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Mochi',
      },
    });
    const me = (await res.json()) as { id?: number; login?: string };
    return res.ok && me.id
      ? { id: `github/${me.id}`, label: me.login ?? String(me.id) }
      : undefined;
  }
  return undefined;
}

/** Another account on the same server that signed in as the same person: connecting it again adds nothing. */
export function sameAccount(
  items: { kind: string }[],
  account: LibraryConnector,
) {
  if (!account.identity) return undefined;
  return items.find(
    (i): i is LibraryConnector =>
      i.kind === 'connector' &&
      (i as LibraryConnector).id !== account.id &&
      (i as LibraryConnector).key === account.key &&
      (i as LibraryConnector).identity?.id === account.identity!.id,
  );
}
