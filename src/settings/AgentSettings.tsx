import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { AccountId, AccountsState, AgentInstall, AgentSettings, AgentSettingsPatch, ApiKeyState } from '../host/types/settings';
import type { Provider } from '../model';
import { HARNESS_IDS, HARNESSES } from './harnesses';
import { defaultAccountId } from './accounts';
import { isNewerVersion } from './parse';

export type InstallState = AgentInstall | 'checking';

type AgentSettingsValue = ReturnType<typeof useAgentSettingsState>;

const Context = createContext<AgentSettingsValue | null>(null);

/**
 * Loads agent settings and, unless `isDetecting` is off, detects every account once per settings visit (a settings widget
 * in a thread shows no login state, so it skips starting each tool). Sections read it through `useAgentSettings`.
 */
export function AgentSettingsProvider({ isDetecting = true, children }: { isDetecting?: boolean; children: ReactNode }) {
  return <Context.Provider value={useAgentSettingsState(isDetecting)}>{children}</Context.Provider>;
}

export function useAgentSettings() {
  const value = useContext(Context);
  if (!value) throw new Error('useAgentSettings must be used inside AgentSettingsProvider');
  return value;
}

function useAgentSettingsState(isDetecting: boolean) {
  const [installs, setInstalls] = useState<Record<AccountId, InstallState>>({});
  const [settings, setSettings] = useState<AgentSettings>();
  const [accounts, setAccounts] = useState<AccountsState>();
  const [apiKeys, setApiKeys] = useState<Partial<Record<Provider, ApiKeyState>>>({});
  const [latest, setLatest] = useState<Partial<Record<Provider, string | null>>>({});
  const [updating, setUpdating] = useState<Provider | null>(null);
  const [restartNeeded, setRestartNeeded] = useState<Provider[]>([]);

  const check = useCallback((id: AccountId) => {
    setInstalls((prev) => ({ ...prev, [id]: 'checking' }));
    host.settings.detect(id).then(
      (install) => setInstalls((prev) => ({ ...prev, [id]: install })),
      (error: Error) => setInstalls((prev) => ({ ...prev, [id]: { provider: 'claude', accountId: id, path: null, version: null, login: { state: 'unknown', reason: ipcMessage(error) } } })),
    );
  }, []);
  const checkLatest = useCallback((provider: Provider) => {
    setLatest((prev) => ({ ...prev, [provider]: undefined }));
    void host.settings.latestVersion(provider).then(
      (version) => setLatest((prev) => ({ ...prev, [provider]: version })),
      () => setLatest((prev) => ({ ...prev, [provider]: null })),
    );
  }, []);

  useEffect(() => {
    // The web build keeps these in memory (the side chat default works there); accounts and keys need the desktop app.
    void host.settings.get().then(setSettings);
    if (!host.isDesktop) return;
    if (isDetecting) HARNESS_IDS.forEach(checkLatest);
    for (const id of HARNESS_IDS) if (HARNESSES[id].apiKey) void host.settings.apiKey(id).then((state) => setApiKeys((prev) => ({ ...prev, [id]: state })));
    void host.settings.accounts().then((state) => {
      setAccounts(state);
      if (isDetecting) state.accounts.forEach((a) => check(a.id));
    });
  }, [check, checkLatest, isDetecting]);

  const checkProvider = (provider: Provider) => {
    accounts?.accounts.filter((a) => a.provider === provider).forEach((a) => check(a.id));
    checkLatest(provider);
  };

  const updateHarness = (provider: Provider) => {
    setUpdating(provider);
    void host.settings.updateHarness(provider).then(
      (install) => {
        setInstalls((prev) => ({ ...prev, [install.accountId]: install }));
        setRestartNeeded((prev) => [...new Set([...prev, provider])]);
        checkProvider(provider);
        toast.success(`${HARNESSES[provider].name} updated`, { description: 'Restart Mochi to use the new version in running sessions.' });
      },
      (error: Error) => toast.error('Update failed', { description: ipcMessage(error) }),
    ).finally(() => setUpdating(null));
  };
  const isUpdateAvailable = (provider: Provider) => {
    const install = installs[defaultAccountId(provider)];
    return isNewerVersion(latest[provider] ?? null, install && install !== 'checking' ? install.version : null);
  };

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
    latest,
    updating,
    restartNeeded,
    updateHarness,
    isUpdateAvailable,
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
