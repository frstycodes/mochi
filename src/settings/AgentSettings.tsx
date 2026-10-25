import { useQueries, useQuery } from '@tanstack/react-query';
import { queryClient } from '../query.ts';
import { queryKeys } from '../queryKeys.ts';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { toast } from '../toast/store.ts';
import { host } from '../host';
import type { AccountId, AccountsState, AgentInstall, AgentSettingsPatch, ApiKeyState } from '../host/types/settings';
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
  const settingsQuery = useQuery({ queryKey: queryKeys.agent.settings(), queryFn: () => host.settings.get() });
  const accountsQuery = useQuery({ queryKey: queryKeys.agent.accounts(), queryFn: () => host.settings.accounts(), enabled: host.isDesktop });
  const settings = settingsQuery.data;
  const accounts = accountsQuery.data;
  const accountList = accounts?.accounts ?? [];
  const installQueries = useQueries({ queries: accountList.map((account) => ({ queryKey: queryKeys.agent.install(account.id), queryFn: () => host.settings.detect(account.id), enabled: host.isDesktop && isDetecting, staleTime: 60_000 })) });
  const installs: Record<AccountId, InstallState> = Object.fromEntries(accountList.map((account, i) => {
    const installQuery = installQueries[i];
    return [account.id, installQuery.isFetching ? 'checking' : installQuery.data ?? (installQuery.error ? { provider: account.provider, accountId: account.id, path: null, version: null, login: { state: 'unknown', reason: ipcMessage(installQuery.error) } } : 'checking')];
  }));
  const latestQueries = useQueries({ queries: HARNESS_IDS.map((provider) => ({ queryKey: queryKeys.agent.version(provider), queryFn: () => host.settings.latestVersion(provider), enabled: host.isDesktop && isDetecting, staleTime: 60_000 })) });
  const latest = Object.fromEntries(HARNESS_IDS.map((id, i) => [id, latestQueries[i].isFetching ? undefined : latestQueries[i].data ?? null]));
  const keyQueries = useQueries({ queries: HARNESS_IDS.map((provider) => ({ queryKey: queryKeys.agent.apiKey(provider), queryFn: () => host.settings.apiKey(provider), enabled: host.isDesktop && !!HARNESSES[provider].apiKey })) });
  const apiKeys: Partial<Record<Provider, ApiKeyState>> = Object.fromEntries(HARNESS_IDS.map((id, i) => [id, keyQueries[i].data]));
  const [updating, setUpdating] = useState<Provider | null>(null);
  const [restartNeeded, setRestartNeeded] = useState<Provider[]>([]);
  const check = (id: AccountId) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agent.install(id) });
    void queryClient.fetchQuery({ queryKey: queryKeys.agent.install(id), queryFn: () => host.settings.detect(id) }).catch(() => {});
  };
  const checkLatest = (provider: Provider) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.agent.version(provider) });
    void queryClient.fetchQuery({ queryKey: queryKeys.agent.version(provider), queryFn: () => host.settings.latestVersion(provider) }).catch(() => {});
  };

  const checkProvider = (provider: Provider) => {
    accounts?.accounts.filter((a) => a.provider === provider).forEach((a) => check(a.id));
    checkLatest(provider);
  };

  const updateHarness = (provider: Provider) => {
    setUpdating(provider);
    void host.settings.updateHarness(provider).then(
      (install) => {
        queryClient.setQueryData(queryKeys.agent.install(install.accountId), install);
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
      queryClient.setQueryData(queryKeys.agent.settings(), next);
      for (const id of HARNESS_IDS) if (patch.harnesses?.[id]?.path !== undefined) checkProvider(id);
    }, fail('Setting not saved'));

  /** Every account mutation returns the whole registry; a new account is detected right away so its sign-in command shows. */
  const mutateAccounts = (run: () => Promise<AccountsState>, error: string) =>
    run().then((next) => {
      next.accounts.filter((a) => !accounts?.accounts.some((b) => b.id === a.id)).forEach((a) => check(a.id));
      queryClient.setQueryData(queryKeys.agent.accounts(), next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.library.nativeItems.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent.notes.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reviewer.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.config.all() });
      return true;
    }, fail(error));

  /** Resolves true once stored; the caller clears its input so the key leaves renderer state. */
  const saveApiKey = (provider: Provider, key: string | null) =>
    host.settings.setApiKey(provider, key).then((state) => {
      queryClient.setQueryData(queryKeys.agent.apiKey(provider), state);
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
