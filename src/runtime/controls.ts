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

export interface ModelOption {
  id: string;
  harness: Provider;
  name: string;
  note: string;
  context: string;
  /** The id the harness takes; unset runs the harness's own configured default. */
  providerModel?: string;
}

// GAP: fake catalog. The real list comes from each harness (Claude Agent SDK, Codex app-server) at connect time. Claude's
// entries carry real SDK ids; Codex's carry none, so Codex runs the user's configured default.
export const MODELS: ModelOption[] = [
  { id: 'opus-5.5', harness: 'claude', name: 'Opus 5.5', note: 'Hardest problems and long runs', context: '200K', providerModel: 'claude-opus-5-5' },
  { id: 'sonnet-5.5', harness: 'claude', name: 'Sonnet 5.5', note: 'Fast, strong default', context: '200K', providerModel: 'claude-sonnet-5-5' },
  { id: 'haiku-5.5', harness: 'claude', name: 'Haiku 5.5', note: 'Quick edits and lookups', context: '200K', providerModel: 'claude-haiku-5-5' },
  { id: 'gpt-5.5-codex', harness: 'codex', name: 'GPT-5.5 Codex', note: 'Tuned for agentic coding', context: '272K' },
  { id: 'gpt-5.5', harness: 'codex', name: 'GPT-5.5', note: 'General reasoning', context: '272K' },
  { id: 'gpt-5.5-mini', harness: 'codex', name: 'GPT-5.5 mini', note: 'Cheap and fast', context: '128K' },
];

/** A model named in Settings that the catalog doesn't list: its id is the harness's own id. */
export function settingsModel(id: string, harness: Provider): ModelOption {
  return { id, harness, name: id, note: 'Default in Settings', context: '', providerModel: id };
}

export const DEFAULT_CONTROLS = {
  claude: { model: 'opus-5.5', effort: 'High', access: 'Auto edit' },
  codex: { model: 'gpt-5.5-codex', effort: 'High', access: 'Auto edit' },
} satisfies Record<Provider, ThreadControls>;

export function controlsOf(thread: Thread): ThreadControls {
  return thread.controls ?? DEFAULT_CONTROLS[thread.providers[0]];
}

/** A new thread's controls. `defaultModel` is the Settings default ('' = the harness's own), shown as its catalog entry when it has one. */
export function initialControls(provider: Provider, defaultModel: string): ThreadControls {
  if (!defaultModel) return DEFAULT_CONTROLS[provider];
  const listed = MODELS.find((m) => m.harness === provider && m.providerModel === defaultModel);
  return { ...DEFAULT_CONTROLS[provider], model: listed?.id ?? defaultModel };
}

const EFFORT_LEVELS = { Low: 'low', Medium: 'medium', High: 'high', 'Extra high': 'xhigh' } satisfies Record<Effort, string>;

// Claude's adapter refuses `bypassPermissions`, so Full access is its `auto` mode; Codex's adapter maps these names onto its policies.
const PERMISSION_MODES = {
  claude: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'auto' },
  codex: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'bypassPermissions' },
} satisfies Record<Provider, Record<Access, string>>;

export function agentOptions(controls: ThreadControls, provider: Provider) {
  const listed = MODELS.find((m) => m.id === controls.model);
  return { model: listed ? listed.providerModel : controls.model, effort: EFFORT_LEVELS[controls.effort], permissionMode: PERMISSION_MODES[provider][controls.access] };
}
