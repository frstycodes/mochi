import { useEffect, useState } from 'react';
import { toast } from '@/toast/store';
import { host } from '../host';
import { connectorIcon, connectorKey } from './connectors';
import type { ConnectorSettings } from './connectorTools';
import type { LibraryEntry } from './library';
import { serviceName } from './names';

/** One connector as the tools page shows it: every account on one server, under the connector's name. */
export interface ToolsConnector {
  key: string;
  name: string;
  url: string;
  icon: string | null;
  hasSignedIn: boolean;
}

/** The connectors in the library, their settings, and listing their tools: any never listed is listed on first view. */
export function useConnectorTools(entries: LibraryEntry[] | null) {
  const [settings, setSettings] = useState<Record<string, ConnectorSettings> | null>(null);
  const [listing, setListing] = useState<Set<string>>(new Set());
  const connectors = entries && connectorsOf(entries);

  const list = (key: string) => {
    setListing((keys) => new Set(keys).add(key));
    void host.library.listConnectorTools(key).then(
      (toolList) => setSettings((all) => ({ ...all, [key]: { ...all?.[key], toolList } })),
      (error: Error) => toast.error('Tools not listed', { description: error.message }),
    ).finally(() => setListing((keys) => new Set([...keys].filter((k) => k !== key))));
  };

  useEffect(() => {
    host.library.connectorSettings().then(setSettings, (error: Error) => toast.error("Couldn't read connector settings", { description: error.message }));
  }, []);

  const unlisted = settings && connectors ? connectors.filter((c) => !settings[c.key]?.toolList && !listing.has(c.key)).map((c) => c.key) : [];
  useEffect(() => unlisted.forEach(list), [unlisted.join()]);

  const save = (key: string, change: (current: ConnectorSettings) => ConnectorSettings) => {
    const { toolList: _, ...next } = change(settings?.[key] ?? {});
    const toolList = settings?.[key]?.toolList;
    setSettings((all) => ({ ...all, [key]: { ...next, ...(toolList && { toolList }) } }));
    void host.library.setConnectorSettings(key, next).then(setSettings, (error: Error) => {
      toast.error('Not saved', { description: error.message });
      void host.library.connectorSettings().then(setSettings, () => {});
    });
  };

  return { connectors, settings, isListing: (key: string) => listing.has(key), list, save };
}

/** Accounts grouped by connector key, in the order their first account was added. */
function connectorsOf(entries: LibraryEntry[]): ToolsConnector[] {
  const byKey = new Map<string, ToolsConnector>();
  for (const entry of entries) {
    if (entry.kind !== 'connector' || !entry.source || !URL.canParse(entry.source)) continue;
    const key = connectorKey(entry.source);
    const known = byKey.get(key);
    byKey.set(key, { key, name: serviceName(entry), url: entry.source, icon: known?.icon ?? connectorIcon(entry.source), hasSignedIn: !!known?.hasSignedIn || entry.isLinked === true });
  }
  return [...byKey.values()];
}
