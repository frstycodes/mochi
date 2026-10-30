# Accounts and devices

How Mochi gets an account (Clerk) and lets your other machines follow and steer threads that run on any one of them. A phone (PWA) comes later as one more client of the same logic. This covers CHECKLIST §6 "Mobile companion / Remote control". Read it with [RUNTIME.md](RUNTIME.md) (agents run in main, and the Auth section) and [SETTINGS.md](SETTINGS.md).

Status labels: **verified** = read in this repo; **source** = read in T3 Code's source at `pingdotgg/t3code@6524a8d` (2026-10-13), paths relative to that repo; **docs** = read in Clerk's docs on 2026-10-13 (links inline), not yet run here; **proposed** = designed here, approved 2026-10-13 (see Decisions); **not verified** = belief, check before building on it.

## Summary (proposed)

- **The machine that owns the worktree runs the agents, always.** Other devices are full remote controls: everything you do in a thread on the machine, you can do from another computer (macOS, Windows or Linux), executed on the owning machine. Devices never run agents, never hold provider credentials, and never touch the worktree directly.
- **The machine is the server, and the single writer.** Devices connect to it over a WebSocket: directly on the LAN or Tailscale when they can reach it, through Mochi's relay otherwise. No cloud database holds your threads.
- **A Mochi account is identity for the relay and your device list.** It is not a Claude or Codex login. Mochi still never logs in to Claude or Codex, and never handles their credentials (RUNTIME.md › Auth, unchanged).
- **One machine needs no account.** Mochi on a single machine works fully offline and local-only, as today. Using more than one device needs an account: pairing, the device list, reach from anywhere and settings sync all go through it.
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

| Scope      | What it allows                                                                                                                                                                                                                    | Default for a new device                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `read`     | threads, activity, goals, report cards, Queue, usage, PR status, schedules                                                                                                                                                        | on                                         |
| `operate`  | answer approvals and questions, send messages and attachments, interrupt, stop, resume, rewind, fork, hand off, side chat                                                                                                         | on                                         |
| `manage`   | start threads (pick machine, project, agent, model, permissions), edit goals, rename, pin, archive, delete, schedules, commit, push, open a PR (as the machine's gh login, asked first as on the machine), the machine's settings | on                                         |
| `code`     | file tree, file contents, diffs, Changes tab actions (stage, revert, line comments), checkpoint diffs                                                                                                                             | on                                         |
| `terminal` | open and type in the thread's terminals                                                                                                                                                                                           | off: a terminal is a shell on your machine |

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
  - The relay closes the machine's socket on a frame over 1 MB, so a bigger message (a snapshot, a long action, a diff) goes as encrypted pieces of 512 KB and is put back together on the other side; a peer that sends more than 64 MB in one message is cut off. Protocol version 7 (6 before `welcome` carried the backend descriptor in place of `machineName`, `machineKind` and `scopes`; 5 before the thread-action scopes; 4 before the composer's `send` fields and `thread-action`; 2 before project ids).
  - The machine's relay socket pings every 30 s; the relay's runtime answers without waking the Durable Object, and a missed pong drops and redials the socket. Found live: an idle socket died without either end seeing a close.
  - Clerk appears to rotate refresh tokens and reject reuse (seen when one session was copied into two profiles; not documented). Mochi keeps whichever refresh token Clerk returns, and a rejected refresh signs the account out on that computer.
- **Relay, only when signed in and "Reach this computer from anywhere" is on.**
  - Built (`infra/relay`): a Cloudflare Worker, one Durable Object per account (named by the Clerk user id), WebSockets on the hibernation API. Every route takes the account's Clerk access token in `Authorization`, never in the URL. `GET /v1/machines` lists the account's machines (id, name, public key, online), `DELETE /v1/machines/:id` forgets one, `GET /v1/connect` opens a socket as `role=machine` or `role=device` for one `machine`.
  - The machine opens one outbound socket and registers its name and public key; each device socket becomes a numbered channel on it (binary frames carry a 4-byte channel prefix on the machine side, none on the device side). The relay forwards those bytes untouched; they are the e2e session's ciphertext.
  - The relay stores per account the machine registry and the signed membership records (`GET` / `POST /v1/members`; a `{ type: 'members' }` control frame tells online machines they changed). It holds public keys and signatures only, never a private key, so it can't sign a record (Pairing, below). No thread content.
  - GAP: devices authenticate with the `Authorization` header, which Mochi's main process can set; a browser (the phone PWA) can't on a WebSocket and will need a short-lived ticket sent in the first frame.

## Pairing (built)

Trust once, shared by all: a computer joins your computers through any one of them, and from then on reaches all of them, as a machine and as a device, and they reach it, with no more prompts. Code, in Core: `packages/core/src/remote/members.ts` (records and trust), `pairing.ts` (the join prompt), `service.ts` (`join`, `joinAlone`, `removeMember`, `absorb`), `registry.ts` (`devices.json`). Main follows the other computers as a device (`electron/remote/client.ts`).

- **Join.** On the new computer: sign in, Settings › Remote access › "Join your computers", pick any online computer of yours. Both screens show the six-digit `pairingCode`; you approve on the one you picked. Then each vouches for the other: the approver signs a member record for the new key, the new computer signs one for the approver (it chose that key, and the code matched).
- **Join with no screen** (`mochi serve`). Signed in, it turns on remote access through the relay and, while it trusts nobody, joins through every online computer of yours at once (`joinAlone`): each shows "Let <name> join?" with its code, and the terminal prints `Approve "<name>" on <computer>: 123 456` for each. The first that allows it wins; closing the other channels withdraws their prompts (`secureAsMachine` aborts `approve`, and Core sends the request again with its deadline now). `mochi login` in another shell follows the same join over the `local` stream `remote.joinAlone`, finding the running Core through `<data>/serve.json` (pid, socket URL, token, and under TLS the certificate's path, which it pins; 0600). Being on the account is never enough: no computer joins without an approval on a member's screen. GAP: with no other computer online it fails and says to run `mochi login` again; it doesn't wait for one to come online.
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

| Data                                                                                                                                                                                                      | Where it lives              | Reaches devices                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Threads, activity, goals, Queue, usage, PR status                                                                                                                                                         | the owning machine's store  | streamed live; changed only through commands                                                                                   |
| File contents, diffs, terminal output                                                                                                                                                                     | the worktree                | streamed on demand with `code` / `terminal` scope                                                                              |
| Settings that aren't tied to one machine (notifications, defaults for new threads, models and starred models, Simplify, goals and drift, git conventions; `isSharedSetting` in `src/settings/catalog.ts`) | each machine                | a change is written to each paired computer that's online; one that missed it is offered this computer's values above Settings |
| Pins                                                                                                                                                                                                      | each screen, for any thread | never: each computer has its own Pinned list                                                                                   |
| Machine-specific settings (paths, shell, worktrees folder, harness paths, accounts and profiles' config files)                                                                                            | that machine                | editable remotely with `manage`, never synced to another machine                                                               |
| Provider credentials, API keys, gh tokens, Clerk tokens, device private keys                                                                                                                              | keychain / `safeStorage`    | never                                                                                                                          |
| Replay recordings, checkpoints                                                                                                                                                                            | the machine                 | replay plays on a device through the stream; files never leave                                                                 |

- Nothing about your settings is stored in the cloud: each computer keeps its own and the others write to it, so the relay still holds only the machine registry and the signed membership records.
  - **Settings.** A shared row changed in Settings (or the settings widget) is saved here, then written to every paired computer that's online and lets this one `manage` it, through the same `setting` command a device uses; one that refuses or fails is named in one toast. Opening Settings reads each online computer's values (`settings`) and, where shared ones differ, shows "<computer> has different settings" with "Use this computer's" (`SharedSettingsNotice`). Appearance stays with each screen; paths, shell, keys, access and Devices with each computer.
  - **Pins.** Each screen keeps its own Pinned list and can pin any thread, this computer's or another's; pins never reach another computer. A pin on this computer's thread stays on the thread (`orbitSlot`, `pinOrder`); one on another computer's is kept here by its machine-aware id (`src/remote/pins.ts`), its order key sorting among this computer's own (`mergeThreads` in `src/remote/merged.ts`). The sidebar lists every computer's threads as one list, each marked by its computer's device icon. Pinned holds five; mod 1–5 follows its order. Orbit and the pinned pager still show this computer's pins only. The `pin` command stays for devices on an older build.
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
- **Machine asleep:** agents pause with the machine. To keep that rare, while "Let devices control this computer" is on and a thread is working or a device is connected, the machine holds Electron's `powerSaveBlocker` (`prevent-app-suspension`) and releases it otherwise (`electron/remote/keepAwake.ts`, built). Settings › Devices › "Keep this computer awake" turns it off; on battery the row says it drains the charge. It stops idle sleep only: closing a laptop's lid or choosing Sleep still sleeps it (not verified per OS).
- **Waking a sleeping machine:** not possible through the relay. Wake-on-LAN is a broadcast "magic packet" on the machine's own network segment; the relay only forwards traffic to a machine that keeps its own outbound connection open, and a sleeping one has none. A device on the same LAN could send one, but the NIC, firmware and OS each have to allow it, and nothing here builds that.

## Hosting and cost (proposed)

- **Relay:** a Cloudflare Worker plus one Durable Object per machine, holding hibernatable WebSockets. T3 runs the same shape (source, `infra/relay`). Not verified: current Workers and Durable Objects pricing. Believed to be about $5/month on the paid plan, with idle hibernated sockets costing little. Check before PR 2.
- **Self-host:** the same Worker deploys to your own Cloudflare account, with the relay URL set in Settings. Pairing always needs a relay (hosted or self-hosted), since the account's device list lives there; traffic itself can stay on the LAN or Tailscale.
- No client hosting: the only client for now is Mochi on another computer.

## Everything is a backend (proposed 2026-10-28)

The app is an interface. It connects to any number of backends; each backend is a Core, and the computer you sit at is one of them, reached over loopback instead of LAN or relay. Each backend says who it is (name, kind, icon) and what it can do, and the interface shows that. The same split gives the web build and `mochi serve` for free: a browser is one more interface, a headless Core one more backend. This replaces "`src/host/remote` as a whole host is the phone PWA's job" (PR 6, below).

### Where it stands (verified 2026-10-28)

- **Core is already the backend for this computer.** It runs as main's utilityProcess, or alone as `mochi serve` (`packages/core/src/serve/serve.ts`, which also serves the page). It serves agents, schedules, git, projects, ports, usage and pty itself (`electron/ipc/index.ts`, `InCore`), the store as an event log with a `replica` stream (`packages/core/src/store/rpc.ts`), and fs, data and themes in part (`hosted.ts`). Every `host.*` call from a window goes to Core over its socket (`src/host/desktop/*.ts`).
- **Core serves the machine; main serves the shell.** Settings, library, the account and the machine side of remote access are Core's (PR 12, below), so a headless Core has all four. Core forwards `host` (windows, updates, pickers), `notify`, `browserView`, `sim`, `secureStorage` (only where `safeStorage` can seal), `remote` (a device's command into the renderer), `metrics` and `main` to main (`mainCapabilities`, `electron/ipc/index.ts`). With no main, `browserView` is headless Chromium in Core.
- **Two APIs, not one.** A window's token holds every scope and calls any RPC. A paired device calls `device.command` (a `RemoteCommand` per type) and reads a mirror stream; every other RPC is `local` and closed to it (`scopeOf`, `packages/schema/src/capabilities.ts`). So the same action has two code paths: the RPC this computer's window calls, and the command another computer sends (`src/remote/commands.ts`, `threadOps.ts`).
- **The interface treats this computer as special.** It has a `replica` for this computer and a `mirror` per other machine (`src/store/replica.ts`, `src/remote/mirror.ts`), joined by `hybridState` (`src/remote/threadScope.ts`). Panes choose between `LocalIo` and `RemoteIo` (`src/remote/threadIo.ts`), and shared views run inside `RemoteScope`, which turns store actions into commands. 66 `origin.kind` / `kind === 'remote'` checks are spread across 15 files.
- **Other machines are dialed by main, not by the interface** (`electron/remote/client.ts`). The device key lives in Core's `Keys`; main fetches it once over `remote.deviceKey` and the relay token over `account.relayToken`, both refused to windows and devices.
- **Name and kind arrive only from other machines,** in the pairing `welcome` frame. This computer's name and icon come from somewhere else.
- **`mochi serve` is a special case in the page:** `servedNamespace` (`src/host/web/served.ts`) proxies `host.*` to Core and drops pushes meant for a window. Its only sign-in is a `#token=` URL fragment, with a browser prompt as the fallback.

### The split (proposed)

- **Shell:** what the interface runs inside. That's Electron or a browser. It owns windows, OS notifications, the dock badge, app updates, and the shell's own device key and account session. It renders the browser pane and the simulator but doesn't own them.
- **Backend:** one Core on one machine. It owns threads and the store, agents, provider logins, git, files, terminals, ports, schedules, projects, that machine's settings, library (skills, commands, connectors), pairing and members, and its relay registration. Whatever a backend needs an OS for that Core can't do alone (the browser pane its agents drive, the simulator, the keychain) is a capability the backend reports it has or lacks.
- **Rule:** if it would still be true with the interface closed, it belongs to the backend.

### Backend descriptor

Every backend answers `backend.info` and pushes it again whenever it changes:

- `id`, `name`, `kind` (`mac`, `windows`, `linux`, `server`), app and protocol version
- `capabilities`: `browserView`, `sim`, `notify`, `keychain`, … (what it can do now; headless has none of the shell-backed ones)
- `scopes`: what this connection may do

The interface draws every machine's icon, name and presence from this, its own computer included. `welcome` carries the same descriptor.

### One protocol

- Every Core RPC gets a scope (`read`, `operate`, `manage`, `code`, `terminal`; `local` only for what never leaves the machine, like `windows`). A window's loopback token holds every scope, and a device's holds what it was granted. The same middleware (`ScopeAuthorization`) decides for both.
- Devices read the same `replica` stream the window reads, filtered per scope as `visibleItem` already does (`packages/core/src/remote/visible.ts`). The mirror frames go away.
- `device.command` becomes a thin adapter onto those RPCs while the interface moves over, then is removed. Protocol version 8 (7 is the descriptor in `welcome`).

### One interface path

- **`Backends`:** a registry in the interface with one entry per connected Core: descriptor, transport, replica and `call`. This computer's Core is just the first entry, not a special case.
- **Thread routing:** a thread belongs to exactly one backend (`backendId`, kept with its id the way `src/remote/ids.ts` does now). Everything about a thread goes through `backendOf(thread)`: panes, composer, Changes, Files, Terminal, PR tab, schedules, settings. This removes `ThreadIo`, `RemoteScope`, `hybridState`, `ThreadCalls` and `mirror`.
- **Merged views** (sidebar, Queue, palette, pins) list across `Backends` grouped by descriptor, as they group by machine now.
- **Shell features** (`windows`, `notify`, `updates`) stay on `host.*`, served by the shell; nothing in them names a backend.

### Transports

| Transport                           | Used by                                                      | Encryption                               |
| ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Loopback WebSocket + token          | desktop's own Core; `mochi serve` opened on the same machine | none (loopback)                          |
| https/wss + token                   | `mochi serve --tls-cert/--tls-key` beyond loopback           | TLS                                      |
| Direct WebSocket (LAN or Tailscale) | any shell to a paired machine                                | libsodium session (`crypto/session.ts`)  |
| Relay                               | any shell to a paired machine, from anywhere                 | libsodium session; relay sees ciphertext |

- **Every connection that leaves the machine is end-to-end encrypted or TLS.** A token never crosses a network in plaintext: `mochi serve` binds loopback unless it is given `--tls-cert` and `--tls-key`, and refuses any other `--host` (there is no `MOCHI_SERVE_HOST` fallback) with a pointer to pairing (Settings › Remote access).
- **On Electron,** the device key stays in main (`safeStorage`). Main runs the handshake and gives the renderer an already-secured channel per backend, as a `MessagePort`. The renderer never sees the key.
- **In a browser,** the handshake runs in the page. The key is a non-extractable WebCrypto Ed25519 key in IndexedDB, and the relay is reached with a short-lived ticket in the first frame, since a browser can't set `Authorization` on a WebSocket (the GAP under Transport).

### Headless `mochi serve`

- A backend with no shell capabilities. A browser opens its page and connects over a direct WebSocket with a token (loopback, or https/wss with `--tls-cert` and `--tls-key`), or a scoped device key once it signs in. Every connection that leaves the machine is end-to-end encrypted or TLS: `mochi serve --host <non-loopback>` without TLS is refused, pointing to pairing a computer or, once PR 15 lands, the browser shell, which runs the handshake in the page.
- **What it needs beyond today:**
  - settings, library, account and the machine side of remote access moving from main into Core (the PR `core-owns-machine`, below)
  - a key store for headless Core: the OS keychain where there is one, else a `0600` file in its data folder
  - a sign-in screen instead of `#token=`
  - the interface hiding what the descriptor lacks: no browser pane, no simulator, notifications only in the shell
- **Agents' browser (decided 2026-10-28):** headless Chromium inside Core. Core starts it the first time a Mochi browser tool runs, and serves `browserView` from it. Any interface shows its live screenshot, the same way it shows another computer's browser pane today. Chromium downloads on first use, not with `mochi serve`. A backend that can't run Chromium reports no `browserView`, and the browser tools answer "this computer has no browser" instead of failing.
- **Account (decided 2026-10-28): CLI sign-in, then pairing.**
  - `mochi login` runs Clerk's device-code flow: it prints a code and a URL, you approve it in any browser, and the session is kept in the backend's key store. `mochi serve` offers to run it on first start.
  - Once signed in, the backend registers with the relay, so it shows on every signed-in computer under "Join your computers".
  - Being on the same account doesn't make it trusted. Account access alone must not be enough to read your threads, and the relay can't vouch for anyone (Pairing, below). So approval is one click on any computer that's already trusted, with the six-digit code shown both there and in the CLI. After that, the backend is a member like any computer.
  - `mochi logout` signs out and removes it from the relay.

- **Windows (decided 2026-10-28): merged, with a machine filter.** Every window shows all backends, grouped by machine. A filter in the sidebar narrows a window to one or more machines, and "New window" can open one already filtered. Each window keeps its own filter, so you can keep a window just for a server next to one for everything. There is no separate per-backend window type.

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
   - `read`: `catalog` lists the machine's projects from its registry (SETTINGS.md › Projects) by id, never by path, and each harness's models and defaults, so the new-thread composer starts a thread there in a project with a model; `create` takes a project id and refuses one the machine didn't list. `projects` reads the registry itself (Settings › Projects for that computer).
   - `manage`: `add-project` (an empty repo in its projects folder, optionally published through its gh login) and `clone-project` (a git URL or GitHub `owner/repo`), run through the same calls as Add project on the machine; the machine picks the folder, a device never names one. A clone may take up to 15 minutes before the device gives up waiting. Protocol version 3.
   - Project identity across computers is the normalised origin (`normalizeOrigin` in `src/git/origin.ts`: scheme, user, port and `.git` stripped, host lowercased), which moving or cloning a thread to another computer can match on.
   - `code`: diff (branch or uncommitted), checkpoint diff, stage / unstage / revert, line notes, the file list (first 10,000) and read-only file contents (text up to 512K characters), through the same host calls as the Changes and Files tabs, in the thread's folder as the machine resolves it. Paths are relative, posix, no `..` (refused in `protocol.ts` before main's own check). A result over 8 MB is refused with its size.
   - `terminal`: a shell the machine opens for the device in the thread's folder (`src/remote/terminals.ts`), apart from the machine's own terminal tabs; the device types and polls output from an offset. A shell nobody read for a minute (the device reloaded or left) closes, and settling the thread kills it.
   - `operate`: rewind (chat or files, the same worktree-first path as the message bar) and side chat (asked on the machine, answered into its store, streamed back).
   - `manage`: delete (the worktree stays on disk) and Settings rows that stay on the machine (prefs, quiet hours, main's settings); Devices, accounts, profiles, the theme and the demo switch only change on the machine itself.
   - Thread ops (`src/remote/threadOps.ts`), each acting only on what that thread has: `read`: the PR on its branch (`pr-status`), worktree size, every trigger here without its runs (`schedules`, which a device re-reads each minute for its schedule badges and editor), what listens in its folder (`ports`); `code`: a PR's review page (`pr-review`) and a files rewind's preview; `manage`: the PR tab's comment, review, reply, resolve and merge (`pr`, on one of the thread's own PRs; a review thread must be that PR's), sync with base, `schedule-set` (the editor's draft; the folder and agent start resolve here), `attach-project` (a project here by id) and `port-kill` (only a pid listening in its folder). Clients reach them through `ThreadCalls` (`src/remote/threadCalls.ts`), picked by the thread's id.
   - Another computer's thread opens Changes (with each saved checkpoint's diff), Files, Terminal and Side chat as panes beside its chat, each behind its scope, and copy, rewind and fork under its messages. Paths in its transcript open its Files pane at the line, web links your browser. Side chats come with the snapshot for a device with `code`, since they quote diffs and files.
   - The composer on another computer's thread does what it does at home, run there: `send` carries the message as typed (images inline, never saved on the sending computer; references and typed skills, resolved there; `steers` or queued as the device's composer chose; `queuedId` for Send now on a queued one), and `thread-action` takes one of the thread's own store actions from a whitelist (`ThreadAction` in `packages/schema/src/relay.ts`), each behind its own scope (`THREAD_ACTION_SCOPES`): `operate` for controls, a provider switch, compact, the queue, resume on the same account and the agent's grant and proposal cards; `manage` for removing the goal, starting a proposed thread and Auto-fix or settle-when-merged on a PR. An action Core doesn't know needs a scope no device has. `unsteer` takes a steer back (or Send now) through that computer's agent; `setup-choice` answers a failed setup step. The model, slash and `@` menus read that computer's `catalog` (its models and its profile's commands and skills until the agent reports its own) and `files`; this computer's account limits and API key never show there.
   - Settings shows another computer's: a picker in its toolbar switches each page to the rows that computer lets this one change, with the same controls.
6. **`multi-machine`**: a machine lists paired machines' threads and Queue with its own and acts on them; "Runs on" lists them. Built:
   - `electron/remote/client.ts` follows each paired machine from main (the device key and the account token stay there): its LAN or Tailscale addresses first, as its `welcome` last listed them, then the relay; `hello` with `resume`; WebSocket pings on the LAN, text `ping` through the relay; backoff to 30 s. A device reconnecting on its own pairs with `isReturning`, so a machine that removed it refuses instead of asking its user again, and the device stops retrying. Commands fail at once while offline; nothing queues.
   - The renderer mirrors each machine (`src/remote/mirror.ts`): the snapshot through `mirrorState`, then every action through the store's own root reducer. The machine's local UI actions (layout, panes) land in the mirror's own layout slices and change nothing a device reads, so the stream sends them unfiltered. The machine's clock tick is streamed (not recorded for replay), so entries keep the same times.
   - The sidebar has a group per machine, the Queue a section per machine with its approvals and questions, and its threads open over the app like a replay: the transcript read-only, a message box, Stop, Settle, Commit, Push and Open pull request (push and the PR ask here first). Shared components run inside `RemoteScope`, which turns their store actions into commands (`src/remote/actions.ts`).
   - Each machine's last snapshot is cached encrypted with `safeStorage` (`electron/remote/cache.ts`; nothing is written on weak storage), so its threads show at launch and read offline, with "Offline since" from when the cache was last written. Settled threads fold under each machine like this computer's own. Each side names its kind (`mac`, `windows`, `linux`; `phone` later) in the pairing frame and `welcome`, kept with paired devices and machines for their icons; a machine's presence shows as a dot online and its last-seen age offline. A thread started on another computer takes images and the model, effort, speed and permissions picked; worktree or folder follows the shared default.
   - `src/host/remote` as a whole host is the phone PWA's job: on a computer the transport has to live in main.
7. **`sync`** (built): shared settings written to each paired computer and offered back where they drifted; pins stay on each screen. No account copy: nothing about settings is stored in the cloud.
8. **`membership`** (built): trust once, shared by all (Pairing). Signed member and removal records (`members.ts`), stored by the relay in the account's Durable Object (`/v1/members`) and carried in `hello`, `welcome` and `members` frames; every computer vouches for each member it trusts; devices and followed machines follow the members; existing pairings migrate on first start. Settings › Remote access lists "Your computers" (scopes, Remove) and "Join your computers". Tests: a trusted signer's record accepted, an unknown or tampered one refused, A→B→C accepted by A, removal ends trust and a later approval restores it, a late vouch can't undo a removal, the relay can't forge a member.
9. **`attention`** (built): keep-awake (Offline, above); alerts and read state across computers; the sidebar stays grouped by computer.
   - Alerts: a followed computer's thread that starts needing you (an approval or question, a failed turn, a finished turn, ready for review) shows the OS notification in the background and a toast in front, under the same Settings › Notifications switches and quiet hours as this computer's own, and counts in the dock badge. Clicking opens that thread (`openRemoteThread`). They come from the difference with a baseline kept per machine across launches (`src/notify/remote.ts`), never from the stream's actions, so a reconnect's snapshot or replayed actions never alert twice, and a turn that ended while this computer was away still alerts once. The first look at a machine only sets the baseline. Turn outcomes come from `live.turnEnd`, which the machine records at each turn's end. GAP: per-thread mute applies to this computer's threads only.
   - Read state: the computer that owns a thread owns its read state, `seenActivity` (activity entries seen) on the thread and `isSeen` on Queue cards. Opening a thread marks it and its asks read when it opens and when it closes; leaving the Queue marks the cards it showed. Another computer sends `seen` (operate scope; a device without it just leaves things unread there) and the change comes back on the stream like any action. Unread shows as a dot on sidebar rows and Queue cards.

Everything is a backend (above), in order. Each PR leaves the app working; old and new paths live side by side until 14 removes the old ones.

10. **`backend-info`** (built): `backend.info` RPC and push in Core (id, name, kind, versions, capabilities, scopes); `welcome` carries it. This computer's name and icon come from its own Core like every other machine's. Small, and it proves the descriptor before anything depends on it. Landed: `Backend.BackendInfo` (`packages/schema/src/backend.ts`: `id`, `name`, `kind`, `appVersion`, `protocolVersion`, `capabilities`, `scopes`); Core's `backend.info` (one answer) and `backend.watch` (now, then again on a rename or when a client starts or stops serving a capability), both scope `read`; `backend.identify` (scope `local`) is how main gives Core the id from `devices.json` and the name from Settings, re-sent after a Core restart. `capabilities` is the names `Capabilities.offered` holds, so headless answers `[]`. `mochi serve` says kind `server`, never the OS kind; the desktop's Core says `mac`, `windows` or `linux`. `welcome` carries `backend` (with the device's scopes) instead of `machineName`, `machineKind` and `scopes`: protocol 7. The window reads its own computer's name and icon from `backend.watch` (`useThisBackend`: Runs-on menu, Environment card) instead of sniffing the OS.
11. **`one-protocol`**: a scope on every Core RPC (`scopeOf` classifies tags, not just `device.command`); devices may call what their scopes allow and read the `replica` stream through `visibleItem`. `device.command` stays as an adapter onto the same handlers. Protocol version 6. Tests: each scope refused below it, a device's replica has no diffs without `code`, a `local` RPC refused to every device.
12. **`core-owns-machine`** (built): settings, library, the account and the machine side of remote access moved from main into Core; main keeps the shell. Shipped as slices:

- 12a ([#462](https://github.com/frstycodes/mochi/pull/462)): Core serves settings and the library, and has a key store, `Keys` (`packages/core/src/keys/keyStore.ts`): `<data>/keys/keys.json`, folder 0700, file 0600, each value sealed through the `secureStorage` capability when a client offers it and plain otherwise.
- 12b ([#464](https://github.com/frstycodes/mochi/pull/464)): the account in Core (`packages/core/src/account/`), kept in `Keys`; main's `account.json` moves over on first read. `mochi login` / `mochi logout` sign in by Clerk's device code (`packages/core/src/serve/login.ts`); `mochi serve` offers it on first start. `account.relayToken` is main's, for its followers.
- 12d ([#461](https://github.com/frstycodes/mochi/pull/461)): with no main serving `browserView`, Core serves it from headless Chromium (`packages/core/src/browser/headless.ts`, `Capabilities.serveLocally`). Chromium downloads into the data folder on first use; where it can't start, the answer is "this computer has no browser".
- 12c ([#469](https://github.com/frstycodes/mochi/pull/469)): the machine side of remote access in Core (`packages/core/src/remote/service.ts`, `host.ts`): settings, registry, membership, the server and the relay registration. The device key moved from main's `device-key` into `Keys` (`deviceKey`). Main keeps the follower client and its cache, keep-awake (Core calls `main.holdAwake`) and the hidden window, and fetches what it needs over main-only RPCs (`remote.deviceKey`, `remote.paired`, `remote.absorb`, `remote.noteWelcome`, `remote.shell`). A device command with no window open answers "No interface is open on this computer". A device's tunnel dials Core's own bound address, over `wss` with Core's certificate pinned when it serves TLS (`CoreEndpoint`, `remote/tunnel.ts`).
  - [#472](https://github.com/frstycodes/mochi/pull/472): no plaintext token beyond loopback. Every connection that leaves the machine is end-to-end encrypted (pairing) or TLS: `mochi serve` refuses a non-loopback `--host` without `--tls-cert`/`--tls-key`, and `MOCHI_SERVE_HOST` is gone.
- 12e ([#465](https://github.com/frstycodes/mochi/pull/465)): with no main, Core runs agents' `browser_*` tools on headless Chromium (`packages/core/src/browser/agentTools.ts`); they answer "This computer has no browser" when it can't start, and Mochi's other tools say they need the app. GAP: the served page's live-frame pane is PR 15's; Codex threads under `mochi serve` have no Mochi tools.
- 12c-2: a headless `mochi serve` joins your computers with one approval on a member, the code in both places (Pairing › Join with no screen). Main offers `secureStorage` only where `safeStorage` can seal, read once `app` is ready, so on Linux with `basic_text` the device key is kept plain in `Keys` and remote access starts (before, storing it failed). A new device key waits for main to connect, then is sealed if it offers `secureStorage`. Test: `packages/core/src/serve/e2e.test.ts` signs a headless Core in by device code against a mock Clerk, registers it with an in-process relay, has a second Core approve it with the matching code, checks both trust each other, changes a setting over the serve token and drives a page in headless Chromium (skipped when it isn't installed).

13. **`backends`**: the interface's `Backends` registry and transport interface. This computer's Core becomes entry one over loopback; other machines come through main as secured `MessagePort`s; one replica per backend. The sidebar, Queue, palette and pins read from it, with a machine filter per window; `mirror` stays behind it for now.
14. **`one-path`**: threads route through `backendOf(thread)`; `ThreadIo`, `RemoteScope`, `hybridState`, `ThreadCalls`, `mirror` and the `device.command` adapter are deleted. Large, so it ships in slices: composer and chat; Changes, Files and Terminal; PR tab and schedules; Settings for another computer. Each slice is verified on this computer's threads and another's.
15. **`browser-shell`**: the web build as a shell. The descriptor gates what the UI shows; handshake in the page with WebCrypto keys; relay tickets; a sign-in screen for `mochi serve` instead of `#token=`. `servedNamespace` goes away. The phone PWA is this plus screens and Web Push.

Later, its own design pass: the phone PWA and push.

## Decisions (approved 2026-10-13)

- Account required for any pairing; one machine alone needs none.
- Hosted relay on the user's own Cloudflare account and domain; self-host stays possible.
- Every scope available remotely; `terminal` off by default for new devices.
- Settings sync between machines.
- macOS, Windows and Linux as equal peers; computer-to-computer first, phone PWA later, no native app.
