import { connectorFor, connectorKey, OAUTH_PROVIDER_IDS } from '../../library/connectors.ts';
import { FEATURED_MARKETPLACES, libraryEntries, removeItem, setItemEnabled, type LibraryIndex, type LibraryItem } from '../../library/library.ts';
import type { LibraryHost } from '../types/library.ts';
import { fixtureParts, MARKETPLACE_CATALOGS, SKILL_CATALOGS } from './libraryFixtures.ts';

// The web build has no agents to load a library into: it browses fixed catalogs and installs into memory, starting
// with a few items in the demo's first profile, so every state of the Library page can be seen and tried.
const DAY = 86_400_000;

let index: LibraryIndex = seed();

const install = (spaceId: string, item: LibraryItem) => {
  index = { ...index, items: [...index.items.filter((i) => i.id !== item.id), item] };
  index = setItemEnabled(index, spaceId, item.id, true);
  return libraryEntries(index, spaceId);
};

export const library: LibraryHost = {
  async list(spaceId) {
    return libraryEntries(index, spaceId);
  },
  async setEnabled(spaceId, id, isEnabled) {
    index = setItemEnabled(index, spaceId, id, isEnabled);
    return libraryEntries(index, spaceId);
  },
  async remove(spaceId, id) {
    index = removeItem(index, id);
    return libraryEntries(index, spaceId);
  },
  async importFromAccount() {
    throw new Error('Importing from an account needs the desktop app');
  },
  async discoverSkills(source) {
    await pause();
    const skills = SKILL_CATALOGS[source];
    if (!skills) throw new Error(`The web preview only browses ${Object.keys(SKILL_CATALOGS).join(' and ')}`);
    return skills;
  },
  async installSkill(spaceId, source, name) {
    await pause();
    const skill = SKILL_CATALOGS[source]?.find((s) => s.name === name);
    if (!skill) throw new Error(`${name} isn't in ${source}`);
    return install(spaceId, { kind: 'skill', id: `skill-${name}`, name, description: skill.description, files: {}, source: skill.source, icon: skill.icon, targets: ['claude', 'codex'], addedAt: Date.now() });
  },
  async marketplaces() {
    return [...FEATURED_MARKETPLACES, ...index.marketplaces];
  },
  async addMarketplace() {
    throw new Error('Adding a marketplace needs the desktop app');
  },
  async removeMarketplace(name) {
    index = { ...index, marketplaces: index.marketplaces.filter((m) => m.name !== name) };
    return FEATURED_MARKETPLACES;
  },
  async marketplaceCatalog(name) {
    await pause();
    const catalog = MARKETPLACE_CATALOGS[name];
    if (!catalog) throw new Error(`No marketplace named ${name}`);
    return catalog;
  },
  async installPlugin(spaceId, marketplace, name) {
    await pause();
    const plugin = MARKETPLACE_CATALOGS[marketplace]?.plugins.find((p) => p.name === name);
    if (!plugin) throw new Error(`${name} isn't in ${marketplace}`);
    return install(spaceId, pluginItem(marketplace, plugin.name));
  },
  async addConnector(spaceId, { url, alias }) {
    await pause();
    return install(spaceId, connectorItem(url, alias, true));
  },
  onDeviceCode() {
    return () => {};
  },
  onAuthorize() {
    return () => {};
  },
  async runSetup() {
    throw new Error('Setup runs need the desktop app');
  },
  async updateSetupStep() {
    throw new Error('Setup runs need the desktop app');
  },
  async oauthApps() {
    return [...OAUTH_PROVIDER_IDS, 'google' as const];
  },
  async ownAppRedirect() {
    return 'https://mochi-relay.example.workers.dev/oauth/callback';
  },
  async signIn(spaceId, id) {
    await pause();
    index = { ...index, items: index.items.map((i) => (i.id === id && i.kind === 'connector' ? { ...i, isLinked: true } : i)) };
    return libraryEntries(index, spaceId);
  },
  async update(spaceId, id, autoUpdate) {
    await pause();
    index = { ...index, items: index.items.map((i) => (i.id !== id ? i : autoUpdate === undefined ? { ...i, updatedAt: Date.now() } : { ...i, autoUpdate })) };
    return libraryEntries(index, spaceId);
  },
};

const pause = () => new Promise((resolve) => setTimeout(resolve, 400));

function pluginItem(marketplace: string, name: string): LibraryItem {
  const plugin = MARKETPLACE_CATALOGS[marketplace].plugins.find((p) => p.name === name)!;
  const { skills, subagents, remotes } = fixtureParts(name, plugin.category);
  const bundle = { name, title: plugin.title, description: plugin.description, version: plugin.version, skills, subagents, hooks: [], servers: [], remotes, files: {}, unsupported: [] };
  return { kind: 'plugin', id: `plugin-${name}`, bundle, marketplace, icon: plugin.icon, targets: ['claude', 'codex'], addedAt: Date.now() };
}

function connectorItem(url: string, alias: string, isLinked: boolean): LibraryItem {
  const key = connectorKey(url);
  return { kind: 'connector', id: `connector-${key}-${alias}`, key, title: connectorFor(url)?.name ?? new URL(url).hostname, url, alias, isLinked, targets: ['claude', 'codex'], addedAt: Date.now() };
}

/** The demo's first profile starts with a little of everything, one account signed out and one plugin updated. */
function seed(): LibraryIndex {
  const skills = SKILL_CATALOGS['anthropics/skills'];
  const items: LibraryItem[] = [
    ...['pdf', 'frontend-design'].map((name): LibraryItem => {
      const s = skills.find((k) => k.name === name)!;
      return { kind: 'skill', id: `skill-${name}`, name, description: s.description, files: {}, source: s.source, icon: s.icon, targets: ['claude', 'codex'], addedAt: Date.now() - 9 * DAY };
    }),
    { ...pluginItem('claude-plugins-official', 'code-review'), updatedAt: Date.now() - 2 * DAY },
    pluginItem('claude-plugins-official', 'linear'),
    connectorItem('https://mcp.linear.app/mcp', 'work', true),
    connectorItem('https://mcp.linear.app/mcp', 'personal', true),
    connectorItem('https://mcp.notion.com/mcp', 'work', false),
  ];
  return { items, profiles: { latitude: items.map((i) => i.id) }, marketplaces: [] };
}
