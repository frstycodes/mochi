import type { Provider } from '../model.ts';
import { prefsNow, profilesNow } from '../store/context.ts';
import { permissionModeOf } from './access.ts';
import type { ThreadControls } from './controls.ts';

/**
 * Main swaps a model the account doesn't offer (or none) for the account's default, an effort the model doesn't take for its own, and drops a speed it doesn't list.
 * `nativeOff` carries the profile's turned-off Claude Code or Codex items for this harness; main maps them onto the session's overrides.
 * Reads the context in scope: Core's when Core applies a command (`withContext`), else this window's.
 */
export function agentOptions(
  controls: ThreadControls,
  provider: Provider,
  spaceId: string,
) {
  const nativeOff =
    profilesNow()
      .find((p) => p.id === spaceId)
      ?.nativeOff?.filter((id) => id.startsWith(`${provider}:`)) ?? [];
  return {
    model: controls.model || undefined,
    effort: controls.effort,
    ...(controls.speed && { speed: controls.speed }),
    permissionMode: permissionModeOf(provider, controls.access),
    ...(!prefsNow().goals && { isGoalsOff: true }),
    ...(nativeOff.length && { nativeOff }),
  };
}
