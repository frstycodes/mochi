import { Schema } from 'effect';

// A leaf: `backend.ts` (and so `relay.ts`) names scopes and capabilities without importing `capabilities.ts`, which imports `relay.ts`.

/**
 * The remote member scopes, and `local`: everything only this computer's own windows and main may do. A paired device's
 * token never carries `local`. A token carries some of them; every RPC needs one (`scopeOf`).
 */
export const AuthScope = Schema.Literals([
  'read',
  'operate',
  'manage',
  'code',
  'terminal',
  'local',
]);
export type AuthScope = typeof AuthScope.Type;

/**
 * What a client can do for Core that Core can't: show OS notifications, own browser-pane views, reach `safeStorage`,
 * drive simulators. `host` is every `host.*` namespace whose handler still lives in main; it shrinks as they move into Core.
 * `remote` runs a device's command (`device.command`) in the window that owns the store, until Core owns it.
 * `reactor` runs the reactor's commands (`packages/core/src/reactor/commands.ts`) in the window that owns the store, until Core owns it.
 * `main` is what Core's agents ask of main (`MainForAgents` in packages/core/src/agents/main.ts), not a `host.*` namespace.
 */
export const CapabilityName = Schema.Literals([
  'notify',
  'browserView',
  'secureStorage',
  'sim',
  'host',
  'remote',
  'metrics',
  'main',
  'reactor',
]);
export type CapabilityName = typeof CapabilityName.Type;
