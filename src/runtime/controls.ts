import type { AgentAskModel } from '../host/types/agent.ts';
import type { SideChatModel } from '../host/types/settings.ts';
import type { Provider, Thread } from '../model.ts';
import { getPrefs } from '../settings/prefs.ts';

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

/** Settings and the SDK name Claude models by their own id; the model chip by catalog id. */
export function claudeModelId(providerModel: string) {
  return MODELS.find((m) => m.harness === 'claude' && m.providerModel === providerModel)?.id ?? providerModel;
}

/** A side chat choice as the model chip names it; a Claude model saved by its own id reads back as its catalog entry. */
export function sideChatChoice(choice: SideChatModel): SideChatModel {
  return choice.provider === 'claude' ? { ...choice, model: claudeModelId(choice.model) } : choice;
}

/** What `host.agent.ask` takes for a chip choice: the catalog entry's harness and real id, else the id as the harness's own. */
export function askModelOf(choice: SideChatModel): AgentAskModel {
  const listed = MODELS.find((m) => m.id === choice.model);
  if (!listed) return choice;
  return listed.providerModel ? { provider: listed.harness, model: listed.providerModel } : { provider: listed.harness };
}

export const DEFAULT_CONTROLS = {
  claude: { model: 'opus-5.5', effort: 'High', access: 'Auto edit' },
  codex: { model: 'gpt-5.5-codex', effort: 'High', access: 'Auto edit' },
} satisfies Record<Provider, ThreadControls>;

export function controlsOf(thread: Thread): ThreadControls {
  return thread.controls ?? DEFAULT_CONTROLS[thread.providers[0]];
}

/**
 * A new thread's controls: effort and permissions from Settings › Harnesses and › Defaults for new threads. `defaultModel`
 * is the harness's Settings default ('' = the harness's own), shown as its catalog entry when it has one.
 */
export function initialControls(provider: Provider, defaultModel: string): ThreadControls {
  const { effort, permissions } = getPrefs();
  const controls = { ...DEFAULT_CONTROLS[provider], effort, access: permissions };
  if (!defaultModel) return controls;
  const listed = MODELS.find((m) => m.harness === provider && m.providerModel === defaultModel);
  return { ...controls, model: listed?.id ?? defaultModel };
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
