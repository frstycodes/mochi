import { useSyncExternalStore } from 'react';
import { MOCHI_SERVER } from '../runtime/toolTable.ts';
import { connectorIcon, connectorKey, CONNECTORS } from './connectors.ts';
import { STANDALONE_PLUGIN, type LibraryEntry } from './library.ts';

/** What to show for a server, plugin or skill: its human name, its own image when it has one, the raw id for a tooltip. */
export interface DisplayName {
  title: string;
  raw: string;
  image?: string;
  /** The server's real address, for its site's favicon. */
  url?: string;
}

/** Turns the code names threads report (server keys, `mcp__` tool names, `plugin:skill`) into the names Customize shows. */
export function libraryNames(entries: LibraryEntry[]) {
  const plugin = (name: string): DisplayName => {
    const entry = entries.find((e) => e.kind === 'plugin' && e.name === name);
    return { title: entry?.title ?? deslug(name), raw: name, ...(entry?.icon && { image: entry.icon }) };
  };

  const server = (key: string): DisplayName => {
    if (key === MOCHI_SERVER) return { title: 'Mochi', raw: key };
    // Claude scopes a plugin's own servers as `plugin:<plugin>:<server>`.
    const scoped = /^plugin:([^:]+):/.exec(key);
    if (scoped) return { ...plugin(scoped[1]), raw: key };
    const account = entries.find((e) => e.kind === 'connector' && !!e.source && URL.canParse(e.source) && connectorKey(e.source) === key);
    if (account?.source) return { title: serviceName(account), raw: key, url: account.source, ...(account.icon && { image: account.icon }) };
    const known = CONNECTORS.find((c) => c.id === key);
    if (known) {
      const image = connectorIcon(known.serverUrl);
      return { title: known.name, raw: key, url: known.serverUrl, ...(image && { image }) };
    }
    // claude.ai's own connectors already arrive named ("claude.ai Slack").
    return { title: /[\sA-Z]/.test(key) ? key : deslug(key), raw: key };
  };

  /** `<plugin>:<skill>`, standalone skills as `mochi:<skill>`, or a bare skill name. */
  const skill = (raw: string): DisplayName => {
    const [owner, name] = raw.includes(':') ? raw.split(':', 2) : [STANDALONE_PLUGIN, raw];
    const title = deslug(name);
    if (owner !== STANDALONE_PLUGIN) {
      const { image } = plugin(owner);
      return { title, raw, ...(image && { image }) };
    }
    const entry = entries.find((e) => e.kind === 'skill' && e.name === name);
    return { title, raw, ...(entry?.icon && { image: entry.icon }) };
  };

  /** A server's tool in words: `slack_search_messages` on `slack` → "Search messages". */
  const tool = (serverKey: string, name: string) => {
    const prefix = `${serverKey.replace(/[^a-zA-Z0-9]+/g, '_')}_`.toLowerCase();
    return deslug(name.toLowerCase().startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name);
  };

  /** A call mid-sentence: "search messages on Slack", "… on Slack (work)" when it named one of several accounts. */
  const call = (serverKey: string, toolName: string, account?: string) => `${tool(serverKey, toolName).toLowerCase()} on ${server(serverKey).title}${account ? ` (${account})` : ''}`;

  return { server, plugin, skill, tool, call };
}

export type LibraryNames = ReturnType<typeof libraryNames>;

/** `google-workspace` → "Google workspace", `get_issue` → "Get issue". */
export function deslug(name: string) {
  const words = name.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/** A connector account's service name, as named when added or renamed: its title without ` · <alias>`. */
export const serviceName = (entry: LibraryEntry) => (entry.alias && entry.title.endsWith(` · ${entry.alias}`) ? entry.title.slice(0, -` · ${entry.alias}`.length) : entry.title);

// One set for the whole window: items are installed once, so every profile's list names them alike.
let current = libraryNames([]);
const listeners = new Set<() => void>();

/** Called with each fresh library list, so names follow installs and renames. */
export function setLibraryNames(entries: LibraryEntry[]) {
  current = libraryNames(entries);
  for (const listener of listeners) listener();
}

/** The names now, for code outside React (labels built in plain functions). */
export const namesNow = () => current;

/** The names, re-rendering when the library list changes. */
export function useLibraryNames() {
  return useSyncExternalStore(subscribe, namesNow);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
