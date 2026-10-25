import type { Provider } from '../model.ts';
import { profileById } from '../profiles.ts';
import { getPrefs } from '../settings/prefs.ts';
import { permissionModeOf } from './access.ts';
import { DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';
import { effortId, modelId } from './models.ts';
import { setStartEnv } from './startEnv.ts';

/** A new thread's controls: effort, speed and permissions from Settings › Models and › General, the model from the harness's Settings default ('' = the account's). */
export function initialControls(
  provider: Provider,
  defaultModel: string,
): ThreadControls {
  const { effort, speed, permissions } = getPrefs();
  return {
    ...DEFAULT_CONTROLS[provider],
    model: modelId(defaultModel),
    effort: effortId(effort),
    speed,
    access: permissions,
  };
}

/**
 * Main swaps a model the account doesn't offer (or none) for the account's default, an effort the model doesn't take for its own, and drops a speed it doesn't list.
 * `nativeOff` carries the profile's turned-off Claude Code or Codex items for this harness; main maps them onto the session's overrides.
 */
export function agentOptions(
  controls: ThreadControls,
  provider: Provider,
  spaceId: string,
) {
  const nativeOff =
    profileById(spaceId).nativeOff?.filter((id) =>
      id.startsWith(`${provider}:`),
    ) ?? [];
  return {
    model: controls.model || undefined,
    effort: controls.effort,
    ...(controls.speed && { speed: controls.speed }),
    permissionMode: permissionModeOf(provider, controls.access),
    ...(!getPrefs().goals && { isGoalsOff: true }),
    ...(nativeOff.length && { nativeOff }),
  };
}

setStartEnv({ agentOptions });
