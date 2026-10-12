import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { host } from '../host';
import type { AgentInstall, AgentSettings, ApiKeyState } from '../host/types/settings';
import type { Provider } from '../model';

export type InstallState = AgentInstall | 'checking';

/** Loads settings and runs detection each time Settings opens (desktop only); detection is a few child processes, cheap enough to repeat. */
export function useAgentSettings(isOpen: boolean) {
  const [installs, setInstalls] = useState<Record<Provider, InstallState>>({ claude: 'checking', codex: 'checking' });
  const [settings, setSettings] = useState<AgentSettings>();
  const [apiKey, setApiKey] = useState<ApiKeyState>();

  const check = useCallback((provider: Provider) => {
    setInstalls((prev) => ({ ...prev, [provider]: 'checking' }));
    host.settings.detect(provider).then(
      (install) => setInstalls((prev) => ({ ...prev, [provider]: install })),
      (error: Error) => setInstalls((prev) => ({ ...prev, [provider]: { provider, path: null, version: null, login: { state: 'unknown', reason: error.message } } })),
    );
  }, []);

  useEffect(() => {
    if (!isOpen || !host.isDesktop) return;
    void host.settings.get().then(setSettings);
    void host.settings.apiKey().then(setApiKey);
    check('claude');
    check('codex');
  }, [isOpen, check]);

  const update = (patch: Partial<AgentSettings>) =>
    host.settings.set(patch).then(
      (next) => {
        setSettings(next);
        if (patch.claudePath !== undefined) check('claude');
        if (patch.codexPath !== undefined) check('codex');
      },
      (error: Error) => toast.error('Setting not saved', { description: ipcMessage(error) }),
    );

  /** Resolves true once stored; the caller clears its input so the key leaves renderer state. */
  const saveApiKey = (key: string | null) =>
    host.settings.setApiKey(key).then(
      (state) => {
        setApiKey(state);
        return true;
      },
      (error: Error) => {
        toast.error('API key not saved', { description: ipcMessage(error) });
        return false;
      },
    );

  return { installs, check, settings, update, apiKey, saveApiKey };
}

// Electron prefixes rejected invoke errors with "Error invoking remote method '<channel>': <Type>: ".
function ipcMessage(error: Error) {
  return error.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '');
}
