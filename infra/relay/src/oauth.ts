/**
 * The one route anyone can reach: a provider that only takes https redirects sends a connector sign-in back here, and
 * this sends the browser on to Mochi on the same machine, at the loopback port the state starts with
 * (`relayState` in `src/library/connectors.ts`). Only ever to 127.0.0.1, so it can't be used to redirect elsewhere; the
 * code is useless without the PKCE verifier Mochi holds.
 */
export function oauthBounce(url: URL): Response {
  const port = Number(
    /^(\d{2,5})-[a-f0-9]{16,64}$/.exec(
      url.searchParams.get('state') ?? '',
    )?.[1],
  );
  if (!port || port > 65535)
    return new Response(
      'This sign-in link is broken. Start again from Mochi.',
      { status: 400 },
    );
  return Response.redirect(
    `http://127.0.0.1:${port}/oauth-callback${url.search}`,
    302,
  );
}
