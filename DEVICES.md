# Accounts and devices

How Mochi gets an account (Clerk) and lets your other machines follow and steer threads that run on any one of them. A phone (PWA) comes later as one more client of the same logic. This covers CHECKLIST §6 "Mobile companion / Remote control". Read it with [RUNTIME.md](RUNTIME.md) (agents run in main, and the Auth section) and [SETTINGS.md](SETTINGS.md).

Status labels: **verified** = read in this repo; **source** = read in T3 Code's source at `pingdotgg/t3code@6524a8d` (2026-10-13), paths relative to that repo; **docs** = read in Clerk's docs on 2026-10-13 (links inline), not yet run here; **proposed** = designed here, approved 2026-10-13 (see Decisions); **not verified** = belief, check before building on it.

## Summary (proposed)

- **The machine that owns the worktree runs the agents, always.** Other devices are full remote controls: everything you do in a thread on the machine, you can do from another computer (macOS, Windows or Linux), executed on the owning machine. Devices never run agents, never hold provider credentials, and never touch the worktree directly.
- **The machine is the server, and the single writer.** Devices connect to it over a WebSocket: directly on the LAN or Tailscale when they can reach it, through Mochi's relay otherwise. No cloud database holds your threads.
- **A Mochi account is identity for the relay and your device list.** It is not a Claude or Codex login. Mochi still never logs in to Claude or Codex, and never handles their credentials (RUNTIME.md › Auth, unchanged).
- **One machine needs no account.** Mochi on a single machine works fully offline and local-only, as today. Using more than one device needs an account: pairing, the device list, reach from anywhere and settings and pins sync all go through it.
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
2. **The relay carries ciphertext instead of handing out tunnels.** A Cloudflare tunnel terminates TLS at Cloudflare's edge, so Cloudflare can read the traffic (not verified; general knowledge of how Cloudflare tunnels work). Mochi's relay forwards frames that are end-to-end encrypted between paired device keys instead, and a new device needs approval on the machine's own screen, so a compromised relay can't add one.
3. **Pairing goes through the account, once.** T3 pairs without accounts by one-time token; Mochi has one flow, joining your computers through any one of them on your account, and every computer you trust accepts the new one from that approval (Pairing, below).

## Clerk sign-in (docs, proposed)

- **Flow: OAuth 2.0 authorization code with PKCE, in the system browser.** Mochi is registered as a public Clerk OAuth application. Main does the whole flow:
  1. generate `code_verifier`, `state` and `nonce`;
  2. `shell.openExternal(<clerk>/oauth/authorize?...&code_challenge_method=S256)`;
  3. receive the redirect;
  4. exchange the code at `/oauth/token` with no client secret;
  5. ask for scopes `openid profile email offline_access`.
- **What Clerk documents:** "Public" clients need no secret, but don't enforce PKCE on their own. Instance-wide "Require PKCE" is on by default and accepts only S256. `offline_access` returns a refresh token that never expires. Access tokens last 1 day and are JWTs by default, verifiable against `/.well-known/jwks.json` ([how Clerk implements OAuth](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)).
- **Redirect: loopback first.** `http://127.0.0.1:<random port>/callback`, served by a one-shot listener in main (RFC 8252). It works in dev, whereas custom-scheme deep links only reach a packaged app on macOS (docs, [OAuth deep links](https://clerk.com/docs/guides/configure/auth-strategies/oauth-deep-links)). Fallback if Clerk won't accept loopback: `mochi://auth/callback` through `app.setAsDefaultProtocolClient` plus `open-url`. Neither line exists in `electron/` today (verified). Whether Clerk OAuth apps accept loopback or custom-scheme redirect URIs is not verified; that is PR 1's first task.
- **Storage.**
  - The refresh token is encrypted with `safeStorage` in main's userData, the same pattern as the API keys in `electron/agents/config.ts:93` (verified). The access token stays in memory in main.
  - The renderer gets `{ status, name, email, imageUrl }` and nothing else, through a new `host.account` (`signIn()`, `signOut()`, `onChange`).
  - No token in a URL, in a log, or in IPC to the renderer.
- **Sign-out** drops both tokens and asks the relay to forget this machine's link. Revoking the refresh token at Clerk: the endpoint is not verified, check it in PR 1.
- **Why not `@clerk/electron`:** it is beta and its renderer runs `ClerkProvider` (docs). Plain OAuth needs no SDK in the app. The relay verifies tokens with `@clerk/backend` or plain JWKS.
- **Cost:** free up to 50,000 monthly retained users per app on Hobby (docs, [pricing](https://clerk.com/pricing)).

## Devices and what they can do (proposed)

Everything runs on the machine that owns the thread; a device sends the command and shows the result. Each device holds scopes, granted on the machine at pairing and changeable later in Settings › Devices.

| Scope | What it allows | Default for a new device |
|---|---|---|
| `read` | threads, activity, goals, report cards, Queue, usage, PR status, schedules | on |
| `operate` | answer approvals and questions, send messages and attachments, interrupt, stop, resume, rewind, fork, hand off, side chat | on |
| `manage` | start threads (pick machine, project, agent, model, permissions), edit goals, rename, pin, archive, delete, schedules, commit, push, open a PR (as the machine's gh login, asked first as on the machine), the machine's settings | on |
| `code` | file tree, file contents, diffs, Changes tab actions (stage, revert, line comments), checkpoint diffs | on |
| `terminal` | open and type in the thread's terminals | off: a terminal is a shell on your machine |

- Never on a device, whatever the scope: provider logins, API keys, gh tokens, the machine's OS keychain, the Mochi tools' browser sessions. Browser and simulator panes are pixels on the machine; devices get a live screenshot (`code` scope), not control.
- "Runs on" (SETTINGS.md › Defaults) lists every machine you are paired with, on every device; a thread stays on the machine it started on.
- Several machines: each runs its own threads; devices show one merged list and Queue, each row tagged with its machine.

## Transport (proposed)

- **Server in main.** A WebSocket server in main (`electron/remote/`), off until you turn on Settings › Devices.
  - Binds `127.0.0.1`. "Allow devices on this network" binds the LAN or Tailscale interface.
- **The renderer stays the writer.** Today the store lives in the renderer: it consumes `AgentEvent`s and saves itself through `host.data.save` (verified, `src/host/types/data.ts`, `src/store/persist.ts`). Every store action already passes through one hook, `recordAction` (verified, `src/replay/recorder.ts`).
  - The remote stream taps that hook: main sends devices a snapshot (`toSaved`-shaped, filtered by scope), then each action with a sequence number.
  - Device commands (`send`, `resolve`, `interrupt`) go from main to the renderer, which runs them through the same paths the UI uses.
  - The cost: remote control needs Mochi's renderer alive. That's a hidden window when every window is closed. Moving the store into main is the long-term fix, and is out of scope here.
- **Reconnect** works like T3's: the device sends its last sequence number and gets the actions after it, or a fresh snapshot if the gap is too old.
- **Pairing** (built, `electron/remote/pairing.ts`; who is trusted: Pairing, below). No secret goes in the URL; every connection, LAN or relay, opens with one exchange and then carries only ciphertext:
  - The device sends its name, its Ed25519 public key and a handshake signed with that key. The machine checks the signature before anything else, so nobody is asked about a key its sender doesn't hold.
  - A member's key connects with no prompt. An unknown key through the relay makes the machine fetch the account's membership records first (another computer may have let it join); still unknown, on the LAN it is refused ("Join your computers through your Mochi account first"), and a computer reconnecting on its own is refused without asking. Otherwise it is a join: the machine shows "Let <computer> join your computers?" with a six-digit code derived from both public keys, and the joining computer shows the same code.
  - Then the libsodium session from `crypto/session.ts` carries the remote protocol (`hello`, commands, the action stream) unchanged.
  - The relay closes the machine's socket on a frame over 1 MB, so a bigger message (a snapshot, a long action, a diff) goes as encrypted pieces of 512 KB and is put back together on the other side; a peer that sends more than 64 MB in one message is cut off. Protocol version 2.
  - The machine's relay socket pings every 30 s; the relay's runtime answers without waking the Durable Object, and a missed pong drops and redials the socket. Found live: an idle socket died without either end seeing a close.
  - Clerk appears to rotate refresh tokens and reject reuse (seen when one session was copied into two profiles; not documented). Mochi keeps whichever refresh token Clerk returns, and a rejected refresh signs the account out on that computer.
- **Relay, only when signed in and "Reach this computer from anywhere" is on.**
  - Built (`infra/relay`): a Cloudflare Worker, one Durable Object per account (named by the Clerk user id), WebSockets on the hibernation API. Every route takes the account's Clerk access token in `Authorization`, never in the URL. `GET /v1/machines` lists the account's machines (id, name, public key, online), `DELETE /v1/machines/:id` forgets one, `GET /v1/connect` opens a socket as `role=machine` or `role=device` for one `machine`.
  - The machine opens one outbound socket and registers its name and public key; each device socket becomes a numbered channel on it (binary frames carry a 4-byte channel prefix on the machine side, none on the device side). The relay forwards those bytes untouched; they are the e2e session's ciphertext.
  - The relay stores per account the machine registry and the signed membership records (`GET` / `POST /v1/members`; a `{ type: 'members' }` control frame tells online machines they changed). It holds public keys and signatures only, never a private key, so it can't sign a record (Pairing, below). No thread content.
  - GAP: devices authenticate with the `Authorization` header, which Mochi's main process can set; a browser (the phone PWA) can't on a WebSocket and will need a short-lived ticket sent in the first frame.

## Pairing (built)

Trust once, shared by all: a computer joins your computers through any one of them, and from then on reaches all of them, as a machine and as a device, and they reach it, with no more prompts. Code: `electron/remote/members.ts` (records and trust), `pairing.ts` (the join prompt), `index.ts` (`join`, `removeMember`, `absorb`).

- **Join.** On the new computer: sign in, Settings › Remote access › "Join your computers", pick any online computer of yours. Both screens show the six-digit `pairingCode`; you approve on the one you picked. Then each vouches for the other: the approver signs a member record for the new key, the new computer signs one for the approver (it chose that key, and the code matched).
- **Records.** `member`: `{ deviceId, publicKey, machineId?, name, kind, addedBy, addedAt, signature }`, Ed25519 over a fixed field order, signed with the `addedBy` computer's device key; `deviceId` must be the one the key derives. `removal`: `{ deviceId, removedBy, removedAt, signature }`. A computer's record for itself adds no trust; it says what it is called and its relay id (`machineId`), so the others can follow it.
- **Who a computer trusts.** Starting from its own key: every key a trusted signer vouched for, repeatedly (a chain A→B→C is accepted by A). Records with a bad signature, or from a signer it doesn't trust, count for nothing. Every computer then signs a record of its own for each member it trusts, so no member depends on one voucher. That vouch keeps the date it was first vouched for: a computer that hadn't heard of a removal yet can't undo it.
- **First computer.** Nothing vouches for it: it trusts its own key and signs its own record. The second computer to join vouches for it.
- **Spread.** Each change goes to the relay (`POST /v1/members`, kept per kind, subject and signer, newest wins) and to every device connected to this computer (a `members` frame); `hello` and `welcome` carry each side's records on every connection, LAN or relay. A computer fetches the relay's records at launch, on sign-in, when the relay says they changed, when an unknown key arrives through it, when a machine refuses it, and when Settings lists your computers: an offline one catches up when it next connects.
- **Remove.** Any member can remove any other: a signed removal, spread the same way. It applies over records about that computer older than it, from anyone but itself, unless its signer was removed first; wherever it arrives, that computer's connections end, its follower stops, and it leaves the relay's list. The removed computer sees "Another of your computers removed this one" and trusts nobody until it joins again with a new approval, signed with a date after the removal.
- **Scopes stay per computer** (`devices.json`): a new member gets `DEFAULT_SCOPES` on each computer (terminal off), changed there in Settings. A removed computer that joins again starts from the defaults.
- **Migration.** On first start with membership, a computer signs a member record for every device and machine already in its `devices.json`, dated when it paired; scopes it set are kept.

**The security property.** A compromised relay can list, forward and drop, but can't add a member: every record needs a signature from a key some member already trusts, and the relay holds no member's private key. Replaying an old record doesn't outrank a newer removal; dropping records only delays them, since links carry them too. When a computer joins, the relay could hand either side a wrong key; the code on both screens is derived from both public keys, so a swapped key makes them differ, and you don't approve.

Known limits: a member's key is as strong as its computer. A compromised member can add members (remove it, and anything it added), or remove others, which then join again. The relay keeps the newest record per signer and subject, so anyone signed in to the account could overwrite one with a newer bogus one; computers ignore it and their own copies still spread over links (GAP: verify signatures in the Worker with WebCrypto Ed25519 to stop that).

## Platforms (proposed)

Mochi on macOS, Windows and Linux are equal peers: any of them can own threads and control the others. Today Mochi ships for macOS only: `package.json` › `build` has just a `mac` target and packs only `node-pty` `darwin-*` prebuilds, and the native helpers (haptics, `electron/native.ts`, screen-capture permission) are guarded by `process.platform` (verified).

- **Keep running with windows closed.** On Windows and Linux main quits when the last window closes (`electron/main.ts:23`, verified). Mochi now stays in the tray instead (Electron `Tray`, PR 0), so agents, schedules and remote devices keep working; Quit in the tray menu stops it. macOS already keeps running.
- **Secret storage.** `safeStorage` uses Keychain on macOS, DPAPI on Windows, libsecret or KWallet on Linux. On Linux with no secret service it falls back to a weak backend (believed; `safeStorage.getSelectedStorageBackend()`, not verified). Then Mochi keeps the refresh token and device key in memory only and says sign-in won't survive a restart, rather than writing them weakly protected.
- **Sign-in redirect.** Loopback works the same on all three; a custom scheme needs per-OS registration (Windows registry through `setAsDefaultProtocolClient`, a Linux `.desktop` file), one more reason for loopback.
- **LAN.** Windows Defender Firewall asks the first time Mochi listens beyond loopback (believed, not verified); Settings › Devices says so before turning it on.
- **Paths.** Commands carry thread ids and worktree-relative paths; the owning machine resolves them. A client never builds an absolute path for another OS.
- **Names.** "Runs on this Mac" (`src/ThreadView.tsx:315`, verified) and SETTINGS.md's "This Mac" become the machine's name, editable in Settings › Devices, defaulting to the OS host name.

## What syncs (built)

| Data | Where it lives | Reaches devices |
|---|---|---|
| Threads, activity, goals, Queue, usage, PR status | the owning machine's store | streamed live; changed only through commands |
| File contents, diffs, terminal output | the worktree | streamed on demand with `code` / `terminal` scope |
| Settings that aren't tied to one machine (notifications, defaults for new threads, models and starred models, Simplify, goals and drift, git conventions; `isSharedSetting` in `src/settings/catalog.ts`) | each machine | a change is written to each paired computer that's online; one that missed it is offered this computer's values above Settings |
| Pins | each machine, for its own threads, with an order key | one Pinned list across machines, sorted by key; moving a pin writes one key, on its own machine |
| Machine-specific settings (paths, shell, worktrees folder, harness paths, accounts and profiles' config files) | that machine | editable remotely with `manage`, never synced to another machine |
| Provider credentials, API keys, gh tokens, Clerk tokens, device private keys | keychain / `safeStorage` | never |
| Replay recordings, checkpoints | the machine | replay plays on a device through the stream; files never leave |

- Nothing about your settings or pins is stored in the cloud: each computer keeps its own and the others write to it, so the relay still holds only the machine registry and the signed membership records.
  - **Settings.** A shared row changed in Settings (or the settings widget) is saved here, then written to every paired computer that's online and lets this one `manage` it, through the same `setting` command a device uses; one that refuses or fails is named in one toast. Opening Settings reads each online computer's values (`settings`) and, where shared ones differ, shows "<computer> has different settings" with "Use this computer's" (`SharedSettingsNotice`). Appearance stays with each screen; paths, shell, keys, access and Devices with each computer.
  - **Pins.** Each pin has an order key (`pinOrder`): the time it was pinned, or the midpoint of its neighbours after a drag; a pin from before keys sorts by its Orbit slot. The sidebar's Pinned list holds every computer's pins in key order, another computer's marked by its device icon; dropping one writes its new key to the computer that owns it (`pin-at` here, the `pin` command with `order` there). Orbit, its number keys and the pinned pager stay per computer, five pins each.
- Devices keep an encrypted cache of the last snapshot so the app opens instantly and reads offline.

## End-to-end encryption (proposed)

- **libsodium** (`libsodium-wrappers`, which runs in Electron and later in the phone PWA): `crypto_kx` key exchange from each side's static key plus fresh ephemeral keys, then `secretstream` per connection. One vetted construction beats hand-assembling ECDH, HKDF, AES-GCM and nonce handling from WebCrypto on a trust boundary.
- **Device keys** are generated on the device and never leave it: `safeStorage` on computers; the PWA later wraps its key with a non-extractable WebCrypto key in IndexedDB.
- **Approval on a computer's screen.** A new computer is accepted only after "Let <computer> join?" on one of yours, also when it arrives through the relay; the rest accept it from that computer's signed record (Pairing). A compromised relay can forward and drop frames, not read or add.
- The same layer runs on LAN, Tailscale and the relay: one code path.
- TLS-only to the relay (relay can read threads): rejected.

## Conflicts (proposed)

- **One writer per thread.** The machine applies commands in arrival order, the same order the UI's own actions use.
- **Answering a Queue item:** the first answer wins. A later answer for the same `requestId` gets "Already answered on <device>", and the card disappears everywhere through the stream.
- **Messages from two devices** both land, in arrival order, through the existing outbox (`src/chat/outbox.ts`, verified to exist).
- **Every command carries an id.** The machine keeps recent ids, so a resend after a dropped connection runs once (T3's receipts, smaller).
- **Two devices editing the same thing** (goal text, title, a setting on the machine): applied in arrival order, last write wins; the loser sees the new value arrive through the stream. Goal edits keep their existing revision history, so nothing is lost.
- **Shared settings between machines:** each change is written where it was made and to every computer online then, so the last write wins on each. A computer that was offline shows as different next time Settings opens, and you pick which values win.

## Offline (proposed)

- **No account, no network:** Mochi on one machine works exactly as today. Nothing here runs until you sign in and turn on Settings › Devices.
- **Device can't reach the machine:** the device shows the cached snapshot with "<machine> offline since <time>" and disables actions. Drafts stay in the composer. Nothing queues to send later, because sending later could spend usage unasked (the same rule as `pauseQueue` on restart, verified in `src/store/persist.ts`).
- **Relay down:** already-paired devices on the LAN or Tailscale keep working from the keys they hold; new pairing waits for the relay, and remote devices see "offline".
- **Machine asleep:** agents pause with the machine, as today. Keep-awake while threads run is a separate checklist item if wanted.

## Hosting and cost (proposed)

- **Relay:** a Cloudflare Worker plus one Durable Object per machine, holding hibernatable WebSockets. T3 runs the same shape (source, `infra/relay`). Not verified: current Workers and Durable Objects pricing. Believed to be about $5/month on the paid plan, with idle hibernated sockets costing little. Check before PR 2.
- **Self-host:** the same Worker deploys to your own Cloudflare account, with the relay URL set in Settings. Pairing always needs a relay (hosted or self-hosted), since the account's device list lives there; traffic itself can stay on the LAN or Tailscale.
- No client hosting: the only client for now is Mochi on another computer.

## Clients

- **Another computer, first and only for now.** Mochi gets a third host implementation, `src/host/remote`, next to `desktop` and `web` (verified layout, `src/host/`), speaking the device protocol instead of IPC. A machine shows paired machines' threads and Queue merged with its own, each tagged with its machine, using the existing UI.
- **Phone, later and separately designed:** a PWA (the web build on `src/host/remote`, Add to Home Screen, Web Push). Because the protocol, scopes, encryption and relay are client-agnostic, it adds screens and push, not logic. No native app planned.

## PRs, in order

Each PR is its own worktree session, per SESSIONS.md, verified in both themes where it has UI. PRs 1–4 ship together: nothing reaches users before encryption.

0. **`platforms`** ([#92](https://github.com/frstycodes/mochi/pull/92)): Windows (NSIS) and Linux (AppImage) builds, `node-pty` per platform, CI packaging on all three, shells / `.cmd` shims / process-tree kills through `electron/platform.ts`, tray keep-alive (agents and schedules keep running with no window), platform-neutral copy. Split out: the custom title bar off macOS, the Ports tab on Windows (no `lsof`), the Windows icon badge. Machine names move to `remote-server`, where they're first needed.
1. **`account`**: Clerk sign-in in main (PKCE, system browser, `safeStorage`), `host.account`, the sidebar account menu; first verify redirect URIs and the revoke endpoint.
2. **`relay`**: built in `infra/relay` (Worker, Durable Objects, Clerk JWT check with jose, machine registry, channel forwarding, self-hostable). The machine's outbound connection and device-key auth land with pairing in `remote-server` follow-ups.
3. **`remote-server`**: `electron/remote/`: WebSocket server, protocol, scopes, pairing through the account's device list, snapshot plus sequenced action stream from `recordAction`, command bridge to the renderer, hidden window keeping the renderer alive with windows closed, direct LAN/Tailscale route tried before the relay. Settings › Devices. Tests: sequencing and replay, first answer wins, scope refusal, duplicate command id. Pairing (built): `pairing.ts`, `registry.ts`, `relayClient.ts`, Settings › Devices with paired devices and your other computers, the approval prompt.
4. **`e2e`**: libsodium handshake and framing, device approval on the owning machine, tampered and replayed frames rejected (test).
5. **`remote-commands`**: the full command set for `operate`, `manage`, `code` and `terminal`, each routed through the same code the machine's UI uses (ship flow still asks before push and PR). Built (first half): `operate` (send, answer, interrupt, fork, hand off) and `manage` (start a thread, rename, edit the goal, pin, settle, schedules, commit, push, open a PR), each dispatching the store action or host call the UI uses (`src/remote/commands.ts`); scopes editable per device. Built (second half):
   - `read`: `catalog` lists the machine's projects (refs a device sends back as is, never reads as paths) and each harness's models and defaults, so the new-thread composer starts a thread there in a project with a model; `create` refuses a project the machine didn't list.
   - `code`: diff (branch or uncommitted), checkpoint diff, stage / unstage / revert, line notes, the file list (first 10,000) and read-only file contents (text up to 512K characters), through the same host calls as the Changes and Files tabs, in the thread's folder as the machine resolves it. Paths are relative, posix, no `..` (refused in `protocol.ts` before main's own check). A result over 8 MB is refused with its size.
   - `terminal`: a shell the machine opens for the device in the thread's folder (`src/remote/terminals.ts`), apart from the machine's own terminal tabs; the device types and polls output from an offset. A shell nobody read for a minute (the device reloaded or left) closes, and settling the thread kills it.
   - `operate`: rewind (chat or files, the same worktree-first path as the message bar) and side chat (asked on the machine, answered into its store, streamed back).
   - `manage`: delete (the worktree stays on disk) and Settings rows that stay on the machine (prefs, quiet hours, main's settings); Devices, accounts, profiles, the theme and the demo switch only change on the machine itself.
   - Another computer's thread opens Changes (with each saved checkpoint's diff), Files, Terminal and Side chat as panes beside its chat, each behind its scope, and copy, rewind and fork under its messages. Paths in its transcript open its Files pane at the line, web links your browser. Side chats come with the snapshot for a device with `code`, since they quote diffs and files.
   - Settings shows another computer's: a picker in its toolbar switches each page to the rows that computer lets this one change, with the same controls.
6. **`multi-machine`**: a machine lists paired machines' threads and Queue with its own and acts on them; "Runs on" lists them. Built:
   - `electron/remote/client.ts` follows each paired machine from main (the device key and the account token stay there): its LAN or Tailscale addresses first, as its `welcome` last listed them, then the relay; `hello` with `resume`; WebSocket pings on the LAN, text `ping` through the relay; backoff to 30 s. A device reconnecting on its own pairs with `isReturning`, so a machine that removed it refuses instead of asking its user again, and the device stops retrying. Commands fail at once while offline; nothing queues.
   - The renderer mirrors each machine (`src/remote/mirror.ts`): the snapshot through `mirrorState`, then every action through the store's own root reducer. The machine's local UI actions (layout, panes) land in the mirror's own layout slices and change nothing a device reads, so the stream sends them unfiltered. The machine's clock tick is streamed (not recorded for replay), so entries keep the same times.
   - The sidebar has a group per machine, the Queue a section per machine with its approvals and questions, and its threads open over the app like a replay: the transcript read-only, a message box, Stop, Settle, Commit, Push and Open pull request (push and the PR ask here first). Shared components run inside `RemoteScope`, which turns their store actions into commands (`src/remote/actions.ts`).
   - Each machine's last snapshot is cached encrypted with `safeStorage` (`electron/remote/cache.ts`; nothing is written on weak storage), so its threads show at launch and read offline, with "Offline since" from when the cache was last written. Settled threads fold under each machine like this computer's own. Each side names its kind (`mac`, `windows`, `linux`; `phone` later) in the pairing frame and `welcome`, kept with paired devices and machines for their icons; a machine's presence shows as a dot online and its last-seen age offline. A thread started on another computer takes images and the model, effort, speed and permissions picked; worktree or folder follows the shared default.
   - `src/host/remote` as a whole host is the phone PWA's job: on a computer the transport has to live in main.
7. **`sync`** (built): shared settings written to each paired computer and offered back where they drifted; one Pinned list across computers by order key. No account copy: nothing about settings or pins is stored in the cloud.
8. **`membership`** (built): trust once, shared by all (Pairing). Signed member and removal records (`members.ts`), stored by the relay in the account's Durable Object (`/v1/members`) and carried in `hello`, `welcome` and `members` frames; every computer vouches for each member it trusts; devices and followed machines follow the members; existing pairings migrate on first start. Settings › Remote access lists "Your computers" (scopes, Remove) and "Join your computers". Tests: a trusted signer's record accepted, an unknown or tampered one refused, A→B→C accepted by A, removal ends trust and a later approval restores it, a late vouch can't undo a removal, the relay can't forge a member.

Later, its own design pass: the phone PWA and push.

## Decisions (approved 2026-10-13)

- Account required for any pairing; one machine alone needs none.
- Hosted relay on the user's own Cloudflare account and domain; self-host stays possible.
- Every scope available remotely; `terminal` off by default for new devices.
- Settings and pins sync between machines.
- macOS, Windows and Linux as equal peers; computer-to-computer first, phone PWA later, no native app.
