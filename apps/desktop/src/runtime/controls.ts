import type { TurnPolicy } from '../host/types/agent.ts';
import type { ModelChoice } from '../host/types/settings.ts';
import type { Provider, Thread } from '../model.ts';
import { accessOf, permissionModeOf, type Access } from './access.ts';
import { effortId, modelId } from './models.ts';

/** Settings' default effort choices; a model's own list comes from its provider (`AgentModel.efforts`). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * What the composer's model, effort, speed and permissions menus chose for a thread. GAP: an agent reads model and effort at
 * start only; a change mid-run applies at its next start (the API-key restart). Speed and permissions go with every message (`policyOf`).
 */
export interface ThreadControls {
  /** The provider's own model id; '' runs the account's default. */
  model: string;
  /** A provider effort id ('high', 'xhigh'); a model that doesn't take it runs its own default. */
  effort: string;
  /** '' standard, `fast` the model's first faster tier, or a tier id (`speedFor`); a model without it runs standard. */
  speed: string;
  access: Access;
}

/** The `TurnPolicy` a message carries; the settings chat keeps the mode it started in. */
export function policyOf(thread: Thread): TurnPolicy {
  const { speed, access } = controlsOf(thread);
  if (thread.isSettingsChat) return { speed };
  const provider = thread.session?.provider ?? thread.providers[0];
  return { speed, permissionMode: permissionModeOf(provider, access) };
}

/** A saved side chat choice with an old catalog id read as the provider's own. */
export const sideChatChoice = (choice: ModelChoice): ModelChoice => ({
  ...choice,
  model: modelId(choice.model),
});

export const DEFAULT_CONTROLS = {
  claude: { model: '', effort: 'high', speed: '', access: 'Auto' },
  codex: { model: '', effort: 'high', speed: '', access: 'Auto' },
} satisfies Record<Provider, ThreadControls>;

export function controlsOf(thread: Thread): ThreadControls {
  const controls = thread.controls ?? DEFAULT_CONTROLS[thread.providers[0]];
  // Threads saved before speed existed ran standard.
  return {
    ...controls,
    model: modelId(controls.model),
    effort: effortId(controls.effort),
    speed: controls.speed ?? '',
    access: accessOf(controls.access),
  };
}
