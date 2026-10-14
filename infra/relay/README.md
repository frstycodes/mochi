# Mochi relay

Lets a Mochi machine be reached from anywhere (DEVICES.md › Transport). A Cloudflare Worker with one Durable Object per
account: it checks the account's Clerk token, lists the account's machines, and forwards end-to-end encrypted frames
between a device and its machine. It can't read what it forwards.

## Deploy

1. In `wrangler.jsonc`, `CLERK_ISSUER` and `CLERK_CLIENT_ID` name the Clerk instance and Mochi's OAuth client (set for the development instance); add a `routes` entry for your domain.
2. `pnpm --dir infra/relay exec wrangler login`, then `pnpm --dir infra/relay deploy`.

Self-hosting is the same Worker on your own Cloudflare account; Mochi takes the relay URL in Settings › Devices.

## Run locally

The `mochi-relay` entry in `.claude/launch.json` runs `wrangler dev` on port 8787 against a Clerk issuer at
`http://127.0.0.1:8799` (a JWKS server you start for testing) and client id `mochi_client`.
