import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import type { AccountId, AccountsState, AgentInstall, AgentSettings, AgentSettingsPatch, ApiKeyState } from '../host/types/settings';
import type { Provider } from '../model';
import { HARNESS_IDS, HARNESSES } from './harnesses';

export type InstallState = AgentInstall | 'checking';

type AgentSettingsValue = ReturnType<typeof useAgentSettingsState>;

const Context = createContext<AgentSettingsValue | null>(null);

/** Loads agent settings and detects every account once per settings visit; sections read it through `useAgentSettings`. */
export function AgentSettingsProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useAgentSettingsState()}>{children}</Context.Provider>;
}

export function useAgentSettings() {
  const value = useContext(Context);
  if (!value) throw new Error('useAgentSettings must be used inside AgentSettingsProvider');
  return value;
}

function useAgentSettingsState() {
  const [installs, setInstalls] = useState<Record<AccountId, InstallState>>({});
  const [settings, setSettings] = useState<AgentSettings>();
  const [accounts, setAccounts] = useState<AccountsState>();
  const [apiKeys, setApiKeys] = useState<Partial<Record<Provider, ApiKeyState>>>({});

  const check = useCallback((id: AccountId) => {
    setInstalls((prev) => ({ ...prev, [id]: 'checking' }));
    host.settings.detect(id).then(
      (install) => setInstalls((prev) => ({ ...prev, [id]: install })),
      (error: Error) => setInstalls((prev) => ({ ...prev, [id]: { provider: 'claude', accountId: id, path: null, version: null, login: { state: 'unknown', reason: ipcMessage(error) } } })),
    );
  }, []);

  useEffect(() => {
    if (!host.isDesktop) return;
    void host.settings.get().then(setSettings);
    for (const id of HARNESS_IDS) if (HARNESSES[id].apiKey) void host.settings.apiKey(id).then((state) => setApiKeys((prev) => ({ ...prev, [id]: state })));
    void host.settings.accounts().then((state) => {
      setAccounts(state);
      state.accounts.forEach((a) => check(a.id));
    });
  }, [check]);

  const checkProvider = (provider: Provider) => accounts?.accounts.filter((a) => a.provider === provider).forEach((a) => check(a.id));

  const update = (patch: AgentSettingsPatch) =>
    host.settings.set(patch).then((next) => {
      setSettings(next);
      for (const id of HARNESS_IDS) if (patch.harnesses?.[id]?.path !== undefined) checkProvider(id);
    }, fail('Setting not saved'));

  /** Every account mutation returns the whole registry; a new account is detected right away so its sign-in command shows. */
  const mutateAccounts = (run: () => Promise<AccountsState>, error: string) =>
    run().then((next) => {
      next.accounts.filter((a) => !accounts?.accounts.some((b) => b.id === a.id)).forEach((a) => check(a.id));
      setAccounts(next);
      return true;
    }, fail(error));

  /** Resolves true once stored; the caller clears its input so the key leaves renderer state. */
  const saveApiKey = (provider: Provider, key: string | null) =>
    host.settings.setApiKey(provider, key).then((state) => {
      setApiKeys((prev) => ({ ...prev, [provider]: state }));
      return true;
    }, fail('API key not saved'));

  return {
    installs,
    check,
    checkProvider,
    settings,
    update,
    accounts,
    addAccount: (provider: Provider, name: string) => mutateAccounts(() => host.settings.addAccount(provider, name), 'Account not added'),
    renameAccount: (id: AccountId, name: string) => mutateAccounts(() => host.settings.renameAccount(id, name), 'Account not renamed'),
    removeAccount: (id: AccountId) => mutateAccounts(() => host.settings.removeAccount(id), 'Account not removed'),
    linkAccount: (spaceId: string, provider: Provider, id: AccountId) => mutateAccounts(() => host.settings.linkAccount(spaceId, provider, id), 'Profile not linked'),
    apiKeys,
    saveApiKey,
  };
}

function fail(title: string) {
  return (error: Error) => {
    toast.error(title, { description: ipcMessage(error) });
    return false as const;
  };
}

// Electron prefixes rejected invoke errors with "Error invoking remote method '<channel>': <Type>: ".
export function ipcMessage(error: Error) {
  return error.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
