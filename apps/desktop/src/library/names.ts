import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { MOCHI_SERVER } from '@mochi/domain/runtime/toolTable';
import {
  connectorIcon,
  connectorKey,
  CONNECTORS,
} from '@mochi/domain/library/connectors';
import { skillPluginName, type LibraryEntry } from './library.ts';

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
    return {
      title: entry?.title ?? deslug(name),
      raw: name,
      ...(entry?.icon && { image: entry.icon }),
    };
  };

  const server = (key: string): DisplayName => {
    if (key === MOCHI_SERVER) return { title: 'Mochi', raw: key };
    // Claude scopes a plugin's own servers as `plugin:<plugin>:<server>`.
    const scoped = /^plugin:([^:]+):/.exec(key);
    if (scoped) return { ...plugin(scoped[1]), raw: key };
    const account = entries.find(
      (e) =>
        e.kind === 'connector' &&
        !!e.source &&
        URL.canParse(e.source) &&
        connectorKey(e.source) === key,
    );
    if (account?.source)
      return {
        title: serviceName(account),
        raw: key,
        url: account.source,
        ...(account.icon && { image: account.icon }),
      };
    const known = CONNECTORS.find((c) => c.id === key);
    if (known) {
      const image = connectorIcon(known.serverUrl);
      return {
        title: known.name,
        raw: key,
        url: known.serverUrl,
        ...(image && { image }),
      };
    }
    // claude.ai's own connectors already arrive named ("claude.ai Slack").
    return { title: /[\sA-Z]/.test(key) ? key : deslug(key), raw: key };
  };

  /** `<plugin>:<skill>`, the library's own as `<owner>:<skill>` (`skillPluginName`), or a bare skill name. */
  const skill = (raw: string): DisplayName => {
    const [owner, name] = raw.includes(':') ? raw.split(':', 2) : [null, raw];
    const title = deslug(name);
    const entry = entries.find(
      (e) =>
        e.kind === 'skill' &&
        e.name === name &&
        (owner === null || skillPluginName(e.source) === owner),
    );
    const image =
      entry?.icon ?? (owner !== null ? plugin(owner).image : undefined);
    return { title, raw, ...(image && { image }) };
  };

  /** A server's tool in words: `slack_search_messages` on `slack` → "Search messages". */
  const tool = (serverKey: string, name: string) => {
    const prefix = `${serverKey.replace(/[^a-zA-Z0-9]+/g, '_')}_`.toLowerCase();
    return deslug(
      name.toLowerCase().startsWith(prefix) && name.length > prefix.length
        ? name.slice(prefix.length)
        : name,
    );
  };

  /** A call mid-sentence: "search messages on Slack", "… on Slack (work)" when it named one of several accounts. */
  const call = (serverKey: string, toolName: string, account?: string) =>
    `${tool(serverKey, toolName).toLowerCase()} on ${server(serverKey).title}${account ? ` (${account})` : ''}`;

  return { server, plugin, skill, tool, call };
}

export type LibraryNames = ReturnType<typeof libraryNames>;

/** `google-workspace` → "Google workspace", `get_issue` → "Get issue". */
export function deslug(name: string) {
  const words = name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

/** A connector account's service name, as named when added or renamed: its title without ` · <alias>`. */
export const serviceName = (entry: LibraryEntry) =>
  entry.alias && entry.title.endsWith(` · ${entry.alias}`)
    ? entry.title.slice(0, -` · ${entry.alias}`.length)
    : entry.title;

// One set for the whole window: items are installed once, so every profile's list names them alike.
const namesStore = createStore(() => ({ names: libraryNames([]) }));

/** Called with each fresh library list, so names follow installs and renames. */
export function setLibraryNames(entries: LibraryEntry[]) {
  namesStore.setState({ names: libraryNames(entries) });
}

/** The names now, for code outside React (labels built in plain functions). */
export const namesNow = () => namesStore.getState().names;

/** The names, re-rendering when the library list changes. */
export function useLibraryNames() {
  return useStore(namesStore, (s) => s.names);
}
