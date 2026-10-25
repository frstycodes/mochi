import type * as Ipc from '../../packages/schema/src/ipc/settings.ts';
import type * as Settings from '../../packages/schema/src/settings.ts';
import type * as H from '../host/types/settings.ts';
import type { ConfigChange } from '../settings/agentConfig.ts';
import type { Provider } from '../model.ts';
import type { Check, Decoded, Rpc, Same } from './check.ts';

/** `Stored` in electron/agents/config.ts, as main reads the file: every field optional. */
type SettingsFile = H.AgentSettingsPatch &
  Partial<H.AccountsState> & {
    apiKeys?: Partial<Record<Provider, string>>;
    pastWorktreeRoots?: string[];
  };

export type Conformance = [
  Check<Same<Decoded<typeof Settings.AgentSettings>, H.AgentSettings>>,
  Check<Same<Decoded<typeof Settings.AccountsState>, H.AccountsState>>,
  Check<Same<Decoded<typeof Settings.SettingsFileV1>, SettingsFile>>,
  Check<Same<Decoded<typeof Ipc.AgentSettingsPatch>, H.AgentSettingsPatch>>,
  Check<Same<Decoded<typeof Ipc.ConfigChange>, ConfigChange>>,
  Check<Rpc<H.SettingsHost, typeof Ipc.settingsRpc>>,
];
