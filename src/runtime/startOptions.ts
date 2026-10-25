import type { Provider } from '../model.ts';
import { getPrefs } from '../settings/prefs.ts';
import { DEFAULT_CONTROLS, type ThreadControls } from './controls.ts';
import { effortId, modelId } from './models.ts';

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
