import type { SideChatModel } from '../host/types/settings.ts';
import type { Provider, Thread } from '../model.ts';
import { getPrefs } from '../settings/prefs.ts';
import { effortId, modelId } from './models.ts';

/** Settings' default effort choices; a model's own list comes from its provider (`AgentModel.efforts`). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export const ACCESS = ['Ask first', 'Auto edit', 'Full access'] as const;
export type Access = (typeof ACCESS)[number];

/** What the composer's model, effort and permissions menus chose for a thread. GAP: an agent reads them at start only; a change mid-run applies at its next start (the API-key restart). */
export interface ThreadControls {
  /** The provider's own model id; '' runs the account's default. */
  model: string;
  /** A provider effort id ('high', 'xhigh'); a model that doesn't take it runs its own default. */
  effort: string;
  access: Access;
}

/** A saved side chat choice with an old catalog id read as the provider's own. */
export const sideChatChoice = (choice: SideChatModel): SideChatModel => ({ ...choice, model: modelId(choice.model) });

export const DEFAULT_CONTROLS = {
  claude: { model: '', effort: 'high', access: 'Auto edit' },
  codex: { model: '', effort: 'high', access: 'Auto edit' },
} satisfies Record<Provider, ThreadControls>;

export function controlsOf(thread: Thread): ThreadControls {
  const controls = thread.controls ?? DEFAULT_CONTROLS[thread.providers[0]];
  return { ...controls, model: modelId(controls.model), effort: effortId(controls.effort) };
}

/** A new thread's controls: effort and permissions from Settings › Harnesses and › Defaults, the model from the harness's Settings default ('' = the account's). */
export function initialControls(provider: Provider, defaultModel: string): ThreadControls {
  const { effort, permissions } = getPrefs();
  return { ...DEFAULT_CONTROLS[provider], model: modelId(defaultModel), effort: effortId(effort), access: permissions };
}

// Claude's adapter refuses `bypassPermissions`, so Full access is its `auto` mode; Codex's adapter maps these names onto its policies.
const PERMISSION_MODES = {
  claude: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'auto' },
  codex: { 'Ask first': 'default', 'Auto edit': 'acceptEdits', 'Full access': 'bypassPermissions' },
} satisfies Record<Provider, Record<Access, string>>;

/** Main swaps a model the account doesn't offer (or none) for the account's default, and an effort the model doesn't take for its own. */
export function agentOptions(controls: ThreadControls, provider: Provider) {
  return { model: controls.model || undefined, effort: controls.effort, permissionMode: PERMISSION_MODES[provider][controls.access] };
}
