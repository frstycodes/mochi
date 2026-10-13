# Accounts and devices

How Mochi gets an optional account (Clerk) and lets other devices (a phone, a second Mac, a browser) follow and steer threads that run on your Mac. This covers CHECKLIST §6 "Mobile companion / Remote control". Read it with [RUNTIME.md](RUNTIME.md) (agents run in main, and the Auth section) and [SETTINGS.md](SETTINGS.md).

Status labels: **verified** = read in this repo; **source** = read in T3 Code's source at `pingdotgg/t3code@6524a8d` (2026-10-13), paths relative to that repo; **docs** = read in Clerk's docs on 2026-10-13 (links inline), not yet run here; **proposed** = ours to decide, waiting for approval; **not verified** = belief, check before building on it.

## Summary (proposed)

- **The Mac that owns the worktree runs the agents, always.** Other devices are remote controls: they see threads and the Queue, answer approvals and questions, send messages, and interrupt. They never run agents, never hold provider credentials, and never touch the worktree.
- **The Mac is the server, and the single writer.** Devices connect to it over a WebSocket: directly on the LAN or Tailscale with no account, or through Mochi's relay from anywhere once you sign in. No cloud database holds your threads.
- **A Mochi account is identity for the relay and your device list.** It is not a Claude or Codex login. Mochi still never logs in to Claude or Codex, and never handles their credentials (RUNTIME.md › Auth, unchanged).
- **No account stays the default.** Mochi works fully offline and local-only. Signing in only adds "reach this Mac from anywhere" and push notifications.
- **End-to-end encrypted.** Device keys are exchanged at pairing, so the relay forwards ciphertext it can't read.

## What T3 Code does (source)

T3 Code is the closest reference. Its model holds up and Mochi should copy most of it, with two exceptions noted at the end of this section.

- **One server per machine runs the agents.** A Node server (`apps/server`, bundled into the desktop app) owns providers, terminals, git and files. Desktop, web and mobile are all clients of it (`docs/internals/overview.md`). Agents keep running with no client connected (`docs/user/remote-access.md:190`). When the host is off, remote use stops: "That machine must stay running and reachable" (`remote-access.md:4`).
- **Transport.** WebSocket RPC on `/ws` (Effect RPC, JSON, permessage-deflate; `apps/server/src/ws.ts`), port 3773.
  - Binds `127.0.0.1` by default. Desktop "Network access" switches it to `0.0.0.0` (`apps/desktop/src/backend/DesktopServerExposure.ts:31-32`).
  - Routes to a server: LAN, Tailscale (`t3 serve --tailscale-serve`), SSH port-forward, or T3 Connect (below). A saved environment tries an ordered list of routes (`docs/internals/remote.md`).
- **Auth without accounts.** Each server issues its own scoped sessions. You pair by one-time token (link or QR from `t3 pair`), or by a silent handoff when the desktop shell talks to its own server (`packages/contracts/src/auth.ts`).
  - Scopes: `orchestration:read` / `operate`, `terminal:*`, `filesystem:*`, and others. Every RPC declares the scope it needs (`apps/server/src/auth/RpcAuthorization.ts`).
  - Tokens are DPoP-bound. Long-lived tokens never go in socket URLs: a client first gets a short-lived WS ticket over HTTP (`docs/internals/environment-auth.md`).
  - Hosted pairing links keep the secret in the URL fragment.
- **State.** The server is event-sourced: SQLite event log plus projections (`apps/server/src/persistence/`).
  - Clients subscribe to a shell stream: a snapshot, then sequenced updates. Each open thread has its own subscription, which takes `afterSequence` to replay what the client missed (`packages/contracts/src/orchestrationV2.ts:2036-2072, 3352`).
  - The server is the only writer. Commands are idempotent through receipts, and a reconnecting client doesn't replay its mutations automatically (`docs/internals/connection-runtime.md`).
- **Offline.** Clients retry with jittered backoff capped at 5 minutes. They keep cached projections readable, marked as not live (`connection-runtime.md`).
- **Clerk only for the optional hosted part, T3 Connect.** Packages: `@clerk/electron` (desktop), `@clerk/expo` (mobile), `@clerk/backend` (relay); see each `package.json`.
  - The relay is a Cloudflare Worker with Durable Objects (`infra/relay`). It links environments to accounts, brokers a one-time bootstrap credential bound to the client's key, allocates Cloudflare tunnels, forwards webhooks, and sends APNs/FCM pushes.
  - It doesn't proxy app traffic: clients reach the environment through its tunnel hostname, and the relay never sees the session token (`docs/internals/t3-connect.md:6, 35-41`). Their own stated caveat: a compromised relay signing key can mint credentials (`t3-connect.md`).
- **Where secrets are kept.**
  - Desktop: saved environments go through Electron `safeStorage` (`apps/desktop/src/app/DesktopConnectionCatalogStore.ts`).
  - Server: secrets as 0600 files (`apps/server/src/auth/ServerSecretStore.ts`).
  - Web: IndexedDB.
  - Mobile: secure storage.

**Where Mochi differs:**

1. **Clerk stays out of the renderer.** T3 renders Clerk's `ClerkProvider` from `@clerk/electron/react` in the renderer (`apps/web/src/components/clerk/ElectronManagedAuthShell.tsx:2`, source), and sign-in UI loads from Clerk into the app window (docs, [Electron overview](https://clerk.com/docs/reference/electron/overview)). That breaks two Mochi rules: no secrets in the renderer, and no credential entry inside the app. Mochi signs in through the system browser with tokens only in main (below).
2. **The relay carries ciphertext instead of handing out tunnels.** A Cloudflare tunnel terminates TLS at Cloudflare's edge, so Cloudflare can read the traffic (not verified; general knowledge of how Cloudflare tunnels work). Mochi's relay forwards frames that are end-to-end encrypted between paired device keys instead, and a new device needs approval on the Mac's own screen, so a compromised relay can't add one.

## Clerk sign-in (docs, proposed)

- **Flow: OAuth 2.0 authorization code with PKCE, in the system browser.** Mochi is registered as a public Clerk OAuth application. Main does the whole flow:
  1. generate `code_verifier`, `state` and `nonce`;
  2. `shell.openExternal(<clerk>/oauth/authorize?...&code_challenge_method=S256)`;
  3. receive the redirect;
  4. exchange the code at `/oauth/token` with no client secret;
  5. ask for scopes `openid profile email offline_access`.
- **What Clerk documents:** "Public" clients need no secret, but don't enforce PKCE on their own. Instance-wide "Require PKCE" is on by default and accepts only S256. `offline_access` returns a refresh token that never expires. Access tokens last 1 day and are JWTs by default, verifiable against `/.well-known/jwks.json` ([how Clerk implements OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)).
- **Redirect: loopback first.** `http://127.0.0.1:<random port>/callback`, served by a one-shot listener in main (RFC 8252). It works in dev, whereas custom-scheme deep links only reach a packaged app on macOS (docs, [OAuth deep links](https://clerk.com/docs/guides/configure/auth-strategies/oauth-deep-links)). Fallback if Clerk won't accept loopback: `mochi://auth/callback` through `app.setAsDefaultProtocolClient` plus `open-url`. Neither line exists in `electron/` today (verified). Whether Clerk OAuth apps accept loopback or custom-scheme redirect URIs is not verified; that is PR 4's first task.
- **Storage.**
  - The refresh token is encrypted with `safeStorage` in main's userData, the same pattern as the API keys in `electron/agents/config.ts:93` (verified). The access token stays in memory in main.
  - The renderer gets `{ status, name, email, imageUrl }` and nothing else, through a new `host.account` (`signIn()`, `signOut()`, `onChange`).
  - No token in a URL, in a log, or in IPC to the renderer.
- **Sign-out** drops both tokens and asks the relay to forget this Mac's link. Revoking the refresh token at Clerk: the endpoint is not verified, check it in PR 4.
- **Why not `@clerk/electron`:** it is beta and its renderer runs `ClerkProvider` (docs). Plain OAuth needs no SDK in the app. The relay verifies tokens with `@clerk/backend` or plain JWKS.
- **Cost:** free up to 50,000 monthly retained users per app on Hobby (docs, [pricing](https://clerk.com/pricing)).

## Devices and what they can do (proposed)

| | The Mac that owns the thread | A paired device (phone, browser, other Mac) |
|---|---|---|
| Runs agents, worktrees, terminals, git | yes | never |
| Provider logins, API keys, gh tokens | stay here (RUNTIME.md › Auth) | never sent |
| View threads, activity, goals, Queue | yes | yes (read scope) |
| Answer approvals and questions, send a message, interrupt, stop | yes | yes (operate scope) |
| Start a thread, edit goals, commit, push, open a PR, settings | yes | not in v1 |
| File contents and diffs | yes | only if "Show code on other devices" is on (off by default) |

- **Scopes** mirror T3: `read` and `operate`. The Mac grants a scope at pairing and can change it per device.
- **"Runs on" stays per thread.** SETTINGS.md › Defaults has a "Runs on: This Mac / …" row; a thread started on one Mac can't move to another.
- **More than one Mac:** each runs its own threads. A device paired with both shows two sections.

## Transport (proposed)

- **Server in main.** A WebSocket server in main (`electron/remote/`), off until you turn on Settings › Devices.
  - Binds `127.0.0.1`. "Allow devices on this network" binds the LAN or Tailscale interface.
  - The phone UI loads from the same server (below), so LAN and Tailscale need no hosting at all.
- **The renderer stays the writer.** Today the store lives in the renderer: it consumes `AgentEvent`s and saves itself through `host.data.save` (verified, `src/host/types/data.ts`, `src/store/persist.ts`). Every store action already passes through one hook, `recordAction` (verified, `src/replay/recorder.ts`).
  - The remote stream taps that hook: main sends devices a snapshot (`toSaved`-shaped, filtered by scope), then each action with a sequence number.
  - Device commands (`send`, `resolve`, `interrupt`) go from main to the renderer, which runs them through the same paths the UI uses.
  - The cost: remote control needs Mochi's renderer alive. That's a hidden window when every window is closed. Moving the store into main is the long-term fix, and is out of scope here.
- **Reconnect** works like T3's: the device sends its last sequence number and gets the actions after it, or a fresh snapshot if the gap is too old.
- **Auth.** No secret goes in the URL: the socket opens, then the first frame authenticates.
  - Pairing: the Mac shows a QR code holding its public key, its address and a one-time code. The device generates its own keypair, as a non-extractable WebCrypto key in IndexedDB on the web or in the keychain on a Mac. The two run an ECDH handshake, and the Mac shows "Allow <device>?".
  - After pairing, each connection proves the device key against a fresh challenge.
- **Relay, only when signed in and "Reach this Mac from anywhere" is on.**
  - The Mac opens one outbound WebSocket to the relay, authenticated with its Clerk access token in a header. Main is Node, so it can set headers.
  - Devices connect to the relay with their device key. The relay pairs the sockets and forwards encrypted frames.
  - The relay stores per account: the Mac ids, the device public keys the Mac registered, and push subscriptions. No thread content.

## What syncs (proposed)

| Data | Where it lives | Reaches devices |
|---|---|---|
| Threads (title, status, goal, steps, activity, usage), Queue, pins order | the Mac's store | streamed live, read-only except the operate commands |
| Settings | the Mac | not in v1. Per-device settings (notifications, theme) live on the device |
| Provider credentials, API keys, gh tokens, Clerk tokens, device private keys | the Mac's keychain / `safeStorage` | never |
| File contents, diffs, terminal output | the worktree | only with "Show code on other devices"; tool lines in activity are part of the thread |
| Replay recordings, checkpoints | the Mac | never |

**Not proposed: a cloud copy for reading while the Mac is off.** Devices cache the last snapshot locally and show it marked offline. Syncing settings and pins between two Macs needs a store in the cloud: an encrypted blob per account, last writer wins per key. That's an open decision, not in the PRs below.

## End-to-end encryption (proposed)

- **Option A, recommended:** pairwise keys from pairing. ECDH P-256 plus AES-GCM through WebCrypto, which Electron and every current browser have, so no new dependency. One session key per connection, derived through HKDF from the static keys plus fresh ephemeral keys. The relay sees sizes and timing, not content. A new device is accepted only on the Mac's screen.
- **Option B:** TLS to the relay only. Simpler, but the relay (and its host) can read threads. Rejected.
- **Option C:** a vetted protocol library (libsodium or Noise) in place of hand-assembled WebCrypto primitives. It costs a dependency on each client and fewer places to get wrong. Worth it if PR 2's review finds the WebCrypto version fiddly. Also a decision.
- **The same E2E layer runs on LAN and Tailscale,** so there is one code path, and plain `ws://` on a LAN stays safe.
- **Push payloads** carry no content: "A thread needs you". Tapping one opens the app, which fetches over the encrypted channel.

## Conflicts (proposed)

- **One writer per thread.** The Mac applies commands in arrival order, the same order the UI's own actions use.
- **Answering a Queue item:** the first answer wins. A later answer for the same `requestId` gets "Already answered on <device>", and the card disappears everywhere through the stream.
- **Messages from two devices** both land, in arrival order, through the existing outbox (`src/chat/outbox.ts`, verified to exist).
- **Every command carries an id.** The Mac keeps recent ids, so a resend after a dropped connection runs once (T3's receipts, smaller).
- **Settings:** none sync, so none conflict. If cross-Mac sync is chosen later: last writer wins per key, with the relay's timestamp.

## Offline (proposed)

- **No account, no network:** Mochi works exactly as today. Nothing here runs until Settings › Devices is turned on.
- **Device can't reach the Mac:** the device shows the cached snapshot with "Mac offline since <time>" and disables actions. Drafts stay in the composer. Nothing queues to send later, because sending later could spend usage unasked (the same rule as `pauseQueue` on restart, verified in `src/store/persist.ts`).
- **Relay down:** LAN and Tailscale devices keep working, and remote devices see "offline".
- **Mac asleep:** agents pause with the Mac, as today. Keep-awake while threads run is a separate checklist item if wanted.

## Hosting and cost (proposed)

- **Relay:** a Cloudflare Worker plus one Durable Object per Mac, holding hibernatable WebSockets. T3 runs the same shape (source, `infra/relay`). Not verified: current Workers and Durable Objects pricing. Believed to be about $5/month on the paid plan, with idle hibernated sockets costing little. Check before PR 5.
- **Self-host:** the same Worker deploys to your own Cloudflare account, with the relay URL set in Settings. Or skip the relay and use Tailscale, which needs nothing hosted.
- **Phone UI:** served by the Mac on LAN and Tailscale. For relay use, the same static build on Cloudflare Pages (free tier, not verified). It's a client only, like `app.t3.codes`.

## Mobile companion

- **v1 is a PWA:** the existing web build with a third host implementation, `src/host/remote`, next to `desktop` and `web` (verified layout, `src/host/`). It speaks the device protocol instead of IPC.
  - Phone layouts: the Queue, a thread (chat, approvals, questions, composer) and the thread list. Add to Home Screen.
  - Web Push for needs-you. Not verified: iOS Web Push for installed PWAs (believed to work since iOS 16.4).
- **Native (Expo) later,** only if the PWA falls short (Live Activities, reliable push). It would use `@clerk/expo` with `expo-secure-store` (docs, [Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart)), reuse the same protocol, and need no Mac changes.

## PRs, in order

Each PR is its own worktree session, per SESSIONS.md.

1. **`remote-server`: local pairing, no account.**
   - `electron/remote/`: WebSocket server, QR pairing, device registry (public keys in userData, the Mac's private key through `safeStorage`), the read/operate scope check, snapshot plus sequenced action stream tapped from `recordAction`, and the command bridge to the renderer.
   - Settings › Devices: on/off, LAN/Tailscale bind, paired devices with scope and Remove.
   - Tests: sequencing and replay, first-answer-wins, scope refusal, duplicate command id.
2. **`e2e`: encrypted sessions on every connection.**
   - Handshake, key derivation, framing, and on-screen approval of a new device.
   - A test that tampered or replayed frames are rejected.
   - Lands before any non-loopback use ships. 1 and 2 can merge as one release.
3. **`remote-client`: the PWA.**
   - The `src/host/remote` implementation; phone layouts for Queue, thread and list; offline banner; served by the Mac's server.
   - Verified in the browser at phone width, both themes.
4. **`account`: Clerk sign-in in main.**
   - First, verify which redirect URIs a Clerk public OAuth app accepts, and the revoke endpoint.
   - PKCE through the system browser, refresh token in `safeStorage`, `host.account`, Settings › Account (sign in and out, who you are). No feature needs it yet.
5. **`relay`: reach from anywhere.**
   - Worker and Durable Object, Clerk JWT check, device-key auth, frame forwarding, the account's Mac and device list.
   - The Mac's outbound connection, behind "Reach this Mac from anywhere". Self-host relay URL setting.
6. **`push`:** Web Push from the relay for needs-you, review ready and failed, all content-free. Per-device notification settings.
7. **Later, only on request:** cross-Mac settings and pins sync, starting threads from a device, native iOS.

## Open decisions for the user

1. **Is the account worth having in v1?** LAN and Tailscale remote control needs no account (PRs 1–3). Clerk only earns its place with the relay (PR 5). Recommended: build PRs 1–3 first, then account plus relay.
2. **Do we host a relay?** It costs money (likely $5/month or more, not verified) and adds operational work. The alternative is Tailscale-only. Recommended: host it, since "answer from my phone anywhere" is the point, and keep self-host and Tailscale available.
3. **Encryption library:** hand-assembled WebCrypto (no dependency) or libsodium/Noise (vetted). Recommended: WebCrypto with a narrow, well-tested construction, revisited at review.
4. **What a device can do in v1:** the table above (no starting threads, no ship, no settings). Widen it?
5. **Code on devices:** off by default. Is that right, or should diffs show on by default since the channel is E2E?
6. **Cross-Mac settings and pins sync:** wanted at all? It would be the only data stored in the cloud (encrypted).
7. **PWA first vs native iOS first.** Recommended: PWA.
