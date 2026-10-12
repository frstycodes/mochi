import type { Provider, Thread } from '../model.ts';

export const EFFORTS = ['Low', 'Medium', 'High', 'Extra high'] as const;
export type Effort = (typeof EFFORTS)[number];

export const ACCESS = ['Ask first', 'Auto edit', 'Full access'] as const;
export type Access = (typeof ACCESS)[number];

/** What the composer's model, effort and permissions menus chose for a thread. GAP: an agent reads them at start only; a change mid-run applies at its next start (the API-key restart). */
export interface ThreadControls {
  model: string;
  effort: Effort;
  access: Access;
}

export const DEFAULT_CONTROLS = {
  claude: { model: 'opus-5.5', effort: 'High', access: 'Auto edit' },
  codex: { model: 'gpt-5.5-codex', effort: 'High', access: 'Auto edit' },
} satisfies Record<Provider, ThreadControls>;

export function controlsOf(thread: Thread): ThreadControls {
  return thread.controls ?? DEFAULT_CONTROLS[thread.providers[0]];
}

// GAP: the composer's catalog is fake (ModelControls.tsx). Claude's ids map to real SDK ids; Codex models map to nothing,
// so Codex runs the user's configured default until the catalog comes from app-server.
const PROVIDER_MODELS: Record<string, string> = { 'opus-5.5': 'claude-opus-5-5', 'sonnet-5.5': 'claude-sonnet-5-5', 'haiku-5.5': 'claude-haiku-5-5' };

const EFFORT_LEVELS = { Low: 'low', Medium: 'medium', High: 'high', 'Extra high': 'xhigh' } satisfies Record<Effort, string>;

// Claude's adapter refuses `bypassPermissions`, so Full access is its `auto` mode; Codex's adapter maps these names onto its policies.
const PERMISSION_MODES = {
  claude: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'auto' },
  codex: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'bypassPermissions' },
} satisfies Record<Provider, Record<Access, string>>;

export function agentOptions(controls: ThreadControls, provider: Provider) {
  return { model: PROVIDER_MODELS[controls.model], effort: EFFORT_LEVELS[controls.effort], permissionMode: PERMISSION_MODES[provider][controls.access] };
}
